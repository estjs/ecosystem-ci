import { spawn, spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import process from 'node:process';

/** Last N bytes of combined output kept for failure reporting. */
export const TAIL_BYTES = 4000;

export interface CaptureResult {
  ok: boolean;
  exitCode: number;
  /** Trailing `TAIL_BYTES` of combined stdout/stderr. */
  tail: string;
}

export interface ExecOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Run a command with inherited stdio and throw if it exits non-zero. Used for
 * setup steps (git, pnpm install/build/publish) where output should stream live
 * and any failure must abort the run.
 */
export function run(command: string, args: string[], label: string, opts: ExecOptions): void {
  const result = spawnSync(command, args, {
    cwd: opts.cwd,
    stdio: 'inherit',
    env: opts.env ?? process.env,
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}`);
  }
}

/**
 * Run a command, stream its output, and resolve with the exit status plus the
 * trailing `TAIL_BYTES` of combined stdout/stderr. Never rejects — a failed
 * spawn or non-zero exit is reported through `ok`/`exitCode`.
 */
export function capture(
  command: string,
  args: string[],
  opts: ExecOptions & { shell?: boolean },
): Promise<CaptureResult> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd: opts.cwd,
      shell: opts.shell ?? false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: opts.env ?? process.env,
    });

    const chunks: Buffer[] = [];
    let total = 0;
    const append = (buf: Buffer) => {
      chunks.push(buf);
      total += buf.length;
      process.stdout.write(buf);
      // Keep a bounded sliding window so long-running steps don't buffer
      // unbounded output just to report the tail on failure.
      while (total > TAIL_BYTES * 4 && chunks.length > 1) {
        total -= chunks[0]!.length;
        chunks.shift();
      }
    };
    proc.stdout?.on('data', append);
    proc.stderr?.on('data', append);

    proc.on('close', (code) => {
      const all = Buffer.concat(chunks).toString();
      const tail = all.length > TAIL_BYTES ? all.slice(-TAIL_BYTES) : all;
      resolve({ ok: code === 0, exitCode: code ?? -1, tail });
    });
  });
}
