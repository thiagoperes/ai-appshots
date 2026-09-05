import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { createJiti } from 'jiti';
import sharp from 'sharp';

import type { ResolvedConfig, TargetSpec } from '../types.ts';
import type { LayoutPreset } from '../composition-types.ts';
import { DEFAULT_THEME } from '../theme.ts';
import { DEFAULT_TARGETS } from '../targets.ts';

const jiti = createJiti(import.meta.url);
const { run, runCapture } = await jiti.import<typeof import('../run.ts')>('../run.ts');
const { composeComposition } = await jiti.import<typeof import('../compose.ts')>('../compose.ts');

test('presets preserve the configured device frame and allow explicit frame overrides', async () => {
  const target: TargetSpec = {
    ...DEFAULT_TARGETS[0]!,
    viewport: { width: 80, height: 160 }, deviceScaleFactor: 1,
    output: { width: 240, height: 480 }, statusBarHeight: 0,
    frame: { kind: 'css', bezelRatio: 0.08, radiusRatio: 0.12, color: '#ff0000' },
  };
  const capture = await sharp({ create: { width: 80, height: 160, channels: 3, background: '#215abb' } }).png().toBuffer();
  const redPixels = async (image: Buffer) => {
    const pixels = await sharp(image).removeAlpha().raw().toBuffer();
    let count = 0;
    for (let i = 0; i < pixels.length; i += 3) {
      if (pixels[i]! > 200 && pixels[i + 1]! < 30 && pixels[i + 2]! < 30) count += 1;
    }
    return count;
  };
  for (const preset of ['classic', 'tilted-panorama', 'feature-closeup', 'side-aligned'] as LayoutPreset[]) {
    const options = {
      target, captures: { one: capture }, screens: ['one'],
      captions: { one: { title: 'Own your day', kicker: 'Stay in control' } },
      canvas: DEFAULT_THEME, theme: 'dark' as const, locale: 'en',
      frameCacheDir: tmpdir(), includesStatusBar: true,
    };
    const framed = await composeComposition({ ...options, composition: { preset } });
    assert.ok(await redPixels(framed.image) > 100, `${preset} discarded the configured frame`);
    const unframed = await composeComposition({ ...options, composition: {
      preset, overrides: { 'device-1': { frame: { kind: 'none' } } },
    } });
    assert.equal(await redPixels(unframed.image), 0, `${preset} ignored the frame override`);
  }
});

test('browser and native captures use distinct screen preparation and reject mismatched heights', async () => {
  const target: TargetSpec = {
    ...DEFAULT_TARGETS[0]!, viewport: { width: 120, height: 240 }, deviceScaleFactor: 1,
    statusBarHeight: 24, statusBarTextSize: 10, output: { width: 120, height: 240 },
    frame: { kind: 'none' }, statusBar: { style: 'ios-tablet' },
  };
  const page = await sharp({ create: { width: 120, height: 216, channels: 3, background: '#eeeef6' } }).png().toBuffer();
  const native = await sharp({ create: { width: 120, height: 240, channels: 3, background: '#2463eb' } }).png().toBuffer();
  const options = {
    target, screens: ['one'], captions: {}, canvas: DEFAULT_THEME, theme: 'light' as const,
    locale: 'en', frameCacheDir: tmpdir(), composition: { preset: 'blank' as const, layers: [
      { id: 'screen', kind: 'device' as const, screen: 'one', x: 0.5, y: 0.5, width: 1, height: 1 },
    ] },
  };
  const full = await composeComposition({ ...options, captures: { one: native }, includesStatusBar: true });
  assert.deepEqual(await sharp(full.image).removeAlpha().raw().toBuffer(), await sharp(native).raw().toBuffer());
  const web = await composeComposition({ ...options, captures: { one: page }, includesStatusBar: false });
  assert.deepEqual(await sharp(web.image).extract({ left: 0, top: 24, width: 120, height: 216 }).removeAlpha().raw().toBuffer(),
    await sharp(page).raw().toBuffer());
  await assert.rejects(composeComposition({ ...options, captures: { one: page }, includesStatusBar: true }), /short by exactly.*status bar/);
  await assert.rejects(composeComposition({ ...options, captures: { one: native }, includesStatusBar: false }), /Browser capture.*expected/);
});

test('partial panorama runs export both panels and preserve other delivery assets', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'appshots-composition-'));
  try {
    const target: TargetSpec = {
      id: 'phone', store: 'app-store', platform: 'ios', frame: { kind: 'none' },
      viewport: { width: 80, height: 160 }, deviceScaleFactor: 1,
      output: { width: 320, height: 568 }, captionScale: 0.075, captionGapRatio: 0.03,
      statusBarHeight: 0, statusBarTextSize: 0, deliveryKind: 'ios',
    };
    const captured: string[] = [];
    const source = await sharp({ create: { width: 80, height: 160, channels: 3, background: '#215abb' } }).png().toBuffer();
    const config: ResolvedConfig = {
      baseUrl: 'http://localhost', targets: [target], theme: DEFAULT_THEME, hide: [],
      screens: ['one', 'two', 'three'].map((id) => ({ id, theme: 'dark' })),
      captions: { en: { one: { title: 'Stay focused' }, two: { title: 'Find your flow' }, three: { title: 'Make time' } } },
      storeLocales: { en: 'en-US' }, settleDelay: 0,
      paths: { root, raw: resolve(root, 'raw'), framed: resolve(root, 'framed'), frameCache: resolve(root, 'frames'), authState: resolve(root, 'auth'), fastlane: resolve(root, 'fastlane') },
      capture: { kind: 'custom', includesStatusBar: true, open: async () => ({
        capture: async (screen) => { captured.push(screen.id); return source; }, close: async () => {},
      }) },
      panoramas: [{ id: 'intro', screens: ['one', 'two'], composition: { preset: 'tilted-panorama' } }],
    };
    const options = { config, targets: [target], screens: [config.screens[1]!], locales: ['en'], capture: true, compose: true, freshAuth: false };
    await runCapture(options);
    assert.deepEqual(captured, ['one']);
    const delivery = resolve(config.paths.fastlane, 'screenshots/en-US');
    await mkdir(delivery, { recursive: true });
    await writeFile(resolve(delivery, '03-phone-three.png'), source);
    await run({ ...options, capture: false });
    assert.deepEqual((await readdir(delivery)).sort(), ['01-phone-one.png', '02-phone-two.png', '03-phone-three.png']);
    for (const file of ['01-one.png', '02-two.png']) {
      const meta = await sharp(await readFile(resolve(config.paths.framed, 'en/phone', file))).metadata();
      assert.equal(meta.width, 320);
      assert.equal(meta.height, 568);
      assert.equal(meta.hasAlpha, false);
    }
    assert.equal((await sharp(await readFile(resolve(root, 'previews/en/phone.png'))).metadata()).width, 636);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
