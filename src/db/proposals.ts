/**
 * Proposals and their conversation, stored. Who may move a proposal is checked here by
 * role as well as at the route, because the lifecycle is the loop's own guardrail (§11):
 * only you approve, decline, defer, request changes or mark shipped; only the builder
 * claims, asks and submits; the tutor files, supports, withdraws its own and judges.
 *
 * Protected (§11): changing this file needs the learner's explicit acknowledgement.
 */
import {AppError, EXIT_USAGE, failed, notFound, refused, usageError} from '../core/errors.ts';
import {
  canMove,
  IN_FLIGHT,
  isProtectedArea,
  OPEN_STATUSES,
  OUTCOMES,
  PRIORITIES,
  readEvidence,
  readProposal,
  SUPPORTABLE,
  TRANSITIONS,
  type Action,
  type CommentKind,
  type Evidence,
  type ProposalStatus,
} from '../core/proposals.ts';
import {daysBetween} from '../core/time.ts';
import {whose, type Role} from '../core/permissions.ts';
import type {Run} from '../core/types.ts';
import {Node, formatIssue} from '../core/validate.ts';
import {parseJson, type Ctx} from './context.ts';
import {resolveId, type RefKind} from './refs.ts';
import {getRun, requireOpenRun} from './runs.ts';
import {numberSetting} from './settings.ts';

export interface Proposal {
  id: string;
  number: number;
  title: string;
  area: string;
  problem: string;
  change: string;
  success: string;
  evidence: Evidence[];
  support: number;
  protected: boolean;
  acknowledged: boolean;
  priority: string;
  status: ProposalStatus;
  proposed_by: string;
  run_id: string | null;
  branch: string | null;
  commit_sha: string | null;
  shipped_at: string | null;
  outcome: string | null;
  outcome_note: string | null;
  added: string;
  changed: string;
}

export interface ProposalComment {
  id: string;
  proposal_id: string;
  actor: string;
  kind: CommentKind;
  body: string;
  at: string;
}

interface ProposalRow extends Omit<Proposal, 'evidence' | 'protected' | 'acknowledged'> {
  evidence: string;
  protected: number;
  acknowledged: number;
}

const fromRow = (row: ProposalRow): Proposal => ({...row, evidence: parseJson<Evidence[]>(row.evidence, []), protected: row.protected === 1, acknowledged: row.acknowledged === 1});

export function getProposal(ctx: Ctx, id: string): Proposal | undefined {
  const row = ctx.db.query('SELECT * FROM proposals WHERE id = ?').get(id) as ProposalRow | null;
  return row === null ? undefined : fromRow(row);
}

