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
