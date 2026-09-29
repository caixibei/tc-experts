import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditDelivery, auditCounts, auditCitations, auditConcurrency } from './delivery-evidence.mjs';
import { createEvidencePacket, auditTranscript } from './evidence-packet.mjs';
import { inventory } from './material-inventory.mjs';
import { routeDomainScene } from './scene-runtime.mjs';
import { runRegressionSmoke } from './quality/regression-smoke.mjs';
import { buildSourceCard } from './source-card-runtime.mjs';
import { planDocumentIntent } from './document-plan-runtime.mjs';
import { chapterContext, draftTrace, chapterImpact, reviseExpression, selectReviewedVersion } from './chapter-workflow.mjs';
import { workflowActions } from './chapter-workflow-examples.mjs';
import { rc26Actions } from './rc26-workflow-examples.mjs';
import { rc27Actions } from './rc27-workflow-examples.mjs';
import { resolveSourceSelectors } from './source-selectors.mjs';
import { auditReviewBindings } from './review-bindings.mjs';
import { compareFidelity, auditManuscriptFidelity } from './fidelity-runtime.mjs';
import { deriveDocumentState } from './document-state-runtime.mjs';
import { assessReviewEvidence } from './review-evidence-runtime.mjs';
import { buildOrganizationCard, organizationCardExample } from './organization-card-runtime.mjs';
import { docxEdit } from './docx-edit-bridge.mjs';
const hash='a'.repeat(64);
export const contract = {
  schemaVersion:'manuscriptos.expert-tools/v1',
  usage:'node scripts/expert-tools.mjs <action> < input.json',
  controls:['--help','--describe','--example <action>','--self-test','--check'],
  maxInputBytes:1048576,exitCodes:{success:0,rejected_or_partial:2},
  evidenceBoundary:'structural_checks_only_not_semantic_truth_or_host_enforcement',
  optionalUtilities:{mediaIndex:{entry:'scripts/media-index.py',runtime:'Python standard library',describe:'python -I -B <entry> --describe',selfTest:'python -I -B <entry> --self-test',commands:['build','search','stats','export'],writes:'explicit owned index root only; originals read-only',optionalParser:'host ffprobe when --probe is requested'}},
  actions:{
    ...workflowActions,
    ...rc26Actions,
    ...rc27Actions,
    route:{required:[],optional:['text (max 8192 chars)','explicitSceneId'],example:{text:'把设备维护步骤编成使用说明书'}},
    plan:{required:['text (max 8192 chars)'],optional:['explicitSceneId'],example:{text:'给咱们公司出本十周年纪念册：前半本写我们怎么起家，后半本写几个大客户跟我们互相成就的故事。'}},
    inventory:{required:['root'],optional:['terms','maxEntries','maxMatches','maxMilliseconds'],example:{root:'.',terms:['教材'],maxEntries:10000,maxMatches:100}},
    delivery:{required:['events','target','lineCount','finalDigest'],eventFields:['kind:write|read','sequence:strictly_increasing_integer','target:string','success:boolean','read:start,end,eof,digest'],example:{events:[{kind:'write',sequence:1,target:'draft',success:true},{kind:'read',sequence:2,target:'draft',success:true,start:1,end:2,eof:true,digest:hash}],target:'draft',lineCount:2,finalDigest:hash}},
    counts:{required:['rows','declaredCount','declaredBytes'],rowFields:['id','kind:file','bytes'],example:{rows:[{id:'a',kind:'file',bytes:12}],declaredCount:1,declaredBytes:12}},
    citations:{inputType:'claim_array',claimFields:['id','references','status:verified requires page receipt','dualEvidence','independentEvidence'],referenceFields:['url','opened','anchor','contentDigest','sourceId','originId'],example:[{id:'claim-1',status:'candidate',references:[{url:'https://example.org/paper',sourceId:'page',originId:'publication'}]}]},
    concurrency:{inputType:'task_array',required:['start:number','end:number'],example:[{start:0,end:10},{start:5,end:12}]},
    packet:{required:['objective'],optional:['decisions','sources','unresolved','maxBytes'],decisionFields:['state:user_confirmed|model_proposed|unknown','userMessageRef required for user_confirmed'],sourceFields:['id','ref','originId','state:metadata_only|observed_unreviewed|source_verified','reviewRef required for source_verified'],example:{objective:'写第一章',decisions:[{state:'user_confirmed',text:'回忆录',userMessageRef:'user-message-1'}],sources:[{id:'video-frame',ref:'frame-001.jpg',originId:'video-1',state:'observed_unreviewed'}]}},
    sourceCard:{required:['source','derivatives','anchors','observations','claims'],example:{source:{sourceId:'video-1',modality:'video',sourceDigest:hash,declaredBytes:4096,originKind:'current_host_derived',hostBinding:{product:'WorkBuddy',version:'5.5.3',instanceId:'host-1'},parentSourceDigest:null,parentBinding:null},derivatives:[{artifactId:'frame-1',kind:'keyframe',digest:hash,originKind:'current_host_derived',hostBinding:{product:'WorkBuddy',version:'5.5.3',instanceId:'host-1'},parentSourceDigest:hash,parentBinding:null}],anchors:[{anchorId:'anchor-1',kind:'time_range',startMs:1000,endMs:2000,startFrame:null,endFrame:null,frame:null,bbox:null,page:null,start:null,end:null}],observations:[{observationId:'observation-1',kind:'visual_observation',anchorId:'anchor-1',derivativeId:'frame-1',contentDigest:hash,state:'observed',unknowns:[]}],claims:[{claimId:'claim-1',textDigest:hash,observationIds:['observation-1'],state:'attributed'}]}},
    transcript:{required:['duration','segments'],segmentFields:['id','start','end','text'],correctionFields:['segmentId','original','replacement','state:candidate|reviewed','basis and reviewRef required for reviewed'],example:{duration:10,segments:[{id:'s1',start:0,end:8,text:'示例转写'}],corrections:[]}}
    ,organizationCard:{required:['chapterId','purpose','readerQuestion','progression'],optional:['selectedSourceRefs','adjacent','knownMissingInfo','constraints'],example:organizationCardExample}
    ,docxEdit:{required:['operation:inspect|edit','root:absolute_existing_directory','source:relative_docx_path'],optional:['expectedSourceSha256','output:new_relative_docx_path and edits for edit'],boundary:'Python standard-library utility, no extra service; edit requires exact source digest and a new output path; unsupported complex targets are rejected; no layout or host acceptance claim',example:{operation:'inspect',root:'/replace-with-authorized-project',source:'draft.docx'}}
  }
};
export async function runAction(action,input) {
  if(!Object.hasOwn(contract.actions,action))return {ok:false,issues:['unknown_action']};
  if(!['citations','concurrency'].includes(action)&&(!input||typeof input!=='object'||Array.isArray(input)))return {ok:false,issues:['input_must_be_object']};
  switch(action){
    case 'route':return routeDomainScene(input);
    case 'plan':return planDocumentIntent(input);
    case 'chapterContext':return chapterContext(input);
    case 'draftTrace':return draftTrace(input);
    case 'chapterImpact':return chapterImpact(input);
    case 'reviseExpression':return reviseExpression(input);
    case 'reviewSelect':return selectReviewedVersion(input);
    case 'checkpoint':return (await import('./manuscript-checkpoint.mjs')).manuscriptCheckpoint(input);
    case 'fidelity':return compareFidelity(input);
    case 'fidelityAudit':return auditManuscriptFidelity(input);
    case 'documentState':return deriveDocumentState(input);
    case 'reviewEvidence':return assessReviewEvidence(input);
    case 'projectReadback':return (await import('./project-readback-runtime.mjs')).readbackProject(input);
    case 'exportDocument':return (await import('./project-readback-runtime.mjs')).exportDocumentBundle(input);
    case 'sourceSelectors':return resolveSourceSelectors(input);
    case 'reviewBindings':return auditReviewBindings(input);
    case 'deriveSource':return (await import('./source-derivation.mjs')).deriveSource(input);
    case 'verifyDelivery':return (await import('./delivery-lifecycle.mjs')).verifyDelivery(input);
    case 'preparePreview':return (await import('./delivery-lifecycle.mjs')).prepareDeliveryPreview(input);
    case 'auditProject':return (await import('./project-acceptance.mjs')).auditProjectAcceptance(input);
    case 'inventory':{const {root,...options}=input;const result=await inventory(root,options);return {...result,ok:result.complete};}
    case 'delivery':return auditDelivery(input);
    case 'counts':return auditCounts(input);
    case 'citations':return auditCitations(input);
    case 'concurrency':return auditConcurrency(input);
    case 'packet':return createEvidencePacket(input);
    case 'sourceCard':return buildSourceCard(input);
    case 'transcript':return auditTranscript(input);
    case 'organizationCard':return buildOrganizationCard(input);
    case 'docxEdit':return docxEdit(input);
  }
}
export async function selfTest() {
  const results=[];
  for(const action of ['route','plan','delivery','counts','citations','concurrency','packet','sourceCard','transcript','organizationCard','chapterContext','draftTrace','chapterImpact','reviseExpression','reviewSelect','fidelity','fidelityAudit','documentState','reviewEvidence','sourceSelectors','reviewBindings']){
    const result=await runAction(action,structuredClone(contract.actions[action].example));
    results.push({caseId:`${action}-positive`,passed:result.ok===true});
    const invalid=await runAction(action,null);
    results.push({caseId:`${action}-null`,passed:invalid.ok===false});
  }
  const partial=structuredClone(contract.actions.delivery.example);partial.events[1].end=1;partial.events[1].eof=false;
  results.push({caseId:'readback-partial',passed:!(await runAction('delivery',partial)).ok});
  results.push({caseId:'url-placeholder',passed:!auditCitations([{id:'x',references:[{url:'https://example.org/.../paper'}]}]).ok});
  return {schemaVersion:'manuscriptos.expert-tools-self-test/v1',ok:results.every(r=>r.passed),passed:results.filter(r=>r.passed).length,total:results.length,results,coverage:'twenty-one pure actions; physical IO and optional Python utilities tested separately',hostValidated:false,networkUsed:false};
}
export async function checkPackage() {
  const self = await selfTest();
  const smoke = runRegressionSmoke();
  return {schemaVersion:'manuscriptos.package-check/v1',ok:self.ok && smoke.ok,
    selfTest:self,publicSmoke:smoke,hostValidated:false,networkUsed:false,
    coverage:'44 interface checks plus known route regression and five asset-presence checks; not full source QA, archive integrity, or semantic acceptance'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  let result;
  try {
    const args=process.argv.slice(2),action=args[0];
    if(!action){result={ok:false,status:'usage_required',...contract};}
    else if(['--help','--describe'].includes(action)&&args.length===1)result={ok:true,...contract};
    else if(action==='--example'&&args.length===2&&Object.hasOwn(contract.actions,args[1]))result=contract.actions[args[1]].example;
    else if(action==='--self-test'&&args.length===1)result=await selfTest();
    else if(action==='--check'&&args.length===1)result=await checkPackage();
    else if(args.length===1&&Object.hasOwn(contract.actions,action)){
      let size=0;const chunks=[];
      for await(const chunk of process.stdin){size+=chunk.length;if(size>contract.maxInputBytes)throw new Error('input_over_budget');chunks.push(chunk);}
      result=await runAction(action,JSON.parse(Buffer.concat(chunks).toString('utf8')));
    }else result={ok:false,issues:['invalid_arguments']};
  }catch(error){result={ok:false,issues:[['input_over_budget'].includes(error.message)?error.message:'invalid_input_or_execution_failed']};}
  process.stdout.write(JSON.stringify(result)+'\n');
  if(result?.ok===false)process.exitCode=2;
}
