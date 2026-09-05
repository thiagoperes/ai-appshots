import assert from 'node:assert/strict';
import { test } from 'node:test';

import sharp from 'sharp';

import { DEFAULT_THEME } from '../../theme.ts';
import type { CanvasTheme } from '../../types.ts';
import { renderCanvas } from '../canvas.ts';

const device = sharp({
  create: {
    width: 120,
    height: 240,
    channels: 4,
    background: '#111827',
  },
})
  .png()
  .toBuffer();

async function render(theme: CanvasTheme) {
  return renderCanvas({
    output: { width: 320, height: 568 },
    caption: { kicker: 'Private browsing', title: 'Block every distraction' },
    theme: 'dark',
    canvas: theme,
    captionScale: 0.075,
    captionGapRatio: 0.03,
    allowBleed: false,
    allowShadow: false,
    device: await device,
    index: 1,
  });
}

test('legacy font fields still select the title and kicker faces', async () => {
  const legacy = await render({
    ...DEFAULT_THEME,
    sansFont: 'serif',
    monoFont: 'sans-serif',
  });
  const semantic = await render({
    ...DEFAULT_THEME,
    titleFont: 'serif',
    kickerFont: 'sans-serif',
  });

  assert.deepEqual(legacy, semantic);
});

test('semantic font fields take precedence over legacy fields', async () => {
  const overrides = await render({
    ...DEFAULT_THEME,
    sansFont: 'monospace',
    monoFont: 'serif',
    titleFont: 'serif',
    kickerFont: 'sans-serif',
  });
  const semantic = await render({
    ...DEFAULT_THEME,
    titleFont: 'serif',
    kickerFont: 'sans-serif',
  });

  assert.deepEqual(overrides, semantic);
});

const base = {
  output: { width: 320, height: 568 },
  theme: 'dark' as const,
  canvas: DEFAULT_THEME,
  captionScale: 0.075,
  captionGapRatio: 0.03,
  allowBleed: false,
  allowShadow: false,
  index: 1,
};

test('short captions and missing kickers reclaim space without losing the bottom inset', async () => {
  const rows = async (title: string, kicker?: string) => {
    const pixels = await sharp(await renderCanvas({ ...base, caption: { title, kicker }, device: await device }))
      .removeAlpha().raw().toBuffer();
    const painted: number[] = [];
    for (let y = 0; y < 568; y += 1) {
      const p = (y * 320 + 160) * 3;
      if (pixels[p] === 17 && pixels[p + 1] === 24 && pixels[p + 2] === 39) painted.push(y);
    }
    assert.ok(painted.length > 0);
    return painted;
  };
  const short = await rows('Focus'), long = await rows('Block every distraction', 'Browsing');
  assert.ok(short[0]! < long[0]! - 20, 'Unused caption rows must not become empty padding');
  assert.equal(short.at(-1), long.at(-1));
});

test('rejects overflowing explicit lines, long words and kickers clearly', async () => {
  for (const caption of [
    { title: 'One\nTwo\nThree' },
    { title: 'W'.repeat(80) },
    { title: 'Hello', kicker: 'W'.repeat(80) },
  ]) {
    await assert.rejects(renderCanvas({ ...base, caption, device: await device }), /does not fit|safe area/);
  }
});

test('bleed permission alone never crops the device', async () => {
  const options = { ...base, caption: { title: 'Stay in control' }, device: await device };
  assert.deepEqual(await renderCanvas(options), await renderCanvas({ ...options, allowBleed: true }));
  assert.notDeepEqual(await renderCanvas(options), await renderCanvas({
    ...options, allowBleed: true, canvas: { ...DEFAULT_THEME, deviceBleed: true },
  }));
});

test('rejects invalid layout controls before rendering', async () => {
  await assert.rejects(renderCanvas({
    ...base, caption: { title: 'Hello' }, device: await device,
    canvas: { ...DEFAULT_THEME, deviceWidthRatio: 2 },
  }), /deviceWidthRatio/);
});
