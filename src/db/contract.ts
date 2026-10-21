import {agentsDocument, type ContractOptions} from '../core/agentsDoc.ts';
import {VERSION} from '../version.ts';
import type {Ctx} from './context.ts';
import {numberSetting} from './settings.ts';

export function contractOptions(ctx: Ctx): ContractOptions {
  const n = (key: string) => numberSetting(ctx.db, key);
  return {
    version: VERSION,
    limits: {
      lesson_ready_hour: n('lesson_ready_hour'),
      quiz_max_questions: n('quiz_max_questions'),
      lesson_max_blocks: n('lesson_max_blocks'),
      lesson_max_bytes: n('lesson_max_bytes'),
      widget_max_bytes: n('widget_max_bytes'),
      asset_max_bytes: n('asset_max_bytes'),
      notes_max_bytes: n('notes_max_bytes'),
      practice_max: n('practice_max'),
      target_accuracy: n('target_accuracy'),
      desired_retention: n('desired_retention'),
      memory_gap_hours: n('memory_gap_hours'),
      context_days: n('context_days'),
      proposals_per_run: n('proposals_per_run'),
      proposals_open_max: n('proposals_open_max'),
      build_wip_max: n('build_wip_max'),
      retro_days: n('retro_days'),
      outcome_days: n('outcome_days'),
    },
  };
}

export const contractDocument = (ctx: Ctx) => agentsDocument(contractOptions(ctx));

/** A hash of the document, so the tutor can tell when a shipped change gave it something new to read. */
export function contractVersion(ctx: Ctx): string {
  return new Bun.CryptoHasher('sha256').update(contractDocument(ctx)).digest('hex').slice(0, 12);
}
