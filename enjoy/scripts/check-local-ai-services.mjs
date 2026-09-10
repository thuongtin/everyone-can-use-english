/* global globalThis:readonly */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-local-ai-"));
const require = createRequire(import.meta.url);

const virtualModulePlugin = (modules) => ({
  name: "local-ai-test-modules",
  setup(builder) {
    for (const [specifier, contents] of Object.entries(modules)) {
      const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      builder.onResolve({ filter: new RegExp(`^${escaped}$`) }, () => ({
        path: specifier,
        namespace: "local-ai-test",
      }));
      builder.onLoad(
        { filter: /.*/, namespace: "local-ai-test" },
        (args) => (args.path === specifier ? { contents, loader: "ts" } : null)
      );
    }
  },
});

try {
  const output = path.join(temp, "local-ai-services.cjs");
  await build({
    entryPoints: [path.join(root, "src/lib/local-ai-services.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: output,
    logLevel: "silent",
  });
  const {
    createLocalLookupRecord,
    createLookupCacheKey,
    createAICacheKey,
  } = require(output);

  const first = createLocalLookupRecord({
    word: "  hello ",
    context: "Hello there",
    nativeLanguage: "vi-VN",
    now: "2026-09-07T00:00:00.000Z",
  });
  const second = createLocalLookupRecord({
    word: "hello",
    context: "Hello there",
    nativeLanguage: "vi-VN",
    now: "2026-09-07T01:00:00.000Z",
  });
  assert.equal(first.id, second.id);
  assert.equal(
    createLookupCacheKey("  hello ", "Hello there"),
    createLookupCacheKey("hello", "Hello there")
  );
  assert.match(first.id, /^local-[a-f0-9]{32}$/u);
  assert.deepEqual(first, {
    id: first.id,
    word: "hello",
    context: "Hello there",
    contextTranslation: "",
    meaningOptions: [],
    createdAt: "2026-09-07T00:00:00.000Z",
    updatedAt: "2026-09-07T00:00:00.000Z",
  });

  const scope = { nativeLanguage: "vi-VN", learningLanguage: "en-US", provider: "codex-acp", model: "codex-model" };
  const scopedKey = createLookupCacheKey("hello", "Hello there", scope);
  for (const [key, value] of Object.entries({ nativeLanguage: "fr-FR", learningLanguage: "es-ES", provider: "openai", model: "another-model" })) {
    assert.notEqual(createLookupCacheKey("hello", "Hello there", { ...scope, [key]: value }), scopedKey);
  }

  const hookOutput = path.join(temp, "use-ai-command.cjs");
  await build({
    entryPoints: [path.join(root, "src/renderer/hooks/use-ai-command.tsx")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: hookOutput,
    logLevel: "silent",
    plugins: [
      virtualModulePlugin({
        react: `
          export const useContext = (context) =>
            globalThis.__localAiHookFixture.contexts[context];
        `,
        "@renderer/context": `
          export const AppSettingsProviderContext = "app";
          export const AISettingsProviderContext = "ai";
        `,
        "@commands": `
          const invoke = (name, args) =>
            globalThis.__localAiHookFixture.commands[name](...args);
          export const lookupCommand = (...args) => invoke("lookupCommand", args);
          export const translateCommand = (...args) => invoke("translateCommand", args);
          export const extractStoryCommand = (...args) => invoke("unexpected", args);
          export const analyzeCommand = (...args) => invoke("analyzeCommand", args);
          export const punctuateCommand = (...args) => invoke("unexpected", args);
          export const summarizeTopicCommand = (...args) => invoke("unexpected", args);
          export const refineCommand = (...args) => invoke("unexpected", args);
          export const chatSuggestionCommand = (...args) => invoke("chatSuggestionCommand", args);
        `,
      }),
    ],
  });

  const cacheValues = new Map();
  const hookCalls = { remote: 0, cacheWrites: [], lookup: 0, translate: 0 };
  globalThis.__localAiHookFixture = {
    contexts: {
      app: {
        EnjoyApp: {
          cacheObjects: {
            get: async (key) => cacheValues.get(key),
            set: async (key, value) => {
              cacheValues.set(key, value);
              hookCalls.cacheWrites.push({ key, value });
            },
          },
        },
        webApi: {
          lookup: async () => {
            hookCalls.remote += 1;
            throw new Error("local lookup reached the network");
          },
          updateLookup: async () => {
            hookCalls.remote += 1;
          },
          translations: async () => {
            hookCalls.remote += 1;
            throw new Error("local translation reached the network");
          },
          createTranslation: async () => {
            hookCalls.remote += 1;
          },
        },
        nativeLanguage: "vi-VN",
        learningLanguage: "en-US",
        apiUrl: "https://must-not-be-used.invalid",
        localMode: true,
      },
      ai: {
        currentGptEngine: {
          name: "codex-acp",
          models: { default: "codex-model", lookup: "codex-model" },
        },
        getProviderConfig: () => ({
          name: "codex-acp",
          models: "codex-model",
        }),
      },
    },
    commands: {
      lookupCommand: async ({ word }) => {
        hookCalls.lookup += 1;
        return {
          id: "meaning-1",
          word,
          definition: "a greeting",
          translation: "xin chào",
          lookups: [],
        };
      },
      translateCommand: async () => {
        hookCalls.translate += 1;
        return "bản dịch cục bộ";
      },
      analyzeCommand: async () => "analysis result",
      chatSuggestionCommand: async () => ({ suggestions: [{ text: "Hello", explaination: "greeting" }] }),
      unexpected: async () => {
        throw new Error("unexpected command");
      },
    },
  };

  const { useAiCommand } = require(hookOutput);
  const commands = useAiCommand();
  const localLookup = await commands.lookupWord({
    word: "hello",
    context: "Hello there",
  });
  assert.equal(hookCalls.remote, 0);
  assert.equal(hookCalls.lookup, 1);
  assert.match(localLookup.id, /^local-[a-f0-9]{32}$/u);
  assert.equal(localLookup.meaning.translation, "xin chào");
  assert.equal(hookCalls.cacheWrites.length, 1);
  assert.equal(
    hookCalls.cacheWrites[0].key,
    createLookupCacheKey("hello", "Hello there", scope)
  );
  const cachedLookup = await commands.lookupWord({
    word: "hello",
    context: "Hello there",
  });
  assert.equal(cachedLookup, localLookup);
  assert.equal(hookCalls.lookup, 1);
  assert.equal(hookCalls.remote, 0);

  const localTranslation = await commands.translate(
    "Hello there",
    "translate-local-test"
  );
  assert.equal(localTranslation, "bản dịch cục bộ");
  assert.equal(hookCalls.remote, 0);
  assert.equal(hookCalls.translate, 1);
  assert.deepEqual(hookCalls.cacheWrites[1], {
    key: createAICacheKey("translate", "Hello there", scope),
    value: "bản dịch cục bộ",
  });
  assert.equal(
    await commands.translate("Hello there", "translate-local-test"),
    "bản dịch cục bộ"
  );
  assert.equal(hookCalls.translate, 1);
  assert.equal(hookCalls.remote, 0);

  await commands.analyzeText("Hello there", "legacy-analysis");
  assert.equal(cacheValues.has("legacy-analysis"), false);
  assert.equal(cacheValues.get(commands.analysisCacheKey("Hello there")), "analysis result");
  await commands.chatSuggestion("Chat context", { cacheKey: "legacy-suggestion", nativeLanguage: "fr-FR" });
  assert.equal(cacheValues.has("legacy-suggestion"), false);
  assert.deepEqual(cacheValues.get(commands.suggestionCacheKey("Chat context", { nativeLanguage: "fr-FR" })), {
    suggestions: [{ text: "Hello", explaination: "greeting" }],
  });
  assert.notEqual(commands.suggestionCacheKey("Chat context"), commands.suggestionCacheKey("Chat context", { nativeLanguage: "fr-FR" }));
  const oldAnalysisKey = commands.analysisCacheKey("Hello there");
  const oldSuggestionKey = commands.suggestionCacheKey("Chat context");
  for (const [target, property, value] of [
    [globalThis.__localAiHookFixture.contexts.app, "nativeLanguage", "ja-JP"],
    [globalThis.__localAiHookFixture.contexts.app, "learningLanguage", "de-DE"],
    [globalThis.__localAiHookFixture.contexts.ai.currentGptEngine, "name", "openai"],
    [globalThis.__localAiHookFixture.contexts.ai.currentGptEngine.models, "default", "new-model"],
  ]) {
    const original = target[property];
    target[property] = value;
    const changed = useAiCommand();
    assert.notEqual(changed.analysisCacheKey("Hello there"), oldAnalysisKey);
    assert.notEqual(changed.suggestionCacheKey("Chat context"), oldSuggestionKey);
    target[property] = original;
  }

  const hookSource = await readFile(
    path.join(root, "src/renderer/hooks/use-ai-command.tsx"),
    "utf8"
  );
  const widgetSource = await readFile(
    path.join(
      root,
      "src/renderer/components/widgets/lookup/ai-lookup-result.tsx"
    ),
    "utf8"
  );
  const conversationSource = await readFile(
    path.join(root, "src/renderer/hooks/use-conversation.tsx"),
    "utf8"
  );
  const chatSource = await readFile(
    path.join(root, "src/renderer/hooks/use-chat-session.tsx"),
    "utf8"
  );

  assert.doesNotMatch(hookSource, /webApi|readRemoteBestEffort|writeRemoteBestEffort/u);
  assert.doesNotMatch(widgetSource, /webApi|readRemoteBestEffort|writeRemoteBestEffort/u);
  globalThis.__localAiHookFixture.contexts.app.localMode = false;
  globalThis.__localAiHookFixture.contexts.app.nativeLanguage = "fr-FR";
  const changedCommands = useAiCommand();
  await changedCommands.lookupWord({ word: "hello", context: "Hello there" });
  await changedCommands.translate("Hello there", "translate-local-test");
  assert.equal(hookCalls.lookup, 2, "changing language must not reuse old lookup");
  assert.equal(hookCalls.translate, 2, "changing language must not reuse old translation");
  assert.equal(hookCalls.remote, 0, "remote persistence must never run even with old mode flag");
  assert.doesNotMatch(conversationSource, /user\?\.accessToken/u);
  assert.doesNotMatch(chatSource, /user\?\.accessToken/u);
  assert.match(
    hookSource,
    /await EnjoyApp\.cacheObjects\.set\(resolvedCacheKey, result\)/u
  );

  console.info(
    "check-local-ai-services: PASS (stable lookup, cache-first, local cloud boundary, credential consumers)"
  );
} finally {
  delete globalThis.__localAiHookFixture;
  await rm(temp, { recursive: true, force: true });
}
