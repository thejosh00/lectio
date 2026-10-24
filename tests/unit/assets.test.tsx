import {expect, test} from 'bun:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {imageBlock} from '../../src/blocks/image.ts';
import {sniffImage} from '../../src/core/assets.ts';
import type {BlockView} from '../../src/web/api.ts';
import {Block} from '../../src/web/blocks/index.tsx';

const bytes = (...parts: Array<number[] | string>) =>
  new Uint8Array(parts.flatMap(p => (typeof p === 'string' ? [...new TextEncoder().encode(p)] : p)));

test('image types are read from the bytes', () => {
  expect(sniffImage(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'rest'))).toBe('image/png');
  expect(sniffImage(bytes([0xff, 0xd8, 0xff, 0xe0], 'JFIF'))).toBe('image/jpeg');
  expect(sniffImage(bytes('GIF89a', [1, 0, 1, 0]))).toBe('image/gif');
  expect(sniffImage(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 '))).toBe('image/webp');
  expect(sniffImage(bytes('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('image/svg+xml');
  expect(sniffImage(bytes('﻿<?xml version="1.0"?>\n<!-- drawn by hand -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd">\n<svg>\n</svg>'))).toBe('image/svg+xml');
});

test('anything else is not an image, whatever it is called', () => {
  expect(sniffImage(bytes('just some text, saved as picture.png'))).toBeUndefined();
  expect(sniffImage(bytes('<html><body><svg></svg></body></html>'))).toBeUndefined();
  expect(sniffImage(bytes('<svgx>'))).toBeUndefined();
  expect(sniffImage(bytes('RIFF', [0, 0, 0, 0], 'WAVEfmt '))).toBeUndefined();
  expect(sniffImage(new Uint8Array())).toBeUndefined();
});

const ctx = (assets: string[]) => ({path: 'blocks[2].body', conceptKeys: new Set<string>(), assets: new Set(assets), questionRefs: new Set<string>(), limits: {widget_max_bytes: 1000}});
const ID = 'a'.repeat(64);

test('an image block needs an asset that exists and a non-empty alt', () => {
  expect(imageBlock.validate({asset: ID, alt: 'a cat'}, ctx([ID]))).toEqual({ok: true, value: {asset: ID, alt: 'a cat', caption: null}} as never);
  const missing = imageBlock.validate({asset: 'b'.repeat(64), alt: 'a cat', caption: 'c'}, ctx([ID]));
  expect(JSON.stringify(missing)).toContain('blocks[2].body.asset');
  expect(JSON.stringify(missing)).toContain('asset put');
  for (const alt of [undefined, '', '   ']) {
    const result = imageBlock.validate({asset: ID, ...(alt === undefined ? {} : {alt})}, ctx([ID]));
    expect(JSON.stringify(result)).toContain('blocks[2].body.alt');
  }
  expect(JSON.stringify(imageBlock.validate({asset: ID, alt: 'x', src: 'http://evil'}, ctx([ID])))).toContain('blocks[2].body.src');
  expect(imageBlock.plainText({asset: ID, alt: 'a cat', caption: 'Figure 1'})).toBe('[Image: a cat]\nFigure 1');
});

test('an image block renders as a figure with a lazy <img>, never inlined SVG', () => {
  const block = {id: 'b1', type: 'image', approach: 'visual', concepts: [], body: {asset: ID, alt: 'two boxes, "s1" and s2', caption: 'After the move'}} as unknown as BlockView;
  const html = renderToStaticMarkup(<Block block={block} lessonId="l1" />);
  expect(html).toBe(`<figure class="image-block"><img src="/assets/${ID}" alt="two boxes, &quot;s1&quot; and s2" loading="lazy"/><figcaption class="caption">After the move</figcaption></figure>`);
  const bare = renderToStaticMarkup(<Block block={{...block, body: {asset: ID, alt: 'x'}} as BlockView} lessonId="l1" />);
  expect(bare).not.toContain('figcaption');
  expect(bare).not.toContain('<svg');
});
