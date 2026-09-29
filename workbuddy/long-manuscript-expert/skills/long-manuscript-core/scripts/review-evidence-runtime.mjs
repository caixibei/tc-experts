import { sha256, stableJson } from './lib/kernel-utils.mjs';
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/u.test(x);
const kinds=new Set(['deterministic_check','model_review','human_review','execution_authorization','owner_acceptance','installed_copy','host_activation','session_resume','material_observation']);
const requirements={humanReviewed:'human_review',ownerAccepted:'owner_acceptance',hostActivated:'host_activation',freshSessionResumed:'session_resume',realMaterialsObserved:'material_observation'};

// The authority registry is a separate caller-owned policy input, never read from the model payload.
// Public CLI intentionally uses no authority registry: local JSON cannot authenticate a human or a host.
export function assessReviewEvidence(input,authorityRegistry=[]){
  if(!object(input)||!hash(input.subjectDigest)||!Array.isArray(input.events)||input.events.length>256||!Array.isArray(authorityRegistry))return{ok:false,issues:['review_evidence_input_invalid'],submitReady:false};
  const rows=[],issues=[],ids=new Set();
  for(const e of input.events){
    if(!object(e)||typeof e.id!=='string'||!e.id||ids.has(e.id)||!kinds.has(e.kind)||!['model','human','runtime','host'].includes(e.actorType)||!hash(e.subjectDigest)||!object(e.payload)||typeof e.evidenceRef!=='string'){issues.push('review_event_invalid');continue;}
    ids.add(e.id);const eventDigest=sha256(stableJson(e));
    const authority=authorityRegistry.find(a=>a?.eventDigest===eventDigest&&a.actorType===e.actorType&&a.kind===e.kind&&a.evidenceRef===e.evidenceRef);
    const conflicts=[];
    if(e.subjectDigest!==input.subjectDigest)conflicts.push('review_subject_stale');
    if(['human_review','owner_acceptance'].includes(e.kind)&&e.actorType!=='human')conflicts.push('model_cannot_be_human_reviewer');
    if(e.kind==='owner_acceptance'&&e.payload.intent!=='accept_result')conflicts.push('execution_authorization_is_not_acceptance');
    if(e.kind==='owner_acceptance'&&e.payload.decision!=='accepted')conflicts.push('owner_result_not_accepted');
    if(e.kind==='host_activation'&&(e.actorType!=='host'||e.payload.surface!=='active_expert_session'||!e.payload.sessionId||!e.payload.expertId))conflicts.push('installation_is_not_host_activation');
    if(e.kind==='host_activation'&&e.payload.status!=='active')conflicts.push('host_not_active');
    if(e.kind==='session_resume'&&(e.actorType!=='host'||e.payload.mode!=='new_host_session'||!e.payload.fromSessionId||!e.payload.toSessionId||e.payload.fromSessionId===e.payload.toSessionId||!hash(e.payload.checkpointDigest)))conflicts.push('process_or_subagent_is_not_host_session');
    if(e.kind==='session_resume'&&e.payload.status!=='resumed')conflicts.push('host_resume_not_completed');
    if(e.kind==='material_observation'&&e.payload.materialNature!=='real_user_material')conflicts.push('synthetic_is_not_natural_material');
    if(e.kind==='material_observation'&&(e.payload.coverage!=='content_observed'||!hash(e.payload.sourceDigest)))conflicts.push('material_content_observation_missing');
    if(e.kind==='human_review'&&(!hash(e.payload.reviewedTextDigest)||e.payload.method!=='human_readback'))conflicts.push('human_readback_missing');
    if(e.kind==='human_review'&&e.payload.decision!=='approved')conflicts.push('human_review_not_approved');
    rows.push({id:e.id,kind:e.kind,actorType:e.actorType,eventDigest,conflicts,originAuthenticated:Boolean(authority),
      state:conflicts.length?'contradicted':authority?'origin_bound':'self_reported'});
  }
  const claims=Object.fromEntries(Object.entries(requirements).map(([key,kind])=>[key,rows.some(r=>r.kind===kind&&r.state==='origin_bound')]));
  return{ok:issues.length===0,issues,rows,claims,reviewReady:Object.values(claims).every(Boolean),submitReady:false,
    submissionAuthorization:'never_derived_from_an_assessment',provenanceBoundary:'authority registry must come from independently reviewed host/user evidence; hashes alone are not identity proof',
    modelReviewCount:rows.filter(r=>r.kind==='model_review').length};
}
