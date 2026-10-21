/**
 * Proposals: changes to lectio itself — proposed by the tutor (or you, or the builder),
 * approved by you, built by the builder, shipped by you, and judged by the tutor.
 *
 * The rules of the lifecycle are here, pure; who may move a proposal along each edge is
 * enforced by the server by actor. This module is protected (§11): the loop can't
 * loosen its own checks.
 */
import {Node, type Issue} from './validate.ts';

export const AREAS = ['block_type', 'question_type', 'measure', 'context', 'contract', 'learner_ui', 'scheduling', 'tutor_skill', 'other'] as const;
/** Areas where approving needs an explicit acknowledgement. */
export const PROTECTED_AREAS = ['limits', 'permissions', 'sandbox', 'improvement_loop'] as const;
export const ALL_AREAS = [...AREAS, ...PROTECTED_AREAS] as const;
export type Area = (typeof ALL_AREAS)[number];
export const isProtectedArea = (area: string) => (PROTECTED_AREAS as readonly string[]).includes(area);

export const PROPOSAL_STATUSES = ['open', 'approved', 'building', 'needs_info', 'in_review', 'changes_requested', 'shipped', 'declined', 'deferred', 'withdrawn'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** Statuses that count against an agent's `proposals_open_max`. */
export const OPEN_STATUSES: readonly ProposalStatus[] = ['open', 'deferred', 'needs_info'];
/** Statuses that hold a branch: what `build_wip_max` limits. */
export const IN_FLIGHT: readonly ProposalStatus[] = ['building', 'in_review', 'changes_requested'];
/** Statuses where more evidence still matters. */
export const SUPPORTABLE: readonly ProposalStatus[] = ['open', 'approved', 'deferred', 'needs_info', 'building', 'changes_requested'];

export const PRIORITIES = ['high', 'normal', 'low'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const OUTCOMES = ['helped', 'no_difference', 'got_in_the_way', 'unused'] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const EVIDENCE_KINDS = ['lesson', 'block', 'question', 'run', 'measure', 'feedback'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const COMMENT_KINDS = ['comment', 'decision', 'support', 'question', 'answer', 'handback', 'review', 'outcome'] as const;
export type CommentKind = (typeof COMMENT_KINDS)[number];

export interface Evidence {
  kind: EvidenceKind;
  id: string | null;
  note: string;
}

export interface ProposalInput {
  title: string;
  area: Area;
  problem: string;
  change: string;
  success: string;
  evidence: Evidence[];
}

/** The edges of the lifecycle: action → the statuses it may start from, and where it goes. */
export const TRANSITIONS = {
  approve: {from: ['open', 'deferred'], to: 'approved'},
  decline: {from: ['open', 'approved', 'deferred', 'needs_info'], to: 'declined'},
  defer: {from: ['open', 'approved', 'needs_info'], to: 'deferred'},
  withdraw: {from: ['open', 'deferred'], to: 'withdrawn'},
  claim: {from: ['approved', 'changes_requested'], to: 'building'},
  ask: {from: ['building'], to: 'needs_info'},
  answer: {from: ['needs_info'], to: 'approved'},
  submit: {from: ['building'], to: 'in_review'},
  request_changes: {from: ['in_review'], to: 'changes_requested'},
  shipped: {from: ['in_review'], to: 'shipped'},
} as const satisfies Record<string, {from: readonly ProposalStatus[]; to: ProposalStatus}>;
export type Action = keyof typeof TRANSITIONS;

export function canMove(action: Action, status: ProposalStatus): boolean {
  return (TRANSITIONS[action].from as readonly ProposalStatus[]).includes(status);
}

export function readEvidence(node: Node): Evidence[] {
  const out: Evidence[] = [];
  for (const item of node.optionalArray({max: 30})) {
    item.object(['kind', 'id', 'note']);
    const kind = item.get('kind').oneOf(EVIDENCE_KINDS);
    const id = item.get('id').optionalString({max: 40});
    const note = item.get('note').string({max: 1000});
    if (kind !== undefined && kind !== 'measure' && (id === undefined || id.trim() === '')) item.get('id').fail(`a ${kind} needs its id`);
    if (kind !== undefined && note !== undefined) out.push({kind, id: id?.trim() || null, note});
  }
  return out;
}

/** A proposal as filed. Every problem is listed by path. */
export function readProposal(value: unknown): {value?: ProposalInput; issues: Issue[]} {
  const node = Node.root(value);
  const o = node.object(['title', 'area', 'problem', 'change', 'success', 'evidence']);
  if (o === undefined) return {issues: node.issues};
  const title = node.get('title').string({max: 120});
  const area = node.get('area').oneOf(ALL_AREAS);
  const problem = node.get('problem').string({max: 4000});
  const change = node.get('change').string({max: 4000});
  const success = node.get('success').string({max: 2000});
  const evidence = readEvidence(node.get('evidence'));
  if (node.issues.length > 0 || title === undefined || area === undefined || problem === undefined || change === undefined || success === undefined) return {issues: node.issues};
  return {value: {title: title.trim(), area, problem: problem.trim(), change: change.trim(), success: success.trim(), evidence}, issues: []};
}

/** `lectio/p12-flashcard-block`: the branch a proposal is built on. */
export function branchName(number: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .split('-')
    .slice(0, 5)
    .join('-');
  return `lectio/p${number}-${slug || 'change'}`;
}

export function numberFromBranch(branch: string): number | undefined {
  const match = /^lectio\/p(\d+)-/.exec(branch);
  return match === null ? undefined : Number(match[1]);
}
