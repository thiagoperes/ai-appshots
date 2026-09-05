import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planCompositions, mergeCompositions } from '../composition-plan.ts';
import { DEFAULT_THEME } from '../theme.ts';
import type { ResolvedConfig, TargetSpec } from '../types.ts';

const target: TargetSpec = {
  id: 'phone', store: 'app-store', platform: 'ios', frame: { kind: 'none' },
  viewport: { width: 80, height: 160 }, deviceScaleFactor: 1,
  output: { width: 320, height: 568 }, captionScale: 0.075, captionGapRatio: 0.03,
  statusBarHeight: 0, statusBarTextSize: 0, deliveryKind: 'ios',
};
const config: ResolvedConfig = {
  baseUrl: 'http://localhost', targets: [target], theme: DEFAULT_THEME, hide: [],
  screens: ['one', 'two', 'three'].map((id) => ({ id, theme: 'dark' })),
  captions: { en: {} }, storeLocales: {}, settleDelay: 0,
  paths: { root: '/tmp', raw: '/tmp/raw', framed: '/tmp/framed', frameCache: '/tmp/frames', authState: '/tmp/auth', fastlane: '/tmp/fastlane' },
  panoramas: [{ id: 'intro', screens: ['one', 'two'], composition: { preset: 'tilted-panorama' } }],
};

test('selecting either panorama panel regenerates the same complete group', () => {
  for (const selected of config.screens.slice(0, 2)) {
    const jobs = planCompositions(config, target, [selected]);
    assert.equal(jobs.length, 1);
    assert.deepEqual(jobs[0]!.screens.map((screen) => screen.id), ['one', 'two']);
    assert.deepEqual(jobs[0]!.sources.map((screen) => screen.id), ['one']);
  }
});

test('additional device layers include capture dependencies outside the selected group', () => {
  const extended: ResolvedConfig = { ...config, composition: {
    layers: [{ id: 'extra', kind: 'device', screen: 'three', x: 1.6, y: 0.5, width: 0.4 }],
  } };
  assert.deepEqual(planCompositions(extended, target, [config.screens[1]!])[0]!.sources.map((screen) => screen.id), ['one', 'three']);
});

test('rejects overlapping, reordered and partially excluded panorama groups', () => {
  assert.throws(() => planCompositions({ ...config, panoramas: [...config.panoramas!,
    { id: 'other', screens: ['two', 'three'], composition: {} },
  ] }, target, config.screens), /more than one/);
  assert.throws(() => planCompositions({ ...config, panoramas: [
    { id: 'wrong-order', screens: ['two', 'one'], composition: {} },
  ] }, target, config.screens), /consecutive/);
  assert.throws(() => planCompositions({ ...config, screens: config.screens.map((screen) => screen.id === 'two' ? { ...screen, excludeTargets: ['phone'] } : screen) }, target, config.screens), /consecutive/);
});

test('target-scoped panoramas leave other targets independent', () => {
  const other = { ...target, id: 'tablet' };
  const scoped = { ...config, targets: [target, other], panoramas: config.panoramas!.map((group) => ({ ...group, targets: ['phone'] })) };
  assert.equal(planCompositions(scoped, other, config.screens).length, 3);
});

test('global, target and screen overrides merge by layer ID', () => {
  const result = mergeCompositions(
    { preset: 'classic', background: { fill: '#fff' }, overrides: { 'title-1': { color: '#000', x: 0.1 } } },
    { overrides: { 'title-1': { x: 0.2 } } },
  );
  assert.deepEqual(result?.overrides?.['title-1'], { color: '#000', x: 0.2 });
  assert.equal(result?.background?.fill, '#fff');
});
