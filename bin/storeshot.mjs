#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

import { createJiti } from 'jiti';

// The package ships TypeScript rather than a build output, and jiti is what
// makes that runnable — the same loader then reads the user's config, so their
// storeshot.config.ts can be TypeScript and import from the rest of the repo
// without either side needing a compile step.
const jiti = createJiti(import.meta.url, { interopDefault: true });

await jiti.import(fileURLToPath(new URL('../src/cli.ts', import.meta.url)));
