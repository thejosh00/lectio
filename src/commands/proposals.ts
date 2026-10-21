/**
 * Improving lectio itself (§11): proposals, from filing to an outcome.
 */
import {flagValue, hasFlag, type ParsedArgs} from '../core/args.ts';
import type {Proposal, ProposalComment} from '../db/proposals.ts';
import {jsonInput} from './tutor.ts';
import {CommandUsage, type CommandDef, type CommandIO} from './types.ts';

const enc = encodeURIComponent;

function need(value: string | undefined, usage: string): string {
  if (value === undefined || value.trim() === '') throw new CommandUsage(`usage: ${usage}`);
  return value;
}

const line = (p: Proposal) => `#${String(p.number).padEnd(4)} ${p.status.padEnd(17)} ${p.title}  (${p.area}${p.protected ? ', protected' : ''}; by ${p.proposed_by}${p.support > 1 ? `; support ${p.support}` : ''})`;

const shown = (body: Record<string, unknown>) => {
  const p = body['proposal'] as Proposal & {comments: ProposalComment[]};
  return [
    line(p),
    `  problem: ${p.problem}`,
    `  change:  ${p.change}`,
    `  success: ${p.success}`,
    ...(p.branch === null ? [] : [`  branch:  ${p.branch} @ ${p.commit_sha ?? '?'}`]),
    ...(p.outcome === null ? [] : [`  outcome: ${p.outcome} — ${p.outcome_note ?? ''}`]),
    ...p.evidence.map(e => `  evidence: ${e.kind}${e.id === null ? '' : ` ${e.id}`} — ${e.note}`),
    ...p.comments.map(c => `  [${c.kind}] ${c.actor}, ${c.at}: ${c.body}`),
  ];
};

function action(name: string, path: string, opts: {summary: string; usage: string; audience: CommandDef['audience']; values?: string[]; booleans?: string[]; body?: (args: ParsedArgs, io: CommandIO) => Record<string, unknown> | Promise<Record<string, unknown>>}): CommandDef {
  return {
    name: `proposal ${name}`,
    audience: opts.audience,
    summary: opts.summary,
    usage: opts.usage,
    ...(opts.values === undefined ? {} : {values: opts.values}),
    ...(opts.booleans === undefined ? {} : {booleans: opts.booleans}),
    build: async (args, io) => ({method: 'POST', path: `/api/proposals/${enc(need(args.positional[0], opts.usage))}/${path}`, body: (await opts.body?.(args, io)) ?? {}}),
    human: shown,
  };
}

