import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {sha256,stableJson} from './lib/kernel-utils.mjs';import {physicalRoot,physicalChild,readProjectText} from './lib/physical-project-files.mjs';
export function sourceLineage(root,source){
  const rel='.fbs/source-derivations/'+source.digest+'/lineage.json',p=physicalChild(root,rel,true);if(!fs.existsSync(p))return null;
  const r=JSON.parse(readProjectText(root,rel).text);if(r.resultDigest!==source.digest||!['simulation','proposed_correction'].includes(r.effectiveKind)||typeof r.lineageDigest!=='string')throw new Error('project_lineage_invalid');
  const {lineageDigest,...body}=r;if(sha256(stableJson(body))!==lineageDigest)throw new Error('project_lineage_digest_mismatch');
  if(source.path===r.originalPath&&source.digest===r.originalDigest)return null;
  const {patches,...summary}=r;return summary;
}
export function deriveSource(input){
  let partial=null;
  try{
    if(!input||!['simulation','proposed_correction'].includes(input.kind)||typeof input.basisRef!=='string'||!input.basisRef.trim()||input.basisRef.length>2048||!Array.isArray(input.patches)||!input.patches.length||input.patches.length>128)throw new Error('project_derivation_input_invalid');
    const root=physicalRoot(input.root),original=readProjectText(root,input.sourcePath);if(original.digest!==input.expectedDigest)throw new Error('project_derivation_base_stale');
    const patches=[...input.patches].sort((a,b)=>(a?.start??0)-(b?.start??0));
    for(let i=0;i<patches.length;i++){const p=patches[i];if(!p||!Number.isSafeInteger(p.start)||!Number.isSafeInteger(p.end)||p.start<0||p.end<=p.start||p.end>original.text.length||p.expected!==original.text.slice(p.start,p.end)||typeof p.replacement!=='string'||(i&&patches[i-1].end>p.start))throw new Error('project_derivation_patch_invalid');}
    let result=original.text;for(const p of [...patches].reverse())result=result.slice(0,p.start)+p.replacement+result.slice(p.end);
    if(!result.isWellFormed())throw new Error('project_derivation_invalid_unicode');
    if(Buffer.byteLength(result)>1048576||result===original.text)throw new Error('project_derivation_empty_or_over_budget');
    const parent=sourceLineage(root,original),resultDigest=sha256(result),body={schemaVersion:'manuscriptos.source-derivation/v1',kind:input.kind,effectiveKind:parent?.effectiveKind==='simulation'?'simulation':input.kind,sourcePath:original.path,parentDigest:original.digest,resultDigest,originalPath:parent?.originalPath??original.path,originalDigest:parent?.originalDigest??original.digest,parentLineageDigest:parent?.lineageDigest??null,basisRef:input.basisRef,patches};
    const lineage={...body,lineageDigest:sha256(stableJson(body))},relative='.fbs/source-derivations/'+resultDigest,target=physicalChild(root,relative,true);if(Buffer.byteLength(JSON.stringify(lineage))>1000000)throw new Error('project_lineage_over_budget');
    if(fs.existsSync(target)){const prior=sourceLineage(root,{path:relative+'/content.txt',digest:resultDigest});if(prior?.lineageDigest!==lineage.lineageDigest||readProjectText(root,relative+'/content.txt').digest!==resultDigest)throw new Error('project_derivation_identity_collision');return{ok:true,status:'already_derived',sourcePath:relative+'/content.txt',lineage,originalChanged:false};}
    const parentDir=physicalChild(root,'.fbs/source-derivations',true);fs.mkdirSync(parentDir,{recursive:true});partial=physicalChild(root,'.fbs/source-derivations/.partial-'+randomUUID(),true);fs.mkdirSync(partial);
    fs.writeFileSync(path.join(partial,'content.txt'),result,{flag:'wx'});fs.writeFileSync(path.join(partial,'lineage.json'),JSON.stringify(lineage,null,2)+'\n',{flag:'wx'});
    if(sha256(fs.readFileSync(path.join(partial,'content.txt')))!==resultDigest||readProjectText(root,input.sourcePath).digest!==original.digest)throw new Error('project_derivation_readback_failed');
    fs.renameSync(partial,target);partial=null;sourceLineage(root,{path:relative+'/content.txt',digest:resultDigest});
    return{ok:true,status:'derived_with_lineage',sourcePath:relative+'/content.txt',lineage,originalChanged:false,factualCorrectionAuthenticated:false};
  }catch(e){return{ok:false,issues:[e.message],retainedPartialDirectory:partial,originalChanged:false};}
}
