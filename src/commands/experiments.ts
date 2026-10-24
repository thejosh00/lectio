/** Two-arm experiments (M14): what the tutor is comparing, and closing one with a verdict. */
import {flagValue} from '../core/args.ts';
import type {Experiment} from '../db/experiments.ts';
import {CommandUsage, type CommandDef} from './types.ts';

export const experimentCommands: CommandDef[] = [
  {
    name: 'experiments',
    audience: 'anyone',
    summary: "two-arm experiments: what the tutor is comparing, and the verdicts of closed ones (results are in progress)",
    usage: 'lectio experiments [--subject …]',
    values: ['subject'],
    build: args => ({method: 'GET', path: '/api/experiments', query: {subject: flagValue(args, 'subject')}}),
    human: body => {
      const experiments = body['experiments'] as Experiment[];
      if (experiments.length === 0) return 'no experiments yet';
      return experiments.flatMap(e => [`${e.name} (${e.status})`, `  a: ${e.arms.a}`, `  b: ${e.arms.b}`, ...(e.verdict === null ? [] : [`  verdict: ${e.verdict}`])]);
    },
  },
  {
    name: 'experiment close',
    audience: 'tutor',
    summary: 'close a two-arm experiment with what it showed',
    usage: 'lectio experiment close <name> --note "<what it showed, with numbers>"',
    values: ['note'],
    build: args => {
      const name = args.positional[0];
      if (name === undefined) throw new CommandUsage('usage: lectio experiment close <name> --note "…"');
      return {method: 'POST', path: `/api/experiments/${encodeURIComponent(name)}/close`, body: {note: flagValue(args, 'note')}};
    },
    human: body => `closed ${(body['experiment'] as Experiment).name}`,
  },
];
