import {examCommands} from './exams.ts';
import {experimentCommands} from './experiments.ts';
import {learnerCommands} from './learner.ts';
import {playbookCommands} from './playbook.ts';
import {proposalCommands} from './proposals.ts';
import {quizCommands} from './quiz.ts';
import {tutorCommands} from './tutor.ts';
import type {CommandDef} from './types.ts';

export const COMMANDS: CommandDef[] = [...learnerCommands, ...quizCommands, ...tutorCommands, ...proposalCommands, ...examCommands, ...playbookCommands, ...experimentCommands];

/** The command named by the leading words of argv, longest name first. */
export function matchCommand(argv: readonly string[]): {command: CommandDef; rest: string[]} | undefined {
  const sorted = [...COMMANDS].sort((a, b) => b.name.split(' ').length - a.name.split(' ').length);
  for (const command of sorted) {
    const words = command.name.split(' ');
    if (words.every((word, i) => argv[i] === word)) return {command, rest: argv.slice(words.length)};
  }
  return undefined;
}
