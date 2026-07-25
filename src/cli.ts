import { parseOptions } from './config';
import { run } from './run';

async function main() {
  await run(await parseOptions(process.argv.slice(2)));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
