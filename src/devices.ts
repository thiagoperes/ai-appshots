import type {
  FormFactor, FrameSpec, Orientation, Platform, Size, StatusBarLayout, TargetSpec,
} from './types.ts';

export interface DeviceProfile {
  readonly id: string;
  readonly name: string;
  readonly platform: Platform;
  readonly formFactor: FormFactor;
  readonly viewport: Size;
  readonly scale: number;
  readonly output: Size;
  readonly frames: Readonly<Record<string, FrameSpec>>;
  readonly statusBarHeight: number;
  readonly statusBarTextSize: number;
  readonly statusBar?: StatusBarLayout;
  readonly landscapeStatusBar?: StatusBarLayout;
  readonly landscapeStatusBarHeight?: number;
}

function hardware(file: string, key: string, width: number, height: number): FrameSpec {
  return { kind: 'frameit', file, offsetKey: key, screenSize: { width, height } };
}

function iphone(id: string, name: string, width: number, height: number, colors: readonly string[]): DeviceProfile {
  return {
    id, name, platform: 'ios', formFactor: 'phone', viewport: { width: width / 3, height: height / 3 }, scale: 3,
    output: { width: 1320, height: 2868 }, statusBarHeight: 62, statusBarTextSize: 17,
    statusBar: { style: 'ios-phone', leading: 0.083, trailing: 0.083, topInset: 0.16 },
    landscapeStatusBarHeight: 0,
    frames: Object.fromEntries(colors.map((color) => [color, hardware(`Apple ${name} ${color}.png`, name, width, height)])),
  };
}

/** Asset generations are explicit; no generic frame is labelled as newer hardware. */
export const DEVICE_PROFILES: readonly DeviceProfile[] = [
  iphone('iphone-17', 'iPhone 17', 1206, 2622, ['Black', 'Lavender', 'Mist Blue', 'Sage', 'White']),
  iphone('iphone-17-pro', 'iPhone 17 Pro', 1206, 2622, ['Deep Blue', 'Cosmic Orange', 'Silver']),
  iphone('iphone-17-pro-max', 'iPhone 17 Pro Max', 1320, 2868, ['Deep Blue', 'Cosmic Orange', 'Silver']),
  ...([
    ['ipad-pro-11', 'iPad Pro (11-inch)', 'iPad Pro (11 inch)', 1668, 2388],
    ['ipad-pro-12.9', 'iPad Pro (12.9-inch) (4th generation)', 'iPad Pro (12.9 inch) (4th generation)', 2048, 2732],
  ] as const).map(([id, name, key, width, height]): DeviceProfile => ({
    id, name, platform: 'ios', formFactor: 'tablet', viewport: { width: width / 2, height: height / 2 }, scale: 2,
    output: { width: 2064, height: 2752 }, statusBarHeight: 24, statusBarTextSize: 13,
    statusBar: { style: 'ios-tablet', leading: 0.025, trailing: 0.025 },
    frames: Object.fromEntries(['Space Gray', 'Silver'].map((color) => [color, hardware(`Apple ${name} ${color}.png`, key, width, height)])),
  })),
  {
    id: 'pixel-5', name: 'Google Pixel 5', platform: 'android', formFactor: 'phone',
    viewport: { width: 360, height: 780 }, scale: 3, output: { width: 1080, height: 1920 },
    statusBarHeight: 32, statusBarTextSize: 14,
    statusBar: { style: 'android', leading: 0.16, trailing: 0.05 },
    landscapeStatusBar: { style: 'android', leading: 0.04, trailing: 0.085 },
    landscapeStatusBarHeight: 24,
    frames: Object.fromEntries(['Just Black', 'Sorta Sage'].map((color) => [color, hardware(`Google Pixel 5 ${color}.png`, 'Google Pixel 5', 1080, 2340)])),
  },
  {
    id: 'galaxy-s21', name: 'Samsung Galaxy S21 5G', platform: 'android', formFactor: 'phone',
    viewport: { width: 360, height: 800 }, scale: 3, output: { width: 1080, height: 1920 },
    statusBarHeight: 32, statusBarTextSize: 14,
    statusBar: { style: 'android', leading: 0.045, trailing: 0.045 },
    landscapeStatusBarHeight: 24,
    frames: { Black: hardware('Samsung Galaxy S21 5G Black.png', 'Samsung Galaxy S21 5G', 1080, 2400) },
  },
  {
    id: 'android-tablet', name: 'Android tablet', platform: 'android', formFactor: 'tablet',
    viewport: { width: 840, height: 1220 }, scale: 2, output: { width: 1440, height: 2560 },
    statusBarHeight: 28, statusBarTextSize: 14,
    statusBar: { style: 'android', leading: 0.025, trailing: 0.025 },
    frames: {
      Graphite: { kind: 'css', bezelRatio: 0.026, radiusRatio: 0.035, color: '#343840' },
      Silver: { kind: 'css', bezelRatio: 0.026, radiusRatio: 0.035, color: '#adb4bf' },
    },
  },
  ...([
    ['macbook-air', 'MacBook Air', 2560, 1600, ['Silver', 'Space Gray', 'Gold']],
    ['macbook-pro-16', 'MacBook Pro 16', 3072, 1920, ['Space Gray', 'Silver']],
  ] as const).map(([id, name, width, height, colors]): DeviceProfile => ({
    id, name, platform: 'macos', formFactor: 'desktop', viewport: { width: width / 2, height: height / 2 }, scale: 2,
    output: { width: 2880, height: 1800 }, statusBarHeight: 0, statusBarTextSize: 0,
    frames: Object.fromEntries(colors.map((color) => [color, hardware(`Apple ${name} ${color}.png`, name, width, height)])),
  })),
  {
    id: 'mac-window', name: 'Mac window', platform: 'macos', formFactor: 'desktop',
    viewport: { width: 1440, height: 900 }, scale: 2, output: { width: 2880, height: 1800 },
    statusBarHeight: 0, statusBarTextSize: 0,
    frames: { Light: { kind: 'window', appearance: 'light' }, Dark: { kind: 'window', appearance: 'dark' }, None: { kind: 'none' } },
  },
];

