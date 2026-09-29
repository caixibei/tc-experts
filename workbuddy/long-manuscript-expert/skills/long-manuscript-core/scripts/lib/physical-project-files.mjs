import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from './kernel-utils.mjs';
export function physicalRoot(root){
  if(typeof root!=='string'||!path.isAbsolute(root))throw new Error('project_absolute_root_required');
  const resolved=path.resolve(root);let p=path.parse(resolved).root;
  for(const part of resolved.slice(p.length).split(path.sep).filter(Boolean)){p=path.join(p,part);if(fs.lstatSync(p).isSymbolicLink())throw new Error('project_link_rejected');}
  if(!fs.statSync(resolved).isDirectory())throw new Error('project_directory_required');return resolved;
}
export function physicalChild(root,relative,allowMissing=false){
  if(typeof relative!=='string'||relative.includes('\\')||relative.includes(':')||relative.startsWith('/')||/[\x00-\x1f]/u.test(relative)||relative.split('/').some(s=>!s||s==='.'||s==='..'||/[ .]$/u.test(s)))throw new Error('project_relative_path_invalid');
  let p=root;
  for(const part of relative.split('/')){p=path.join(p,part);try{const st=fs.lstatSync(p);if(st.isSymbolicLink()||(!st.isDirectory()&&(!st.isFile()||st.nlink!==1)))throw new Error('project_link_rejected');}catch(e){if(!(allowMissing&&e.code==='ENOENT'))throw e;}}
  return p;
}
export function readProjectText(root,relative){
  const file=physicalChild(root,relative),fd=fs.openSync(file,'r');
  try{
    const before=fs.fstatSync(fd);if(!before.isFile()||before.size>1048576)throw new Error('project_file_over_budget');
    const data=fs.readFileSync(fd),after=fs.fstatSync(fd);
    if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||data.length!==before.size)throw new Error('project_file_changed_during_read');
    const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(data);
    return{path:relative,bytes:data.length,digest:sha256(data),text};
  }finally{fs.closeSync(fd);}
}
