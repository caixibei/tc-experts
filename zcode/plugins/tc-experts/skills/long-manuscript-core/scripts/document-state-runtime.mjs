import { sha256, stableJson } from './lib/kernel-utils.mjs';
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const id=x=>typeof x==='string'&&/^[a-z][a-z0-9-]{0,127}$/u.test(x);
export function deriveDocumentState(input){
  if(!object(input)||!id(input.projectId)||!Array.isArray(input.chapters)||!input.chapters.length||input.chapters.length>512||!object(input.currentSourceDigests))return{ok:false,issues:['document_state_input_invalid']};
  const issues=[],rows=[],seen=new Set();
  for(const c of input.chapters){
    if(!object(c)||!id(c.id)||seen.has(c.id)||typeof c.text!=='string'||c.digest!==sha256(c.text)||!Array.isArray(c.dependencies)||c.dependencies.some(d=>!object(d)||!id(d.id)||typeof d.digest!=='string'||!/^[a-f0-9]{64}$/u.test(d.digest))){issues.push('document_chapter_identity_invalid');continue;}
    seen.add(c.id);const lines=c.text.split(/\r?\n/u),heading=lines.find(l=>/^#\s+/u.test(l));
    const title=heading?heading.replace(/^#\s+/u,'').trim():c.id;
    const paragraphs=c.text.split(/\r?\n\s*\r?\n/u).filter(p=>p.trim()&&!/^\s*(?:#{1,6}\s|---\s*$|>)/u.test(p));
    const hasProse=paragraphs.some(p=>!/^\s*(?:[-*]\s|\d+\.|\|)/u.test(p));
    const stale=c.dependencies.filter(d=>!object(d)||input.currentSourceDigests[d.id]!==d.digest).map(d=>d?.id??'invalid');
    const state=stale.length?'source_review_required':hasProse?'draft_available':'planned_only';
    // A complete paragraph is retained or omitted. Never manufacture an abstract from an old summary.
    const excerpt=paragraphs.find(p=>Buffer.byteLength(p,'utf8')<=2048)??null;
    rows.push({chapterId:c.id,title,digest:c.digest,state,staleSourceIds:stale,excerpt,excerptKind:excerpt?'verbatim_paragraph':'not_included_over_budget',
      completedByHuman:false,embeddedVersionLabel:/v\d+|定稿|已完成/u.test(title)?'requires_document_level_reconciliation':null});
  }
  if(input.declaredToc!==undefined){
    if(!Array.isArray(input.declaredToc)||input.declaredToc.length!==rows.length||rows.some((r,i)=>input.declaredToc[i]?.chapterId!==r.chapterId||input.declaredToc[i]?.state!==r.state))issues.push('document_declared_toc_stale');
  }
  const canonicalTitle=s=>s.replace(/[（(](?:初稿|结构|定稿|v\d)[^）)]*[）)]/giu,'').replace(/[\s*#]/gu,'');
  for(const c of input.chapters){
    const toc=c?.text?.match(/^#{1,6}\s*(?:目录|当前目录与状态)\s*\r?\n([\s\S]*?)(?=^#{1,6}\s|$(?![\s\S]))/mu)?.[1];
    if(!toc)continue;
    for(const line of toc.split(/\r?\n/u))for(const row of rows){
      if(canonicalTitle(line).includes(canonicalTitle(row.title))&&/正文待写|结构就绪|—\s*待写/u.test(line)&&row.state!=='planned_only')issues.push('document_embedded_toc_stale');
    }
  }
  const next=rows.find(r=>r.state==='source_review_required')??rows.find(r=>r.state==='planned_only');
  const nextAction=next?`${next.state==='source_review_required'?'review':'write'}:${next.chapterId}`:'review:whole-document';
  const projection={schemaVersion:'manuscriptos.document-state/v1',projectId:input.projectId,chapters:rows,
    counts:{total:rows.length,drafts:rows.filter(r=>r.state==='draft_available').length,needsSourceReview:rows.filter(r=>r.state==='source_review_required').length,planned:rows.filter(r=>r.state==='planned_only').length},nextAction,
    nextActionLabel:next?`${next.state==='source_review_required'?'对照更新后的来源复核':'继续写作'}《${next.title}》`:'通读整稿，核对来源、表达与未决事项'};
  return{ok:issues.length===0,issues,projection,projectionDigest:sha256(stableJson(projection)),semanticTruthVerified:false,derivedFrom:'current_content_and_source_versions',completionAccepted:false};
}
