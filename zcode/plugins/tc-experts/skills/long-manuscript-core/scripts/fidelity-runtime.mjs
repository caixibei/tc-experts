import { sha256 } from './lib/kernel-utils.mjs';
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const text=x=>typeof x==='string'&&x.trim().length>0;
const normalize=s=>s.normalize('NFKC').replace(/\s+/gu,'');
const sorted=x=>[...x].sort().join('|');
const uncertain=/可能|也许|或许|大概|大约|差不多|左右|记不清|不确定|未核实|[0-9一二三四五六七八九十百千万两]+多|\b(?:may|might|perhaps|approximately)\b/giu;
const absolute=/从不|总是|一定|必然|全部|所有|一律|毫无疑问|\b(?:always|never|certainly|definitely|all)\b/giu;
const negative=/尚未|还没|没有|不能|不得|并非|未曾|不超过|不到|不|未|无|\b(?:not|never|no)\b/giu;
const upper=/不超过|至多|最多|不到|\bat most\b/giu;
const lower=/至少|不低于|不少于|\bat least\b/giu;
const quotation=s=>[...s.matchAll(/[“「"]([^”」"\n]+)[”」"]/gu)].map(m=>m[1]);
function chineseNumber(s){
  const digits={'零':0,'〇':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9},units={'十':10,'百':100,'千':1000,'万':10000};
  if([...s].every(c=>Object.hasOwn(digits,c)))return String(Number([...s].map(c=>digits[c]).join('')));
  let total=0,section=0,n=0;
  for(const c of s){if(Object.hasOwn(digits,c))n=digits[c];else if(c==='万'){section=(section+n||1)*10000;total+=section;section=0;n=0;}else{section+=(n||1)*units[c];n=0;}}
  return String(total+section+n);
}
function numbers(s){return [...s.normalize('NFKC').matchAll(/[0-9]+(?:\.[0-9]+)?|[零〇一二两三四五六七八九十百千万]+(?=\s*(?:年|月|日|名|人|件|把|张|单|个|次|元|多))/gu)].map(m=>/^\d/u.test(m[0])?String(Number(m[0])):chineseNumber(m[0]));}
const attribution=s=>[...s.matchAll(/据([^，。！？\n]{1,20}?)(?:回忆|介绍|表示|所述|口述)/gu)].map(m=>normalize(m[1]));
export function compareFidelity(input){
  if(!object(input)||!text(input.source)||!text(input.draft)||input.source.length>262144||input.draft.length>262144)return{ok:false,issues:['fidelity_input_invalid'],semanticTruthVerified:false};
  const s=input.source,d=input.draft,issues=[];
  if([...s.matchAll(uncertain)].length>[...d.matchAll(uncertain)].length)issues.push('uncertainty_removed');
  if([...d.matchAll(absolute)].length>[...s.matchAll(absolute)].length)issues.push('absolute_claim_added');
  if(sorted(numbers(s))!==sorted(numbers(d)))issues.push('quantity_or_date_changed');
  if([...s.matchAll(negative)].length!==[...d.matchAll(negative)].length)issues.push('negation_changed');
  if([...s.matchAll(upper)].length!==[...d.matchAll(upper)].length||[...s.matchAll(lower)].length!==[...d.matchAll(lower)].length)issues.push('bound_changed');
  const sa=attribution(s),da=attribution(d);
  if(sa.length&&!da.length)issues.push('attribution_removed');else if(sorted(sa)!==sorted(da))issues.push('attribution_changed');
  if(sorted(quotation(s))!==sorted(quotation(d)))issues.push('quotation_changed');
  if(input.mode==='quote'&&!s.includes(d))issues.push('exact_quote_not_supported');
  const identical=s===d;
  return{ok:!issues.length,issues,sourceDigest:sha256(s),draftDigest:sha256(d),status:issues.length?'mechanical_conflict':identical?'literal_match':'semantic_review_required',
    semanticTruthVerified:false,semanticReviewRequired:!identical,scope:'bounded_surface_invariants_not_entailment_or_complete_entity_analysis'};
}

export function auditManuscriptFidelity(input){
  if(!object(input)||!text(input.draft)||input.draft.length>262144||!object(input.sources)||!Array.isArray(input.bindings)||input.bindings.length>1024)return{ok:false,issues:['fidelity_document_input_invalid']};
  const seen=new Set(),covered=new Uint8Array(input.draft.length),kinds=new Uint8Array(input.draft.length),rows=[],issues=[];
  for(const b of input.bindings){
    if(!object(b)||!text(b.id)||seen.has(b.id)||!Number.isSafeInteger(b.start)||!Number.isSafeInteger(b.end)||b.start<0||b.end<=b.start||b.end>input.draft.length||!['claim','quote','structure','unverified'].includes(b.kind)){issues.push('fidelity_binding_invalid');continue;}
    seen.add(b.id);const fragment=input.draft.slice(b.start,b.end);let result;
    if(b.textDigest!==sha256(fragment)){issues.push('fidelity_draft_anchor_stale');continue;}
    if(b.kind==='structure'){
      if(!fragment.split('\n').filter(x=>x.trim()).every(line=>/^#{1,6}\s+|^\s*[-*_]{3,}\s*$/u.test(line)))issues.push('fidelity_structure_contains_prose');
      result={ok:true,status:'structural_text'};
    }else if(b.kind==='unverified'){result={ok:true,status:'semantic_review_required'};}
    else{
      const s=input.sources[b.sourceId];
      if(!object(s)||!text(s.text)||s.digest!==sha256(s.text)||!Number.isSafeInteger(b.sourceStart)||!Number.isSafeInteger(b.sourceEnd)||b.sourceStart<0||b.sourceEnd<=b.sourceStart||b.sourceEnd>s.text.length){issues.push('fidelity_source_anchor_invalid');continue;}
      result=compareFidelity({source:s.text.slice(b.sourceStart,b.sourceEnd),draft:fragment,mode:b.kind==='quote'?'quote':'paraphrase'});
    }
    covered.fill(1,b.start,b.end);const flag=b.kind==='unverified'?4:b.kind==='structure'?8:result.status==='literal_match'?3:1;for(let i=b.start;i<b.end;i++)kinds[i]|=flag;rows.push({id:b.id,kind:b.kind,start:b.start,end:b.end,...result});
  }
  const gaps=[];let start=null;
  for(let i=0;i<=input.draft.length;i++){
    const missing=i<input.draft.length&&!covered[i]&&!/\s/u.test(input.draft[i]);
    if(missing&&start===null)start=i;
    if(!missing&&start!==null){gaps.push({start,end:i});start=null;}
  }
  if(gaps.length)issues.push('fidelity_unmapped_prose');
  if(rows.some(r=>!r.ok))issues.push('fidelity_claim_conflict');
  const reviewIds=rows.filter(r=>r.status==='semantic_review_required').map(r=>r.id);
  const mapped={sourceMappedCharacters:0,literalMatchCharacters:0,unverifiedCharacters:0,structuralCharacters:0};for(let i=0;i<kinds.length;i++){if(/\s/u.test(input.draft[i]))continue;const k=kinds[i];if(k&4)mapped.unverifiedCharacters++;else if(k&1){mapped.sourceMappedCharacters++;if(k&2)mapped.literalMatchCharacters++;}else if(k&8)mapped.structuralCharacters++;}
  return{ok:!issues.length,issues:[...new Set(issues)],rows,unmappedRanges:gaps,reviewIds,draftDigest:sha256(input.draft),
    coverage:{declaredBindings:input.bindings.length,evaluatedBindings:rows.length,unmappedCharacters:gaps.reduce((n,g)=>n+g.end-g.start,0),...mapped,unit:'non_whitespace_UTF16_code_units',semanticAccuracyNotMeasured:true},
    status:issues.length?'blocked':reviewIds.length?'semantic_review_required':'literal_and_structure_checked',
    semanticTruthVerified:false,atomicClaimCompletenessVerified:false};
}
