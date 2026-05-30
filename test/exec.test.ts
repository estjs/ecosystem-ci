import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { capture, run } from '../utils/exec';

const cwd = process.cwd();
const node = process.execPath;

describe('run', () => {
  it('returns normally when the command exits 0', () => {
    expect(() => run(node, ['-e', 'process.exit(0)'], 'ok step', { cwd })).not.toThrow();
  });

  it('throws with the label and exit code on failure', () => {
    expect(() => run(node, ['-e', 'process.exit(3)'], 'boom step', { cwd })).toThrow(
      /boom step failed with exit code 3/,
    );
  });
});

describe('capture', () => {
  it('reports ok and captures the output tail on success', async () => {
    const result = await capture(node, ['-e', 'process.stdout.write("hello-capture")'], { cwd });
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.tail).toContain('hello-capture');
  });

  it('reports the non-zero exit code without throwing', async () => {
    const result = await capture(node, ['-e', 'process.exit(7)'], { cwd });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(7);
  });

  it('runs through a shell when shell:true', async () => {
    const result = await capture('exit 0', [], { cwd, shell: true });
    expect(result.ok).toBe(true);
  });

  it('captures stderr as well as stdout', async () => {
    const result = await capture(node, ['-e', 'process.stderr.write("err-output")'], { cwd });
    expect(result.tail).toContain('err-output');
  });
});
