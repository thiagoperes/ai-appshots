export function step(message: string) {
  console.log(`\n▸ ${message}`);
}

export function info(message: string) {
  console.log(`  ${message}`);
}

export function warn(message: string) {
  console.warn(`  ! ${message}`);
}

export function fail(message: string, hint?: string): never {
  console.error(`\n${message}`);

  if (hint) {
    console.error(hint);
  }

  process.exit(1);
}
