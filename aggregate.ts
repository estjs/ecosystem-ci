import { appendFileSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { ALL_SUITE_IDS } from './config';
import { WORKSPACE } from './utils/paths';
import type { SuiteResult } from './utils/runSuite';

export interface Aggregate {
  ciVersion?: string;
  essorSha?: string;
  essorRef?: string;
  results: SuiteResult[];
}

export function statusBadge(status: SuiteResult['status']): string {
  switch (status) {
    case 'success':
      return ':white_check_mark: pass';
    case 'failure':
      return ':x: fail';
    case 'setup-failed':
      return ':warning: setup-failed';
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function loadAggregate(): Aggregate {
  const aggregateDir = resolve(WORKSPACE, 'aggregate');
  const collected: SuiteResult[] = [];
  let essorSha: string | undefined;
  let essorRef: string | undefined;
  let ciVersion: string | undefined;

  try {
    const entries = readdirSync(aggregateDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const dir = resolve(aggregateDir, e.name);
      // download-artifact@v4 preserves the original filename, which is
      // result-<suite>.json — not result.json. Read whatever .json we find.
      let file: string | undefined;
      try {
        file = readdirSync(dir).find((f) => f.endsWith('.json'));
      } catch {
        continue;
      }
      if (!file) continue;
      try {
        const text = readFileSync(resolve(dir, file), 'utf8');
        const parsed = JSON.parse(text) as Aggregate | SuiteResult;
        if (Array.isArray((parsed as Aggregate).results)) {
          const agg = parsed as Aggregate;
          collected.push(...agg.results);
          essorSha = essorSha || agg.essorSha;
          essorRef = essorRef || agg.essorRef;
          ciVersion = ciVersion || agg.ciVersion;
        } else if ((parsed as SuiteResult).id) {
          collected.push(parsed as SuiteResult);
        }
      } catch {
        // invalid JSON
      }
    }
    if (collected.length) {
      return { results: sortByDeclared(collected), essorSha, essorRef, ciVersion };
    }
  } catch {
    // aggregate dir missing
  }

  try {
    const text = readFileSync(resolve(WORKSPACE, 'result.json'), 'utf8');
    const parsed = JSON.parse(text) as Aggregate;
    return { ...parsed, results: sortByDeclared(parsed.results) };
  } catch {
    return { results: [] };
  }
}

export function sortByDeclared(results: SuiteResult[]): SuiteResult[] {
  const order = new Map(ALL_SUITE_IDS.map((id, i) => [id, i]));
  return [...results].sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
}

export function renderMarkdown(agg: Aggregate): string {
  const { results } = agg;
  if (results.length === 0) {
    return '## essor ecosystem-ci\n\n_No results found._\n';
  }

  const totalDuration = results.reduce((s, r) => s + r.durationMs, 0);
  const failed = results.filter((r) => r.status !== 'success');

  const sha = agg.essorSha?.slice(0, 7) ?? 'unknown';
  const ref = agg.essorRef ?? '';
  const refLabel = ref ? ` on \`${ref}\`` : '';
  const header =
    failed.length === 0
      ? `## :white_check_mark: essor ecosystem-ci passed \`${sha}\`${refLabel}`
      : `## :x: essor ecosystem-ci · \`${sha}\`${refLabel} · ${failed.length} failure(s)`;

  const rows = results
    .map((r) => `| \`${r.id}\` | ${statusBadge(r.status)} | ${formatDuration(r.durationMs)} |`)
    .join('\n');

  const table = ['| Suite | Status | Duration |', '|---|---|---|', rows].join('\n');

  const details = failed
    .map((r) => {
      const failingStep = r.steps.find((s) => !s.ok);
      const stepLine = failingStep
        ? `\`${failingStep.cmd}\` (exit ${failingStep.exitCode})`
        : (r.setupError ?? 'unknown');
      const tail = failingStep?.tail ?? '';
      return [
        `<details><summary>:x: <code>${r.id}</code> — ${stepLine}</summary>`,
        '',
        '```',
        tail.trim() || '(no output captured)',
        '```',
        '',
        '</details>',
      ].join('\n');
    })
    .join('\n\n');

  return `${[
    header,
    '',
    `Total runtime: ${formatDuration(totalDuration)} · ${results.length} suite(s)`,
    '',
    table,
    details ? `\n${details}\n` : '',
  ]
    .join('\n')
    .trimEnd()}\n`;
}

function main() {
  const agg = loadAggregate();
  const md = renderMarkdown(agg);

  const commentPath = resolve(WORKSPACE, 'comment.md');
  writeFileSync(commentPath, md);
  console.warn(`[ecosystem-ci] wrote ${commentPath}`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
    console.warn('[ecosystem-ci] appended to GITHUB_STEP_SUMMARY');
  } else {
    console.warn('\n----- markdown report -----\n');
    console.warn(md);
  }

  const hasFailure = agg.results.some((r) => r.status !== 'success');
  process.exit(hasFailure ? 1 : 0);
}

// Only run when invoked directly (`tsx aggregate.ts`), not when imported by tests.
if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main();
}
