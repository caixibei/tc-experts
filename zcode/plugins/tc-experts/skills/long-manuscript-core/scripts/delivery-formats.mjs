import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha256, stableJson} from './lib/kernel-utils.mjs';

const scriptRoot=path.dirname(fileURLToPath(import.meta.url));
export function deliveryFormats(value) {
  const formats=value??['markdown','html'];
  if(!Array.isArray(formats)||formats.length<2||formats.length>3||new Set(formats).size!==formats.length||
     formats.some(f=>!['markdown','html','docx'].includes(f))||!formats.includes('markdown')||!formats.includes('html'))
    throw new Error('project_delivery_formats_invalid');
  return ['markdown','html','docx'].filter(f=>formats.includes(f));
}
export function deliveryOutputNames(formats) {
  return ['manuscript.md','manuscript.html','resume.json',...(formats.includes('docx')?['manuscript.docx']:[])];
}
export function rendererIdentity(entry='project-readback-runtime.mjs') {
  const seen=new Set(),rows=[];
  const visit=(file)=>{
    const full=path.resolve(scriptRoot,file);
    if(!full.startsWith(scriptRoot+path.sep))throw new Error('project_renderer_dependency_escape');
    if(seen.has(full))return;seen.add(full);
    if(seen.size>256)throw new Error('project_renderer_dependency_budget');
    const bytes=fs.readFileSync(full),source=bytes.toString('utf8');
    rows.push({path:path.relative(scriptRoot,full).replaceAll('\\','/'),bytes:bytes.length,sha256:sha256(bytes)});
    const imports=[...source.matchAll(/\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s*['"]([^'"]+)['"]/g)];
    for(const m of imports){const spec=m[1]??m[2]??m[3];if(spec.startsWith('node:'))continue;
      if(!spec.startsWith('.'))throw new Error('project_renderer_external_dependency');
      visit(path.relative(scriptRoot,path.resolve(path.dirname(full),spec)));
    }
  };
  visit(entry);rows.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  return {algorithm:'static_literal_module_closure_sha256_v1',files:rows,digest:sha256(stableJson(rows))};
}
export function simpleDocxParagraphs(markdown) {
  if(/(^|\n)\s*```|!\[[^\]]*\]\(|(^|\n)\s*\|.*\||<\/?(?:table|img|iframe)\b/iu.test(markdown))
    throw new Error('project_docx_markup_outside_supported_scope');
  const rows=[],buffer=[];
  const push=(text,style)=>{const runs=[];let start=0;for(const m of text.matchAll(/\*\*([^*\n]+)\*\*/gu)){
    if(m.index>start)runs.push({text:text.slice(start,m.index)});runs.push({text:m[1],bold:true});start=m.index+m[0].length;}
    if(start<text.length)runs.push({text:text.slice(start)});
    rows.push({text:runs.map(r=>r.text).join(''),style,runs});};
  const flush=()=>{if(buffer.length){push(buffer.join(' '),'Normal');buffer.length=0;}};
  for(const line of markdown.split(/\r?\n/u)){
    const heading=line.match(/^(#{1,6})\s+(.+)$/u);
    if(heading){flush();if(heading[1].length>2)throw new Error('project_docx_heading_depth_unsupported');push(heading[2],heading[1].length===1?'Heading1':'Heading2');}
    else if(!line.trim())flush();else if(line.trim()!=='---')buffer.push(line.trim());
  }
  flush();return rows;
}
