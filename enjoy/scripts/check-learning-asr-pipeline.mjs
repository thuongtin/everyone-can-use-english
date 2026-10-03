import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const temporary = await mkdtemp(path.join(os.tmpdir(), 'learning-asr-pipeline-'));
try {
  const entry = path.resolve('src/main/learning-asr');
  const out = path.join(temporary, 'pipeline.mjs');
  await build({ stdin: { contents: ['service','errors','audio-windows','checkpoints','alignment'].map(name => `export * from ${JSON.stringify(entry+'/'+name+'.ts')};`).join('\n') + `\nexport * from ${JSON.stringify(path.resolve('src/lib/transcription-speech-review.ts'))};`, resolveDir: process.cwd(), loader: 'ts' }, outfile: out, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent', plugins: [{ name: 'unused-local-aligner', setup(builder) { builder.onResolve({filter: /^\.\.\/echogarden$/}, () => ({path: 'eg', namespace: 'stub'})); builder.onLoad({filter: /.*/, namespace: 'stub'}, () => ({contents: 'export default {};', loader: 'js'})); } }] });
  const { createLearningAsrService, LearningAsrError, encodePcmWindow, parsePcmWav, createCheckpointStore, planTranscriptAlignment, planSeamGeometry, convertProviderWords, transcriptionSpeechReview, transcriptionQualityMetadata } = await import(pathToFileURL(out));
  const sampleRate = 100, frameCount = 10000, bytes = Buffer.alloc(frameCount * 2);
  for (let frame = 0; frame < frameCount; frame++) bytes.writeInt16LE(1000 + frame, frame * 2);
  const pcm = { sampleRate, channels: 1, frameCount, blockAlign: 2, pcm: bytes };
  assert.deepEqual(
    planSeamGeometry(
      { startSample: 0, endSample: 4700 },
      { startSample: 4300, endSample: 10000, coreStartSample: 4500 },
      false,
    ),
    { overlapStartSample: 4300, overlapEndSample: 4700, boundarySample: 4500 },
    'Normal adjacent windows must retain their existing seam bounds',
  );
  assert.deepEqual(
    planSeamGeometry(
      { startSample: 0, endSample: 11_069_120 },
      { startSample: 10_863_120, endSample: 11_560_194, coreStartSample: 10_895_120 },
      true,
    ),
    { overlapStartSample: 10_934_120, overlapEndSample: 10_998_120, boundarySample: 10_966_120 },
    'A wide fallback overlap must use its sample midpoint and the configured two-second half-width',
  );
  assert.deepEqual(
    planSeamGeometry(
      { startSample: 0, endSample: 1300 },
      { startSample: 1000, endSample: 5000, coreStartSample: 1200 },
      true,
    ),
    { overlapStartSample: 1000, overlapEndSample: 1300, boundarySample: 1150 },
    'A short fallback overlap must clamp the half-width to half of the actual common interval',
  );
  const overlapSegments = [
    { text: 'opening context', start: 0, end: 39 },
    { text: 'the impacts on the', start: 39, end: 45.74 },
    { text: 'water trees and soil', start: 45.4, end: 48.94 },
    { text: 'next sentence', start: 49.74, end: 52.06 },
  ];
  const plannedOverlap = planTranscriptAlignment({
    transcript: overlapSegments.map(segment => segment.text).join(' '), segments: overlapSegments,
  }, pcm);
  assert.equal(plannedOverlap.length, 2);
  assert.equal(plannedOverlap[1].text, 'the impacts on the water trees and soil next sentence');
  assert.ok(plannedOverlap[0].endSample <= plannedOverlap[1].startSample);
  const reversedSegments = [overlapSegments[0], overlapSegments[2], overlapSegments[1]];
  assert.equal(planTranscriptAlignment({ transcript: reversedSegments.map(segment => segment.text).join(' '), segments: reversedSegments }, pcm), undefined);
  const tooLongOverlap = [{text:'one',start:0,end:50},{text:'two',start:49,end:99}];
  assert.equal(planTranscriptAlignment({transcript:'one two',segments:tooLongOverlap},pcm),undefined,
    'An overlapping component must never exceed the bounded acoustic alignment limit');
  const wav = encodePcmWindow(pcm, { startSample: 0, endSample: frameCount });
  const word = (index, text = `w${index}`) => ({ type: 'word', text, startTime: index * .5 + .1, endTime: index * .5 + .4, timeline: [] });
  const validateWords = (words, transcript, duration) => {
    assert.equal(words.map(w => w.text).join(' '), transcript);
    words.forEach((w, i) => { assert(w.startTime >= 0 && w.endTime > w.startTime && w.endTime <= duration); if (i) assert(w.startTime >= words[i - 1].endTime); });
  };
  const align = async (_audio, text, options) => ({ words: text.split(' ').map(token => {
    const result = word(Number(token.replace(/^bad|^w/u, '')), token);
    assert(result.startTime >= options.offsetSeconds && result.endTime <= options.offsetSeconds + options.durationSeconds); return result;
  }), omittedPhoneTimings: 0 });
  let calls = [];
  const sentSamples = new Set();
  const provider = (identity, effect = () => {}) => ({ engine: 'test', model: 'qualified-contract', identity, preferWhole: false, minRequestIntervalMs: 0,
    async transcribe(audio, options) {
      const received = parsePcmWav(audio);
      const start = (received.pcm.readInt16LE(0) - 1000) / sampleRate;
      assert.equal(received.frameCount / received.sampleRate, options.duration);
      for(let frame=0;frame<received.frameCount;frame++) {
        const absoluteFrame=Math.round(start*sampleRate)+frame;
        assert.equal(received.pcm.readInt16LE(frame*2),pcm.pcm.readInt16LE(absoluteFrame*2), 'Provider payload must contain original contiguous samples');
        sentSamples.add(absoluteFrame);
      }
      calls.push(start); await effect(start, options);
      const words = Array.from({ length: 200 }, (_, index) => word(index)).filter(w => w.startTime >= start && w.endTime <= start + options.duration);
      return { transcript: words.map(w => w.text).join(' '), segments: [] };
    },
  });
  const run = (id, engine, extra = {}, findSpeechGaps = async () => [], aligner = align, hasSpeech = async () => true) => createLearningAsrService({ checkpointRoot: path.join(temporary, id), align: aligner, convertProviderWords, validateWords, findSpeechGaps, hasSpeech,
    buildTimeline(words, text, _lang, duration) { validateWords(words, text, duration); return [{ type: 'sentence', text, startTime: words[0].startTime, endTime: words.at(-1).endTime, timeline: words }]; }, wait: async (_ms, signal) => { if (signal?.aborted) throw new LearningAsrError('asr_cancelled', 'cancel'); }
  }).transcribe({ jobId: 'pipeline-check', wav, language: 'en', provider: engine, ...extra });
  const good = await run('complete', provider('good'));
  assert.equal(good.transcript.split(' ').length, 200); assert.equal(new Set(good.transcript.split(' ')).size, 200);
  assert.equal(good.validation.sourceSamples, 10000); assert.equal(sentSamples.size, pcm.frameCount, "All original samples must reach provider"); assert.equal(calls.length, 2);
  calls = [];
  const resumed = await run('complete', provider('good')); assert.equal(calls.length, 0); assert.equal(resumed.validation.resumedWindows, 2);
  const receivedLocales = [];
  const localeProvider = provider('azure-locale', (_start, options) => receivedLocales.push(options.language));
  localeProvider.engine = 'azure_speech';
  await run('azure-locale', localeProvider, { language: 'en-US' });
  assert.deepEqual([...new Set(receivedLocales)], ['en-US']);
  receivedLocales.length = 0;
  await run('azure-locale', localeProvider, { language: 'en-GB' });
  assert.deepEqual([...new Set(receivedLocales)], ['en-GB'], 'Locale changes must not reuse another locale checkpoint');
  calls = []; let once = true;
  const retry = await run('retry', provider('retry', () => { if (once) { once = false; throw new LearningAsrError('asr_rate_limit', 'retry', undefined, 1); } }));
  assert.equal(retry.validation.retries, 1); assert.equal(calls.length, 3);
  calls = [];
  await assert.rejects(run('auth', provider('auth', () => { throw new LearningAsrError('asr_auth', 'auth'); })), e => e.code === 'asr_auth'); assert.equal(calls.length, 1);
  calls = []; const controller = new AbortController();
  await assert.rejects(run('cancel', provider('cancel', start => { if (start > 0) controller.abort(); }), { signal: controller.signal }), e => e.code === 'asr_cancelled');
  calls = [];
  const afterCancel = await run('cancel', provider('cancel')); assert.equal(afterCancel.validation.resumedWindows, 1); assert.equal(calls.length, 1);
  calls = [];
  const conflictProvider = provider('repair'), original = conflictProvider.transcribe;
  conflictProvider.transcribe = async function(audio, opts) { const result = await original(audio, opts); if (calls.at(-1) === 43) result.transcript = result.transcript.replace('w90', 'bad90'); return result; };
  const repaired = await run('repair', conflictProvider); assert.equal(repaired.validation.repairedSeams, 1); assert.equal(repaired.transcript, good.transcript);
  const narrowBridgeRejected = async (audio,text,options) => {
    if ([37,31].includes(options.offsetSeconds)) throw new LearningAsrError('asr_review_required','unreliable narrow bridge');
    return align(audio,text,options);
  };
  const widerBridge = await run('wider-bridge',conflictProvider,{},async()=>[],narrowBridgeRejected);
  assert.equal(widerBridge.validation.repairedSeams,1); assert.equal(widerBridge.transcript,good.transcript);
  calls = [];
  const irreconcilable = provider('reject'), recognizeBad = irreconcilable.transcribe;
  irreconcilable.transcribe = async (audio, opts) => {
    const result = await recognizeBad(audio, opts);
    if (calls.at(-1) > 0) result.transcript = result.transcript.replace('w90', 'bad90').replace('w85', 'bad85');
    return result;
  };
  await assert.rejects(run('reject', irreconcilable), error => error.code === 'asr_review_required' && error.range.startTime === 30);
  const wholeProvider = provider('whole'), recognizeWindow = wholeProvider.transcribe;
  wholeProvider.preferWhole = true;
  wholeProvider.transcribe = async (audio, opts) => opts.format === 'mp3' ? {
    transcript: good.transcript,
    segments: Array.from({length: 10}, (_, i) => ({text: good.transcript.split(' ').slice(i*20, i*20+20).join(' '), start: i*10+.1, end: i*10+9.9})),
  } : recognizeWindow(audio, opts);
  const prepared = async () => ({audio: Buffer.from('whole-test-input'), duration: 100, format: 'mp3'});
  const whole = await run('whole', wholeProvider, {prepareWhole: prepared});
  assert.equal(whole.validation.transport, 'whole'); assert.equal(whole.transcript, good.transcript);
  const nativeProvider = { ...wholeProvider, identity: 'native-whole' };
  nativeProvider.transcribe = async () => ({
    transcript: good.transcript, segments: [],
    words: Array.from({length: 200}, (_, index) => { const w = word(index); return {text: w.text, start: w.startTime, end: w.endTime}; }),
  });
  let coverageChecks = 0;
  const nativeWhole = await run('native-whole', nativeProvider, {prepareWhole: prepared}, async () => { coverageChecks++; return []; }, async () => { throw Error('Native timestamps must avoid local alignment'); });
  assert.equal(nativeWhole.transcript, good.transcript);
  assert.equal(nativeWhole.validation.transport, 'whole');
  assert.equal(coverageChecks, 1, 'Native timestamps must still undergo source speech coverage');
  const invalidNativeProvider = { ...wholeProvider, identity: 'invalid-native-whole' };
  invalidNativeProvider.transcribe = async (audio, opts) => ({ ...(await wholeProvider.transcribe(audio, opts)), words: [{text: 'wrong', start: 0, end: 0}] });
  let fallbackAlignments = 0;
  const fallbackNative = await run('invalid-native-whole', invalidNativeProvider, {prepareWhole: prepared}, async () => [], (...args) => { fallbackAlignments++; return align(...args); });
  assert.equal(fallbackNative.transcript, good.transcript);
  assert.ok(fallbackAlignments > 0, 'Invalid native timestamps must use local alignment');
  const partiallyInvalidNative = { ...wholeProvider, identity: 'partial-native-whole' };
  partiallyInvalidNative.transcribe = async (audio, opts) => ({
    ...(await wholeProvider.transcribe(audio, opts)),
    words: Array.from({length: 200}, (_, index) => { const w = word(index); return {text: w.text, start: w.startTime, end: index === 90 ? w.startTime : w.endTime}; }),
  });
  const locallyRealigned = [];
  const partialNative = await run('partial-native-whole', partiallyInvalidNative, {prepareWhole: prepared}, async () => [], (...args) => {
    locallyRealigned.push(args[1]); return align(...args);
  });
  assert.equal(partialNative.transcript, good.transcript);
  assert.equal(locallyRealigned.length, 1, 'A malformed native word must realign only its source block');
  assert.ok(locallyRealigned[0].split(' ').includes('w90'));
  const nativeWindowProvider = provider('native-windows');
  const sourceWindow = nativeWindowProvider.transcribe;
  nativeWindowProvider.transcribe = async (audio, opts) => {
    const response = await sourceWindow(audio, opts);
    const start = calls.at(-1);
    return { ...response, words: response.transcript.split(' ').map(text => {
      const w = word(Number(text.slice(1))); return {text, start: w.startTime - start, end: w.endTime - start};
    }) };
  };
  const nativeWindows = await run('native-windows', nativeWindowProvider, {}, async () => [], async () => { throw Error('Native windows must avoid local alignment'); });
  assert.equal(nativeWindows.transcript, good.transcript);
  assert.equal(nativeWindows.validation.transport, 'windows');

  const limitedProvider = provider('whole-size-limited');
  const limitedWindow = limitedProvider.transcribe;
  limitedProvider.preferWhole = true;
  limitedProvider.maxWholeRequestBytes = Buffer.byteLength('whole-test-input');
  let wholeUploads = 0;
  limitedProvider.transcribe = async (audio, opts) => {
    if (opts.format === 'mp3') { wholeUploads++; return wholeProvider.transcribe(audio, opts); }
    return limitedWindow(audio, opts);
  };
  const atLimit = await run('whole-at-size-limit', limitedProvider, {prepareWhole: prepared});
  assert.equal(atLimit.validation.transport, 'whole');
  assert.equal(wholeUploads, 1);
  limitedProvider.identity = 'whole-oversized';
  wholeUploads = 0;
  const oversizedFallback = await run('whole-oversized', limitedProvider, {
    prepareWhole: async () => ({ ...(await prepared()), audio: Buffer.from('whole-test-input!') }),
  });
  assert.equal(wholeUploads, 0, 'Whole audio exceeding the provider cap must fall back before upload');
  assert.equal(oversizedFallback.validation.transport, 'windows');
  assert.equal(oversizedFallback.transcript, good.transcript);
  const serverLimitedProvider = provider('whole-server-size-limit');
  const serverLimitedWindow = serverLimitedProvider.transcribe;
  serverLimitedProvider.preferWhole = true;
  let rejectedWholeUploads = 0;
  serverLimitedProvider.transcribe = async (audio, options) => {
    if (options.format === 'mp3') {
      rejectedWholeUploads++;
      throw new LearningAsrError('asr_invalid_audio', 'Server rejected the whole upload with HTTP 413.');
    }
    return serverLimitedWindow(audio, options);
  };
  const serverLimitedFallback = await run('whole-server-size-limit', serverLimitedProvider, {prepareWhole: prepared});
  assert.equal(rejectedWholeUploads, 1, 'A rejected whole upload must not be retried');
  assert.equal(serverLimitedFallback.validation.transport, 'windows');
  assert.equal(serverLimitedFallback.transcript, good.transcript);
  const rejectedTailProvider = provider('whole-rejected-tail'), recognizeTailWindow = rejectedTailProvider.transcribe;
  rejectedTailProvider.preferWhole = true;
  rejectedTailProvider.transcribe = async (audio, opts) => opts.format === 'mp3' ? {
    transcript: `${good.transcript} phantom`,
    segments: Array.from({length:10},(_,i)=>({text:good.transcript.split(' ').slice(i*20,i*20+20).join(' ')+(i===9?' phantom':''),start:i*10+.1,end:i*10+9.9})),
  } : recognizeTailWindow(audio,opts);
  calls=[];
  const recoveredTail = await run('whole-rejected-tail', rejectedTailProvider, {prepareWhole:prepared}, async()=>[], async(audio,text,options)=>{
    if(text.includes('phantom')) throw new LearningAsrError('asr_review_required','Whole transcript tail lacks acoustic alignment');
    return align(audio,text,options);
  });
  assert.equal(recoveredTail.transcript,good.transcript);
  assert.equal(recoveredTail.validation.transport,'windows');
  assert.deepEqual(calls,[43],'Whole failure must retain the validated prefix and resend only overlapping tail windows');
  const corridorProvider = provider('whole-fallback-corridor'), recognizeCorridorWindow = corridorProvider.transcribe;
  corridorProvider.preferWhole = true;
  corridorProvider.transcribe = async (audio, opts) => {
    if (opts.format === 'mp3') return {
      transcript: `${good.transcript} phantom`,
      segments: Array.from({length:10},(_,i)=>({text:good.transcript.split(' ').slice(i*20,i*20+20).join(' ')+(i===9?' phantom':''),start:i*10+.1,end:i*10+9.9})),
    };
    const result = await recognizeCorridorWindow(audio, opts);
    if (calls.at(-1) === 43) result.transcript = result.transcript.replace('w90', 'bad90');
    return result;
  };
  calls = [];
  const corridorRecovered = await run('whole-fallback-corridor', corridorProvider, {prepareWhole:prepared}, async()=>[], async(audio,text,options)=>{
    if(text.includes('phantom')) throw new LearningAsrError('asr_review_required','Whole transcript tail lacks acoustic alignment');
    return align(audio,text,options);
  });
  assert.equal(corridorRecovered.transcript, good.transcript, 'A deterministic fallback corridor must preserve the exact validated prefix and current-window continuation');
  assert.deepEqual(calls, [43], 'A valid fallback corridor must not issue bridge recognition requests');
  const repairGeometry = [];
  const geometryProvider = provider('whole-fallback-repair-geometry', (start, options) => {
    repairGeometry.push({ start, duration: options.duration });
    if (start !== 43) throw new LearningAsrError('asr_no_speech', 'Synthetic bridge rejection');
  });
  const recognizeGeometryWindow = geometryProvider.transcribe;
  geometryProvider.preferWhole = true;
  geometryProvider.transcribe = async (audio, opts) => {
    if (opts.format === 'mp3') return {
      transcript: `${good.transcript} phantom`,
      segments: Array.from({length:10},(_,i)=>({text:good.transcript.split(' ').slice(i*20,i*20+20).join(' ')+(i===9?' phantom':''),start:i*10+.1,end:i*10+9.9})),
    };
    const result = await recognizeGeometryWindow(audio, opts);
    if (calls.at(-1) === 43) result.transcript = result.transcript.replace('w123', 'bad123');
    return result;
  };
  calls = [];
  await assert.rejects(
    run('whole-fallback-repair-geometry', geometryProvider, {prepareWhole:prepared}, async()=>[], async(audio,text,options)=>{
      if(text.includes('phantom')) throw new LearningAsrError('asr_review_required','Whole transcript tail lacks acoustic alignment');
      return align(audio,text,options);
    }, async()=>false),
    error => error.code === 'asr_review_required' && error.range.startTime === 46.5 && error.range.endTime === 76.5,
  );
  assert.deepEqual(repairGeometry, [
    { start: 43, duration: 57 },
    { start: 53.5, duration: 16 },
    { start: 46.5, duration: 30 },
  ], 'Fallback bridge ranges and final failure range must share the effective midpoint boundary');
  wholeProvider.identity = 'invalid-whole';
  wholeProvider.transcribe = async (audio, opts) => opts.format === 'mp3' ? {transcript: good.transcript, segments: [{text:'missing words',start:0,end:1}]} : recognizeWindow(audio, opts);
  const fallback = await run('fallback', wholeProvider, {prepareWhole: prepared});
  assert.equal(fallback.validation.transport, 'windows'); assert.equal(fallback.transcript, good.transcript);
  wholeProvider.identity = 'prepare-failure';
  const failedPreparation = await run('prepare-failure', wholeProvider, {prepareWhole: async () => {throw new Error('native preparation failed');}});
  assert.equal(failedPreparation.validation.transport, 'windows'); assert.equal(failedPreparation.transcript, good.transcript);
  wholeProvider.identity = 'whole-no-speech';
  wholeProvider.transcribe = async (audio, opts) => { if(opts.format === 'mp3') throw new LearningAsrError('asr_no_speech','no speech'); return recognizeWindow(audio,opts); };
  const noSpeechFallback = await run('whole-no-speech', wholeProvider, {prepareWhole: prepared});
  assert.equal(noSpeechFallback.validation.transport, 'windows'); assert.equal(noSpeechFallback.transcript, good.transcript);
  const detectMissingPhrase = async (_audio, words) => words.some(word => word.text === 'w120') && words.some(word => word.text === 'w121') ? [] : [{startTime:60,endTime:61}];
  const missingProvider = provider('missing-phrase'), missingOriginal = missingProvider.transcribe;
  missingProvider.transcribe = async (audio, opts) => { const result = await missingOriginal(audio,opts); if(calls.at(-1)===43) result.transcript=result.transcript.replace('w120 w121 ', ''); return result; };
  const fixedGap = await run('missing-phrase',missingProvider,{},detectMissingPhrase);
  assert.equal(fixedGap.validation.repairedSpeechGaps,1); assert.equal(fixedGap.transcript,good.transcript);
  missingProvider.identity='persistent-missing';
  missingProvider.transcribe = async (audio, opts) => { const result = await missingOriginal(audio,opts); result.transcript=result.transcript.replace('w120 w121 ', ''); return result; };
  const reviewRequired = await run('persistent-missing',missingProvider,{},detectMissingPhrase);
  assert.equal(reviewRequired.validation.speechGapCheck, 'review-required');
  assert.deepEqual(reviewRequired.validation.speechGaps, [{startTime:60,endTime:61}]);
  assert.equal(reviewRequired.validation.textCoverage, 'matched');
  assert.equal(reviewRequired.validation.timestampChecks, 'passed');
  assert.equal(reviewRequired.validation.recognitionAccuracy, 'not-measured');
  assert.ok(!reviewRequired.transcript.split(' ').includes('w120'), 'Missing provider content must not be invented');
  assert.equal(good.validation.speechGapCheck, 'passed');
  assert.equal(good.validation.speechGaps, undefined);
  const editedMetadata = transcriptionQualityMetadata(undefined, reviewRequired);
  assert.equal(editedMetadata.validation, undefined, 'An edit must not inherit old text or timestamp validation');
  assert.deepEqual(transcriptionSpeechReview(editedMetadata).speechGaps, reviewRequired.validation.speechGaps);
  const editedAgain = transcriptionQualityMetadata(undefined, JSON.parse(JSON.stringify(editedMetadata)));
  assert.deepEqual(editedAgain, editedMetadata, 'Review evidence must survive repeated edits and persisted readback');
  assert.equal(transcriptionSpeechReview(transcriptionQualityMetadata(good.validation, editedAgain)), undefined,
    'A fresh successful coverage check can clear old review ranges');
  assert.deepEqual(transcriptionQualityMetadata(undefined, undefined), {}, 'Another media must not inherit source review evidence');
  const multipleGaps = [{startTime:60,endTime:61}, {startTime:80,endTime:81}];
  const multipleReview = await run('multiple-review',provider('multiple-review'),{},async()=>multipleGaps);
  assert.deepEqual(multipleReview.validation.speechGaps, multipleGaps, 'Preserve every unresolved range, not only the attempted gap');
  for (const reason of ['detector unavailable', 'invalid word geometry', 'unsupported source speech']) {
    await assert.rejects(run(`fatal-coverage-${reason}`,provider(`fatal-coverage-${reason}`),{},async()=>{
      throw new LearningAsrError('asr_review_required',reason);
    }), error=>error.code==='asr_review_required'&&error.message===reason);
  }
  const needsContext = async (audio,text,options) => {
    if(options.offsetSeconds === 43) throw new LearningAsrError('asr_review_required','clipped word');
    return align(audio,text,options);
  };
  const contextRepaired = await run('context-repair',provider('context-repair'),{},async()=>[],needsContext);
  assert.equal(contextRepaired.validation.repairedAlignmentWindows,1); assert.equal(contextRepaired.transcript,good.transcript);
  calls = [];
  const shorterRecognitionRequired = async (audio, text, options) => {
    if (options.durationSeconds > 32) throw new LearningAsrError('asr_review_required', 'Long-window speech cannot be reliably aligned');
    return align(audio, text, options);
  };
  const partitioned = await run('partition-recovery', provider('partition-recovery'), {}, async()=>[], shorterRecognitionRequired);
  assert.equal(partitioned.transcript, good.transcript, 'Bounded shorter recognition must preserve every source word and intentional overlap');
  assert.equal(partitioned.validation.sourceSamples, pcm.frameCount);
  assert(partitioned.validation.repairedAlignmentWindows >= 2);
  assert(calls.length <= 16, 'Partition fallback must have bounded provider requests');
  const neverAligned = async () => { throw new LearningAsrError('asr_review_required', 'No reliable acoustic timestamps'); };
  calls = [];
  await assert.rejects(run('partition-reject', provider('partition-reject'), {}, async()=>[], neverAligned), error => error.code === 'asr_review_required');
  assert(calls.length <= 8, 'An unalignable source must stop after bounded partition attempts');
  calls = [];
  await assert.rejects(run('partition-auth', provider('partition-auth', (_start, options) => {
    if (options.duration <= 32) throw new LearningAsrError('asr_auth', 'Child request credential failure');
  }), {}, async()=>[], shorterRecognitionRequired), error => error.code === 'asr_auth');
  assert.equal(calls.length, 3, 'Fatal auth in the first child must prevent later child requests');
  calls = [];
  const partitionCancel = new AbortController();
  await assert.rejects(run('partition-cancel', provider('partition-cancel', (_start, options) => {
    if (options.duration <= 32) partitionCancel.abort();
  }), {signal:partitionCancel.signal}, async()=>[], shorterRecognitionRequired), error => error.code === 'asr_cancelled');
  assert.equal(calls.length, 3, 'Cancellation in the first child must prevent later child requests');
  const nativeCancel = new AbortController();
  let nativeStarted;
  const startedNative = new Promise(resolve => {nativeStarted=resolve;});
  let releaseNative;
  const pendingNative = new Promise(resolve => {releaseNative=resolve;});
  const cancelledAlignment = run('native-cancel',provider('native-cancel'),{signal:nativeCancel.signal},async()=>[],async()=>{nativeStarted();return pendingNative;});
  await startedNative; nativeCancel.abort();
  await assert.rejects(cancelledAlignment,error=>error.code==='asr_cancelled');
  releaseNative({words:[],omittedPhoneTimings:0});
  const ambientIntro = provider('ambient-intro'), ambientOriginal = ambientIntro.transcribe;
  ambientIntro.transcribe = async(audio,options)=>{ const result=await ambientOriginal(audio,options); if(calls.at(-1)===0)throw new LearningAsrError('asr_no_speech','ambient intro'); result.transcript=result.transcript.split(' ').filter(token=>Number(token.slice(1))>=96).join(' '); return result; };
  const afterIntro = await run('ambient-intro',ambientIntro,{},async()=>[],align,async()=>false);
  assert.equal(afterIntro.transcript,Array.from({length:104},(_,i)=>`w${96+i}`).join(' '));
  const store = createCheckpointStore(path.join(temporary, 'corruption'), 'id'); await store.write('response', { value: 3 });
  assert.deepEqual(await store.read('response', value => value.value === 3), { value: 3 });
  const [folder] = await readdir(path.join(temporary, 'corruption')); const [file] = await readdir(path.join(temporary, 'corruption', folder));
  const filename = path.join(temporary, 'corruption', folder, file), contents = JSON.parse(await readFile(filename, 'utf8'));
  contents.value.value = 99; await writeFile(filename, JSON.stringify(contents)); assert.equal(await store.read('response', () => true), undefined);
  console.log('PASS: full sample coverage, overlap text, persistent resume, retry, fatal auth, cancel/resume, seam repair and corrupt checkpoint rejection');
} finally { await rm(temporary, { recursive: true, force: true }); }
