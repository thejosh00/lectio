/**
 * `lectio service`: keep `lectio serve` running in the background on macOS, as a
 * launch agent that starts at login and restarts if it stops.
 *
 * Each instance gets its own agent. The label is derived from the data directory
 * (`~/.lectio` → `com.lectio.serve`, `~/.lectio-work` → `com.lectio.serve.lectio-work`),
 * so a personal and a work instance on one machine never replace each other.
 */
import {existsSync, mkdirSync, unlinkSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {basename, join, resolve} from 'node:path';
import {flagValue, parseArgs} from '../core/args.ts';
import {EXIT_ERROR, EXIT_OK, EXIT_USAGE} from '../core/errors.ts';
import {DEFAULT_DIR_NAME} from '../config.ts';
import {latestBackup} from '../db/backup.ts';
import {tokenFileWarnings} from '../client.ts';

export function serviceLabel(dataDir: string): string {
  const name = basename(dataDir).replace(/^\./, '');
  if (name === DEFAULT_DIR_NAME.replace(/^\./, '')) return 'com.lectio.serve';
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'instance';
  return `com.lectio.serve.${slug}`;
}

export interface ServiceSpec {
  label: string;
  command: string[];
  dataDir: string;
  logPath: string;
  path: string;
}

const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The launch agent, as XML. Pure, so its shape is an ordinary test. */
export function servicePlist(spec: ServiceSpec): string {
  const strings = (values: string[]) => values.map(value => `\t\t<string>${escapeXml(value)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Label</key>
\t<string>${escapeXml(spec.label)}</string>
\t<key>ProgramArguments</key>
\t<array>
${strings(spec.command)}
\t</array>
\t<key>RunAtLoad</key>
\t<true/>
\t<key>KeepAlive</key>
\t<true/>
\t<key>ThrottleInterval</key>
\t<integer>10</integer>
\t<key>EnvironmentVariables</key>
\t<dict>
\t\t<key>PATH</key>
\t\t<string>${escapeXml(spec.path)}</string>
\t\t<key>LECTIO_DIR</key>
\t\t<string>${escapeXml(spec.dataDir)}</string>
\t</dict>
\t<key>WorkingDirectory</key>
\t<string>${escapeXml(spec.dataDir)}</string>
\t<key>StandardOutPath</key>
\t<string>${escapeXml(spec.logPath)}</string>
\t<key>StandardErrorPath</key>
\t<string>${escapeXml(spec.logPath)}</string>
</dict>
</plist>
`;
}

/** How this process was started, so the agent starts the same thing (Bun on PATH, not a Cellar path). */
export function serveCommand(execPath: string, cliPath: string, extra: string[], bunOnPath?: string | null): string[] {
  if (!basename(execPath).startsWith('bun')) return [execPath, 'serve', ...extra];
  return [bunOnPath ?? execPath, cliPath, 'serve', ...extra];
}

export type Launchctl = (args: string[]) => {code: number; stdout: string; stderr: string};

const realLaunchctl: Launchctl = args => {
  const result = Bun.spawnSync(['launchctl', ...args], {stdout: 'pipe', stderr: 'pipe'});
  return {code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString()};
};

export interface ServiceContext {
  dataDir: string;
  out: (line?: string) => void;
  err: (line?: string) => void;
  launchctl?: Launchctl;
  agentsDir?: string;
  platform?: string;
  uid?: number;
  execPath?: string;
}

const USAGE = [
  'usage: lectio service <command>',
  '  install [--host h] [--port p]   run the server in the background, now and at login',
  '  uninstall                       stop it and remove the launch agent',
  '  start | stop | restart          start, stop (until next login), or restart it',
  '  status                          whether it is running, the last backup, and token-file warnings',
  '  logs                            follow the server log',
].join('\n');

export function serviceCommand(ctx: ServiceContext, argv: readonly string[]): number {
  if ((ctx.platform ?? process.platform) !== 'darwin') {
    ctx.err('lectio service uses launchd, which only exists on macOS; run "lectio serve" under your own supervisor');
    return EXIT_ERROR;
  }
  const args = parseArgs(argv, {alias: {p: 'port', H: 'host'}});
  const [sub] = args.positional;
  const launchctl = ctx.launchctl ?? realLaunchctl;
  const label = serviceLabel(ctx.dataDir);
  const domain = `gui/${ctx.uid ?? process.getuid?.() ?? 501}`;
  const target = `${domain}/${label}`;
  const plistPath = join(ctx.agentsDir ?? join(homedir(), 'Library', 'LaunchAgents'), `${label}.plist`);
  const logPath = join(ctx.dataDir, 'logs', 'serve.log');
  const loaded = () => launchctl(['print', target]).code === 0;
  const bootstrap = (): number => {
    const result = launchctl(['bootstrap', domain, plistPath]);
    if (result.code !== 0) {
      ctx.err(`launchctl could not start it: ${result.stderr.trim() || `exit ${result.code}`}`);
      ctx.err(`see ${logPath}`);
      return EXIT_ERROR;
    }
    return EXIT_OK;
  };
  const notInstalled = () => {
    ctx.err('not installed yet: run "lectio service install"');
    return EXIT_ERROR;
  };

  switch (sub) {
    case 'install': {
      const extra: string[] = [];
      const host = flagValue(args, 'host');
      const port = flagValue(args, 'port');
      if (host !== undefined) extra.push('--host', host);
      if (port !== undefined) extra.push('--port', port);
      const spec: ServiceSpec = {
        label,
        command: serveCommand(ctx.execPath ?? process.execPath, resolve(import.meta.dir, '..', 'cli.ts'), extra, ctx.execPath === undefined ? Bun.which('bun') : undefined),
        dataDir: ctx.dataDir,
        logPath,
        path: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
      };
      mkdirSync(join(ctx.dataDir, 'logs'), {recursive: true});
      mkdirSync(join(plistPath, '..'), {recursive: true});
      if (loaded()) launchctl(['bootout', target]);
      writeFileSync(plistPath, servicePlist(spec));
      if (bootstrap() !== EXIT_OK) return EXIT_ERROR;
      ctx.out(`installed ${plistPath}`);
      ctx.out('lectio now runs in the background, and starts when you log in');
      ctx.out(`  runs:  ${spec.command.join(' ')}`);
      ctx.out(`  data:  ${ctx.dataDir}`);
      ctx.out(`  log:   ${logPath}`);
      return EXIT_OK;
    }
    case 'uninstall': {
      if (loaded()) launchctl(['bootout', target]);
      if (existsSync(plistPath)) unlinkSync(plistPath);
      ctx.out('uninstalled; lectio no longer runs in the background');
      return EXIT_OK;
    }
    case 'start': {
      if (!existsSync(plistPath)) return notInstalled();
      if (loaded()) {
        ctx.out('already running');
        return EXIT_OK;
      }
      if (bootstrap() !== EXIT_OK) return EXIT_ERROR;
      ctx.out('started');
      return EXIT_OK;
    }
    case 'stop': {
      if (!loaded()) {
        ctx.out('not running');
        return EXIT_OK;
      }
      launchctl(['bootout', target]);
      ctx.out('stopped; it starts again at your next login, or with "lectio service start"');
      return EXIT_OK;
    }
    case 'restart': {
      if (!loaded()) {
        if (!existsSync(plistPath)) return notInstalled();
        if (bootstrap() !== EXIT_OK) return EXIT_ERROR;
        ctx.out('started');
        return EXIT_OK;
      }
      const result = launchctl(['kickstart', '-k', target]);
      if (result.code !== 0) {
        ctx.err(`launchctl could not restart it: ${result.stderr.trim()}`);
        return EXIT_ERROR;
      }
      ctx.out('restarted');
      return EXIT_OK;
    }
    case 'status': {
      // The nearest thing lectio has to a doctor: also say what is wrong with the token files (R5).
      for (const warning of tokenFileWarnings(ctx.dataDir)) ctx.err(warning);
      if (!existsSync(plistPath)) {
        ctx.out('not installed');
        return EXIT_OK;
      }
      const printed = launchctl(['print', target]);
      if (printed.code !== 0) ctx.out('installed, not running');
      else {
        const pid = /\bpid = (\d+)/.exec(printed.stdout)?.[1];
        ctx.out(pid === undefined ? 'installed, waiting to restart' : `running, pid ${pid}`);
      }
      const latest = latestBackup(ctx.dataDir);
      ctx.out(latest === undefined ? 'no backups yet' : `last backup: ${latest.name}, ${latest.modified.toLocaleString()}`);
      ctx.out(`log: ${logPath}`);
      return EXIT_OK;
    }
    case 'logs': {
      const tail = Bun.spawnSync(['tail', '-n', '50', '-f', logPath], {stdout: 'inherit', stderr: 'inherit'});
      return tail.exitCode ?? EXIT_OK;
    }
    default:
      ctx.err(USAGE);
      return EXIT_USAGE;
  }
}
