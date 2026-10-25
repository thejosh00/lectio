/**
 * Storing and finding assets. The row says what an asset is; the bytes live in
 * `$LECTIO_DIR/assets/<sha256>.<ext>`, where the daily backup copies them (src/db/backup.ts).
 * Assets never change and are never deleted, so a put of bytes already stored is a no-op.
 */
import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {ASSET_EXTENSIONS, ASSET_ID, sniffImage, svgLabels, type AssetMime} from '../core/assets.ts';
import {AppError, EXIT_ERROR, notFound, usageError} from '../core/errors.ts';
import {ASSETS_DIR} from './backup.ts';
import type {Ctx} from './context.ts';
import {numberSetting} from './settings.ts';

export interface Asset {
  id: string;
  mime: AssetMime;
  bytes: number;
  /** An SVG's labels (its `<text>` elements); 0 for other types; null when stored before #4 counted them. */
  labels: number | null;
  added_by: string;
  added: string;
}

function assetsDir(ctx: Ctx): string {
  if (ctx.dataDir === undefined) throw new AppError('this server has no data directory, so it cannot store assets', EXIT_ERROR);
  return join(ctx.dataDir, ASSETS_DIR);
}

export const assetFileName = (asset: Pick<Asset, 'id' | 'mime'>) => `${asset.id}.${ASSET_EXTENSIONS[asset.mime]}`;

export function findAsset(ctx: Ctx, id: string): Asset | undefined {
  return (ctx.db.query('SELECT * FROM assets WHERE id = ?').get(id) as Asset | null) ?? undefined;
}

/** Store an image. Refused unless the bytes are an image type lectio shows and within `asset_max_bytes`. */
export function putAsset(ctx: Ctx, data: Uint8Array): {asset: Asset; existing: boolean} {
  const max = numberSetting(ctx.db, 'asset_max_bytes');
  if (data.length === 0) throw usageError('the asset is empty');
  if (data.length > max) throw usageError(`the asset is ${data.length} bytes; the limit is ${max} (asset_max_bytes)`);
  const mime = sniffImage(data);
  if (mime === undefined) throw usageError('the asset is not a PNG, JPEG, GIF, WebP or SVG image (its type is read from the bytes, not the name)');
  const id = new Bun.CryptoHasher('sha256').update(data).digest('hex');

  const dir = assetsDir(ctx);
  const path = join(dir, assetFileName({id, mime}));
  // Written before the row, and again if the file was somehow lost: a row always has its bytes.
  if (!existsSync(path)) {
    mkdirSync(dir, {recursive: true});
    const partial = `${path}.partial`;
    writeFileSync(partial, data);
    renameSync(partial, path);
  }
  const labels = labelsIn(mime, data);
  const existing = findAsset(ctx, id);
  if (existing !== undefined) {
    // Stored before labels were counted: putting it again counts them.
    if (existing.labels === null) ctx.db.query('UPDATE assets SET labels = ? WHERE id = ?').run(labels, id);
    return {asset: {...existing, labels}, existing: true};
  }
  const asset: Asset = {id, mime, bytes: data.length, labels, added_by: ctx.actor, added: ctx.now()};
  ctx.db.query('INSERT INTO assets (id, mime, bytes, labels, added_by, added) VALUES (?, ?, ?, ?, ?, ?)').run(asset.id, asset.mime, asset.bytes, asset.labels, asset.added_by, asset.added);
  ctx.event('asset', id, {mime, bytes: asset.bytes});
  return {asset, existing: false};
}

const labelsIn = (mime: AssetMime, data: Uint8Array) => (mime === 'image/svg+xml' ? svgLabels(new TextDecoder().decode(data)) : 0);

/**
 * Asset id → its labels, for the assets that have any: what a picture's time estimate counts.
 * An SVG stored before labels were counted is read from its bytes (a re-put stores the count).
 */
export function assetLabels(ctx: Ctx): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of ctx.db.query("SELECT id, mime, labels FROM assets WHERE labels > 0 OR (labels IS NULL AND mime = 'image/svg+xml')").all() as Array<Pick<Asset, 'id' | 'mime' | 'labels'>>) {
    let labels = row.labels;
    if (labels === null) {
      const path = ctx.dataDir === undefined ? undefined : join(ctx.dataDir, ASSETS_DIR, assetFileName(row));
      labels = path !== undefined && existsSync(path) ? labelsIn(row.mime, readFileSync(path)) : 0;
    }
    if (labels > 0) out.set(row.id, labels);
  }
  return out;
}

/** The asset and the path of its bytes, for serving. `ref` may carry its extension. */
export function assetFile(ctx: Ctx, ref: string): {asset: Asset; path: string} {
  const id = ref.replace(/\.[a-z]+$/, '');
  const asset = ASSET_ID.test(id) ? findAsset(ctx, id) : undefined;
  if (asset === undefined) throw notFound(`no asset "${ref}"`);
  const path = join(assetsDir(ctx), assetFileName(asset));
  if (!existsSync(path)) throw notFound(`asset "${id}" is known but its bytes are missing from ${ASSETS_DIR}/; restore a backup`);
  return {asset, path};
}
