/**
 * Assets: images a lesson shows. An asset is named by the sha256 of its bytes, so the same
 * bytes are always the same asset, and its type comes from the bytes — never from the
 * filename, which the uploader controls.
 *
 * Pure.
 */

export type AssetMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/svg+xml';

/** The file extension each type is stored under, in `$LECTIO_DIR/assets/`. */
export const ASSET_EXTENSIONS: Record<AssetMime, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

/** A sha256, as lowercase hex. */
export const ASSET_ID = /^[0-9a-f]{64}$/;

const startsWith = (bytes: Uint8Array, prefix: readonly number[], at = 0) => prefix.every((b, i) => bytes[at + i] === b);
const ascii = (text: string) => [...text].map(c => c.charCodeAt(0));

/**
 * An SVG is text whose first element is `<svg>`, after an optional BOM, XML declaration,
 * comments and doctype.
 */
const SVG_START = /^﻿?\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*|<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>\s*)*<svg[\s>/]/i;

/** The image type the bytes hold, or undefined when they are not one lectio shows. */
export function sniffImage(bytes: Uint8Array): AssetMime | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) return 'image/gif';
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'image/webp';
  const head = new TextDecoder('utf-8', {fatal: false}).decode(bytes.subarray(0, 4096));
  if (SVG_START.test(head)) return 'image/svg+xml';
  return undefined;
}
