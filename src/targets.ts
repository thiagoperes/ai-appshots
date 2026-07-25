import type { StoreId, TargetSpec } from './types';

/**
 * Apple's Marketing Resources and Identity Guidelines require product bezels to
 * be shown "as is": no cropping, tilting, shadows or reflections, and
 * promotional copy beside the device rather than on top of it. Play has no
 * equivalent restriction, so Android targets may bleed the device off the
 * bottom edge and cast a shadow.
 *
 * @see https://developer.apple.com/app-store/marketing/guidelines/
 */
export interface StorePolicy {
  /** Allow the device to run past the bottom edge of the canvas. */
  readonly allowDeviceBleed: boolean;
  readonly allowDeviceShadow: boolean;
}

export const STORE_POLICIES: Readonly<Record<StoreId, StorePolicy>> = {
  'app-store': { allowDeviceBleed: false, allowDeviceShadow: false },
  'play-store': { allowDeviceBleed: true, allowDeviceShadow: true },
};

/**
 * Output sizes come from the stores' own specs:
 *
 * - App Store 6.9" accepts 1320x2868, and the iPhone 17 Pro Max bezel's screen
 *   area is exactly that, so the capture needs no rescaling.
 * - App Store 13" iPad accepts both 2064x2752 and 2048x2732. The newest iPad
 *   bezel frameit ships expects 2048x2732, which is why the capture is that
 *   size while the canvas uses the larger accepted value.
 * - Play requires 9:16 portrait between 1080px and 7680px, with the long edge
 *   no more than twice the short edge.
 *
 * @see https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications
 * @see https://support.google.com/googleplay/android-developer/answer/9866151
 */
export const DEFAULT_TARGETS: readonly TargetSpec[] = [
  {
    id: 'ios-iphone-6.9',
    store: 'app-store',
    engine: 'webkit',
    viewport: { width: 440, height: 956 },
    deviceScaleFactor: 3,
    output: { width: 1320, height: 2868 },
    frame: {
      kind: 'frameit',
      file: 'Apple iPhone 17 Pro Max Deep Blue.png',
      offsetKey: 'iPhone 17 Pro Max',
    },
    captionScale: 0.078,
    captionGapRatio: 0.042,
    // Matches the safe-area top inset on a Dynamic Island iPhone, so the clock
    // and indicators land either side of the island cut into the bezel.
    statusBarHeight: 59,
    statusBarTextSize: 17,
    statusBarPlatform: 'ios',
    deliveryKind: 'ios',
  },
  {
    id: 'ios-ipad-13',
    store: 'app-store',
    engine: 'webkit',
    viewport: { width: 1024, height: 1366 },
    deviceScaleFactor: 2,
    output: { width: 2064, height: 2752 },
    frame: {
      kind: 'frameit',
      file: 'Apple iPad Pro (12.9-inch) (4th generation) Space Gray.png',
      offsetKey: 'iPad Pro (12.9 inch) (4th generation)',
    },
    captionScale: 0.05,
    captionGapRatio: 0.05,
    statusBarHeight: 24,
    statusBarTextSize: 13,
    statusBarPlatform: 'ios',
    deliveryKind: 'ios',
  },
  {
    id: 'android-phone',
    store: 'play-store',
    engine: 'chromium',
    viewport: { width: 360, height: 780 },
    deviceScaleFactor: 3,
    output: { width: 1080, height: 1920 },
    frame: {
      kind: 'frameit',
      file: 'Google Pixel 5 Just Black.png',
      offsetKey: 'Google Pixel 5',
    },
    captionScale: 0.078,
    captionGapRatio: 0.042,
    statusBarHeight: 24,
    statusBarTextSize: 14,
    statusBarPlatform: 'android',
    deliveryKind: 'phone',
  },
  {
    // frameit's only Android tablet bezels are a 2014 Nexus 9 and a Chrome OS
    // Pixel Slate, both of which look dated next to current hardware. A neutral
    // CSS bezel ages better; swap in a frameit frame here if that changes.
    id: 'android-tablet',
    store: 'play-store',
    engine: 'chromium',
    viewport: { width: 840, height: 1220 },
    deviceScaleFactor: 2,
    output: { width: 1440, height: 2560 },
    frame: {
      kind: 'css',
      bezelRatio: 0.022,
      radiusRatio: 0.035,
      color: '#1c1c1e',
    },
    captionScale: 0.055,
    captionGapRatio: 0.05,
    statusBarHeight: 24,
    statusBarTextSize: 14,
    statusBarPlatform: 'android',
    deliveryKind: 'tablet',
  },
];

export function findTarget(
  id: string,
  targets: readonly TargetSpec[] = DEFAULT_TARGETS,
): TargetSpec {
  const target = targets.find((candidate) => candidate.id === id);

  if (!target) {
    const known = targets.map((candidate) => candidate.id).join(', ');

    throw new Error(`Unknown target "${id}". Available targets: ${known}.`);
  }

  return target;
}
