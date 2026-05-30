import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { ALL_SUITE_IDS } from '../config';
import { parseArgs } from '../ecosystem-ci';

describe('parseArgs', () => {
  const saved = { ref: process.env.ESSOR_REF, input: process.env.INPUT_REF };
  afterEach(() => {
    restoreEnv('ESSOR_REF', saved.ref);
    restoreEnv('INPUT_REF', saved.input);
  });

  it('defaults to all suites and ref "main"', () => {
    delete process.env.ESSOR_REF;
    delete process.env.INPUT_REF;
    const args = parseArgs([]);
    expect(args.suiteIds).toEqual(ALL_SUITE_IDS);
    expect(args.essorRef).toBe('main');
    expect(args.skipBuild).toBe(false);
    expect(args.port).toBe(4873);
  });

  it('accepts a positional suite id', () => {
    expect(parseArgs(['athen']).suiteIds).toEqual(['athen']);
  });

  it('accepts --suite and accumulates repeats', () => {
    expect(parseArgs(['--suite', 'athen', '--suite', 'test-utils']).suiteIds).toEqual([
      'athen',
      'test-utils',
    ]);
  });

  it('--all expands to every suite id', () => {
    expect(parseArgs(['--all']).suiteIds).toEqual(ALL_SUITE_IDS);
  });

  it('parses --ref, --no-build and --port', () => {
    const args = parseArgs(['--suite', 'athen', '--ref', 'feat/x', '--no-build', '--port', '4881']);
    expect(args.essorRef).toBe('feat/x');
    expect(args.skipBuild).toBe(true);
    expect(args.port).toBe(4881);
  });

  it('throws when a value-taking flag is missing its value', () => {
    expect(() => parseArgs(['--suite'])).toThrow(/--suite requires a value/);
    expect(() => parseArgs(['--ref'])).toThrow(/--ref requires a value/);
    expect(() => parseArgs(['--port'])).toThrow(/--port requires a value/);
  });

  it('throws on unknown flags', () => {
    expect(() => parseArgs(['--bogus'])).toThrow(/unknown flag: --bogus/);
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
