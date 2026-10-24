/**
 * The tutor's playbook (M13): how it teaches, versioned. The tutor rewrites it; you can
 * read every version and put an earlier one back.
 */
import {flagValue, hasFlag} from '../core/args.ts';
import type {NoteVersion} from '../core/types.ts';
import {CommandUsage, type CommandDef} from './types.ts';

interface PlaybookBody {
  body: string;
  version: number;
  actor: string | null;
  at: string | null;
  note: string;
  next_change_from: string | null;
}

const saved = (body: Record<string, unknown>) => (body['changed'] === true ? `saved playbook v${(body['playbook'] as PlaybookBody).version}` : 'no change');

export const playbookCommands: CommandDef[] = [
  {
    name: 'playbook',
    audience: 'anyone',
    summary: 'how the tutor teaches: its playbook, or every version with --history',
    usage: 'lectio playbook [--history]',
    booleans: ['history'],
    build: args => ({method: 'GET', path: '/api/playbook', query: {history: hasFlag(args, 'history') ? 'true' : undefined}}),
    human: body => {
      const playbook = body['playbook'] as PlaybookBody;
      const history = body['history'] as NoteVersion[] | undefined;
      if (history !== undefined) return history.map(v => `v${v.version}  ${v.at}  ${v.actor}${v.restored_from === null ? '' : `  (restores v${v.restored_from})`}${v.note ? `  — ${v.note}` : ''}`);
      if (playbook.version === 0) return 'nothing written yet: the tutor seeds it on its next run';
      return [`v${playbook.version} by ${playbook.actor} at ${playbook.at}${playbook.note ? ` — ${playbook.note}` : ''}`, '', playbook.body];
    },
  },
  {
    name: 'playbook set',
    audience: 'anyone',
    summary: 'rewrite the playbook (a new version); the tutor says why, at most every playbook_min_days',
    usage: 'lectio playbook set --file playbook.md | --stdin --note "<what changed, why, and what should move>"',
    values: ['file', 'note'],
    booleans: ['stdin'],
    build: async (args, io) => {
      const file = flagValue(args, 'file');
      if (file === undefined && !hasFlag(args, 'stdin')) throw new CommandUsage('give the playbook with --file <path> or --stdin');
      let text: string;
      try {
        text = file === undefined ? await io.readStdin() : await io.readFile(file);
      } catch (error) {
        throw new CommandUsage(`can't read ${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
      return {method: 'PUT', path: '/api/playbook', body: {body: text, note: flagValue(args, 'note')}};
    },
    human: saved,
  },
  {
    name: 'playbook revert',
    audience: 'learner',
    summary: "put an earlier version of the tutor's playbook back",
    usage: 'lectio playbook revert <version> [--note "…"]',
    values: ['note'],
    build: args => {
      const version = Number(args.positional[0]);
      if (!Number.isInteger(version) || version < 1) throw new CommandUsage('usage: lectio playbook revert <version> [--note "…"]');
      return {method: 'POST', path: '/api/playbook/revert', body: {version, note: flagValue(args, 'note')}};
    },
    human: saved,
  },
];
