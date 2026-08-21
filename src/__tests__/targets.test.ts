import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUILT_IN_TARGETS,
  DEFAULT_TARGETS,
  findTarget,
} from '../targets.ts';

test('exposes an opt-in Mac App Store target', () => {
  const target = findTarget('macos-16:10');

  assert.equal(target.platform, 'macos');
  assert.deepEqual(target.viewport, { width: 1440, height: 900 });
  assert.equal(target.deviceScaleFactor, 2);
  assert.deepEqual(target.output, { width: 2880, height: 1800 });
  assert.equal(target.frame.kind, 'none');
  assert.ok(BUILT_IN_TARGETS.includes(target));
  assert.ok(!DEFAULT_TARGETS.includes(target));
});
