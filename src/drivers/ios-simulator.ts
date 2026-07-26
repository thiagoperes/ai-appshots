import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

import { exec, execChecked, prompt } from './exec';
import { info } from '../log';
import type {
  CaptureContext,
  CaptureDriver,
  CaptureSession,
  IosSimulatorCapture,
  ResolvedConfig,
  ScreenSpec,
  TargetSpec,
} from '../types';

interface SimulatorDevice {
  readonly udid: string;
  readonly name: string;
  readonly state: string;
  readonly isAvailable?: boolean;
}

/**
 * Apple's canonical marketing status bar: 9:41, a full battery that is not
 * charging, and full signal. Without the override a capture leaks whatever the
 * host clock and simulated carrier happen to be.
 *
 * @see https://developer.apple.com/design/human-interface-guidelines/going-full-screen
 */
const MARKETING_STATUS_BAR = [
  '--time',
  '9:41',
  '--batteryState',
  'charged',
  '--batteryLevel',
  '100',
  '--cellularMode',
  'active',
  '--cellularBars',
  '4',
  '--wifiMode',
  'active',
  '--wifiBars',
  '3',
];

function wanted(spec: IosSimulatorCapture) {
  return typeof spec.device === 'string' ? [spec.device] : [...spec.device];
}

async function listJson<T>(args: readonly string[], label: string): Promise<T> {
  return JSON.parse(
    await execChecked('xcrun', ['simctl', 'list', ...args, '--json'], label),
  ) as T;
}

/**
 * Creates a simulator for the first wanted device type that Xcode knows about.
 *
 * Having the runtime and the device type installed does not mean an instance
 * exists — a fresh machine or CI runner usually has neither. Creating one is
 * cheap, persists for later runs, and is the difference between the driver
 * working out of the box and failing on a clean checkout.
 */
async function createDevice(names: readonly string[]) {
  const types = await listJson<{
    devicetypes?: { name: string; identifier: string }[];
  }>(['devicetypes'], 'Listing device types');

  const runtimes = await listJson<{
    runtimes?: {
      identifier: string;
      version: string;
      isAvailable?: boolean;
      platform?: string;
    }[];
  }>(['runtimes'], 'Listing runtimes');

  const runtime = (runtimes.runtimes ?? [])
    .filter(
      (each) =>
        each.isAvailable !== false &&
        (each.platform ?? 'iOS').toLowerCase() === 'ios',
    )
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))
    .at(0);

  if (!runtime) {
    return undefined;
  }

  for (const name of names) {
    const type = (types.devicetypes ?? []).find((each) => each.name === name);

    if (!type) {
      continue;
    }

    const udid = (
      await execChecked(
        'xcrun',
        ['simctl', 'create', name, type.identifier, runtime.identifier],
        `Creating a ${name} simulator`,
      )
    ).trim();

    info(`created ${name} simulator (${runtime.identifier})`);

    return { udid, name, state: 'Shutdown' } satisfies SimulatorDevice;
  }

  return undefined;
}

/**
 * Picks a simulator by name preference, favouring one that is already booted so
 * a run does not cold-boot a second device when a suitable one is open.
 */
async function findDevice(spec: IosSimulatorCapture, target: TargetSpec) {
  const payload = await listJson<{
    devices?: Record<string, SimulatorDevice[]>;
  }>(['devices'], 'Listing simulators');

  const available = Object.values(payload.devices ?? {})
    .flat()
    .filter((device) => device.isAvailable !== false);

  const names = wanted(spec);

  for (const name of names) {
    const matches = available.filter((device) => device.name === name);
    const device = matches.find((each) => each.state === 'Booted') ?? matches[0];

    if (device) {
      return device;
    }
  }

  const created =
    spec.createIfMissing === false ? undefined : await createDevice(names);

  if (created) {
    return created;
  }

  throw new Error(
    `No simulator available for target "${target.id}" matching ` +
      `${names.join(' or ')}, and none could be created.\n` +
      `Install the device type and a runtime under Xcode > Settings > ` +
      `Components, or set a different "device" on the capture spec.`,
  );
}

