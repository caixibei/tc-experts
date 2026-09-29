import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sha256, stableJson, escapeHtml } from './lib/kernel-utils.mjs';
import { physicalRoot, physicalChild, readProjectText } from './lib/physical-project-files.mjs';
import { deriveDocumentState } from './document-state-runtime.mjs';
import { manuscriptCheckpoint } from './manuscript-checkpoint.mjs';
import { auditManuscriptFidelity } from './fidelity-runtime.mjs';
import { resolveSourceSelectors } from './source-selectors.mjs';
import { auditReviewBindings, chapterReviewBasis } from './review-bindings.mjs';
import { sourceLineage } from './source-derivation.mjs';
import { verifyDelivery, prepareDeliveryPreview } from './delivery-lifecycle.mjs';
import { deliveryFormats, rendererIdentity, simpleDocxParagraphs } from './delivery-formats.mjs';
import { renderDocx } from './docx-runtime.mjs';
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const id=x=>typeof x==='string'&&/^[a-z][a-z0-9-]{0,127}$/u.test(x);

export function readbackProject(input){
  try{
    if(!object(input))throw new Error('project_input_invalid');
    const root=physicalRoot(input.root);let bindings=input.fileBindings,prior=null,projectId=input.projectId,decisions=input.decisions??[],projectTitle=input.projectTitle,materialNature=input.materialNature??'not_observed',reviewFiles=input.reviewFiles??[],transitions=[];
    if(input.fromCheckpoint===true){
      const r=manuscriptCheckpoint({mode:'read',root});if(!r.ok||!r.head)throw new Error('project_checkpoint_unavailable');
      prior=r.head;bindings=prior.snapshot.fileBindings;projectId=prior.snapshot.ProjectStatus.projectId;decisions=prior.snapshot.decisions;projectTitle=prior.snapshot.ProjectStatus.title;materialNature=prior.snapshot.materialNature??'not_observed';reviewFiles=prior.snapshot.reviewFiles??[];transitions=r.sourceTransitions??[];
      if(!bindings)throw new Error('project_legacy_snapshot_physical_links_missing');
    }
    if(input.sourcePathOverrides!==undefined){
      if(input.fromCheckpoint!==true||!Array.isArray(input.sourcePathOverrides))throw new Error('project_source_override_invalid');bindings=structuredClone(bindings);const ids=new Set();
      for(const o of input.sourcePathOverrides){const source=bindings.sources.find(s=>s.id===o?.sourceId);if(!source||typeof o.path!=='string'||ids.has(o.sourceId))throw new Error('project_source_override_invalid');ids.add(o.sourceId);source.path=o.path;}
    }
    if(!id(projectId)||!object(bindings)||!Array.isArray(bindings.sources)||!Array.isArray(bindings.chapters)||bindings.sources.length>512||bindings.chapters.length>512||!Array.isArray(decisions))throw new Error('project_bindings_invalid');
    if((projectTitle!==undefined&&(typeof projectTitle!=='string'||!projectTitle.trim()||projectTitle.length>200))||!['synthetic','user_supplied','public_source','not_observed','test_derived'].includes(materialNature)||!Array.isArray(reviewFiles)||reviewFiles.length>512)throw new Error('project_presentation_metadata_invalid');
    if([...bindings.sources,...bindings.chapters].some(f=>!object(f)||!id(f.id))||new Set([...bindings.sources,...bindings.chapters].map(f=>f.id)).size!==bindings.sources.length+bindings.chapters.length)throw new Error('project_duplicate_or_invalid_ids');
    let readBytes=0;
    const boundedRead=p=>{const r=readProjectText(root,p);readBytes+=r.bytes;if(readBytes>4*1048576)throw new Error('project_total_read_budget_exceeded');return r;};
    const sources=bindings.sources.map(f=>({id:f.id,...boundedRead(f.path)}));
    const sourceDigests=Object.fromEntries(sources.map(s=>[s.id,s.digest]));
    const lineages=sources.map(s=>({sourceId:s.id,record:sourceLineage(root,s)})).filter(x=>x.record);
    if(lineages.some(l=>l.record.effectiveKind==='simulation'))materialNature='test_derived';
    const unclassifiedChanges=sources.filter(s=>!lineages.some(l=>l.sourceId===s.id)&&((prior&&prior.snapshot.sourceDigests[s.id]!==s.digest)||transitions.some(t=>t.sourceId===s.id))).map(s=>s.id);
    const selectorMaps=new Map();let selectorCount=0;
    const chapters=bindings.chapters.map(f=>{
      if(!Array.isArray(f.sourceIds)||f.sourceIds.some(s=>!sources.some(x=>x.id===s)))throw new Error('project_source_dependency_invalid');
      const observed=boundedRead(f.path),old=prior?.snapshot.chapters.find(c=>c.id===f.id);
      const selectors=f.sourceSelectors??[];if(!Array.isArray(selectors)||selectors.length>128||new Set(selectors.map(s=>s?.id)).size!==selectors.length)throw new Error('project_selectors_invalid');selectorCount+=selectors.length;if(selectorCount>512)throw new Error('project_selector_budget_exceeded');
      const map=new Map(),selectedDependencies=[];
      for(const s of selectors){if(!s||!id(s.id)||!f.sourceIds.includes(s.sourceId))throw new Error('project_selector_source_invalid');const source=sources.find(x=>x.id===s.sourceId),r=resolveSourceSelectors({text:source.text,selectors:[s]});if(!r.rows?.length)throw new Error('project_selector_invalid');const depId='fragment-'+sha256(stableJson({chapter:f.id,source:s.sourceId,id:s.id})).slice(0,24);sourceDigests[depId]=r.rows[0].digest;map.set(s.id,{...r.rows[0],sourceId:s.sourceId,dependencyId:depId});selectedDependencies.push({id:depId,digest:r.rows[0].expectedDigest});}
      selectorMaps.set(f.id,map);
      const dependencies=[...selectedDependencies,...f.sourceIds.filter(s=>!selectors.some(q=>q.sourceId===s)).map(s=>({id:s,digest:sourceDigests[s]}))];
      return{id:f.id,...observed,dependencies:old?.dependencies??dependencies};
    });
    if([...sources,...chapters].reduce((n,f)=>n+f.bytes,0)>4*1048576)throw new Error('project_total_read_budget_exceeded');
    const fidelity=bindings.chapters.map((f,i)=>{let missing=false;const adjusted=f.fidelityBindings?.map(b=>{if(!b.sourceSelectorId)return b;const s=selectorMaps.get(f.id)?.get(b.sourceSelectorId);if(!s||s.sourceId!==b.sourceId||s.status!=='resolved'){missing=true;return b;}return{...b,sourceStart:s.start,sourceEnd:s.end};});return{chapterId:f.id,result:missing?{ok:false,status:'source_selector_unresolved',issues:['project_fidelity_selector_unresolved']}:adjusted?auditManuscriptFidelity({draft:chapters[i].text,sources:Object.fromEntries(sources.map(s=>[s.id,{text:s.text,digest:s.digest}])),bindings:adjusted}):{ok:true,status:'not_assessed',semanticTruthVerified:false}};});
    const state=deriveDocumentState({projectId,chapters,currentSourceDigests:sourceDigests,declaredToc:input.declaredToc});
    const fidelityIssues=fidelity.filter(f=>!f.result.ok).map(f=>'project_fidelity_conflict:'+f.chapterId);
    const changedChapters=prior?chapters.filter(c=>prior.snapshot.chapters.find(p=>p.id===c.id)?.digest!==c.digest).map(c=>c.id):[];
    const reviewSubjects=chapters.map(c=>({chapterId:c.id,textDigest:c.digest,basisDigest:chapterReviewBasis(c,sourceDigests)}));
    const reviewArtifacts=reviewFiles.map(p=>boundedRead(p)),reviews=auditReviewBindings({subjects:reviewSubjects,reviews:reviewArtifacts.map(f=>JSON.parse(f.text))});
    const staleReview=reviews.rows?.find(r=>r.state==='stale'||r.state==='changes_requested');
    if(staleReview&&state.projection?.counts.needsSourceReview===0){state.projection.nextAction='review:'+staleReview.chapterId;state.projection.nextActionLabel='复核当前版本并更新审阅记录：'+(state.projection.chapters.find(c=>c.chapterId===staleReview.chapterId)?.title??staleReview.chapterId);state.projectionDigest=sha256(stableJson(state.projection));}
    const snapshot={schemaVersion:'manuscriptos.project-snapshot/v1',ProjectStatus:{projectId,title:projectTitle??projectId,nextAction:state.projection?.nextAction},materialNature,decisions,sourceDigests,
      chapters:chapters.map(({id,text,digest,dependencies})=>({id,text,digest,dependencies})),fileBindings:bindings,reviewFiles};
    // Second physical pass closes ordinary concurrent edits across separately read files.
    for(const f of [...sources,...chapters,...reviewArtifacts])if(readProjectText(root,f.path).digest!==f.digest)throw new Error('project_changed_during_observation');
    const fileManifest=[...sources,...chapters].map(({id,path,bytes,digest})=>({id,path,bytes,digest}));
    return{schemaVersion:"manuscriptos.project-readback/v2",observationAlgorithm:"rc27_current_files_reviews_lineage_v1",ok:state.ok&&!fidelityIssues.length&&reviews.ok,issues:[...state.issues,...fidelityIssues,...(reviews.issues??[])],root,state,fidelity,reviews,reviewSubjects,reviewArtifacts:reviewArtifacts.map(({path,bytes,digest})=>({path,bytes,digest})),lineages,unclassifiedSourceChanges:unclassifiedChanges,selectors:[...selectorMaps].map(([chapterId,map])=>({chapterId,rows:[...map.values()]})),changedChapterIds:changedChapters,snapshot,fileManifest,
      observationDigest:sha256(stableJson({fileManifest,projectionDigest:state.projectionDigest,fileBindings:bindings,fidelity,projectTitle:projectTitle??projectId,materialNature,reviews,reviewArtifacts:reviewArtifacts.map(f=>f.digest),lineages,unclassifiedChanges})),priorCheckpointDigest:prior?.digest??null,
      sourceBytesActuallyRead:true,decisionEvidenceStatus:'caller_supplied_not_identity_verified',originalsChanged:false,hostValidated:false,semanticTruthVerified:false};
  }catch(error){return{ok:false,issues:[String(error.message).startsWith('project_')?error.message:'project_read_unavailable'],originalsChanged:false};}
}

