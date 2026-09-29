import {sha256,stableJson} from './lib/kernel-utils.mjs';
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
export function resolveSourceSelectors(input){
  if(!object(input)||typeof input.text!=='string'||input.text.length>1048576||!Array.isArray(input.selectors)||input.selectors.length>512)return{ok:false,issues:['selector_input_invalid']};
  const rows=[],issues=[],ids=new Set();
  for(const s of input.selectors){
    if(!object(s)||typeof s.id!=='string'||!s.id||ids.has(s.id)||typeof s.exact!=='string'||!s.exact||s.exact.length>262144||[s.prefix,s.suffix].some(x=>x!==undefined&&typeof x!=='string')){issues.push('selector_shape_invalid');continue;}
    ids.add(s.id);const positions=[];let p=-1;
    while((p=input.text.indexOf(s.exact,p+1))!==-1){if((s.prefix===undefined||input.text.slice(0,p).endsWith(s.prefix))&&(s.suffix===undefined||input.text.slice(p+s.exact.length).startsWith(s.suffix)))positions.push(p);if(positions.length>1)break;}
    const status=positions.length===1?'resolved':positions.length?'ambiguous':'missing';
    if(status!=='resolved')issues.push('selector_'+status);
    rows.push({id:s.id,status,start:status==='resolved'?positions[0]:null,end:status==='resolved'?positions[0]+s.exact.length:null,digest:status==='resolved'?sha256(s.exact):sha256(stableJson({id:s.id,status})),expectedDigest:sha256(s.exact)});
  }
  return{ok:!issues.length,issues:[...new Set(issues)],rows,sourceDigest:sha256(input.text),positionUnit:'UTF16',semanticEquivalenceInferred:false};
}
