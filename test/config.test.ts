import { describe, expect, it } from 'vitest';
import { ALL_SUITE_IDS, SUITES, findSuite } from '../config';

describe('config', () => {
  it('derives ALL_SUITE_IDS from SUITES in order', () => {
    expect(ALL_SUITE_IDS).toEqual(SUITES.map((s) => s.id));
  });

  it('has unique, non-empty suite ids', () => {
    expect(new Set(ALL_SUITE_IDS).size).toBe(ALL_SUITE_IDS.length);
    expect(ALL_SUITE_IDS.every((id) => id.length > 0)).toBe(true);
  });

  it('every suite has a git source and at least one command', () => {
    for (const suite of SUITES) {
      expect(suite.source.type).toBe('git');
      expect(suite.commands.length).toBeGreaterThan(0);
    }
  });

  it('findSuite returns the matching suite', () => {
    expect(findSuite('athen')?.id).toBe('athen');
  });

  it('findSuite returns undefined for an unknown id', () => {
    expect(findSuite('does-not-exist')).toBeUndefined();
  });
});
