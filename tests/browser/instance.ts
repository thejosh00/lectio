/**
 * A lectio instance for one browser test, driven over stdin and stdout. Playwright's runner needs
 * Node, and lectio needs Bun (`bun:sqlite`), so each test starts this as a process of its own and
 * sends it one JSON command a line: the same helpers the other tests use, on the same fake clock.
 */
import {createInterface} from 'node:readline';
import {startInstance} from '../helpers/instance.ts';
import {startRealCopy} from './real-copy.ts';
import {seeds} from './seeds.ts';

const reply = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
const real = process.env['LECTIO_REAL_DATA'];
if (real !== undefined) {
  const copy = await startRealCopy(real);
  reply({url: copy.url, token: copy.token, real: {lessons: copy.lessons}});
  for await (const _ of createInterface({input: process.stdin})) {
    await copy.stop();
    process.exit(0);
  }
}

const lc = await startInstance();
reply({url: lc.url, token: lc.token('you')});

for await (const line of createInterface({input: process.stdin})) {
  const command = JSON.parse(line) as {seed?: string; advance?: Parameters<typeof lc.advance>[0]; stop?: true};
  try {
    if (command.stop) {
      await lc.stop();
      process.exit(0);
    }
    if (command.advance) lc.advance(command.advance);
    if (command.seed) reply({ok: await seeds[command.seed]!(lc)});
    else reply({ok: true});
  } catch (error) {
    reply({error: String(error)});
  }
}
