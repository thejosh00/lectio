import {allSettingsJson, setSetting, settingJson} from '../../db/settings.ts';
import {str, type Route} from '../http.ts';

export const settingsRoutes: Route[] = [
  {method: 'GET', path: '/api/settings', handler: ctx => ({settings: allSettingsJson(ctx.db)})},
  {method: 'GET', path: '/api/settings/:key', handler: (ctx, req) => ({setting: settingJson(ctx.db, req.params['key']!)})},
  {
    method: 'PUT',
    path: '/api/settings/:key',
    allow: ['learner'],
    what: 'changing settings',
    handler: (ctx, req) =>
      ctx.write(() => {
        const key = req.params['key']!;
        setSetting(ctx.db, key, str(req.body, 'value') ?? null);
        ctx.event('settings', key, {kind: 'changed', key});
        return {setting: settingJson(ctx.db, key)};
      }),
  },
];
