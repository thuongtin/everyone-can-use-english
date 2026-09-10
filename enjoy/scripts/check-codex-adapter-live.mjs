import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,mkdir,rm,writeFile,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(import.meta.dirname,'..');
const temporary=await mkdtemp(join(root,'.tmp-codex-live-'));
const workspace=join(temporary,'workspace');const privateHome=join(temporary,'private');
await mkdir(workspace,{mode:0o700});await mkdir(privateHome,{mode:0o700});
const image=process.argv.includes('--image');
const candidateVersion=process.argv.find(arg=>arg.startsWith('--verify-version='))?.slice('--verify-version='.length);
try {
 const output=join(temporary,'subject.mjs');
 await build({stdin:{contents:'export {CodexNativeAgent} from "./src/main/agents/codex-native"; export {probeNativeAgent} from "./src/main/agents/native-discovery";',resolveDir:root},outfile:output,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'});
 const {CodexNativeAgent,probeNativeAgent}=await import(pathToFileURL(output).href);
 const probe=await probeNativeAgent('codex');
 if(candidateVersion){assert.equal(probe.version,candidateVersion);assert.ok(probe.executable);assert.ok(probe.text||probe.reason==='native_version_unsupported');}
 else assert.equal(probe.text,true,probe.reason??'text unavailable');
 const started=Date.now();
 const result=await new CodexNativeAgent().run({executable:probe.executable,workspace:await realpath(workspace),privateHome:await realpath(privateHome),signal:new AbortController().signal,timeoutMs:240000,image,prompt:image?'Use native image_generation to create exactly one small illustration of a red apple on a pale cream background. Use no other tools. Finish after the image is generated.':'Reply with exactly ENJOY_NATIVE_OK. Use no tools.',onEvent:event=>console.log(JSON.stringify({event:event.type,tool:event.toolName}))});
 assert.equal(result.provider,'codex');
 if(!image) assert.match(result.text,/ENJOY_NATIVE_OK/);
 const directory=join(root,'tmp/learning-acceptance/2026-09-07',...(candidateVersion?[`compatibility-${candidateVersion}`]:[]));await mkdir(directory,{recursive:true});
 const evidence={pass:true,kind:image?'image':'text',version:probe.version,model:result.model,elapsedMs:Date.now()-started,images:result.images.map(item=>({mimeType:item.mimeType,sizeBytes:item.bytes.length,providerItemId:item.providerItemId}))};
 if(image){assert.ok(result.images.length);await writeFile(join(directory,'native-apple.png'),result.images[0].bytes);}
 await writeFile(join(directory,`codex-native-${image?'image':'text'}.json`),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
} catch(error) {console.error(JSON.stringify({pass:false,code:error.code??'check_failed',message:error.code?undefined:error.message}));process.exitCode=1;}
finally {await rm(temporary,{recursive:true,force:true});}
