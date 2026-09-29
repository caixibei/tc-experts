import {sha256,stableJson} from './lib/kernel-utils.mjs';
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/u.test(x);
export function chapterReviewBasis(chapter,currentDigests,lineage=[]){return sha256(stableJson({chapterId:chapter.id,textDigest:chapter.digest,dependencies:chapter.dependencies.map(d=>({id:d.id,digest:currentDigests[d.id]??null})),lineage}));}
export function auditReviewBindings(input){
  if(!object(input)||!Array.isArray(input.subjects)||!Array.isArray(input.reviews)||input.reviews.length>512)return{ok:false,issues:['review_binding_input_invalid']};
  if(input.subjects.some(s=>!object(s)||typeof s.chapterId!=='string'||!hash(s.textDigest)||!hash(s.basisDigest))||new Set(input.subjects.map(s=>s.chapterId)).size!==input.subjects.length)return{ok:false,issues:['review_subjects_invalid']};
  const rows=[],issues=[],seen=new Set();
  for(const r of input.reviews){
    if(!object(r)||typeof r.id!=='string'||!r.id||seen.has(r.id)||!['model','human'].includes(r.actorType)||!['approved','changes_requested'].includes(r.decision)||!hash(r.reviewedTextDigest)||!hash(r.basisDigest)){issues.push('review_record_invalid');continue;}
    seen.add(r.id);const s=input.subjects.find(s=>s.chapterId===r.chapterId);const stale=[];
    if(!s)stale.push('unknown_chapter');else{if(r.reviewedTextDigest!==s.textDigest)stale.push('text_changed');if(r.basisDigest!==s.basisDigest)stale.push('source_context_changed');}
    rows.push({id:r.id,chapterId:r.chapterId,actorType:r.actorType,state:stale.length?'stale':r.decision==='approved'?'current_declared_review':'changes_requested',staleReasons:stale});
  }
  const pendingChapterIds=input.subjects.filter(s=>!rows.some(r=>r.chapterId===s.chapterId&&r.state==='current_declared_review')).map(s=>s.chapterId);
  return{ok:!issues.length,issues,rows,pendingChapterIds,staleReviewIds:rows.filter(r=>r.state==='stale').map(r=>r.id),humanIdentityVerified:false,semanticQualityVerified:false};
}
