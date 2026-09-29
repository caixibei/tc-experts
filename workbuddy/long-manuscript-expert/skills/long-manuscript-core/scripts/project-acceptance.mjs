import {readbackProject} from './project-readback-runtime.mjs';import {verifyDelivery} from './delivery-lifecycle.mjs';
export function auditProjectAcceptance(input,{acceptedCorrectionDigests=[]}={}){
  if(!input||!['working_draft','factual_acceptance'].includes(input.purpose??'working_draft'))return{ok:false,issues:['acceptance_input_invalid']};
  const fresh=readbackProject(input),delivery=verifyDelivery({...input.delivery,root:input.root}),issues=[];
  if(!fresh.ok)issues.push(...(fresh.issues??['project_readback_failed']));
  if(!delivery.ok)issues.push(...(delivery.issues??['delivery_verification_failed']));
  if(fresh.state?.projection.counts.needsSourceReview)issues.push('source_review_pending');
  if(fresh.reviews?.staleReviewIds.length)issues.push('review_version_stale');
  if(fresh.reviews?.rows.some(r=>r.state==='changes_requested'))issues.push('review_changes_requested');
  if(delivery.manifest&&fresh.observationDigest&&delivery.manifest.observationDigest!==fresh.observationDigest)issues.push('delivery_observation_stale');
  const localIntegrityReady=!issues.length;
  const provenanceBlocked=!fresh.snapshot||['test_derived','synthetic','public_source','not_observed'].includes(fresh.snapshot.materialNature)||(fresh.unclassifiedSourceChanges?.length??0)>0||fresh.lineages?.some(l=>l.record.effectiveKind==='proposed_correction'&&!acceptedCorrectionDigests.includes(l.record.lineageDigest));
  if(input.purpose==='factual_acceptance'){
    if(provenanceBlocked)issues.push('source_lineage_not_ready_for_factual_acceptance');
    if(fresh.reviews?.pendingChapterIds.length)issues.push('current_review_missing');
  }
  return{schemaVersion:'manuscriptos.project-acceptance/v1',ok:!issues.length,issues:[...new Set(issues)],localIntegrityReady,
    sourceStatus:{materialNature:fresh.snapshot?.materialNature??'not_observed',provenanceBlocked,unclassifiedChanges:fresh.unclassifiedSourceChanges??[]},
    reviewStatus:fresh.reviews??null,reviewSubjects:fresh.reviewSubjects??[],delivery,
    observationDigest:fresh.observationDigest??null,semanticTruthVerified:false,humanAcceptanceVerified:false,submitted:false};
}
