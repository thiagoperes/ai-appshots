import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import type {
  CaptureContext,
  CaptureDriver,
  CaptureSession,
  ImportCapture,
  ImportFileContext,
} from '../types';

function defaultFile({ screen, target }: ImportFileContext) {
  return `${target.id}/${screen.id}.png`;
}

/**
 * Frames screenshots that something else produced — XCUITest, `fastlane
 * snapshot`, Espresso, or a designer's export. Everything downstream of capture
 * is identical, so a native app with existing UI tests can adopt the framing and
 * delivery half of the pipeline without changing how it takes screenshots.
 */
export function createImportDriver(spec: ImportCapture): CaptureDriver {
  const file = spec.file ?? defaultFile;

  return {
    kind: 'import',
    // Whatever produced these was a real device or simulator, so the status bar
    // is already there.
    includesStatusBar: true,

    open: async ({ target, config }: CaptureContext): Promise<CaptureSession> => {
      const dir = isAbsolute(spec.dir)
        ? spec.dir
        : resolve(config.paths.root, spec.dir);

      return {
        capture: async (screen, locale) => {
          const path = resolve(dir, file({ screen, target, locale }));

          try {
            return await readFile(path);
          } catch {
            throw new Error(
              `No screenshot at ${path} for "${screen.id}" on ` +
                `"${target.id}".\nAdjust "dir" or "file" on the import ` +
                `capture spec.`,
            );
          }
        },
        close: async () => undefined,
      };
    },
  };
}
