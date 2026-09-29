import { sha256 } from './lib/kernel-utils.mjs';

const observed = '据林女士回忆，1998年工坊只有3名员工。';
const source = { sourceId: 'interview-1', modality: 'text', sourceDigest: sha256(observed), declaredBytes: Buffer.byteLength(observed), originKind: 'original' };
const original = '整体而言，这项尝试可能改善协作，但尚未取得统计结果。';
export const workflowActions = {
  chapterContext: { required: ['objective', 'chapterId', 'blocks', 'currentDigests', 'maxBytes'],
    budget: 'UTF-8 bytes of packet, including block metadata; required blocks are never truncated',
    example: { objective: '写工坊起家史第一章', chapterId: 'chapter-1', maxBytes: 4096,
      currentDigests: { 'constraint-1': sha256('保留口述归属，不补人物心理。') },
      blocks: [{ id: 'constraint-1', kind: 'constraint', text: '保留口述归属，不补人物心理。', digest: sha256('保留口述归属，不补人物心理。'), protected: true, priority: 100, dependencies: [] }] } },
  draftTrace: { required: ['draft', 'cards', 'evidence', 'claims', 'currentSourceDigests'],
    anchors: 'JavaScript UTF-16 offsets, start inclusive and end exclusive; text hashes are raw UTF-8',
    example: { draft: observed, currentSourceDigests: { 'interview-1': source.sourceDigest },
      cards: [{ source, derivatives: [], anchors: [{ anchorId: 'anchor-1', kind: 'character_range', start: 0, end: observed.length }],
        observations: [{ observationId: 'observation-1', kind: 'text_read', anchorId: 'anchor-1', derivativeId: null, contentDigest: sha256(observed), state: 'observed', unknowns: [] }],
        claims: [{ claimId: 'claim-1', textDigest: sha256(observed), observationIds: ['observation-1'], state: 'attributed' }] }],
      evidence: [{ id: 'evidence-1', sourceId: 'interview-1', observationId: 'observation-1', text: observed }],
      claims: [{ id: 'claim-1', start: 0, end: observed.length, textDigest: sha256(observed), evidenceIds: ['evidence-1'], kind: 'direct_quote' }] } },
  chapterImpact: { required: ['chapters', 'currentDigests'], example: { chapters: [{ id: 'chapter-1', digest: sha256(observed), dependencies: [{ id: 'interview-1', digest: source.sourceDigest }] }],
    currentDigests: { 'chapter-1': sha256(observed), 'interview-1': sha256('用户将员工人数更正为4名。') } } },
  reviseExpression: { required: ['original', 'baseDigest', 'genre', 'allowedRanges', 'protectedRanges', 'patches'],
    example: { original, baseDigest: sha256(original), genre: '研究说明', allowedRanges: [{ start: 0, end: original.length }], protectedRanges: [],
      patches: [{ start: 0, end: 5, expected: '整体而言，', replacement: '', reason: '删除不增加信息的开场，保留概率和未决限定。' }] } },
  reviewSelect: { required: ['original', 'versions'], evidenceBoundary: 'review receipts must bind exact text; evidence references remain caller-provided',
    example: { original, versions: [{ id: 'version-1', text: original, review: { status: 'completed', textDigest: sha256(original), reviewerRef: 'local-review-example', score: 80,
      checks: ['facts', 'scope', 'expression'].map(id => ({ id, state: 'passed', evidenceRef: `example-review:${id}` })), findings: [] } }] } },
  checkpoint: { required: ['mode:initialize|commit|read|recover', 'root:absolute_existing_directory'],
    writeFields: ['idempotencyKey', 'expectedDigest:null_on_initialize', 'expectedVersion:0_on_initialize', 'snapshot'],
    writes: 'explicit opt-in .fbs/manuscript-checkpoints.sqlite and SQLite journal only; no manuscript file migration or export',
    bounds: '1 MiB per snapshot; 256 revisions and 64 MiB total; no automatic pruning',
    example: { mode: 'read', root: '/replace-with-authorized-existing-project' } }
};
