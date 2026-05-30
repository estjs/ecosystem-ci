import { describe, expect, it } from 'vitest';
import {
  type Aggregate,
  formatDuration,
  renderMarkdown,
  sortByDeclared,
  statusBadge,
} from '../aggregate';
import type { StepResult, SuiteResult } from '../utils/runSuite';

function step(overrides: Partial<StepResult> = {}): StepResult {
  return { cmd: 'pnpm test', ok: true, exitCode: 0, durationMs: 100, tail: '', ...overrides };
}

function suiteResult(overrides: Partial<SuiteResult> = {}): SuiteResult {
  return {
    id: 'athen',
    status: 'success',
    durationMs: 1000,
    steps: [step()],
    ...overrides,
  };
}

describe('statusBadge', () => {
  it('maps each status to a labelled badge', () => {
    expect(statusBadge('success')).toContain('pass');
    expect(statusBadge('failure')).toContain('fail');
    expect(statusBadge('setup-failed')).toContain('setup-failed');
  });
});

describe('formatDuration', () => {
  it('renders sub-second durations in ms', () => {
    expect(formatDuration(500)).toBe('500ms');
  });
  it('renders longer durations in seconds with one decimal', () => {
    expect(formatDuration(1500)).toBe('1.5s');
  });
});

describe('sortByDeclared', () => {
  it('orders results by their position in ALL_SUITE_IDS', () => {
    const unordered = [
      suiteResult({ id: 'test-utils' }),
      suiteResult({ id: 'essor-router' }),
      suiteResult({ id: 'athen' }),
    ];
    expect(sortByDeclared(unordered).map((r) => r.id)).toEqual([
      'essor-router',
      'athen',
      'test-utils',
    ]);
  });

  it('pushes unknown suite ids to the end', () => {
    const unordered = [suiteResult({ id: 'mystery' }), suiteResult({ id: 'essor-router' })];
    expect(sortByDeclared(unordered).map((r) => r.id)).toEqual(['essor-router', 'mystery']);
  });
});

describe('renderMarkdown', () => {
  it('reports an empty placeholder when there are no results', () => {
    expect(renderMarkdown({ results: [] })).toContain('No results found');
  });

  it('renders a passing header and a table row per suite', () => {
    const agg: Aggregate = {
      essorSha: 'abcdef0123456789',
      essorRef: 'main',
      results: [suiteResult({ id: 'athen' }), suiteResult({ id: 'essor-router' })],
    };
    const md = renderMarkdown(agg);
    expect(md).toContain('passed');
    expect(md).toContain('abcdef0'); // short sha
    expect(md).toContain('on `main`');
    expect(md).toContain('| `athen` |');
    expect(md).toContain('| `essor-router` |');
  });

  it('renders a failure header and a details block with the failing step tail', () => {
    const agg: Aggregate = {
      essorSha: 'deadbeef00000000',
      results: [
        suiteResult({
          id: 'athen',
          status: 'failure',
          steps: [
            step({ cmd: 'pnpm install', ok: true }),
            step({ cmd: 'pnpm test', ok: false, exitCode: 1, tail: 'AssertionError: boom' }),
          ],
        }),
      ],
    };
    const md = renderMarkdown(agg);
    expect(md).toContain('failure(s)');
    expect(md).toContain('pnpm test');
    expect(md).toContain('(exit 1)');
    expect(md).toContain('AssertionError: boom');
  });

  it('falls back to setupError when a suite failed during setup', () => {
    const agg: Aggregate = {
      results: [
        suiteResult({ id: 'athen', status: 'setup-failed', steps: [], setupError: 'clone failed' }),
      ],
    };
    expect(renderMarkdown(agg)).toContain('clone failed');
  });
});
