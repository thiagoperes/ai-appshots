import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDeviceTarget, DEVICE_PROFILES, formFactorFor } from '../devices.ts';
import { captureSize, pageViewport } from '../frames.ts';
import { BUILT_IN_TARGETS, DEFAULT_TARGETS, findTarget } from '../targets.ts';

test('device profiles keep capture geometry, frame colors and store output separate', () => {
  const phone = createDeviceTarget('iphone-17-pro', { color: 'Silver' });
  assert.deepEqual(captureSize(phone), { width: 1206, height: 2622 });
  assert.deepEqual(phone.output, { width: 1320, height: 2868 });
  assert.equal(phone.frame.kind, 'frameit');
  if (phone.frame.kind === 'frameit') assert.match(phone.frame.file, /iPhone 17 Pro Silver/);
  assert.equal(formFactorFor(createDeviceTarget('ipad-pro-11')), 'tablet');
  const mac = createDeviceTarget('macbook-air');
  assert.equal(mac.platform, 'macos');
  assert.equal(mac.deliveryKind, 'macos');
  assert.deepEqual(pageViewport(mac), mac.viewport);
  assert.ok(!DEFAULT_TARGETS.some((target) => target.platform === 'macos'));
});

test('landscape swaps the capture and delivery geometry and rotates only the hardware', () => {
  const portrait = createDeviceTarget('galaxy-s21');
  const landscape = createDeviceTarget('galaxy-s21', { orientation: 'landscape' });
  assert.deepEqual(captureSize(landscape), { width: 2400, height: 1080 });
  assert.deepEqual(landscape.output, { width: 1920, height: 1080 });
  assert.equal(landscape.frame.kind, 'frameit');
  if (landscape.frame.kind === 'frameit') assert.equal(landscape.frame.rotation, 90);
  assert.deepEqual(captureSize(portrait), { width: 1080, height: 2400 });
  assert.equal(createDeviceTarget('iphone-17', { orientation: 'landscape' }).statusBarHeight, 0);
  assert.ok(createDeviceTarget('pixel-5', { orientation: 'landscape' }).statusBar!.trailing! > 0.08);
  assert.deepEqual(createDeviceTarget('ipad-pro-11', { orientation: 'landscape' }).statusBar,
    createDeviceTarget('ipad-pro-11').statusBar);
  assert.equal(createDeviceTarget('macbook-air', { orientation: 'landscape' }).id, 'macbook-air');
  assert.equal(formFactorFor({ platform: 'ios', viewport: { width: 1194, height: 834 } }), 'tablet');
});

test('all named profiles are discoverable and bad selections fail with available choices', () => {
  assert.equal(new Set(BUILT_IN_TARGETS.map((target) => target.id)).size, BUILT_IN_TARGETS.length);
  for (const profile of DEVICE_PROFILES) assert.equal(findTarget(profile.id).platform, profile.platform);
  assert.throws(() => createDeviceTarget('imaginary'), /Unknown device.*Available/);
  assert.throws(() => createDeviceTarget('pixel-5', { color: 'Silver' }), /Available: Just Black, Sorta Sage/);
});

test('custom frame, caption, output and status-bar choices survive target creation', () => {
  const target = createDeviceTarget('mac-window', {
    id: 'custom', frame: { kind: 'window', appearance: 'dark', title: 'Workspace' },
    output: { width: 1440, height: 900 }, captionScale: 0.06,
    composition: { preset: 'side-aligned' }, statusBarHeight: 0,
  });
  assert.equal(target.id, 'custom');
  assert.deepEqual(target.frame, { kind: 'window', appearance: 'dark', title: 'Workspace' });
  assert.equal(target.captionScale, 0.06);
  assert.deepEqual(target.output, { width: 1440, height: 900 });
  assert.equal(target.composition?.preset, 'side-aligned');
  const landscape = createDeviceTarget('pixel-5', {
    orientation: 'landscape', frame: { kind: 'image', path: 'custom.png', rotation: 270,
      screen: { x: 10, y: 10, width: 1080, height: 2340 } },
  });
  assert.equal(landscape.frame.kind === 'image' && landscape.frame.rotation, 270);
  const custom = createDeviceTarget({
    ...DEVICE_PROFILES[0]!, id: 'custom-hardware', viewport: { width: 400, height: 700 }, scale: 2,
    frames: { Custom: { kind: 'image', path: 'custom.png', screen: { x: 20, y: 20, width: 800, height: 1400 } } },
  });
  assert.equal(custom.id, 'custom-hardware');
  assert.deepEqual(captureSize(custom), { width: 800, height: 1400 });
});
