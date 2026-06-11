import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import process from 'node:process';
import { REPO_ROOT, VERDACCIO_CONFIG, VERDACCIO_STORAGE } from './paths';

export interface VerdaccioHandle {
  url: string;
  port: number;
  stop: () => Promise<void>;
}

export async function startVerdaccio(port = 4873): Promise<VerdaccioHandle> {
  rmSync(VERDACCIO_STORAGE, { recursive: true, force: true });
  mkdirSync(VERDACCIO_STORAGE, { recursive: true });

  const proc: ChildProcess = spawn(
    'node',
    ['./node_modules/verdaccio/bin/verdaccio', '--config', VERDACCIO_CONFIG, '--listen', String(port)],
    {
      // Run from the ecosystem-ci root so it finds verdaccio in
      // THIS project's node_modules, not in the empty VERDACCIO_STORAGE dir.
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, VERDACCIO_HANDLE_KILL_SIGNALS: 'true' },
    },
  );

  let buffer = '';
  let stopped = false;
  proc.stdout?.on('data', (d) => {
    buffer += d.toString();
  });
  proc.stderr?.on('data', (d) => {
    buffer += d.toString();
  });

  proc.on('exit', (code) => {
    if (code != null && code !== 0 && !stopped) {
      console.error('[verdaccio] exited unexpectedly with code', code);
      console.error(buffer.slice(-2000));
    }
  });

  const stop = async () => {
    if (stopped) return;
    stopped = true;
    proc.kill('SIGTERM');
    await sleep(200);
    if (!proc.killed) proc.kill('SIGKILL');
  };

  const url = `http://localhost:${port}/`;
  const ready = await waitForReady(url, 30_000);
  if (!ready) {
    await stop();
    throw new Error(`Verdaccio did not become ready in 30s. Last output:\n${buffer.slice(-2000)}`);
  }

  return { url, port, stop };
}

async function waitForReady(baseUrl: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}-/ping`);
      if (res.ok) return true;
    } catch {
      // not ready yet
    }
    await sleep(300);
  }
  return false;
}
