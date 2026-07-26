import { createAndroidEmulatorDriver } from './android-emulator';
import { createImportDriver } from './import';
import { createIosSimulatorDriver } from './ios-simulator';
import { createWebDriver } from './web';
import type {
  CaptureDriver,
  CaptureSpec,
  Platform,
  ResolvedConfig,
  TargetSpec,
} from '../types';

export { launchBrowser } from './web';

export function createDriver(spec: CaptureSpec): CaptureDriver {
  switch (spec.kind) {
    case 'web':
      return createWebDriver(spec);
    case 'ios-simulator':
      return createIosSimulatorDriver(spec);
    case 'android-emulator':
      return createAndroidEmulatorDriver(spec);
    case 'import':
      return createImportDriver(spec);
    case 'custom':
      return {
        kind: 'custom',
        includesStatusBar: spec.includesStatusBar,
        open: spec.open,
      };
  }
}

function isSpec(value: NonNullable<ResolvedConfig['capture']>): value is CaptureSpec {
  return 'kind' in value;
}

/** Shared so targets that fall through to it resolve to one browser driver. */
const WEB: CaptureSpec = { kind: 'web' };

/**
 * Resolves where a target's captures come from: its own setting first, then the
 * config's — which may be one spec for everything or one per platform — and
 * finally a headless browser.
 */
export function captureSpecFor(
  target: TargetSpec,
  config: Pick<ResolvedConfig, 'capture'>,
): CaptureSpec {
  if (target.capture) {
    return target.capture;
  }

  const configured = config.capture;

  if (configured) {
    if (isSpec(configured)) {
      return configured;
    }

    const forPlatform = configured[target.platform as Platform];

    if (forPlatform) {
      return forPlatform;
    }
  }

  return WEB;
}

export function driverFor(
  target: TargetSpec,
  config: Pick<ResolvedConfig, 'capture'>,
): CaptureDriver {
  return createDriver(captureSpecFor(target, config));
}