export function exportDocumentBundle(input){
  let partial=null;
  try{
    const observed=readbackProject(input);if(!observed.ok)return observed;
    if(typeof input.expectedObservationDigest!=='string'||observed.observationDigest!==input.expectedObservationDigest)throw new Error('project_export_observation_stale');
    if(observed.state.projection.counts.needsSourceReview>0)throw new Error('project_export_source_review_required');
    if(observed.reviews.staleReviewIds.length||observed.reviews.rows.some(r=>r.state==='changes_requested'))throw new Error('project_export_review_not_current');
    if(input.deliveryRevision!==undefined&&!/^[a-z0-9][a-z0-9-]{0,31}$/u.test(input.deliveryRevision))throw new Error('project_delivery_revision_invalid');
    const formats=deliveryFormats(input.formats),renderer=rendererIdentity(),rendererDigest=renderer.digest;
    const deliveryId=sha256(stableJson({observationDigest:observed.observationDigest,rendererDigest,formats,revision:input.deliveryRevision??null}));
    const root=observed.root,relative='deliveries/'+deliveryId,target=physicalChild(root,relative,true);
    const labels={draft_available:'已有草稿，待整稿审阅',source_review_required:'来源变化，待复核',planned_only:'待写'};
    const rows=observed.state.projection.chapters;
    const toc=rows.map((r,i)=>`${i+1}. ${r.title} — ${labels[r.state]}`).join('\n');
    const pendingFidelity=observed.fidelity.filter(f=>f.result.status==='not_assessed'||f.result.status==='semantic_review_required').length;
    const title=observed.snapshot.ProjectStatus.title,nature=observed.snapshot.materialNature==='test_derived'?'测试派生稿：包含模拟更正，不可作为原件事实。':observed.snapshot.materialNature==='synthetic'?'合成测试材料，仅用于流程演示。':observed.snapshot.materialNature==='public_source'?'公开来源整理稿，来源事实与作者接受仍需分别审阅。':observed.snapshot.materialNature==='not_observed'?'材料来源性质尚未确认。':'';
    const correction=observed.unclassifiedSourceChanges.length?'来源历史有未分类变更，需核对更正依据。':observed.lineages.some(l=>l.record.effectiveKind==='proposed_correction')?'包含建议更正，更正依据尚未认证。':'';
    const note=`${nature}${correction}工作稿。尚待来源与表述检查的章节：${pendingFidelity}；尚无当前版本审阅记录的章节：${observed.reviews.pendingChapterIds.length}。全文语义与定稿验收尚未完成。`;
    const markdown=`# ${title}\n\n${note}\n\n## 当前目录与状态\n\n${toc}\n\n${observed.snapshot.chapters.map(c=>c.text).join('\n\n---\n\n')}\n\n## 下一步\n\n${observed.state.projection.nextActionLabel}\n`;
    const render=s=>s.split(/\r?\n\s*\r?\n/u).filter(p=>p.trim()).map(p=>/^#{1,6}\s/u.test(p)?`<h2>${escapeHtml(p.replace(/^#{1,6}\s+/u,''))}</h2>`:`<p>${escapeHtml(p).replace(/ {2}\r?\n/gu,'<br>')}</p>`).join('\n');
    const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><style>body{font:18px/1.85 system-ui;max-width:880px;margin:48px auto;padding:0 24px;color:#263238}p,li{overflow-wrap:anywhere}aside{background:#eef4f6;padding:16px;border-left:4px solid #478387}h1,h2{line-height:1.4}section{margin:42px 0}footer{border-top:1px solid #ddd;padding-top:16px}</style><h1>${escapeHtml(title)}</h1><aside>${escapeHtml(note)}</aside><nav aria-label="目录"><h2>当前目录与状态</h2><ol>${rows.map(r=>`<li>${escapeHtml(r.title)} — ${labels[r.state]}</li>`).join('')}</ol></nav>${observed.snapshot.chapters.map(c=>`<section>${render(c.text)}</section>`).join('')}<footer><h2>下一步</h2>${escapeHtml(observed.state.projection.nextActionLabel)}</footer></html>`;
    const outputs={'manuscript.md':markdown,'manuscript.html':html,'resume.json':JSON.stringify(observed.state,null,2)+'\n'};
    if(formats.includes('docx')){
      const paragraphs=[{text:`${nature}${correction}工作稿，尚待全文语义与定稿验收。`,style:'Normal'},{text:'目录',style:'Heading1'},
        ...rows.map((r,i)=>({text:`${i+1}. ${r.title}`,style:'Normal'})),
        ...observed.snapshot.chapters.flatMap(c=>simpleDocxParagraphs(c.text))];
      outputs['manuscript.docx']=renderDocx({title,paragraphs}).bytes;
    }
    if(Object.values(outputs).some(b=>Buffer.byteLength(b)>32*1048576))throw new Error('project_export_file_over_budget');
    const manifest={schemaVersion:formats.includes('docx')?'manuscriptos.delivery-bundle/v3':'manuscriptos.delivery-bundle/v2',rendererDigest,rendererDependencies:renderer,formats,preferredPreviewFormat:formats.includes('docx')?'docx':'html',deliveryId,observationDigest:observed.observationDigest,deliveryRevision:input.deliveryRevision??null,declaredMaterialNature:observed.snapshot.materialNature,lineage:observed.lineages.map(l=>({sourceId:l.sourceId,lineageDigest:l.record.lineageDigest,effectiveKind:l.record.effectiveKind})),unclassifiedSourceChanges:observed.unclassifiedSourceChanges,inputFiles:observed.fileManifest,outputs:Object.entries(outputs).map(([path,text])=>({path,bytes:Buffer.byteLength(text),sha256:sha256(text)})),reviewQueue:observed.fidelity.map(f=>({chapterId:f.chapterId,status:f.result.status})),reviews:observed.reviews,reviewSubjects:observed.reviewSubjects,lifecycle:{canonical:true,preview:'separate_copy',acceptance:'exact_raw_bytes'},formatValidation:{docx:formats.includes('docx')?'generated_scoped_ooxml_requires_task_render_review':'not_requested',renderedInCurrentTask:false},humanAccepted:false};
    function verify(directory){if(fs.readdirSync(directory).sort().join('|')!==[...Object.keys(outputs),'manifest.json'].sort().join('|'))throw new Error('project_export_file_set_mismatch');for(const e of manifest.outputs){const b=fs.readFileSync(physicalChild(directory,e.path));if(b.length!==e.bytes||sha256(b)!==e.sha256)throw new Error('project_export_readback_mismatch');}if(fs.readFileSync(physicalChild(directory,'manifest.json'),'utf8')!==JSON.stringify(manifest,null,2)+'\n')throw new Error('project_export_manifest_mismatch');}
    const deliveryResult=status=>{const manifestDigest=sha256(JSON.stringify(manifest,null,2)+'\n'),preview=prepareDeliveryPreview({root,directory:relative,expectedManifestDigest:manifestDigest});return{ok:preview.ok,status:preview.ok?status:'canonical_saved_preview_failed',issues:preview.issues??[],directory:target,relativeDirectory:relative,manifest,manifestDigest,preview:preview.preview??null,openPath:preview.openPath??null,nextAction:observed.state.projection.nextActionLabel,canonicalSaved:true,canonicalIdempotent:true,previewAlwaysFresh:true,originalsChanged:false,hostValidated:false,semanticTruthVerified:false};};
    if(fs.existsSync(target)){verify(target);return deliveryResult('already_exported_verified');}
    const parent=physicalChild(root,'deliveries',true);if(!fs.existsSync(parent))fs.mkdirSync(parent);
    partial=physicalChild(root,'deliveries/.partial-'+randomUUID(),true);fs.mkdirSync(partial);
    for(const [name,content]of Object.entries(outputs))fs.writeFileSync(path.join(partial,name),content,{flag:'wx'});
    fs.writeFileSync(path.join(partial,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});verify(partial);
    const after=readbackProject(input);if(!after.ok||after.observationDigest!==observed.observationDigest)throw new Error('project_changed_before_export');
    fs.renameSync(partial,target);partial=null;verify(target);
    const seal=verifyDelivery({root,directory:relative,expectedManifestDigest:sha256(JSON.stringify(manifest,null,2)+'\n')});if(!seal.ok)throw new Error('project_final_delivery_verification_failed');
    return deliveryResult('exported_and_readback_verified');
  }catch(error){return{ok:false,issues:[String(error.message).startsWith('project_')?error.message:'project_export_failed'],retainedPartialDirectory:partial,originalsChanged:false};}
}
