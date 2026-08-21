import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

import { commandExists, exec, execBinary, execChecked, prompt } from './exec';
import { info } from '../log';
import type {
  AndroidEmulatorCapture,
  CaptureContext,
  CaptureDriver,
  CaptureSession,
  ResolvedConfig,
  ScreenSpec,
  TargetSpec,
} from '../types';

function sdkRoot() {
  return (
    process.env.ANDROID_HOME ??
    process.env.ANDROID_SDK_ROOT ??
    resolve(homedir(), 'Library/Android/sdk')
  );
}

async function exists(path: string) {
  try {
    await access(path);

    return true;
  } catch {
    return false;
  }
}

/** Prefers an `adb` on PATH, then the one inside the SDK. */
async function findAdb() {
  if (await commandExists('adb')) {
    return 'adb';
  }

  const bundled = resolve(sdkRoot(), 'platform-tools/adb');

  if (await exists(bundled)) {
    return bundled;
  }

  throw new Error(
    'Could not find adb. Install the Android SDK platform tools, or set ' +
      'ANDROID_HOME.',
  );
}

async function attachedDevices(adb: string) {
  const raw = await execChecked(adb, ['devices'], 'Listing devices');

  return raw
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === 'device')
    .map(([serial]) => serial as string);
}

async function waitForBoot(adb: string, serial: string) {
  await execChecked(adb, ['-s', serial, 'wait-for-device'], 'Waiting for device');

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const result = await exec(adb, [
      '-s',
      serial,
      'shell',
      'getprop',
      'sys.boot_completed',
    ]);

    if (result.stdout.trim() === '1') {
      return;
    }

    await new Promise((done) => setTimeout(done, 2_000));
  }

  throw new Error(`${serial} did not finish booting.`);
}

/**
 * Boots an AVD in the background. The emulator process outlives the run on
 * purpose: a warm emulator makes the next run far faster, and shutting one down
 * that the operator opened themselves would be rude.
 */
async function bootAvd(adb: string, avd: string) {
  const binary = resolve(sdkRoot(), 'emulator/emulator');

  if (!(await exists(binary))) {
    throw new Error(`Could not find the emulator binary at ${binary}.`);
  }

  info(`booting AVD ${avd}`);

  const child = spawn(binary, ['-avd', avd, '-no-boot-anim'], {
    detached: true,
    stdio: 'ignore',
  });

  child.unref();

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const [serial] = await attachedDevices(adb);

    if (serial) {
      await waitForBoot(adb, serial);

      return serial;
    }

    await new Promise((done) => setTimeout(done, 2_000));
  }

  throw new Error(`AVD ${avd} never attached to adb.`);
}

async function resolveSerial(
  adb: string,
  spec: AndroidEmulatorCapture,
  target: TargetSpec,
) {
  if (spec.serial) {
    await waitForBoot(adb, spec.serial);

    return spec.serial;
  }

  const attached = await attachedDevices(adb);

  if (attached.length === 1) {
    return attached[0] as string;
  }

  if (attached.length > 1) {
    throw new Error(
      `More than one device is attached (${attached.join(', ')}). Set ` +
        `"serial" on the capture spec for target "${target.id}".`,
    );
  }

  if (spec.avd) {
    return bootAvd(adb, spec.avd);
  }

  throw new Error(
    `No Android device is attached for target "${target.id}". Start an ` +
      `emulator, or set "avd" on its capture spec so ai-appshots boots one.`,
  );
}

/**
 * SystemUI demo mode is Android's equivalent of `simctl status_bar override`:
 * a fixed clock, a full battery, full signal and no notification icons.
 *
 * @see https://developer.android.com/training/testing/other-components/ui-automator#demo-mode
 */
const DEMO_COMMANDS: readonly (readonly string[])[] = [
  ['command', 'enter'],
  ['command', 'clock', '-e', 'hhmm', '0941'],
  ['command', 'battery', '-e', 'level', '100', '-e', 'plugged', 'false'],
  ['command', 'network', '-e', 'wifi', 'show', '-e', 'level', '4'],
  [
    'command',
    'network',
    '-e',
    'mobile',
    'show',
    '-e',
    'datatype',
    'none',
    '-e',
    'level',
    '4',
  ],
  ['command', 'notifications', '-e', 'visible', 'false'],
];

async function broadcast(adb: string, serial: string, args: readonly string[]) {
  await exec(adb, [
    '-s',
    serial,
    'shell',
    'am',
    'broadcast',
    '-a',
    'com.android.systemui.demo',
    '-e',
    ...args,
  ]);
}

async function enterDemoMode(adb: string, serial: string) {
  await exec(adb, [
    '-s',
    serial,
    'shell',
    'settings',
    'put',
    'global',
    'sysui_demo_allowed',
    '1',
  ]);

  for (const command of DEMO_COMMANDS) {
    await broadcast(adb, serial, command);
  }
}

async function navigate(
  adb: string,
  serial: string,
  screen: ScreenSpec,
  target: TargetSpec,
  locale: string,
  spec: AndroidEmulatorCapture,
  config: ResolvedConfig,
) {
  if (screen.deepLink) {
    const args = [
      '-s',
      serial,
      'shell',
      'am',
      'start',
      '-a',
      'android.intent.action.VIEW',
      '-d',
      screen.deepLink,
    ];

    await execChecked(
      adb,
      spec.appId ? [...args, spec.appId] : args,
      `Opening ${screen.deepLink}`,
    );

    return;
  }

  if (config.navigate) {
    await config.navigate({
      screen,
      target,
      locale,
      device: serial,
      platform: 'android',
    });

    return;
  }

  await prompt(`  drive the app to "${screen.id}", then press Enter `);
}

export function createAndroidEmulatorDriver(
  spec: AndroidEmulatorCapture,
): CaptureDriver {
  return {
    kind: 'android-emulator',
    // `screencap` grabs the framebuffer, status bar and navigation bar included.
    includesStatusBar: true,

    open: async ({ target, config }: CaptureContext): Promise<CaptureSession> => {
      const adb = await findAdb();
      const serial = await resolveSerial(adb, spec, target);

      if (spec.apkPath) {
        const apk = isAbsolute(spec.apkPath)
          ? spec.apkPath
          : resolve(config.paths.root, spec.apkPath);

        info(`installing ${apk}`);
        await execChecked(
          adb,
          ['-s', serial, 'install', '-r', apk],
          'Installing APK',
        );
      }

      if (spec.marketingStatusBar !== false) {
        await enterDemoMode(adb, serial);
      }

      if (spec.appId) {
        await execChecked(
          adb,
          [
            '-s',
            serial,
            'shell',
            'monkey',
            '-p',
            spec.appId,
            '-c',
            'android.intent.category.LAUNCHER',
            '1',
          ],
          `Launching ${spec.appId}`,
        );
      }

      info(`using ${serial}`);

      return {
        capture: async (screen, locale) => {
          await navigate(adb, serial, screen, target, locale, spec, config);
          await new Promise((done) => setTimeout(done, config.settleDelay));

          return execBinary(
            adb,
            ['-s', serial, 'exec-out', 'screencap', '-p'],
            `Capturing ${screen.id}`,
          );
        },
        close: async () => {
          if (spec.marketingStatusBar !== false) {
            await broadcast(adb, serial, ['command', 'exit']);
          }
        },
      };
    },
  };
}
