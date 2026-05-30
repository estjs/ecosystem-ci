import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { ESSOR_PACKAGES, buildCiVersion, detectEssorRef } from '../utils/versions';

describe('buildCiVersion', () => {
  it('uses the first 7 chars of the essor sha', () => {
    expect(buildCiVersion('abcdef0123456789')).toBe('0.0.0-ci-abcdef0');
  });

  it('falls back to a local tag when no sha is given', () => {
    expect(buildCiVersion()).toMatch(/^0\.0\.0-ci-local-[a-z0-9]+$/);
  });
});

describe('eSSOR_PACKAGES', () => {
  it('contains exactly the 7 published packages, with no duplicates', () => {
    expect(ESSOR_PACKAGES).toHaveLength(7);
    expect(ESSOR_PACKAGES).toContain('essor');
    expect(ESSOR_PACKAGES).toContain('@estjs/signals');
    expect(new Set(ESSOR_PACKAGES).size).toBe(ESSOR_PACKAGES.length);
  });
});

describe('detectEssorRef', () => {
  const saved = { ref: process.env.ESSOR_REF, input: process.env.INPUT_REF };
  afterEach(() => {
    restoreEnv('ESSOR_REF', saved.ref);
    restoreEnv('INPUT_REF', saved.input);
  });

  it('defaults to "main" when no env is set', () => {
    delete process.env.ESSOR_REF;
    delete process.env.INPUT_REF;
    expect(detectEssorRef()).toBe('main');
  });

  it('prefers INPUT_REF over the default', () => {
    delete process.env.ESSOR_REF;
    process.env.INPUT_REF = 'from-input';
    expect(detectEssorRef()).toBe('from-input');
  });

  it('prefers ESSOR_REF over everything', () => {
    process.env.ESSOR_REF = 'from-ref';
    process.env.INPUT_REF = 'from-input';
    expect(detectEssorRef()).toBe('from-ref');
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
