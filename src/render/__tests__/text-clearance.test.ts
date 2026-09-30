import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';

import type { CompositionLayer, DeviceLayer, TextLayer } from '../../composition-types.ts';
import { renderComposition } from '../composition.ts';
import type { CompositionOptions } from '../composition.ts';
import { DEFAULT_THEME } from '../../theme.ts';

const output = { width: 400, height: 400 };
const square = sharp({ create: { width: 100, height: 100, channels: 4, background: '#2463eb' } }).png().toBuffer();
const base: CompositionOptions = {
  output, screens: ['one'], captions: {}, locale: 'en', theme: 'light', canvas: DEFAULT_THEME, captionScale: 0.05,
  composition: { preset: 'blank' }, resolveDevice: async () => ({ image: await square }),
};
const title: TextLayer = {
  id: 'title', kind: 'text', text: 'Headline', x: 0.1, y: 0.05, width: 0.8, height: 0.2,
  fontSize: 0.1, minFontSize: 0.1, maxLines: 1, color: '#000000', anchor: { x: 0, y: 0 },
};
/** A 200px device whose top edge sits `gap` pixels below the title's lowest glyph. */
const below = (gap: number, extra: Partial<DeviceLayer> = {}): DeviceLayer => ({
  id: 'device', kind: 'device', screen: 'one', frame: { kind: 'none' }, width: 0.5,
  x: 0.5, y: (inkBottom + gap + 100) / output.height, ...extra,
});
const render = (layers: CompositionLayer[], textClearance?: number) => renderComposition({
  ...base, composition: { preset: 'blank', background: { fill: '#ffffff' }, layers, ...(textClearance === undefined ? {} : { textClearance }) },
});

// Where the title's glyphs end, measured from a render with nothing else in it.
const alone = await sharp((await render([title])).image).removeAlpha().greyscale().raw().toBuffer();
let inkBottom = 0;
for (let i = 0; i < alone.length; i++) if (alone[i]! < 128) inkBottom = Math.floor(i / output.width);

test('text keeps two percent of the panel width from every device by default', async () => {
  await render([title, below(12)]);
  await assert.rejects(render([title, below(4)]), /"title" comes within 8px of device layer "device"/);
});

test('a tilted device is judged by its drawn corner, not its bounding box', async () => {
  // Rotating lifts one corner of the square by about 20px; its box would rise further.
  await assert.rejects(render([title, below(12, { rotation: 12 })]), /comes within/);
  await render([title, below(30, { rotation: 12 })]);
});

test('soft shadows may come close; only the solid device counts', async () => {
  await render([title, below(12, { shadow: { blur: 0.05, y: -0.03, opacity: 0.6 } })]);
});

test('text meant for a screen can opt out, and zero clearance still forbids touching', async () => {
  await render([{ ...title, allowDeviceOverlap: true }, below(-10)]);
  await render([title, below(2)], 0);
  await assert.rejects(render([title, below(-4)], 0), /comes within 0px/);
  await assert.rejects(render([title, below(12)], 0.3), /textClearance/);
});

test('crowding outside the exported canvas is not a failure', async () => {
  const offCanvas: TextLayer = { ...title, id: 'edge', x: -0.5, y: 0.9, width: 0.45, height: 0.1 };
  await render([offCanvas, { ...below(0), y: 1.2, x: -0.3 }]);
});
