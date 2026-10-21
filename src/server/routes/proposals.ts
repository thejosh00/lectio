import {usageError} from '../../core/errors.ts';
import {addComment, addProposal, answer, ask, builderDue, claim, commentsOf, decide, listProposals, markShipped, recordOutcome, requestChanges, resolveProposal, submit, supportProposal, withdraw} from '../../db/proposals.ts';
import {bool, q, str, type ApiRequest, type Route} from '../http.ts';
import type {Ctx} from '../../db/context.ts';

const ALL = ['learner', 'tutor', 'builder'] as const;
const proposal = (ctx: Ctx, req: ApiRequest) => resolveProposal(ctx, req.params['ref']);
const withComments = (ctx: Ctx, p: ReturnType<typeof resolveProposal>) => ({proposal: {...p, comments: commentsOf(ctx, p.id)}});

export const proposalRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/proposals',
    handler: (ctx, req) => ({proposals: listProposals(ctx, {status: q(req, 'status')?.split(','), area: q(req, 'area')})}),
  },
  {method: 'GET', path: '/api/proposals/due', handler: ctx => ({...builderDue(ctx)})},
  {method: 'GET', path: '/api/proposals/:ref', handler: (ctx, req) => withComments(ctx, proposal(ctx, req))},
  {
    method: 'POST',
    path: '/api/proposals',
    allow: ALL,
    what: 'filing proposals',
    handler: (ctx, req) =>
      ctx.write(() => {
        if (req.body['proposal'] === undefined) throw usageError('send the proposal JSON: --file p.json');
        return {...addProposal(ctx, {proposal: req.body['proposal'], run: str(req.body, 'run'), open: bool(req.body, 'open') === true, acknowledge: bool(req.body, 'protected') === true})};
      }),
  },
  {
    method: 'POST',
    path: '/api/proposals/:ref/support',
    allow: ['tutor', 'builder'],
    what: 'supporting proposals',
    handler: (ctx, req) => ctx.write(() => withComments(ctx, supportProposal(ctx, proposal(ctx, req), {evidence: req.body['evidence'], note: str(req.body, 'note'), run: str(req.body, 'run')}))),
  },
  ...(['approve', 'decline', 'defer'] as const).map(
    (action): Route => ({
      method: 'POST',
      path: `/api/proposals/:ref/${action}`,
      allow: ['learner'],
      what: `${action === 'approve' ? 'approving' : action === 'decline' ? 'declining' : 'deferring'} proposals`,
      handler: (ctx, req) =>
        ctx.write(() => withComments(ctx, decide(ctx, proposal(ctx, req), action, {note: str(req.body, 'note'), priority: str(req.body, 'priority'), acknowledge: bool(req.body, 'protected') === true}))),
    }),
  ),
  {
    method: 'POST',
    path: '/api/proposals/:ref/withdraw',
    allow: ALL,
    what: 'withdrawing proposals',
    handler: (ctx, req) => ctx.write(() => withComments(ctx, withdraw(ctx, proposal(ctx, req), str(req.body, 'note')))),
  },
  {method: 'POST', path: '/api/proposals/:ref/claim', allow: ['builder'], what: 'claiming proposals', handler: (ctx, req) => ctx.write(() => withComments(ctx, claim(ctx, proposal(ctx, req))))},
  {
    method: 'POST',
    path: '/api/proposals/:ref/ask',
    allow: ['builder'],
    what: 'asking about proposals',
    handler: (ctx, req) => ctx.write(() => withComments(ctx, ask(ctx, proposal(ctx, req), str(req.body, 'question')))),
  },
  {
    method: 'POST',
    path: '/api/proposals/:ref/answer',
    allow: ['learner'],
    what: "answering the builder's questions",
    handler: (ctx, req) => ctx.write(() => withComments(ctx, answer(ctx, proposal(ctx, req), str(req.body, 'answer')))),
  },
  {
    method: 'POST',
    path: '/api/proposals/:ref/submit',
    allow: ['builder'],
    what: 'submitting builds for review',
    handler: (ctx, req) => ctx.write(() => withComments(ctx, submit(ctx, proposal(ctx, req), {branch: str(req.body, 'branch'), commit: str(req.body, 'commit'), note: str(req.body, 'note')}))),
  },
  {
    method: 'POST',
    path: '/api/proposals/:ref/request-changes',
    allow: ['learner'],
    what: 'requesting changes',
    handler: (ctx, req) => ctx.write(() => withComments(ctx, requestChanges(ctx, proposal(ctx, req), str(req.body, 'note')))),
  },
  {
    method: 'POST',
    path: '/api/proposals/:ref/shipped',
    allow: ['learner'],
    what: 'marking proposals shipped',
    handler: (ctx, req) => ctx.write(() => withComments(ctx, markShipped(ctx, proposal(ctx, req), str(req.body, 'commit')))),
  },
  {
    method: 'POST',
    path: '/api/proposals/:ref/outcome',
    allow: ['tutor'],
    what: "judging shipped proposals' outcomes",
    handler: (ctx, req) => ctx.write(() => withComments(ctx, recordOutcome(ctx, proposal(ctx, req), {outcome: str(req.body, 'outcome'), note: str(req.body, 'note')}))),
  },
  {
    method: 'POST',
    path: '/api/proposals/:ref/comments',
    allow: ALL,
    what: 'commenting on proposals',
    handler: (ctx, req) => ctx.write(() => withComments(ctx, addComment(ctx, proposal(ctx, req), str(req.body, 'body')))),
  },
];

