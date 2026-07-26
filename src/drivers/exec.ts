import { execFile } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

/** Simulator boots and emulator installs are slow; give them room. */
const DEFAULT_TIMEOUT = 180_000;

export interface ExecResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs a command and returns its output. Never throws on a non-zero exit, so
 * callers can decide whether a failure is fatal — many `simctl` and `adb`
 * commands fail harmlessly, like booting a device that is already booted.
 */
export function exec(
  command: string,
  args: readonly string[],
  options: { readonly timeout?: number } = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      [...args],
      {
        timeout: options.timeout ?? DEFAULT_TIMEOUT,
        maxBuffer: 256 * 1024 * 1024,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        resolve({
          code: error ? ((error as { code?: number }).code ?? 1) : 0,
          stdout,
          stderr,
        });
      },
    );
  });
}

export async function execChecked(
  command: string,
  args: readonly string[],
  label: string,
): Promise<string> {
  const result = await exec(command, args);

  if (result.code !== 0) {
    throw new Error(
      `${label} failed (exit ${result.code}).\n` +
        `  ${command} ${args.join(' ')}\n` +
        (result.stderr || result.stdout).trim(),
    );
  }

  return result.stdout;
}

/** Runs a command that writes binary data to stdout, such as `adb screencap`. */
export function execBinary(
  command: string,
  args: readonly string[],
  label: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      { timeout: DEFAULT_TIMEOUT, maxBuffer: 256 * 1024 * 1024, encoding: 'buffer' },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(`${label} failed.\n${stderr.toString('utf8').trim()}`),
          );

          return;
        }

        resolve(stdout);
      },
    );
  });
}

export async function commandExists(command: string) {
  return (await exec('which', [command], { timeout: 10_000 })).code === 0;
}

/**
 * Blocks until the operator confirms the app is on the right screen. The escape
 * hatch for apps with no deep links, and the reason a native run is interactive
 * unless you wire up `navigate`.
 */
export async function prompt(question: string) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    await rl.question(question);
  } finally {
    rl.close();
  }
}
