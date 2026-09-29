import { sha256, stableJson } from './lib/kernel-utils.mjs';
import { routeDomainScene } from './scene-runtime.mjs';

const boundedText = text => typeof text === 'string' && text.length > 0 && text.length <= 8192;
const objective = (sceneId, role, readerQuestion) => ({ sceneId, role, readerQuestion, sourceRequirements: ['selected_materials', 'source_card_or_explicit_gap'] });

function compatibleComposite(text) {
  const value = text.normalize('NFKC');
  const brand = /(?:品牌|起家|创业|白手起家|成长历程|打拼)/u.test(value);
  const cases = /(?:客户|大客户|标杆客户|合作案例|案例|互相成就)/u.test(value);
  if (brand && cases) return { compositeId: 'brand-story-and-casebook', objectives: [
    objective('brand-story-longform', 'primary_narrative', '这个组织如何形成并演进？'),
    objective('casebook', 'evidence_cases', '哪些客户合作或案例支撑这段叙述？'),
  ] };
  const genealogy = /(?:世系|家谱|宗谱|各房|族谱)/u.test(value);
  const oral = /(?:口述|长辈|访谈|回忆|经历|录音)/u.test(value);
  if (genealogy && oral) return { compositeId: 'genealogy-and-oral-history', objectives: [
    objective('genealogy', 'relationship_spine', '人物与支系关系如何确定？'),
    objective('memoir-oral-history', 'narrative_testimony', '哪些口述经历需要归属呈现？'),
  ] };
  return null;
}

export function planDocumentIntent(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !boundedText(input.text ?? '')) return { ok: false, status: 'invalid_invocation', issues: ['plan_text_invalid_or_over_budget'] };
  const routed = routeDomainScene({ text: input.text, explicitSceneId: input.explicitSceneId ?? null });
  const composite = input.explicitSceneId == null ? compatibleComposite(input.text) : null;
  if (composite) {
    const plan = { schemaVersion: 'manuscriptos.document-plan/v1', kind: 'composite', compositeId: composite.compositeId, objectives: composite.objectives, userChoiceRequired: false, routeEvidence: routed.status, constraints: ['source_scope_required', 'claims_require_source_or_attribution', 'single_writer_commit'] };
    return { ok: true, status: 'composite_planned', plan, planDigest: sha256(stableJson(plan)), semanticTruthVerified: false };
  }
  if (routed.ok && routed.sceneId) {
    const plan = { schemaVersion: 'manuscriptos.document-plan/v1', kind: 'single', compositeId: null, objectives: [objective(routed.sceneId, 'primary', '这份文稿需要回答什么问题？')], userChoiceRequired: false, routeEvidence: routed.routeSource, constraints: ['source_scope_required', 'claims_require_source_or_attribution', 'single_writer_commit'] };
    return { ok: true, status: 'single_planned', plan, planDigest: sha256(stableJson(plan)), semanticTruthVerified: false };
  }
  if (routed.status === 'needs_clarification') return { ok: false, status: 'clarification_required', issues: routed.issues ?? [], clarification: routed.clarification ?? null, candidates: routed.candidates ?? [] };
  return { ok: false, status: routed.status ?? 'plan_unavailable', issues: routed.issues ?? ['plan_unavailable'] };
}
