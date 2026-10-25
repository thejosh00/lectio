/**
 * `lectio tools`: what the tutor can make on this machine (M16). Runs where the tutor runs,
 * not on the server: the tools that matter are the ones in its own environment. Looks each
 * tool up on the PATH (and Chrome at its usual macOS place); never installs anything.
 */
import {existsSync} from 'node:fs';
import {mediaStatus, TOOLS, type MediaStatus} from '../core/media.ts';

const CHROME_APP = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export interface ToolDeps {
  which: (command: string) => string | null;
  exists: (path: string) => boolean;
  env: Record<string, string | undefined>;
}

export const realToolDeps = (env: Record<string, string | undefined>): ToolDeps => ({which: command => Bun.which(command), exists: path => existsSync(path), env});

function find(name: string, deps: ToolDeps): string | null {
  if (name === 'chrome') {
    const configured = deps.env['CHROME_PATH'];
    if (configured !== undefined && deps.exists(configured)) return configured;
    if (deps.exists(CHROME_APP)) return CHROME_APP;
    for (const command of ['google-chrome', 'chromium', 'chromium-browser']) {
      const path = deps.which(command);
      if (path !== null) return path;
    }
    return null;
  }
  return deps.which(name);
}

export interface ToolsReport {
  tools: Array<{name: string; what: string; found: boolean; path: string | null}>;
  media: MediaStatus[];
}

export function toolsReport(deps: ToolDeps): ToolsReport {
  const tools = TOOLS.map(tool => {
    const path = find(tool.name, deps);
    return {name: tool.name, what: tool.what, found: path !== null, path};
  });
  return {tools, media: mediaStatus(new Set(tools.filter(t => t.found).map(t => t.name)))};
}

export function toolsText(report: ToolsReport): string[] {
  return [
    'tools on this machine:',
    ...report.tools.map(t => `  ${t.found ? '✓' : '·'} ${t.name.padEnd(8)} ${t.what}`),
    '',
    'media types, cheapest first:',
    ...report.media.map(m => {
      const where = m.lectio === 'available' ? 'in lectio' : m.lectio === 'planned' ? `planned for ${m.milestone}` : 'not in lectio yet';
      const tools = m.missing.length === 0 ? '' : `; needs ${m.missing.map(g => g.join(' or ')).join(' and ')}`;
      return `  ${m.ready ? '✓' : '·'} ${m.type.padEnd(8)} ${where}${tools}`;
    }),
  ];
}
