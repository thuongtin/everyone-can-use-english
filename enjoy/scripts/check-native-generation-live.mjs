import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Sequelize} from 'sequelize';
import {mkdtemp,mkdir,rm,writeFile,readFile,copyFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {learningBrief} from './fixtures/learning-lesson.mjs';
const root=resolve(import.meta.dirname,'..');
const temporary=await mkdtemp(join(root,'.tmp-native-generation-live-'));
const provider=process.argv.includes('--claude')?'claude':'codex';
const isMap=process.argv.includes('--map');
const candidateVersion=process.argv.find(arg=>arg.startsWith('--verify-version='))?.slice('--verify-version='.length);
let db,runtime;
try{
 const output=join(temporary,'subject.mjs');
 await build({entryPoints:[join(root,'src/main/learning/runtime.ts')],outfile:output,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent',plugins:process.argv.includes('--diagnostic')?[{name:'safe-catalog-diagnostic',setup(builder){builder.onLoad({filter:/codex-native\.ts$/},async args=>({loader:'ts',contents:(await readFile(args.path,'utf8')).replace('if (input.mcp && !scopedFound)', 'console.log(JSON.stringify({catalog: status.data.map((s: any) => ({scoped:s.name===serverName,state:s.runtimeStatus,tools:Object.keys(s.tools??{}),errorPresent:Boolean(s.toolsError)}))})); if (input.mcp && !scopedFound)')}));}}]:[]});
 const {LearningRuntime}=await import(pathToFileURL(output).href);
 const migration=await import(pathToFileURL(join(root,'src/main/db/migrations/1788701024340-create-learning-studio.js')).href);
 db=new Sequelize({dialect:'sqlite',storage:join(temporary,'learning.sqlite'),logging:false});
 await migration.up({context:db.getQueryInterface()});
 runtime=await LearningRuntime.open({sequelize:db,profileId:'native-live-acceptance',assetRoot:join(temporary,'assets')});
 let generation=runtime.generation;
 if(candidateVersion){
  assert.equal(provider,'codex'); assert.equal(process.argv.includes('--image'),false);
  const candidateModule=join(temporary,'candidate.mjs');
  await build({stdin:{contents:'export {NativeLearningGeneration} from "./src/main/learning/native-generation";export {probeNativeAgent} from "./src/main/agents/native-discovery";',resolveDir:root},outfile:candidateModule,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'});
  const {NativeLearningGeneration,probeNativeAgent}=await import(pathToFileURL(candidateModule).href);
  generation=new NativeLearningGeneration(runtime,{probe:async requested=>{const probe=await probeNativeAgent(requested);assert.equal(probe.version,candidateVersion);assert.ok(probe.executable);assert.ok(probe.text||probe.reason==='native_version_unsupported');return {...probe,text:true,reason:null};}});
 }
 const created=isMap?await runtime.storage.createMap({title:'Cup: a container for drinking tea and coffee. Include related vocabulary with Vietnamese translations.'}):await runtime.storage.createLesson({brief:{...learningBrief,imageCount:process.argv.includes('--image')?1:0},title:`Native ${provider} acceptance`});
 const resourceId=isMap?created.map.id:created.lesson.id;
 const started=Date.now();
 const {jobId}=await generation.generate({provider,resourceType:isMap?'map':'lesson',resourceId,revisionId:created.revision.id,requestKey:randomUUID()});
 let state; let last='';
 while(Date.now()-started<700000){
  state=await runtime.application.jobs.get(jobId);
  const summary=JSON.stringify({state:state.job.state,stages:state.stages.map(s=>({kind:s.kind,state:s.state})),errors:state.attempts.filter(a=>a.errorCode).map(a=>a.errorCode)});
  if(summary!==last){console.log(summary);last=summary;}
  if(['completed','failed','cancelled','interrupted'].includes(state.job.state))break;
  if(state.job.state==='partial'&&state.stages.some(s=>s.state==='failed'))break;
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
 assert.equal(state.job.state,'completed',JSON.stringify(state.attempts.map(a=>({state:a.state,error:a.errorCode}))));
 const bundle=isMap?await runtime.storage.getMap(resourceId):await runtime.storage.getLesson(resourceId);
 const revision=bundle.revisions.find(r=>r.id===created.revision.id);assert.equal(revision.status,'ready');
 const directory=join(root,'tmp/learning-acceptance/2026-09-07',...(candidateVersion?[`compatibility-${candidateVersion}`]:[]));await mkdir(directory,{recursive:true});
 const evidence={pass:true,provider,kind:isMap?'map':'lesson',candidateVersion: candidateVersion??null,candidateAcceptanceOnly:Boolean(candidateVersion),elapsedMs:Date.now()-started,job:state,content:revision.content,validation:revision.validation??null};
 for(const asset of bundle.assets??[]) await copyFile(join(runtime.scope.context.assetRoot,asset.relativePath),join(directory,asset.relativePath));
 evidence.assets=(bundle.assets??[]).map(asset=>({id:asset.id,relativePath:asset.relativePath,mimeType:asset.mimeType,sizeBytes:asset.sizeBytes,provenance:asset.provenance}));
 await writeFile(join(directory,`${provider}-native-${isMap?'map':'lesson'}.json`),JSON.stringify(evidence,null,2));
 console.log(JSON.stringify({pass:true,provider,kind:evidence.kind,elapsedMs:evidence.elapsedMs}));
} catch(error){console.error(JSON.stringify({pass:false,provider,code:error.code??'check_failed',message:!error.code||error.code==='ERR_MODULE_NOT_FOUND'?error.message:undefined}));process.exitCode=1;}
finally{await runtime?.close();await db?.close();await rm(temporary,{recursive:true,force:true});}