/** By number (`12`, `#12`, `p12`) or id. */
export function resolveProposal(ctx: Ctx, ref: string | undefined): Proposal {
  if (ref === undefined || ref.trim() === '') throw usageError('which proposal? give its number');
  const number = /^(?:#|p)?(\d+)$/i.exec(ref.trim())?.[1];
  const row =
    number !== undefined
      ? (ctx.db.query('SELECT * FROM proposals WHERE number = ?').get(Number(number)) as ProposalRow | null)
      : (ctx.db.query('SELECT * FROM proposals WHERE id = ?').get(ref.trim()) as ProposalRow | null);
  if (row === null) throw notFound(`no proposal ${ref}`);
  return fromRow(row);
}

export function listProposals(ctx: Ctx, filter: {status?: string[]; area?: string; proposedBy?: string} = {}): Proposal[] {
  const where: string[] = [];
  const params: string[] = [];
  if (filter.status !== undefined && filter.status.length > 0) {
    where.push(`status IN (${filter.status.map(() => '?').join(', ')})`);
    params.push(...filter.status);
  }
  if (filter.area !== undefined) {
    where.push('area = ?');
    params.push(filter.area);
  }
  if (filter.proposedBy !== undefined) {
    where.push('proposed_by = ?');
    params.push(filter.proposedBy);
  }
  return (ctx.db.query(`SELECT * FROM proposals ${where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`} ORDER BY number DESC`).all(...params) as ProposalRow[]).map(fromRow);
}

export function commentsOf(ctx: Ctx, proposalId: string): ProposalComment[] {
  return ctx.db.query('SELECT * FROM proposal_comments WHERE proposal_id = ? ORDER BY at, rowid').all(proposalId) as ProposalComment[];
}

function comment(ctx: Ctx, proposal: Proposal, kind: CommentKind, body: string): void {
  if (body.trim() === '') return;
  ctx.db.query('INSERT INTO proposal_comments (id, proposal_id, actor, kind, body, at) VALUES (?, ?, ?, ?, ?, ?)').run(ctx.newId(), proposal.id, ctx.actor, kind, body.trim(), ctx.now());
}

function move(ctx: Ctx, proposal: Proposal, action: Action, extra: Record<string, string | number | null> = {}): Proposal {
  if (!canMove(action, proposal.status)) {
    const from = (TRANSITIONS[action].from as readonly string[]).join(' or ');
    throw failed(`#${proposal.number} is ${proposal.status}; ${action.replace('_', ' ')} needs it ${from}`);
  }
  const to = TRANSITIONS[action].to;
  const sets = ['status = ?', 'changed = ?', ...Object.keys(extra).map(k => `${k} = ?`)];
  ctx.db.query(`UPDATE proposals SET ${sets.join(', ')} WHERE id = ?`).run(to, ctx.now(), ...Object.values(extra), proposal.id);
  ctx.event('proposal', proposal.id, {kind: action, number: proposal.number, from: proposal.status, to});
  return getProposal(ctx, proposal.id)!;
}

/** The loop's own guardrail, checked here whatever route a caller came by. */
function only(ctx: Ctx, roles: Role[], what: string): void {
  if (!roles.includes(ctx.role)) throw refused(what, whose(roles));
}

const EVIDENCE_TABLE: Partial<Record<string, RefKind>> = {lesson: 'lesson', block: 'block', question: 'question', run: 'run', feedback: 'feedback'};

function checkEvidence(ctx: Ctx, evidence: Evidence[]): Evidence[] {
  return evidence.map((e, i) => {
    const kind = EVIDENCE_TABLE[e.kind];
    if (kind === undefined || e.id === null) return e;
    try {
      return {...e, id: resolveId(ctx, kind, e.id)};
    } catch {
      throw new AppError(`evidence[${i}].id: no ${e.kind} "${e.id}"`, EXIT_USAGE, {errors: [{path: `evidence[${i}].id`, message: `no ${e.kind} "${e.id}"`}]});
    }
  });
}

export function addProposal(ctx: Ctx, input: {proposal: unknown; run: string | undefined; open: boolean; acknowledge: boolean}): {proposal: Proposal; caps: {this_run_left: number | null; open_left: number | null}} {
  const read = readProposal(input.proposal);
  if (read.value === undefined) {
    throw new AppError(`the proposal has ${read.issues.length === 1 ? 'a problem' : `${read.issues.length} problems`}: ${read.issues.map(formatIssue).join('; ')}`, EXIT_USAGE, {errors: read.issues});
  }
  const p = read.value;
  const evidence = checkEvidence(ctx, p.evidence);
  const isProtected = isProtectedArea(p.area);
  let run: Run | undefined;
  if (ctx.role === 'tutor') {
    run = requireOpenRun(ctx, input.run);
    const perRun = numberSetting(ctx.db, 'proposals_per_run');
    const filed = (ctx.db.query('SELECT COUNT(*) AS n FROM proposals WHERE run_id = ?').get(run.id) as {n: number}).n;
    if (filed >= perRun) throw failed(`this run has filed ${filed} proposals, the most one run may (proposals_per_run); support an open one instead`, {cap: 'proposals_per_run'});
  }
  if (ctx.isAgent) {
    const openMax = numberSetting(ctx.db, 'proposals_open_max');
    const mine = listProposals(ctx, {status: [...OPEN_STATUSES], proposedBy: ctx.actor}).length;
    if (mine >= openMax) throw failed(`you have ${mine} proposals open, deferred or waiting on a question (proposals_open_max is ${openMax}); support or withdraw one first`, {cap: 'proposals_open_max'});
  }
  const same = listProposals(ctx, {status: [...SUPPORTABLE, 'in_review']}).find(o => o.title.toLowerCase() === p.title.toLowerCase());
  if (same !== undefined) throw failed(`#${same.number} already proposes "${same.title}"; support it instead`, {number: same.number});

  // Yours are approved on filing (unless --open); in a protected area, only with the acknowledgement.
  const approveNow = ctx.role === 'learner' && !input.open;
  if (approveNow && isProtected && !input.acknowledge) {
    throw new AppError(`"${p.area}" is a protected area: filing it approved needs --protected (or file it --open and approve later)`, EXIT_USAGE, {protected: true});
  }
  const number = ((ctx.db.query('SELECT MAX(number) AS n FROM proposals').get() as {n: number | null}).n ?? 0) + 1;
  const id = ctx.newId();
  const now = ctx.now();
  ctx.db
    .query(
      `INSERT INTO proposals (id, number, title, area, problem, change, success, evidence, support, protected, acknowledged, priority, status, proposed_by, run_id, added, changed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'normal', ?, ?, ?, ?, ?)`,
    )
    .run(id, number, p.title, p.area, p.problem, p.change, p.success, JSON.stringify(evidence), isProtected ? 1 : 0, approveNow && input.acknowledge ? 1 : 0, approveNow ? 'approved' : 'open', ctx.actor, run?.id ?? null, now, now);
  ctx.event('proposal', id, {kind: 'added', number, area: p.area, status: approveNow ? 'approved' : 'open'});
  return {proposal: getProposal(ctx, id)!, caps: capsLeft(ctx, run)};
}

export function capsLeft(ctx: Ctx, run: Run | undefined): {this_run_left: number | null; open_left: number | null} {
  if (!ctx.isAgent) return {this_run_left: null, open_left: null};
  const openMax = numberSetting(ctx.db, 'proposals_open_max');
  const open = listProposals(ctx, {status: [...OPEN_STATUSES], proposedBy: ctx.actor}).length;
  const perRun = numberSetting(ctx.db, 'proposals_per_run');
  const filed = run === undefined ? 0 : (ctx.db.query('SELECT COUNT(*) AS n FROM proposals WHERE run_id = ?').get(run.id) as {n: number}).n;
  return {this_run_left: run === undefined ? null : Math.max(0, perRun - filed), open_left: Math.max(0, openMax - open)};
}

export function supportProposal(ctx: Ctx, proposal: Proposal, input: {evidence: unknown; note: string | undefined; run: string | undefined}): Proposal {
  only(ctx, ['tutor', 'builder'], 'Supporting a proposal');
  if (ctx.role === 'tutor') requireOpenRun(ctx, input.run);
  if (!(SUPPORTABLE as readonly string[]).includes(proposal.status)) throw failed(`#${proposal.number} is ${proposal.status}; there is nothing to support`);
  const note = input.note?.trim() ?? '';
  if (note === '') throw usageError('say what you ran into this time: --note "…"');
  const node = Node.root(input.evidence ?? [], 'evidence');
  const evidence = checkEvidence(ctx, readEvidence(node));
  if (node.issues.length > 0) throw new AppError(node.issues.map(formatIssue).join('; '), EXIT_USAGE, {errors: node.issues});
  ctx.db
    .query('UPDATE proposals SET support = support + 1, evidence = ?, changed = ? WHERE id = ?')
    .run(JSON.stringify([...proposal.evidence, ...evidence]), ctx.now(), proposal.id);
  comment(ctx, proposal, 'support', note);
  ctx.event('proposal', proposal.id, {kind: 'support', number: proposal.number});
  return getProposal(ctx, proposal.id)!;
}

export function decide(
  ctx: Ctx,
  proposal: Proposal,
  action: 'approve' | 'decline' | 'defer',
  input: {note: string | undefined; priority?: string | undefined; acknowledge?: boolean},
): Proposal {
  only(ctx, ['learner'], `${action === 'approve' ? 'Approving' : action === 'decline' ? 'Declining' : 'Deferring'} a proposal`);
  const note = input.note?.trim() ?? '';
  if (action !== 'approve' && note === '') throw usageError(`say why, so the tutor learns from it: --note "…"`);
  if (action === 'approve') {
    if (input.priority !== undefined && !(PRIORITIES as readonly string[]).includes(input.priority)) throw usageError(`--priority must be one of ${PRIORITIES.join(', ')}`);
    if (proposal.protected && input.acknowledge !== true) {
      throw new AppError(`#${proposal.number} is in a protected area (${proposal.area}); approving it needs --protected, to say you know it may change the loop's own rules`, EXIT_USAGE, {protected: true});
    }
    const moved = move(ctx, proposal, 'approve', {priority: input.priority ?? proposal.priority, acknowledged: input.acknowledge === true ? 1 : 0});
    comment(ctx, moved, 'decision', note === '' ? `approved (${moved.priority})` : note);
    return moved;
  }
  const moved = move(ctx, proposal, action);
  comment(ctx, moved, 'decision', note);
  return moved;
}

export function withdraw(ctx: Ctx, proposal: Proposal, note: string | undefined): Proposal {
  if (proposal.proposed_by !== ctx.actor) throw refused('Withdrawing a proposal', `its proposer's (${proposal.proposed_by})`);
  if ((note?.trim() ?? '') === '') throw usageError('say why: --note "…"');
  const moved = move(ctx, proposal, 'withdraw');
  comment(ctx, moved, 'decision', note!);
  return moved;
}

/** In flight: building, in review, or waiting on requested changes. */
export function inFlight(ctx: Ctx): Proposal[] {
  return listProposals(ctx, {status: [...IN_FLIGHT]});
}

export function claim(ctx: Ctx, proposal: Proposal): Proposal {
  only(ctx, ['builder'], 'Claiming a proposal to build');
  if (proposal.status === 'approved') {
    const max = numberSetting(ctx.db, 'build_wip_max');
    const flying = inFlight(ctx).filter(p => p.id !== proposal.id);
    if (flying.length >= max) throw failed(`${flying.length} proposal${flying.length === 1 ? ' is' : 's are'} already in flight (${flying.map(p => `#${p.number} ${p.status}`).join(', ')}); build_wip_max is ${max}`, {cap: 'build_wip_max'});
  }
  return move(ctx, proposal, 'claim');
}

export function ask(ctx: Ctx, proposal: Proposal, question: string | undefined): Proposal {
  only(ctx, ['builder'], 'Asking about a proposal');
  if ((question?.trim() ?? '') === '') throw usageError('what is the question?');
  const moved = move(ctx, proposal, 'ask');
  comment(ctx, moved, 'question', question!);
  return moved;
}

export function answer(ctx: Ctx, proposal: Proposal, text: string | undefined): Proposal {
  only(ctx, ['learner'], "Answering the builder's question");
  if ((text?.trim() ?? '') === '') throw usageError('what is the answer?');
  const moved = move(ctx, proposal, 'answer');
  comment(ctx, moved, 'answer', text!);
  return moved;
}

export function submit(ctx: Ctx, proposal: Proposal, input: {branch: string | undefined; commit: string | undefined; note: string | undefined}): Proposal {
  only(ctx, ['builder'], 'Submitting a build for review');
  const branch = input.branch?.trim() ?? '';
  const sha = input.commit?.trim().toLowerCase() ?? '';
  if (!/^lectio\/p\d+-[a-z0-9-]+$/.test(branch) || !branch.startsWith(`lectio/p${proposal.number}-`)) throw usageError(`--branch must be lectio/p${proposal.number}-<slug>`);
  if (!/^[0-9a-f]{7,40}$/.test(sha)) throw usageError('--commit must be the branch head (a git sha)');
  if ((input.note?.trim() ?? '') === '') throw usageError('the hand-back note is required: --note-file handback.md');
  const moved = move(ctx, proposal, 'submit', {branch, commit_sha: sha});
  comment(ctx, moved, 'handback', input.note!);
  return moved;
}

export function requestChanges(ctx: Ctx, proposal: Proposal, note: string | undefined): Proposal {
  only(ctx, ['learner'], 'Requesting changes');
  if ((note?.trim() ?? '') === '') throw usageError('say what to change: --note "…"');
  const moved = move(ctx, proposal, 'request_changes');
  comment(ctx, moved, 'review', note!);
  return moved;
}

export function markShipped(ctx: Ctx, proposal: Proposal, commit: string | undefined): Proposal {
  only(ctx, ['learner'], 'Marking a proposal shipped');
  const sha = commit?.trim().toLowerCase();
  return move(ctx, proposal, 'shipped', {shipped_at: ctx.now(), ...(sha === undefined || sha === '' ? {} : {commit_sha: sha})});
}

export function recordOutcome(ctx: Ctx, proposal: Proposal, input: {outcome: string | undefined; note: string | undefined}): Proposal {
  only(ctx, ['tutor'], "Judging a shipped proposal's outcome");
  if (proposal.status !== 'shipped') throw failed(`#${proposal.number} is ${proposal.status}; outcomes are for shipped proposals`);
  if (input.outcome === undefined || !(OUTCOMES as readonly string[]).includes(input.outcome)) throw usageError(`the outcome is one of ${OUTCOMES.join(', ')}`);
  const note = input.note?.trim() ?? '';
  if (note === '') throw usageError('say what you saw: --note "…"');
  ctx.db.query('UPDATE proposals SET outcome = ?, outcome_note = ?, changed = ? WHERE id = ?').run(input.outcome, note, ctx.now(), proposal.id);
  comment(ctx, proposal, 'outcome', `${input.outcome}: ${note}`);
  ctx.event('proposal', proposal.id, {kind: 'outcome', number: proposal.number, outcome: input.outcome});
  return getProposal(ctx, proposal.id)!;
}

export function addComment(ctx: Ctx, proposal: Proposal, body: string | undefined): Proposal {
  if ((body?.trim() ?? '') === '') throw usageError('what is the comment?');
  comment(ctx, proposal, 'comment', body!);
  ctx.event('proposal', proposal.id, {kind: 'comment', number: proposal.number});
  return proposal;
}

/**
 * Mark in-review proposals whose submitted commit is now part of what the server runs.
 * `isAncestor` answers whether a commit is an ancestor of the running one (git does).
 */
export function detectShipped(ctx: Ctx, isAncestor: (sha: string) => boolean): Proposal[] {
  const shipped: Proposal[] = [];
  for (const p of listProposals(ctx, {status: ['in_review']})) {
    if (p.commit_sha === null || !isAncestor(p.commit_sha)) continue;
    ctx.db.query("UPDATE proposals SET status = 'shipped', shipped_at = ?, changed = ? WHERE id = ?").run(ctx.now(), ctx.now(), p.id);
    ctx.event('proposal', p.id, {kind: 'shipped', number: p.number, from: 'in_review', to: 'shipped'});
    shipped.push(getProposal(ctx, p.id)!);
  }
  return shipped;
}

/** What the builder has to do, for its otto check script. */
export function builderDue(ctx: Ctx): {due: boolean; why: string[]; next: number | null} {
  const changes = listProposals(ctx, {status: ['changes_requested']});
  const approved = listProposals(ctx, {status: ['approved']});
  const answered = approved.filter(p => commentsOf(ctx, p.id).at(-1)?.kind === 'answer');
  const flying = inFlight(ctx);
  const room = flying.length < numberSetting(ctx.db, 'build_wip_max');
  const why: string[] = [];
  if (changes.length > 0) why.push('changes_requested');
  if (answered.length > 0) why.push('question_answered');
  if (room && approved.length > answered.length) why.push('approved');
  const rank = (p: Proposal) => ({high: 0, normal: 1, low: 2})[p.priority as 'high'] ?? 1;
  const queue = [...changes, ...answered, ...(room ? approved.filter(p => !answered.includes(p)).sort((a, b) => rank(a) - rank(b) || a.number - b.number) : [])];
  return {due: why.length > 0, why, next: queue[0]?.number ?? null};
}

/** What needs the learner on the Improvements page (and the badge on Today). */
export function needsYou(ctx: Ctx): number {
  return listProposals(ctx, {status: ['open', 'needs_info', 'in_review']}).length;
}

/** What the tutor's context says about improving lectio. */
export function proposalsContext(ctx: Ctx, lastRun: Run | undefined) {
  const outcomeDays = numberSetting(ctx.db, 'outcome_days');
  const today = ctx.today();
  const brief = (p: Proposal) => ({number: p.number, title: p.title, area: p.area, status: p.status, support: p.support, proposed_by: p.proposed_by, problem: p.problem.length > 300 ? `${p.problem.slice(0, 299)}…` : p.problem});
  const open = listProposals(ctx, {status: ['open', 'approved', 'building', 'needs_info', 'in_review', 'changes_requested', 'deferred']});
  const since = lastRun?.started ?? '';
  const shipped = listProposals(ctx, {status: ['shipped']});
  const declined = listProposals(ctx, {status: ['declined']}).slice(0, 20);
  const run = ctx.isAgent ? ctx.db.query('SELECT id FROM agent_runs WHERE actor = ? AND finished IS NULL').get(ctx.actor) as {id: string} | null : null;
  return {
    open_proposals: open.map(brief),
    declined_proposals: declined.map(p => ({number: p.number, title: p.title, area: p.area, why: commentsOf(ctx, p.id).filter(c => c.kind === 'decision').at(-1)?.body ?? ''})),
    shipped_since_last_run: shipped.filter(p => p.shipped_at !== null && p.shipped_at >= since).map(p => ({...brief(p), shipped_at: p.shipped_at, success: p.success})),
    awaiting_outcome: shipped
      .filter(p => p.outcome === null)
      .map(p => ({...brief(p), shipped_at: p.shipped_at, success: p.success, overdue: p.shipped_at !== null && daysBetween(ctx.dayOf(p.shipped_at), today) >= outcomeDays})),
    proposal_caps: capsLeft(ctx, run === null ? undefined : getRun(ctx, run.id)),
  };
}
