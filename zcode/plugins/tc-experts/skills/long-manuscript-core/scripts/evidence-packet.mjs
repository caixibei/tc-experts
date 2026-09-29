import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const nonempty = v => typeof v === 'string' && v.trim().length > 0;
// Select references; never trim a decision or silently promote evidence.
export function createEvidencePacket(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {ok:false,issues:['invalid_packet_input']};
  const { objective, decisions = [], sources = [], unresolved = [], maxBytes = 32768 } = input;
  if (typeof objective !== 'string' || !objective.trim() || !Number.isSafeInteger(maxBytes) || maxBytes < 256 || maxBytes > 1048576 || ![decisions,sources,unresolved].every(Array.isArray) || sources.length > 10000 || decisions.length > 1000 || unresolved.length > 1000) return {ok:false,issues:['invalid_packet_input']};
  if (decisions.some(d=>!['user_confirmed','model_proposed','unknown'].includes(d?.state) || (d.state==='user_confirmed' && !nonempty(d.userMessageRef)))) return {ok:false,issues:['decision_provenance_missing']};
  if (sources.some(s=>!nonempty(s?.id) || !nonempty(s.ref) || !nonempty(s.originId) || !['metadata_only','observed_unreviewed','source_verified'].includes(s.state) || (s.state==='source_verified'&&!nonempty(s.reviewRef))) || new Set(sources.map(s=>s.id)).size !== sources.length) return {ok:false,issues:['source_provenance_invalid']};
  const packet={schemaVersion:'manuscriptos.evidence-packet/v1',objective,decisions,unresolved,sources:[],omittedSourceIds:sources.map(s=>s.id)};
  const size = () => Buffer.byteLength(JSON.stringify(packet));
  if (size()>maxBytes) return {ok:false,issues:['required_state_exceeds_budget'],requiredBytes:size()};
  for(const source of sources){
    packet.sources.push(source);packet.omittedSourceIds.shift();
    if(size()>maxBytes){packet.sources.pop();packet.omittedSourceIds.unshift(source.id);break;}
  }
  const json=JSON.stringify(packet);
  return {ok:true,packet,bytes:Buffer.byteLength(json),sha256:createHash('sha256').update(json).digest('hex'),semanticTruthVerified:false};
}

export function auditTranscript(input={}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {ok:false,issues:['invalid_transcript_input']};
  const {duration,segments=[],corrections=[]} = input;
  const issues=[];
  if (!Number.isFinite(duration)||duration<=0||!Array.isArray(segments)||segments.length>100000||!Array.isArray(corrections)||corrections.length>10000) return {ok:false,issues:['invalid_transcript_input']};
  const ids=new Set();let end=0;const gaps=[];
  for(const s of segments){
    if(!nonempty(s?.id)||ids.has(s.id))issues.push('segment_id_invalid');ids.add(s?.id);
    if(!Number.isFinite(s?.start)||!Number.isFinite(s?.end)||s.start<0||s.end<=s.start||s.end>duration||typeof s.text!=='string'){issues.push('segment_invalid');continue;}
    if(s.start<end)issues.push('segment_overlap_or_order_conflict');
    if(s.start>end)gaps.push([end,s.start]);end=Math.max(end,s.end);
  }
  if(end<duration)gaps.push([end,duration]);
  for(const c of corrections){
    if (!c || typeof c !== 'object' || Array.isArray(c)) { issues.push('correction_invalid'); continue; }
    if(!ids.has(c?.segmentId)||!c.original||!c.replacement||!['candidate','reviewed'].includes(c.state))issues.push('correction_invalid');
    if(c.state==='reviewed'&&(!['human_audio_review','source_text_review'].includes(c.basis)||!nonempty(c.reviewRef)))issues.push('correction_review_missing');
    if(!segments.some(s=>s?.id===c.segmentId&&typeof s.text==='string'&&s.text.includes(c.original)))issues.push('correction_not_in_raw_segment');
  }
  return {ok:issues.length===0,issues:[...new Set(issues)],segmentCount:segments.length,coveredEnd:end,gaps,coverageMeaning:'timestamp_intervals_only_not_speech_completeness',rawEvidenceState:'observed_unreviewed',semanticTruthVerified:false};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(JSON.stringify({ok:false,status:'library_only',entrypoint:'scripts/expert-tools.mjs',hint:'Use --describe, --example or --self-test at the unified entrypoint.'})+'\n');
  process.exitCode=2;
}
