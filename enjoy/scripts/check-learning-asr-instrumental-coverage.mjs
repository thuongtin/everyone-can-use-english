import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const temporary = await mkdtemp(path.join(os.tmpdir(), 'asr-instrumental-'));
try {
  const output = path.join(temporary, 'coverage.mjs');
  await build({
    entryPoints: ['src/main/learning-asr/instrumental-coverage.ts'],
    outfile: output, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
    plugins: [{ name: 'unused-vad', setup(builder) {
      builder.onResolve({filter: /^echogarden\/dist\/api\/API\.js$/}, () => ({path:'vad',namespace:'test'}));
      builder.onLoad({filter:/.*/,namespace:'test'}, () => ({contents:'export function detectVoiceActivity(){throw new Error("unexpected VAD call");}'}));
    }}],
  });
  const {createMusicAwareSpeechCoverage, YAMNET_MODEL_SHA256} = await import(pathToFileURL(output));
  const audio = new Uint8Array([1]);
  const intro = {startTime:.09,endTime:3.4};
  const missingWord = {startTime:4.1298125,endTime:5.210625};
  const classify = (gap, overrides={}) => ({...gap,modelSha256:YAMNET_MODEL_SHA256,musicMean:.6,vocalMax:.01,analyzedWindows:6,completeFrameCoverage:true,...overrides});
  let calls = 0;
  const coverage = createMusicAwareSpeechCoverage(async () => {
    calls++;
    return [classify(intro),classify(missingWord,{musicMean:0,vocalMax:.58})];
  }, async () => [intro,missingWord]);
  assert.deepEqual(await coverage.findSpeechGaps(audio,[],12),[missingWord]);
  assert.deepEqual(await coverage.findSpeechGaps(audio,[],12),[missingWord]);
  assert.equal(calls,1,'Repeated repair checks must reuse source classification');
  assert.equal(coverage.evidence(audio).length,1);
  assert.equal(coverage.evidence(audio)[0].modelSha256,YAMNET_MODEL_SHA256);
  const secondAudio = new Uint8Array([2]);
  const sourceScoped = createMusicAwareSpeechCoverage(async bytes => bytes === audio ? [classify(intro)] : [classify(intro,{vocalMax:.9})],async()=>[intro]);
  assert.deepEqual(await sourceScoped.findSpeechGaps(audio,[],12),[]);
  assert.equal(sourceScoped.evidence(audio).length,1);
  assert.deepEqual(await sourceScoped.findSpeechGaps(secondAudio,[],12),[intro]);
  assert.deepEqual(sourceScoped.evidence(secondAudio),[],'Different source audio must not inherit instrumental evidence');
  for (const result of [
    undefined, null, {}, [], [null],
    [classify(intro,{modelSha256:'different-model'})],
    [classify(intro,{completeFrameCoverage:false})],
    [classify(intro,{musicMean:NaN})],
    [classify(intro,{vocalMax:-1})],
    [classify(intro,{analyzedWindows:0})],
    [classify(intro,{endTime:3.3})],
    [classify(intro),classify(intro)],
    [classify(intro,{musicMean:.9,vocalMax:.3})],
  ]) {
    const check = createMusicAwareSpeechCoverage(async()=>result,async()=>[intro]);
    assert.deepEqual(await check.findSpeechGaps(audio,[],12),[intro]);
    assert.deepEqual(check.evidence(audio),[]);
  }
  const broken = createMusicAwareSpeechCoverage(async()=>{throw new Error('WASM unavailable');},async()=>[intro]);
  assert.deepEqual(await broken.findSpeechGaps(audio,[],12),[intro]);
  const controller = new AbortController();
  const cancelled = createMusicAwareSpeechCoverage(async()=>{controller.abort();throw new Error('closed');},async()=>[intro]);
  await assert.rejects(cancelled.findSpeechGaps(audio,[],12,controller.signal),error=>error.code==='asr_cancelled');
  const healthy = createMusicAwareSpeechCoverage(async()=>{throw new Error('must stay lazy');},async()=>[]);
  assert.deepEqual(await healthy.findSpeechGaps(audio,[],12),[]);
  const longGap={startTime:0,endTime:16};
  const bounded=createMusicAwareSpeechCoverage(async()=>{throw new Error('must not classify long input');},async()=>[longGap]);
  assert.deepEqual(await bounded.findSpeechGaps(audio,[],20),[longGap]);
  console.log('PASS: instrumental evidence, vocal protection, complete-frame requirement, malformed/failure fallback, cache, lazy bounds and cancellation');
} finally { await rm(temporary,{recursive:true,force:true}); }
