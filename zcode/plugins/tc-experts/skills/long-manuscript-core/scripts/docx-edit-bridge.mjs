import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import {sha256} from './lib/kernel-utils.mjs';

export function docxEdit(input) {
  if(!input||!['inspect','edit'].includes(input.operation))return{ok:false,issues:['docx_operation_invalid']};
  const script=fileURLToPath(new URL('./docx-edit.py',import.meta.url));
  const python=process.env.FBS_MANUSCRIPT_PYTHON||'python';
  const r=spawnSync(python,['-I','-B',script],{input:JSON.stringify(input),encoding:'utf8',windowsHide:true,
    timeout:30000,maxBuffer:64*1048576});
  if(r.error)return{ok:false,status:r.error.code==='ENOENT'?'unavailable':'execution_failed',issues:[r.error.code==='ENOBUFS'?'docx_inspection_output_over_budget':r.error.code==='ETIMEDOUT'?'docx_utility_timeout':'docx_python_unavailable_or_failed'],
    nextAction:'use an actually available document tool or continue with editable text',hostValidated:false};
  let output;try{output=JSON.parse(r.stdout);}catch{return{ok:false,issues:['docx_utility_output_invalid'],exitCode:r.status,hostValidated:false};}
  if((r.status===0)!==(output.ok===true))return{ok:false,issues:['docx_utility_exit_mismatch'],exitCode:r.status,hostValidated:false};
  return {...output,utilitySha256:sha256(fs.readFileSync(script)),exitCode:r.status,hostValidated:false,
    layoutValidation:'not_performed_by_this_utility'};
}
