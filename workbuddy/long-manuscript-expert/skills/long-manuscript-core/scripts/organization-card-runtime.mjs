import { sha256, stableJson } from './lib/kernel-utils.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const length = value => [...value].length; // JSON Schema maxLength counts Unicode code points.
const invalidText = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const text = (value, max = 2000) => typeof value === 'string' && value.trim().length > 0 &&
  length(value) <= max && !invalidText.test(value);
const id = value => typeof value === 'string' && value === value.trim() && /^[a-z][a-z0-9-]{0,127}$/u.test(value);
const unique = values => new Set(values).size === values.length;
const cleanList = (value, maxItems = 32, maxLength = 256, references = false) =>
  Array.isArray(value) && value.length <= maxItems &&
  value.every(item => text(item, maxLength) && item === item.trim() &&
    (!references || !/[\u0000-\u001f\u007f]/u.test(item))) && unique(value);
const onlyKeys = (value, keys) => Object.keys(value).every(key => keys.includes(key));
const inputKeys = ['chapterId', 'purpose', 'readerQuestion', 'progression', 'selectedSourceRefs', 'adjacent', 'knownMissingInfo', 'constraints'];
const fail = (...issues) => ({ ok: false, issues: [...new Set(issues)], semanticTruthVerified: false, fileWritesPerformed: false });

function validateProgression(item) {
  return object(item) && onlyKeys(item, ['id', 'label', 'sourceRefs', 'completionQuestion']) &&
    id(item.id) && text(item.label, 240) &&
    cleanList(item.sourceRefs === undefined ? [] : item.sourceRefs, 32, 256, true) &&
    text(item.completionQuestion, 500);
}

/**
 * Input form: organization-card.schema.json#/$defs/buildInput.
 * The root schema describes the normalized returned card, not the API input.
 * References are opaque source references, not evidence that a source exists or supports a claim.
 * Cross-field invariants (unique step IDs, selected-source membership and adjacency) are checked here.
 * This optional planning artifact never writes a project or establishes writing-quality superiority.
 */
export function buildOrganizationCard(input) {
  if (!object(input)) return fail('organization_card_input_invalid');
  if (!onlyKeys(input, inputKeys)) return fail('organization_card_input_property_unknown');
  if (!id(input.chapterId)) return fail('organization_card_chapter_id_invalid');
  if (!text(input.purpose, 1000)) return fail('organization_card_purpose_required');
  if (!text(input.readerQuestion, 1000)) return fail('organization_card_reader_question_required');
  if (!Array.isArray(input.progression) || input.progression.length < 1 || input.progression.length > 8 ||
    input.progression.some(item => !validateProgression(item))) return fail('organization_card_progression_invalid');
  const progressionIds = input.progression.map(item => item.id);
  if (!unique(progressionIds)) return fail('organization_card_duplicate_progression_id');
  const progression = input.progression.map(item => ({
    id: item.id,
    label: item.label.trim(),
    sourceRefs: [...(item.sourceRefs === undefined ? [] : item.sourceRefs)].sort(),
    completionQuestion: item.completionQuestion.trim()
  }));
  // Omitted selection means the union of explicitly referenced sources. Explicit [] stays empty.
  const selectedSourceRefs = input.selectedSourceRefs === undefined
    ? [...new Set(progression.flatMap(item => item.sourceRefs))]
    : input.selectedSourceRefs;
  if (!cleanList(selectedSourceRefs, 64, 256, true)) return fail('organization_card_selected_sources_invalid');
  const selected = new Set(selectedSourceRefs);
  if (progression.some(item => item.sourceRefs.some(ref => !selected.has(ref)))) {
    return fail('organization_card_progression_source_not_selected');
  }
  const knownMissingInfo = input.knownMissingInfo === undefined ? [] : input.knownMissingInfo;
  const constraints = input.constraints === undefined ? [] : input.constraints;
  if (!cleanList(knownMissingInfo, 32, 500)) return fail('organization_card_missing_info_invalid');
  if (!cleanList(constraints, 32, 500)) return fail('organization_card_constraints_invalid');
  if (input.adjacent !== undefined && (!object(input.adjacent) ||
    !onlyKeys(input.adjacent, ['previousId', 'nextId']) ||
    [input.adjacent.previousId, input.adjacent.nextId].some(value => value !== null && value !== undefined && !id(value)))) {
    return fail('organization_card_adjacent_invalid');
  }
  const adjacent = { previousId: input.adjacent?.previousId ?? null, nextId: input.adjacent?.nextId ?? null };
  if (adjacent.previousId === input.chapterId || adjacent.nextId === input.chapterId) {
    return fail('organization_card_adjacent_self_reference');
  }
  if (adjacent.previousId !== null && adjacent.previousId === adjacent.nextId) {
    return fail('organization_card_adjacent_duplicate_neighbor');
  }
  const card = {
    schemaVersion: 'manuscriptos.organization-card/v1',
    artifactType: 'chapter_organization_card',
    chapterId: input.chapterId,
    purpose: input.purpose.trim(),
    readerQuestion: input.readerQuestion.trim(),
    progression,
    selectedSourceRefs: [...selectedSourceRefs].sort(),
    adjacent,
    knownMissingInfo: [...knownMissingInfo],
    constraints: [...constraints],
    evidenceBoundary: 'source_refs_are_references_not_proof; card_is_a_writing_plan',
    status: 'draft_for_writing'
  };
  return {
    ok: true,
    card,
    cardDigest: sha256(stableJson(card)),
    semanticTruthVerified: false,
    authorVoicePreservedVerified: false,
    fileWritesPerformed: false,
    nextAction: 'use_card_as_optional_context_for_one_bounded_writing_pass'
  };
}

export const organizationCardExample = {
  chapterId: 'origin',
  purpose: '说明本章要解决的起点问题及其变化。',
  readerQuestion: '读者读完本章后，能否说明起点、转折和仍待核实之处？',
  progression: [
    { id: 'starting-condition', label: '交代起点', sourceRefs: ['source-origin'], completionQuestion: '起点是否由来源支持？' },
    { id: 'turning-point', label: '说明转折', sourceRefs: ['source-origin'], completionQuestion: '转折与前后关系是否清楚？' }
  ],
  selectedSourceRefs: ['source-origin'],
  adjacent: { previousId: null, nextId: 'next-chapter' },
  knownMissingInfo: ['转折的具体日期待核实'],
  constraints: ['保留来源中的不确定表述']
};
