import {usageError} from '../../core/errors.ts';
import {putAsset} from '../../db/assets.ts';
import {requireStr, type Route} from '../http.ts';

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export const assetRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/assets',
    allow: ['learner', 'tutor'],
    what: 'adding assets',
    handler: (ctx, req) => {
      const encoded = requireStr(req.body, 'data_base64', 'the asset (data_base64)').replace(/\s+/g, '');
      if (!BASE64.test(encoded)) throw usageError('"data_base64" must be base64');
      return ctx.write(() => putAsset(ctx, Buffer.from(encoded, 'base64')));
    },
  },
];