export const proposalCommands: CommandDef[] = [
  {
    name: 'proposals',
    audience: 'anyone',
    summary: 'changes to lectio: proposed, approved, building, in review, shipped',
    usage: 'lectio proposals [--status open,approved,…] [--area …]',
    values: ['status', 'area'],
    build: args => ({method: 'GET', path: '/api/proposals', query: {status: flagValue(args, 'status'), area: flagValue(args, 'area')}}),
    human: body => {
      const list = body['proposals'] as Proposal[];
      return list.length === 0 ? 'no proposals' : list.map(line);
    },
  },
  {
    name: 'proposals due',
    audience: 'builder',
    summary: 'whether the builder has anything to do (its otto check script runs this)',
    usage: 'lectio proposals due --as agent:builder --json',
    build: () => ({method: 'GET', path: '/api/proposals/due'}),
    human: body => (body['due'] === true ? `due: ${(body['why'] as string[]).join(', ')}; next #${String(body['next'])}` : 'nothing due'),
  },
  {
    name: 'proposal show',
    audience: 'anyone',
    summary: 'one proposal, with its evidence and conversation',
    usage: 'lectio proposal show <n>',
    build: args => ({method: 'GET', path: `/api/proposals/${enc(need(args.positional[0], 'lectio proposal show <n>'))}`}),
    human: shown,
  },
  {
    name: 'proposal add',
    audience: 'anyone',
    summary: 'propose a change to lectio (yours are approved on filing unless --open)',
    usage: 'lectio proposal add --file p.json [--run <run>] [--open] [--protected]',
    values: ['file', 'run'],
    booleans: ['open', 'protected', 'stdin'],
    build: async (args, io) => ({
      method: 'POST',
      path: '/api/proposals',
      body: {proposal: await jsonInput(args, io, 'proposal'), run: flagValue(args, 'run'), open: hasFlag(args, 'open'), protected: hasFlag(args, 'protected')},
    }),
    human: body => [`filed: ${line(body['proposal'] as Proposal)}`],
  },
  action('approve', 'approve', {
    audience: 'learner',
    summary: 'approve a proposal for the builder, with a priority',
    usage: 'lectio proposal approve <n> [--priority high|normal|low] [--protected] [--note "…"]',
    values: ['priority', 'note'],
    booleans: ['protected'],
    body: args => ({priority: flagValue(args, 'priority'), note: flagValue(args, 'note'), protected: hasFlag(args, 'protected')}),
  }),
  action('decline', 'decline', {audience: 'learner', summary: 'decline a proposal, saying why', usage: 'lectio proposal decline <n> --note "…"', values: ['note'], body: args => ({note: flagValue(args, 'note')})}),
  action('defer', 'defer', {audience: 'learner', summary: 'not now', usage: 'lectio proposal defer <n> --note "…"', values: ['note'], body: args => ({note: flagValue(args, 'note')})}),
  action('answer', 'answer', {
    audience: 'learner',
    summary: "answer the builder's question; the proposal goes back in the queue",
    usage: 'lectio proposal answer <n> "<answer>"',
    body: args => ({answer: need(args.positional.slice(1).join(' '), 'lectio proposal answer <n> "<answer>"')}),
  }),
  action('request-changes', 'request-changes', {audience: 'learner', summary: 'send a build back to the builder', usage: 'lectio proposal request-changes <n> --note "…"', values: ['note'], body: args => ({note: flagValue(args, 'note')})}),
  action('shipped', 'shipped', {
    audience: 'learner',
    summary: "mark it shipped, when the server can't tell by itself (a binary build)",
    usage: 'lectio proposal shipped <n> [--commit <sha>]',
    values: ['commit'],
    body: args => ({commit: flagValue(args, 'commit')}),
  }),
  action('support', 'support', {
    audience: 'tutor',
    summary: 'hit a known problem again: add evidence to the open proposal instead of filing a new one',
    usage: 'lectio proposal support <n> --evidence \'[{"kind":"lesson","id":"…","note":"…"}]\' --note "…" --run <run>',
    values: ['evidence', 'note', 'run'],
    body: args => {
      let evidence: unknown;
      try {
        evidence = JSON.parse(flagValue(args, 'evidence') ?? '[]');
      } catch {
        throw new CommandUsage('--evidence must be a JSON list');
      }
      return {evidence, note: flagValue(args, 'note'), run: flagValue(args, 'run')};
    },
  }),
  action('withdraw', 'withdraw', {audience: 'tutor', summary: 'withdraw your own proposal while it is open', usage: 'lectio proposal withdraw <n> --note "…"', values: ['note'], body: args => ({note: flagValue(args, 'note')})}),
  {
    name: 'proposal outcome',
    audience: 'tutor',
    summary: 'after using a shipped change: did it help?',
    usage: 'lectio proposal outcome <n> helped|no_difference|got_in_the_way|unused --note "…"',
    values: ['note'],
    build: args => {
      const [ref, outcome] = args.positional;
      if (ref === undefined || outcome === undefined) throw new CommandUsage('usage: lectio proposal outcome <n> helped|no_difference|got_in_the_way|unused --note "…"');
      return {method: 'POST', path: `/api/proposals/${enc(ref)}/outcome`, body: {outcome, note: flagValue(args, 'note')}};
    },
    human: shown,
  },
  action('claim', 'claim', {audience: 'builder', summary: 'start building an approved proposal', usage: 'lectio proposal claim <n> --as agent:builder'}),
  action('ask', 'ask', {
    audience: 'builder',
    summary: 'a question only the learner can answer; the proposal waits for it',
    usage: 'lectio proposal ask <n> "<question>" --as agent:builder',
    body: args => ({question: need(args.positional.slice(1).join(' '), 'lectio proposal ask <n> "<question>"')}),
  }),
  action('submit', 'submit', {
    audience: 'builder',
    summary: 'hand a built branch back for review',
    usage: 'lectio proposal submit <n> --branch <b> --commit <sha> --note-file handback.md --as agent:builder',
    values: ['branch', 'commit', 'note-file'],
    body: async (args, io) => {
      const file = flagValue(args, 'note-file');
      if (file === undefined) throw new CommandUsage('the hand-back note is required: --note-file handback.md');
      let note: string;
      try {
        note = await io.readFile(file);
      } catch (error) {
        throw new CommandUsage(`can't read ${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
      return {branch: flagValue(args, 'branch'), commit: flagValue(args, 'commit'), note};
    },
  }),
  action('comment', 'comments', {
    audience: 'anyone',
    summary: 'add to the conversation on a proposal',
    usage: 'lectio proposal comment <n> "<text>"',
    body: args => ({body: need(args.positional.slice(1).join(' '), 'lectio proposal comment <n> "<text>"')}),
  }),
];
