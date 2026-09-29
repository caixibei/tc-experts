import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, stableJson, unique } from './lib/kernel-utils.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const policyPath = path.join(skillRoot, 'resources', 'project-state-policy.json');
const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
if (policy.schemaVersion !== 'fbs.project-state-policy/v1' || !Array.isArray(policy.projectLifecycle) || !policy.allowedTransitions || typeof policy.allowedTransitions !== 'object') {
  throw new Error('project-state-policy is invalid');
}

export const projectStates = Object.freeze([...policy.projectLifecycle]);
if (new Set(projectStates).size !== projectStates.length || Object.keys(policy.allowedTransitions).sort().join(',') !== [...projectStates].sort().join(',')) {
  throw new Error('project-state-policy lifecycle and transition keys diverge');
}
const transitions = Object.fromEntries(projectStates.map((state) => {
  const targets = policy.allowedTransitions[state];
  if (!Array.isArray(targets) || new Set(targets).size !== targets.length || targets.some((target) => !projectStates.includes(target) || target === state)) {
    throw new Error(`project-state-policy has invalid transitions for ${state}`);
  }
  return [state, Object.freeze([...targets])];
}));

export function createProject(input = {}) {
  const project = {
    schemaVersion: '1.0.0',
    projectId: input.projectId ?? `project-${sha256(stableJson(input)).slice(0, 16)}`,
    documentType: input.documentType ?? 'general',
    audience: input.audience ?? null,
    goal: input.goal ?? null,
    state: 'intake',
    operationMode: input.operationMode ?? 'material_activation',
    domainScene: input.domainScene ?? 'general',
    materialIds: unique(input.materialIds ?? []),
    chapterIds: unique(input.chapterIds ?? []),
    openEvidenceGaps: unique(input.openEvidenceGaps ?? []),
    constraints: unique(input.constraints ?? []),
    decisionLog: []
  };
  return { ...project, stateDigest: sha256(stableJson(project)) };
}

export function transitionProject(project, nextState, evidence = {}) {
  const sourceValidation = validateProject(project);
  if (!sourceValidation.ok) return { ok: false, issue: 'invalid_source_project', issues: sourceValidation.issues };
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return { ok: false, issue: 'invalid_transition_evidence', issues: ['evidence_object_required'] };
  if (evidence.expectedStateDigest !== project.stateDigest) return { ok: false, issue: 'stale_source_project', issues: ['expectedStateDigest_mismatch'] };
  if (!projectStates.includes(project?.state) || !projectStates.includes(nextState)) return { ok: false, issue: 'unknown_state' };
  if (!transitions[project.state].includes(nextState)) return { ok: false, issue: `invalid_transition:${project.state}->${nextState}` };
  const evidencePayload = {
    evidenceRef: evidence.evidenceRef ?? null,
    actor: evidence.actor ?? 'user_or_expert',
    expectedStateDigest: evidence.expectedStateDigest,
  };
  const next = {
    ...project,
    state: nextState,
    decisionLog: [...(project.decisionLog ?? []), {
      from: project.state,
      to: nextState,
      previousStateDigest: project.stateDigest,
      evidenceRef: evidencePayload.evidenceRef,
      actor: evidencePayload.actor,
      evidenceDigest: sha256(stableJson(evidencePayload)),
    }]
  };
  delete next.stateDigest;
  return { ok: true, project: { ...next, stateDigest: sha256(stableJson(next)) } };
}

export function validateProject(project) {
  const issues = [];
  if (!project?.projectId) issues.push('projectId_missing');
  if (!projectStates.includes(project?.state)) issues.push('state_invalid');
  if (!project?.documentType) issues.push('documentType_missing');
  if (!project?.operationMode) issues.push('operationMode_missing');
  if (!project?.domainScene) issues.push('domainScene_missing');
  if (!Array.isArray(project?.decisionLog)) issues.push('decisionLog_invalid');
  const copy = { ...project };
  delete copy.stateDigest;
  if (project?.stateDigest !== sha256(stableJson(copy))) issues.push('stateDigest_mismatch');
  return { ok: issues.length === 0, issues };
}
