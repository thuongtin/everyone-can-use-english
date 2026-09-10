#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

import { learningBrief, learningDraft } from "./fixtures/learning-lesson.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(root, ".tmp-azure-learning-"));
const output = path.join(temp, "subject.mjs");
const originalFetch = globalThis.fetch;

try {
  await build({
    entryPoints: [path.join(root, "src/main/learning/azure-text-generation.ts")],
    alias: { "@": path.join(root, "src") },
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
  });
  const { azureLearningGenerationPrompt, runAzureLearningTextGeneration } = await import(`${pathToFileURL(output).href}?check=${Date.now()}`);
  const identity = {
    jobId: "10000000-0000-4000-8000-000000000001",
    stageId: "10000000-0000-4000-8000-000000000002",
    attemptId: "10000000-0000-4000-8000-000000000003",
    revisionId: "10000000-0000-4000-8000-000000000004",
  };
  const prompts = [];
  let fetchCalls = 0;
  globalThis.fetch = async (_input, init = {}) => {
    fetchCalls += 1;
    const body = JSON.parse(String(init.body));
    prompts.push(body.messages.at(-1).content);
    const rejectedCandidate = {
      ...learningDraft,
      scenes: [{
        id: "rejected-scene",
        description: "A scene that the zero-image brief does not allow.",
        sectionIds: ["section-one"],
        targetIds: ["cup"],
      }],
    };
    const content = fetchCalls === 1
      ? "{}"
      : JSON.stringify(fetchCalls === 2 ? rejectedCandidate : learningDraft);
    return new Response(JSON.stringify({
      id: `chatcmpl-${fetchCalls}`,
      object: "chat.completion",
      created: 1,
      model: body.model,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const submissions = [];
  const context = { brief: learningBrief, rubric: { wordRange: [100, 180], maxSentenceWords: 16 } };
  const application = {
    async getTrustedJobContext(received) {
      assert.deepEqual(received, identity);
      return context;
    },
    async submitTrustedCandidate(received, kind, payload) {
      assert.deepEqual(received, identity);
      submissions.push({ kind, payload });
      return submissions.length === 1
        ? { accepted: false, issues: [{ code: "scene_count_mismatch", path: ["draft", "scenes"] }] }
        : { accepted: true, issues: [] };
    },
  };
  await runAzureLearningTextGeneration({
    application,
    identity,
    resourceType: "lesson",
    config: {
      key: "fixture-key",
      baseUrl: "https://fixture.openai.azure.com/openai/v1",
      modelName: "fixture-deployment",
      maxTokens: 12_000,
    },
    signal: new AbortController().signal,
  });
  assert.equal(fetchCalls, 3, "schema and validator failures should each receive a bounded repair");
  assert.match(prompts[0], /Output JSON Schema:/u);
  assert.match(prompts[1], /Issues from the previous candidate/u);
  assert.match(prompts[0], /exactly context\.brief\.imageCount scenes/u);
  assert.match(prompts[0], /meaning, fill, order, and retell/u);
  assert.match(prompts[0], /at least two exercises/u);
  assert.match(prompts[0], /context\.rubric\.wordRange/u);
  assert.match(prompts[2], /Previous rejected candidate/u);
  assert.match(prompts[2], /rejected-scene/u);
  assert.deepEqual(submissions.at(-1), { kind: "text", payload: learningDraft });

  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(runAzureLearningTextGeneration({
    application,
    identity,
    resourceType: "lesson",
    config: {
      key: "fixture-key",
      baseUrl: "https://fixture.openai.azure.com/openai/v1",
      modelName: "fixture-deployment",
    },
    signal: aborted.signal,
  }), { code: "azure_text_cancelled" });
  assert.equal(fetchCalls, 3, "pre-cancelled generation must not call Azure");

  const mapPrompt = azureLearningGenerationPrompt("map", {
    title: "Ordering drinks at a cafe",
    brief: { level: "A2", illustrations: false },
    rubric: { wordRange: [100, 180], maxSentenceWords: 16 },
  }, {});
  assert.match(mapPrompt, /context\.title as the authoritative learner topic/u);
  assert.match(mapPrompt, /Ordering drinks at a cafe/u);
  assert.match(mapPrompt, /Every nonroot node must be a concrete English word or phrase/u);
  assert.match(mapPrompt, /Never create vocabulary nodes named Meaning, Synonyms, Antonyms, Examples, Collocations/u);
  assert.match(mapPrompt, /Put pedagogical category labels only in studyGroups titles/u);
  assert.doesNotMatch(mapPrompt, /for Enjoy\./u);

  console.log("PASS: Azure learning generation states the full lesson rubric, binds mindmaps to the learner topic with concrete vocabulary nodes, repairs schema and validator failures from the previous candidate, submits through the trusted validator, and stops before transport when cancelled.");
} finally {
  globalThis.fetch = originalFetch;
  await rm(temp, { recursive: true, force: true });
}
