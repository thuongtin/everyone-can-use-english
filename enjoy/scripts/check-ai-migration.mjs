import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(root, ".tmp-enjoy-ai-migration-"));

try {
  const output = path.join(temp, "conversation-migration.mjs");
  await build({
    stdin: {
      contents: `export {
  migrateConversationChatConfig,
  migrateConversationGptConfig,
  normalizeChatConfigForRead,
  readChatSttEngine,
} from "./src/lib/conversation-migration.ts";`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
  });

  const {
    migrateConversationChatConfig,
    migrateConversationGptConfig,
    normalizeChatConfigForRead,
    readChatSttEngine,
  } = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
  const tests = [];
  const test = (name, callback) => {
    callback();
    tests.push(name);
  };
  const defaults = { engine: "enjoyai", model: "gpt-4o" };
  const providers = [
    "gemini",
    "deepseek",
    "openrouter",
    "lmstudio",
    "ollama",
    "enjoyai",
    "openai",
  ];

  for (const provider of providers) {
    test(`preserves ${provider} provider and model`, () => {
      const config = migrateConversationGptConfig(
        {
          engine: provider,
          model: `${provider}-model`,
          key: "fake-provider-key",
          baseUrl: `https://${provider}.invalid`,
        },
        defaults
      );

      assert.equal(config.engine, provider);
      assert.equal(config.model, `${provider}-model`);
      assert.equal("key" in config, false);
      assert.equal("baseUrl" in config, false);
    });
  }

  test("preserves an unknown historical provider and model", () => {
    assert.deepEqual(
      migrateConversationGptConfig(
        {
          engine: "legacy-provider-v99",
          model: "legacy-model-v99",
        },
        defaults
      ),
      {
        engine: "legacy-provider-v99",
        model: "legacy-model-v99",
        temperature: undefined,
        maxCompletionTokens: undefined,
        frequencyPenalty: undefined,
        presencePenalty: undefined,
        historyBufferSize: undefined,
        numberOfChoices: undefined,
      }
    );
  });

  test("uses existing defaults only for empty historical values", () => {
    assert.deepEqual(
      migrateConversationGptConfig(
        { engine: "  ", model: "" },
        defaults
      ),
      {
        engine: "enjoyai",
        model: "gpt-4o",
        temperature: undefined,
        maxCompletionTokens: undefined,
        frequencyPenalty: undefined,
        presencePenalty: undefined,
        historyBufferSize: undefined,
        numberOfChoices: undefined,
      }
    );

    const partial = migrateConversationGptConfig(
      { engine: "legacy-provider-v99", model: "" },
      defaults
    );
    assert.equal(partial.engine, "legacy-provider-v99");
    assert.equal(partial.model, "gpt-4o");
  });

  test("writes sttEngine and reads legacy stt without rewriting it", () => {
    assert.deepEqual(
      migrateConversationChatConfig(
        { sttEngine: "openai", stt: "legacy-stt" },
        "enjoy_azure"
      ),
      { sttEngine: "openai" }
    );
    assert.deepEqual(
      migrateConversationChatConfig({ stt: "openai" }, "enjoy_azure"),
      { sttEngine: "openai" }
    );
    assert.deepEqual(
      migrateConversationChatConfig({ sttEngine: "", stt: "" }, "enjoy_azure"),
      { sttEngine: "enjoy_azure" }
    );
    assert.equal(
      readChatSttEngine({ sttEngine: "openai", stt: "legacy-stt" }),
      "openai"
    );
    assert.equal(readChatSttEngine({ stt: "openai" }), "openai");
    assert.equal(readChatSttEngine({ sttEngine: "", stt: "" }), undefined);
    assert.equal(readChatSttEngine(undefined), undefined);
  });

  test("normalizes legacy STT in a read projection without mutating the row", () => {
    const legacyConfig = { stt: "legacy-openai", prompt: "keep-me" };
    const projection = normalizeChatConfigForRead(legacyConfig);

    assert.deepEqual(projection, {
      stt: "legacy-openai",
      sttEngine: "legacy-openai",
      prompt: "keep-me",
    });
    assert.deepEqual(legacyConfig, {
      stt: "legacy-openai",
      prompt: "keep-me",
    });
  });

  const modelOutput = path.join(temp, "chat-model.mjs");
  const mocks = {
    models: `export class ChatAgent {}\nexport class ChatMember {}\nexport class ChatMessage {}`,
    window: `export default { win: null }`,
    logger: `export default { scope: () => ({ error() {} }) }`,
    enums: `export const ChatAgentTypeEnum = { GPT: "GPT", TTS: "TTS" }; export const ChatTypeEnum = { CONVERSATION: "CONVERSATION", GROUP: "GROUP", TTS: "TTS" };`,
    i18next: `export const t = (value) => value;`,
  };

  await build({
    stdin: {
      contents: `export { Chat } from "./src/main/db/models/chat.ts";
export { DataTypes, Sequelize } from "sequelize";`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: modelOutput,
    external: ["sequelize", "sequelize-typescript"],
    logLevel: "silent",
    plugins: [
      {
        name: "chat-model-mocks",
        setup(pluginBuild) {
          pluginBuild.onResolve(
            { filter: new RegExp("^@main/db/models$") },
            () => ({ path: "models", namespace: "mock" })
          );
          pluginBuild.onResolve(
            { filter: new RegExp("^@main/window$") },
            () => ({ path: "window", namespace: "mock" })
          );
          pluginBuild.onResolve(
            { filter: new RegExp("^@main/logger$") },
            () => ({ path: "logger", namespace: "mock" })
          );
          pluginBuild.onResolve(
            { filter: new RegExp("^@/types/enums$") },
            () => ({ path: "enums", namespace: "mock" })
          );
          pluginBuild.onResolve(
            { filter: new RegExp("^i18next$") },
            () => ({ path: "i18next", namespace: "mock" })
          );
          pluginBuild.onResolve(
            { filter: new RegExp("^@/") },
            (args) => ({
              path: `${path.join(root, "src", args.path.slice(2))}.ts`,
            })
          );
          pluginBuild.onLoad(
            { filter: /.*/, namespace: "mock" },
            (args) => ({ contents: mocks[args.path], loader: "ts" })
          );
        },
      },
    ],
  });

  const { Chat, DataTypes, Sequelize } = await import(
    `${pathToFileURL(modelOutput).href}?test=${Date.now()}`
  );
  const sequelize = new Sequelize({
    dialect: "sqlite",
    storage: ":memory:",
    logging: false,
  });
  try {
    Chat.initialize(
      {
        id: { type: DataTypes.UUID, primaryKey: true },
        type: DataTypes.STRING,
        name: DataTypes.STRING,
        digest: DataTypes.TEXT,
        config: DataTypes.JSON,
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
      },
      {
        sequelize,
        modelName: "Chat",
        tableName: "chats",
        timestamps: true,
      }
    );

    test("Chat DTO exposes legacy STT where the renderer caller reads it", () => {
      const storedConfig = { stt: "legacy-openai", prompt: "keep-me" };
      const chat = Chat.build({
        id: "chat-1",
        type: "CONVERSATION",
        name: "Legacy",
        config: storedConfig,
      });
      const dto = chat.toJSON();

      assert.equal(dto.config.sttEngine, "legacy-openai");
      assert.equal(dto.config.stt, "legacy-openai");
      assert.equal(dto.config.prompt, "keep-me");
      assert.equal(chat.config.sttEngine, undefined);
      assert.equal(chat.config.stt, "legacy-openai");

      const transcribeRequest = { service: dto.config.sttEngine };
      assert.equal(transcribeRequest.service, "legacy-openai");
    });
  } finally {
    await sequelize.close();
  }

  console.info(
    `check-ai-migration: PASS (${tests.length} provider and persistence cases)`
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
