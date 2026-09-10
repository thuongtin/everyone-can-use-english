import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-provider-selection-"));

try {
  const output = path.join(temp, "provider-selection-migration.mjs");
  await build({
    stdin: {
      contents: `export * from "./src/lib/provider-selection-migration.ts";
export * from "./src/lib/conversation-migration.ts";`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
  });
  const subject = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);

  const guard = subject.createProviderSelectionRequestGuard();
  const tokenA = guard.activate("connected:profile-a");
  let resolveA;
  const deferredA = new Promise((resolve) => {
    resolveA = resolve;
  });
  let visibleProfile = "";
  const applyWhenCurrent = async (token, pending) => {
    const value = await pending;
    if (guard.isCurrent(token)) visibleProfile = value;
  };
  const lateA = applyWhenCurrent(tokenA, deferredA);
  const tokenB = guard.activate("connected:profile-b");
  await applyWhenCurrent(tokenB, Promise.resolve("profile-b"));
  resolveA("profile-a");
  await lateA;
  assert.equal(visibleProfile, "profile-b");
  guard.activate("disconnected::");
  assert.equal(guard.isCurrent(tokenB), false);

  const missingTts = subject.createProviderSelectionRequiredTtsConfig("en-US");
  assert.deepEqual(
    {
      engine: missingTts.engine,
      model: missingTts.model,
      voice: missingTts.voice,
      language: missingTts.language,
    },
    { engine: "needs-selection", model: "", voice: "", language: "en-US" },
  );
  assert.deepEqual(subject.resolveSynthesisProviderSelection(missingTts), {
    status: "needs-selection",
    reason: "selection-required",
  });

  const aiSettingsSource = await readFile(
    path.join(root, "src/renderer/context/ai-settings-provider.tsx"),
    "utf8",
  );
  assert.doesNotMatch(aiSettingsSource, /setTtsConfigState\(null\)/u);
  assert.match(
    aiSettingsSource,
    /await bridge\.status\(\)[\s\S]{0,250}if \(!requestGuard\.isCurrent\(request\)\) return;/u,
  );
  assert.match(
    aiSettingsSource,
    /const discovered = await Promise\.all\([\s\S]{0,900}if \(!active \|\| !requestGuard\.isCurrent\(request\)\) return;/u,
  );
  assert.match(
    aiSettingsSource,
    /storedProviders[\s\S]{0,500}if \(!requestGuard\.isCurrent\(request\)\) return;/u,
  );
  assert.match(aiSettingsSource, /loadedScope === requestScope/u);

  const validText = {
    name: "gemini",
    models: {
      default: "custom-gemini",
      lookup: "lookup-model",
      translate: "translate-model",
      analyze: "analysis-model",
      extractStory: "story-model",
    },
    roleDefinition: "Keep this custom prompt",
  };
  assert.deepEqual(subject.resolveTextProviderSelection(validText), {
    status: "configured",
    value: validText,
  });
  const validVertexText = {
    name: "vertex-express",
    models: {
      default: "publisher-model",
      lookup: "vertex-lookup-model",
    },
    roleDefinition: "Keep the Vertex prompt",
    entityBinding: { type: "document", id: "document-1" },
  };
  assert.deepEqual(subject.resolveTextProviderSelection(validVertexText), {
    status: "configured",
    value: validVertexText,
  });
  assert.deepEqual(
    subject.resolveTextProviderSelection({
      ...validVertexText,
      models: { default: "" },
    }),
    { status: "invalid-configuration", reason: "model-required" },
  );
  assert.deepEqual(subject.resolveTextProviderSelection(null), {
    status: "unconfigured",
  });
  assert.deepEqual(
    subject.resolveTextProviderSelection({
      name: "enjoyai",
      models: { default: "gpt-4o", lookup: "custom-lookup" },
    }),
    { status: "needs-selection", reason: "legacy-provider" },
  );

  const validConversationGpt = subject.migrateConversationGptConfig(
    {
      engine: "openai",
      model: "custom-model",
      baseUrl: "https://gateway.example/v1",
      temperature: 0.3,
    },
    { engine: "needs-selection", model: "" },
  );
  assert.deepEqual(validConversationGpt, {
    engine: "openai",
    model: "custom-model",
    baseUrl: "https://gateway.example/v1",
    temperature: 0.3,
    maxCompletionTokens: undefined,
    frequencyPenalty: undefined,
    presencePenalty: undefined,
    historyBufferSize: undefined,
    numberOfChoices: undefined,
  });
  const legacyConversationGpt = subject.migrateConversationGptConfig(
    { engine: "enjoyai", model: "gpt-4o", baseUrl: "https://legacy.invalid" },
    { engine: "needs-selection", model: "" },
  );
  assert.equal(legacyConversationGpt.engine, "needs-selection");
  assert.equal(legacyConversationGpt.model, "");
  assert.deepEqual(legacyConversationGpt.providerSelectionMigration.backup, {
    engine: "enjoyai",
    model: "gpt-4o",
    baseUrl: "https://legacy.invalid",
  });
  assert.deepEqual(
    subject.migrateConversationGptConfig(
      legacyConversationGpt,
      { engine: "needs-selection", model: "" },
    ),
    legacyConversationGpt,
  );

  const legacyChat = { stt: "enjoy_azure", prompt: "keep" };
  const chatProjection = subject.normalizeChatConfigForRead(legacyChat);
  assert.equal(chatProjection.sttEngine, "needs-selection");
  assert.equal(chatProjection.prompt, "keep");
  assert.equal(chatProjection.providerSelectionMigration.backup.sttEngine, "enjoy_azure");
  assert.deepEqual(legacyChat, { stt: "enjoy_azure", prompt: "keep" });
  assert.deepEqual(subject.normalizeChatConfigForRead(chatProjection), chatProjection);

  const legacyTts = {
    engine: "enjoyai",
    model: "openai/tts-1",
    voice: "alloy",
    language: "en-US",
  };
  const migratedTts = subject.migrateConversationTtsConfig(legacyTts);
  assert.equal(migratedTts.engine, "needs-selection");
  assert.deepEqual(migratedTts.providerSelectionMigration.backup, legacyTts);
  assert.deepEqual(subject.migrateConversationTtsConfig(migratedTts), migratedTts);
  assert.deepEqual(
    subject.resolveTextProviderSelection({
      name: "retired-provider",
      models: { default: "custom-model" },
    }),
    { status: "needs-selection", reason: "unsupported-provider" },
  );
  assert.deepEqual(
    subject.resolveTextProviderSelection({ name: "openai", models: {} }),
    { status: "invalid-configuration", reason: "model-required" },
  );
  assert.deepEqual(
    subject.resolveTextProviderSelection({
      name: "codex-acp",
      models: { default: "" },
    }),
    {
      status: "configured",
      value: { name: "codex-acp", models: { default: "" } },
    },
  );

  for (const engine of [
    "local",
    "cloudflare_workers_ai",
    "mai_transcribe",
    "openai",
  ]) {
    assert.deepEqual(subject.resolveTranscriptionProviderSelection(engine), {
      status: "configured",
      value: engine,
    });
  }
  for (const engine of ["enjoy_azure", "enjoy_cloudflare"]) {
    assert.deepEqual(subject.resolveTranscriptionProviderSelection(engine), {
      status: "needs-selection",
      reason: "legacy-provider",
    });
  }

  const validSpeech = {
    engine: "openai",
    model: "gpt-4o-mini-tts",
    voice: "nova",
    baseUrl: "https://speech.example/v1",
    language: "en-US",
  };
  assert.deepEqual(subject.resolveSynthesisProviderSelection(validSpeech), {
    status: "configured",
    value: validSpeech,
  });
  const validAzureSpeech = {
    engine: "azure",
    model: "azure/speech",
    voice: "en-US-JennyNeural",
    language: "en-US",
  };
  assert.deepEqual(subject.resolveSynthesisProviderSelection(validAzureSpeech), {
    status: "configured",
    value: validAzureSpeech,
  });
  assert.deepEqual(
    subject.resolveSynthesisProviderSelection({
      engine: "enjoyai",
      model: "openai/tts-1",
      voice: "alloy",
    }),
    { status: "needs-selection", reason: "legacy-provider" },
  );
  assert.deepEqual(
    subject.resolveSynthesisProviderSelection({
      engine: "openai",
      model: "unknown",
      voice: "alloy",
    }),
    { status: "invalid-configuration", reason: "model-or-voice-invalid" },
  );

  const legacyInput = {
    gptEngine: {
      name: "enjoyai",
      models: { default: "gpt-4o", lookup: "custom-lookup" },
      roleDefinition: "Historical prompt",
    },
    sttEngine: "enjoy_azure",
    ttsConfig: {
      engine: "enjoyai",
      model: "azure/speech",
      voice: "en-US-JennyNeural",
      language: "en-US",
    },
  };
  const migration = subject.planProviderSelectionMigration(legacyInput);
  assert.equal(migration.version, 1);
  assert.deepEqual(migration.backup, legacyInput);
  assert.deepEqual(migration.updates, {
    gptEngine: { name: "needs-selection", models: { default: "" } },
    sttEngine: "needs-selection",
    ttsConfig: { engine: "needs-selection" },
  });
  const preparedRecord = {
    version: 1,
    status: "prepared",
    backup: migration.backup,
    updates: migration.updates,
  };
  assert.deepEqual(
    subject.readProviderSelectionMigrationRecord(preparedRecord),
    preparedRecord,
  );
  assert.equal(
    subject.readProviderSelectionMigrationRecord({ ...preparedRecord, version: 2 }),
    null,
  );

  assert.deepEqual(
    subject.planProviderSelectionMigration({
      ...legacyInput,
      ...migration.updates,
    }).updates,
    {},
  );
  assert.deepEqual(
    subject.planProviderSelectionMigration({
      gptEngine: validText,
      sttEngine: "openai",
      ttsConfig: validSpeech,
    }),
    {
      version: 1,
      backup: {},
      updates: {},
    },
  );
  assert.deepEqual(
    subject.planProviderSelectionMigration({
      gptEngine: validVertexText,
      sttEngine: "openai",
      ttsConfig: validSpeech,
    }),
    {
      version: 1,
      backup: {},
      updates: {},
    },
  );

  console.log("check-ai-migration: PASS");
} finally {
  await rm(temp, { recursive: true, force: true });
}