async function boot(device: SimulatorDevice) {
  if (device.state === 'Booted') {
    return;
  }

  info(`booting ${device.name}`);
  // Racing another run can make `boot` fail with "current state: Booted", which
  // bootstatus then reports as fine, so only the wait is worth checking.
  await exec('xcrun', ['simctl', 'boot', device.udid]);
  await execChecked(
    'xcrun',
    ['simctl', 'bootstatus', device.udid, '-b'],
    `Booting ${device.name}`,
  );
}

async function navigate(
  screen: ScreenSpec,
  target: TargetSpec,
  locale: string,
  device: SimulatorDevice,
  config: ResolvedConfig,
) {
  if (screen.deepLink) {
    await execChecked(
      'xcrun',
      ['simctl', 'openurl', device.udid, screen.deepLink],
      `Opening ${screen.deepLink}`,
    );

    return;
  }

  if (config.navigate) {
    await config.navigate({
      screen,
      target,
      locale,
      device: device.udid,
      platform: 'ios',
    });

    return;
  }

  await prompt(`  drive the app to "${screen.id}", then press Enter `);
}

async function screenshot(device: SimulatorDevice, label: string) {
  const path = resolve(tmpdir(), `storeshot-${randomUUID()}.png`);

  try {
    await execChecked(
      'xcrun',
      ['simctl', 'io', device.udid, 'screenshot', '--type', 'png', path],
      `Capturing ${label}`,
    );

    return await readFile(path);
  } finally {
    await rm(path, { force: true });
  }
}

export function createIosSimulatorDriver(
  spec: IosSimulatorCapture,
): CaptureDriver {
  return {
    kind: 'ios-simulator',
    // A simulator screenshot is the whole screen, real status bar included.
    includesStatusBar: true,

    open: async ({ target, config }: CaptureContext): Promise<CaptureSession> => {
      if (process.platform !== 'darwin') {
        throw new Error(
          'Capturing from the iOS Simulator needs macOS with Xcode. Use the ' +
            '"import" capture kind to frame screenshots produced elsewhere.',
        );
      }

      const device = await findDevice(spec, target);

      await boot(device);

      if (spec.showWindow) {
        await exec('open', ['-a', 'Simulator']);
      }

      if (spec.appPath) {
        const app = isAbsolute(spec.appPath)
          ? spec.appPath
          : resolve(config.paths.root, spec.appPath);

        info(`installing ${app}`);
        await execChecked(
          'xcrun',
          ['simctl', 'install', device.udid, app],
          'Installing app',
        );
      }

      if (spec.marketingStatusBar !== false) {
        await execChecked(
          'xcrun',
          ['simctl', 'status_bar', device.udid, 'override', ...MARKETING_STATUS_BAR],
          'Overriding the status bar',
        );
      }

      if (spec.bundleId) {
        await execChecked(
          'xcrun',
          [
            'simctl',
            'launch',
            '--terminate-running-process',
            device.udid,
            spec.bundleId,
          ],
          `Launching ${spec.bundleId}`,
        );
      }

      info(`using ${device.name} (${device.udid})`);

      return {
        capture: async (screen, locale) => {
          await navigate(screen, target, locale, device, config);
          await new Promise((done) => setTimeout(done, config.settleDelay));

          return screenshot(device, screen.id);
        },
        close: async () => {
          if (spec.marketingStatusBar !== false) {
            await exec('xcrun', ['simctl', 'status_bar', device.udid, 'clear']);
          }

          if (spec.bundleId) {
            await exec('xcrun', [
              'simctl',
              'terminate',
              device.udid,
              spec.bundleId,
            ]);
          }
        },
      };
    },
  };
}
