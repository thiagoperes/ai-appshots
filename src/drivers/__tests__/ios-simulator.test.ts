import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createIosSimulatorDriver,
  type IosSimulatorDriverRuntime,
} from '../ios-simulator.ts';
import type { CaptureContext, IosSimulatorCapture } from '../../types.ts';

interface CommandCall {
  readonly kind: 'exec' | 'checked';
  readonly args: readonly string[];
}

function createRuntime(
  output: (args: readonly string[]) => string = () => '',
) {
  const calls: CommandCall[] = [];
  const runtime: IosSimulatorDriverRuntime = {
    platform: 'darwin',
    exec: async (_command, args) => {
      calls.push({ kind: 'exec', args });

      return { code: 0, stdout: '', stderr: '' };
    },
    execChecked: async (_command, args) => {
      calls.push({ kind: 'checked', args });

      return output(args);
    },
    prompt: async () => undefined,
  };

  return { calls, runtime };
}

function inventory(
  devices: readonly {
    readonly udid: string;
    readonly name: string;
    readonly state: string;
  }[],
) {
  return JSON.stringify({ devices: { 'com.apple.CoreSimulator.iOS-26-5': devices } });
}

const context = {
  target: { id: 'ios-iphone' },
  config: { paths: { root: '/project' }, settleDelay: 0 },
} as CaptureContext;

test('preserves legacy device-name selection and lifecycle defaults', async () => {
  const { calls, runtime } = createRuntime((args) => {
    if (args[1] === 'list' && args[2] === 'devices') {
      return inventory([
        { udid: 'shutdown-phone', name: 'iPhone 17 Pro', state: 'Shutdown' },
        { udid: 'booted-phone', name: 'iPhone 17 Pro', state: 'Booted' },
      ]);
    }

    return '';
  });
  const driver = createIosSimulatorDriver(
    {
      kind: 'ios-simulator',
      device: 'iPhone 17 Pro',
      marketingStatusBar: false,
    },
    runtime,
  );

  const session = await driver.open(context);
  await session.close();

  assert.deepEqual(calls, [
    {
      kind: 'checked',
      args: ['simctl', 'list', 'devices', '--json'],
    },
  ]);
});

test('erases, boots, and shuts down only the exact managed simulator', async () => {
  const { calls, runtime } = createRuntime((args) => {
    if (args[1] === 'list' && args[2] === 'devices') {
      return inventory([
        { udid: 'developer-phone', name: 'iPhone 17 Pro', state: 'Booted' },
        { udid: 'owned-phone', name: 'NewsBlocker Appshots', state: 'Booted' },
      ]);
    }

    return '';
  });
  const driver = createIosSimulatorDriver(
    {
      kind: 'ios-simulator',
      device: 'iPhone 17 Pro',
      managedDeviceName: 'NewsBlocker Appshots',
      eraseBeforeCapture: true,
      shutdownAfterCapture: true,
      marketingStatusBar: false,
    },
    runtime,
  );

  const session = await driver.open(context);
  await session.close();

  assert.deepEqual(
    calls,
    [
      ['checked', 'list', 'devices', '--json'],
      ['exec', 'shutdown', 'owned-phone'],
      ['checked', 'erase', 'owned-phone'],
      ['exec', 'boot', 'owned-phone'],
      ['checked', 'bootstatus', 'owned-phone', '-b'],
      ['exec', 'shutdown', 'owned-phone'],
    ].map(([kind, ...args]) => ({
      kind,
      args: ['simctl', ...args],
    })),
  );
  assert.equal(
    calls.some((call) => call.args.includes('developer-phone')),
    false,
  );
});

test('creates a managed instance with its separate requested device type', async () => {
  const { calls, runtime } = createRuntime((args) => {
    if (args[1] === 'list' && args[2] === 'devices') {
      return inventory([]);
    }

    if (args[1] === 'list' && args[2] === 'devicetypes') {
      return JSON.stringify({
        devicetypes: [
          {
            name: 'iPhone 17 Pro',
            identifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro',
          },
        ],
      });
    }

    if (args[1] === 'list' && args[2] === 'runtimes') {
      return JSON.stringify({
        runtimes: [
          {
            identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5',
            version: '26.5',
            platform: 'iOS',
          },
        ],
      });
    }

    if (args[1] === 'create') {
      return 'owned-phone\n';
    }

    return '';
  });
  const driver = createIosSimulatorDriver(
    {
      kind: 'ios-simulator',
      device: 'iPhone 17 Pro',
      managedDeviceName: 'NewsBlocker Appshots',
      marketingStatusBar: false,
    },
    runtime,
  );

  const session = await driver.open(context);
  await session.close();

  assert.ok(
    calls.some(
      (call) =>
        call.kind === 'checked' &&
        JSON.stringify(call.args) ===
          JSON.stringify([
            'simctl',
            'create',
            'NewsBlocker Appshots',
            'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro',
            'com.apple.CoreSimulator.SimRuntime.iOS-26-5',
          ]),
    ),
  );
});

test('refuses lifecycle controls without an explicit managed name', () => {
  for (const lifecycle of [
    { eraseBeforeCapture: true },
    { shutdownAfterCapture: true },
  ]) {
    const spec: IosSimulatorCapture = {
      kind: 'ios-simulator',
      device: 'iPhone 17 Pro',
      ...lifecycle,
    };

    assert.throws(
      () => createIosSimulatorDriver(spec),
      /require an explicit "managedDeviceName"/,
    );
  }
});

test('refuses to mutate duplicate managed simulator names', async () => {
  const { calls, runtime } = createRuntime((args) => {
    if (args[1] === 'list' && args[2] === 'devices') {
      return inventory([
        { udid: 'owned-one', name: 'NewsBlocker Appshots', state: 'Shutdown' },
        { udid: 'owned-two', name: 'NewsBlocker Appshots', state: 'Booted' },
      ]);
    }

    return '';
  });
  const driver = createIosSimulatorDriver(
    {
      kind: 'ios-simulator',
      device: 'iPhone 17 Pro',
      managedDeviceName: 'NewsBlocker Appshots',
      eraseBeforeCapture: true,
      marketingStatusBar: false,
    },
    runtime,
  );

  await assert.rejects(driver.open(context), /Refusing to manage an ambiguous/);
  assert.deepEqual(calls, [
    {
      kind: 'checked',
      args: ['simctl', 'list', 'devices', '--json'],
    },
  ]);
});

test('shuts down an owned simulator when session setup fails', async () => {
  const { calls, runtime } = createRuntime((args) => {
    if (args[1] === 'list' && args[2] === 'devices') {
      return inventory([
        { udid: 'owned-phone', name: 'NewsBlocker Appshots', state: 'Shutdown' },
      ]);
    }

    if (args[1] === 'install') {
      throw new Error('install failed');
    }

    return '';
  });
  const driver = createIosSimulatorDriver(
    {
      kind: 'ios-simulator',
      device: 'iPhone 17 Pro',
      managedDeviceName: 'NewsBlocker Appshots',
      shutdownAfterCapture: true,
      marketingStatusBar: false,
      appPath: 'build/App.app',
    },
    runtime,
  );

  await assert.rejects(driver.open(context), /install failed/);
  assert.deepEqual(calls.at(-1), {
    kind: 'exec',
    args: ['simctl', 'shutdown', 'owned-phone'],
  });
});
