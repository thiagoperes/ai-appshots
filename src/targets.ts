import type { StoreId, TargetSpec } from './types';
import { createDeviceTarget, DEVICE_PROFILES } from './devices.ts';

/**
 * Conservative defaults for the legacy framed layout. Apple's artwork guidance
 * is separate from App Store screenshot file requirements. The composition
 * renderer reports artwork notices separately and supports generic frames.
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
 * - The Mac App Store accepts 16:10 screenshots at 2880x1800.
 * - Play requires 9:16 portrait between 1080px and 7680px, with the long edge
 *   no more than twice the short edge.
 *
 * @see https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications
 * @see https://support.google.com/googleplay/android-developer/answer/9866151
 */
export const MACOS_TARGET: TargetSpec = createDeviceTarget('mac-window', {
  id: 'macos-16:10', frame: { kind: 'window' },
});

export const DEFAULT_TARGETS: readonly TargetSpec[] = [
  createDeviceTarget('iphone-17-pro-max', { id: 'ios-iphone-6.9' }),
  createDeviceTarget('ipad-pro-12.9', { id: 'ios-ipad-13' }),
  createDeviceTarget('pixel-5', { id: 'android-phone' }),
  createDeviceTarget('android-tablet'),
];

/** All targets available through `findTarget`; macOS remains opt-in. */
export const BUILT_IN_TARGETS: readonly TargetSpec[] = [
  ...DEFAULT_TARGETS,
  MACOS_TARGET,
  ...DEVICE_PROFILES.filter((device) => !DEFAULT_TARGETS.some((target) => target.id === device.id))
    .map((device) => createDeviceTarget(device.id)),
];

export function findTarget(
  id: string,
  targets: readonly TargetSpec[] = BUILT_IN_TARGETS,
): TargetSpec {
  const target = targets.find((candidate) => candidate.id === id);

  if (!target) {
    const known = targets.map((candidate) => candidate.id).join(', ');

    throw new Error(`Unknown target "${id}". Available targets: ${known}.`);
  }

  return target;
}
