import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';import {sha256} from './lib/kernel-utils.mjs';import {physicalRoot,physicalChild,readProjectText} from './lib/physical-project-files.mjs';
import {deliveryFormats,deliveryOutputNames} from './delivery-formats.mjs';
const HASH=/^[a-f0-9]{64}$/u;
export function verifyDelivery(input){
  try{
    if(!input||typeof input.directory!=='string'||!input.directory.startsWith('deliveries/')||!HASH.test(input.expectedManifestDigest??''))throw new Error('delivery_identity_required');
    const root=physicalRoot(input.root),directory=physicalChild(root,input.directory),mp=input.directory+'/manifest.json',raw=readProjectText(root,mp);
    if(raw.digest!==input.expectedManifestDigest)throw new Error('delivery_manifest_changed');
    const manifest=JSON.parse(raw.text);
    if(!['manuscriptos.delivery-bundle/v2','manuscriptos.delivery-bundle/v3'].includes(manifest.schemaVersion))throw new Error('delivery_manifest_version_unsupported');
    const formats=manifest.schemaVersion==='manuscriptos.delivery-bundle/v3'?deliveryFormats(manifest.formats):['markdown','html'];
    const names=deliveryOutputNames(formats);
    if(!Array.isArray(manifest.outputs)||manifest.outputs.length!==names.length||new Set(manifest.outputs.map(e=>e.path)).size!==names.length||manifest.outputs.some(e=>!names.includes(e.path)||!HASH.test(e.sha256??'')||!Number.isSafeInteger(e.bytes)||e.bytes<0||e.bytes>32*1048576))throw new Error('delivery_manifest_invalid');
    const issues=[],files=[];if(fs.readdirSync(directory).sort().join('|')!==[...names,'manifest.json'].sort().join('|'))issues.push('delivery_file_set_changed');
    for(const e of manifest.outputs){const f=physicalChild(root,input.directory+'/'+e.path);if(fs.statSync(f).size>32*1048576)throw new Error('delivery_file_over_budget');const bytes=fs.readFileSync(f),actualDigest=sha256(bytes),matches=actualDigest===e.sha256&&bytes.length===e.bytes;let diagnostic=null;
      if(!matches){issues.push('delivery_bytes_changed:'+e.path);if(e.path==='manuscript.html'){const s=bytes.toString('utf8'),removed=s.replace(/ data-page-node-id="[^"]*"/gu,'');if(removed!==s&&sha256(removed)===e.sha256)diagnostic='preview_attribute_only_raw_identity_still_invalid';}}
      files.push({path:e.path,expectedDigest:e.sha256,actualDigest,expectedBytes:e.bytes,actualBytes:bytes.length,matches,diagnostic});
    }
    // Re-read the group after the first pass so a concurrent change to an earlier
    // file during a later read cannot be reported as an unchanged delivery.
    for(const row of files){const f=physicalChild(root,input.directory+'/'+row.path);if(fs.statSync(f).size>32*1048576)throw new Error('delivery_file_over_budget');const bytes=fs.readFileSync(f);row.finalObservedDigest=sha256(bytes);row.finalObservedBytes=bytes.length;
      if(row.finalObservedDigest!==row.expectedDigest||bytes.length!==row.expectedBytes){row.matches=false;issues.push('delivery_bytes_changed:'+row.path);}}
    if(readProjectText(root,mp).digest!==raw.digest)issues.push('delivery_manifest_changed_during_verification');
    if(fs.readdirSync(directory).sort().join('|')!==[...names,'manifest.json'].sort().join('|'))issues.push('delivery_file_set_changed');
    return{ok:!issues.length,issues:[...new Set(issues)],manifest,manifestDigest:raw.digest,directory,relativeDirectory:input.directory,files,canonicalBytesUnchanged:!issues.length,verificationPasses:2,observationBoundary:'two physical passes; mutations after verification require a fresh check',normalizationUsedForAcceptance:false};
  }catch(e){return{ok:false,issues:[e.message],canonicalBytesUnchanged:false};}
}
export function prepareDeliveryPreview(input){
  let partial=null;
  try{
    const sealed=verifyDelivery(input);if(!sealed.ok)return sealed;
    const requestedFormat=input.previewFormat??sealed.manifest.preferredPreviewFormat??'html';
    const previewName={html:'manuscript.html',markdown:'manuscript.md',docx:'manuscript.docx'}[requestedFormat];
    if(!previewName||!sealed.manifest.outputs.some(e=>e.path===previewName))throw new Error('delivery_preview_format_unavailable');
    const root=physicalRoot(input.root),parent=physicalChild(root,'previews',true);if(!fs.existsSync(parent))fs.mkdirSync(parent);
    const relative='previews/'+randomUUID(),target=physicalChild(root,relative,true);partial=target;fs.mkdirSync(target);
    for(const name of [...sealed.manifest.outputs.map(e=>e.path),'manifest.json'])fs.copyFileSync(physicalChild(root,input.directory+'/'+name),path.join(target,name),fs.constants.COPYFILE_EXCL);
    for(const e of sealed.manifest.outputs)if(sha256(fs.readFileSync(path.join(target,e.path)))!==e.sha256)throw new Error('preview_copy_mismatch');
    if(!verifyDelivery(input).ok)throw new Error('canonical_changed_during_preview_copy');
    const receipt={schemaVersion:'manuscriptos.preview-copy/v1',canonicalDirectory:input.directory,canonicalManifestDigest:input.expectedManifestDigest,previewDirectory:relative,previewFile:relative+'/'+previewName,previewFormat:requestedFormat,previewIsCanonical:false,mayBeModifiedByRenderer:true};
    fs.writeFileSync(path.join(target,'preview-info.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});partial=null;
    return{ok:true,preview:receipt,canonicalUnchanged:true,openPath:path.join(target,previewName)};
  }catch(e){return{ok:false,issues:[e.message],retainedPartialDirectory:partial};}
}