export interface DeviceTargetOptions {
  readonly id?: string;
  readonly color?: string;
  readonly orientation?: Orientation;
  readonly output?: Size;
  readonly frame?: FrameSpec;
  readonly composition?: TargetSpec['composition'];
  readonly capture?: TargetSpec['capture'];
  readonly captionScale?: number;
  readonly captionGapRatio?: number;
  readonly statusBar?: StatusBarLayout;
  readonly statusBarHeight?: number;
  readonly statusBarTextSize?: number;
}

/** Select hardware and capture geometry together, without hand-maintaining pixel math. */
export function createDeviceTarget(profile: string | DeviceProfile, options: DeviceTargetOptions = {}): TargetSpec {
  const device = typeof profile === 'string' ? DEVICE_PROFILES.find((candidate) => candidate.id === profile) : profile;
  if (!device) throw new Error(`Unknown device "${profile}". Available: ${DEVICE_PROFILES.map((entry) => entry.id).join(', ')}.`);
  const color = options.color ?? Object.keys(device.frames)[0]!;
  const selectedFrame = options.frame ?? device.frames[color];
  if (!selectedFrame) throw new Error(`Unknown color "${color}" for ${device.name}. Available: ${Object.keys(device.frames).join(', ')}.`);
  const native = device.viewport.width > device.viewport.height ? 'landscape' : 'portrait';
  const rotated = options.orientation !== undefined && options.orientation !== native;
  const viewport = rotated ? { width: device.viewport.height, height: device.viewport.width } : { ...device.viewport };
  const output = options.output ?? (rotated ? { width: device.output.height, height: device.output.width } : { ...device.output });
  const frame = rotated && (selectedFrame.kind === 'frameit' || selectedFrame.kind === 'image')
    ? { ...selectedFrame, rotation: selectedFrame.rotation ?? 90 as const }
    : { ...selectedFrame };
  return {
    id: options.id ?? `${device.id}${rotated ? `-${options.orientation}` : ''}`,
    store: device.platform === 'android' ? 'play-store' : 'app-store', platform: device.platform,
    formFactor: device.formFactor, viewport, deviceScaleFactor: device.scale,
    output,
    frame, composition: options.composition, capture: options.capture,
    captionScale: options.captionScale ?? (device.formFactor === 'desktop' ? 0.045 : device.formFactor === 'tablet' ? 0.06 : 0.078),
    captionGapRatio: options.captionGapRatio ?? 0.08 * Math.min(output.width, output.height) / output.height,
    statusBarHeight: options.statusBarHeight ?? (rotated ? device.landscapeStatusBarHeight ?? device.statusBarHeight : device.statusBarHeight),
    statusBarTextSize: options.statusBarTextSize ?? device.statusBarTextSize,
    statusBar: options.statusBar ?? (rotated ? device.landscapeStatusBar ?? device.statusBar : device.statusBar),
    deliveryKind: device.platform === 'macos' ? 'macos' : device.platform === 'ios' ? 'ios' : device.formFactor === 'tablet' ? 'tablet' : 'phone',
  };
}

export function formFactorFor(target: Pick<TargetSpec, 'platform' | 'viewport' | 'formFactor'>): FormFactor {
  return target.formFactor ?? (target.platform === 'macos' ? 'desktop' : Math.min(target.viewport.width, target.viewport.height) >= 600 ? 'tablet' : 'phone');
}
