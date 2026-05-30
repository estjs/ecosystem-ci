import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { ALL_SUITE_IDS, findSuite } from './config';
import { prepareEssor } from './utils/essor';
import { WORKSPACE } from './utils/paths';
import { publishAllToVerdaccio } from './utils/publish';
import { type SuiteResult, runSuite } from './utils/runSuite';
import { startVerdaccio } from './utils/verdaccio';
import { buildCiVersion, detectEssorRef } from './utils/versions';

export interface ParsedArgs {
  suiteIds: string[];
  essorRef: string;
  skipBuild: boolean;
  port: number;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    suiteIds: [],
    essorRef: detectEssorRef(),
    skipBuild: false,
    port: 4873,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--suite') {
      const next = argv[++i];
      if (!next) throw new Error('--suite requires a value');
      args.suiteIds.push(next);
    } else if (a === '--ref') {
      const next = argv[++i];
      if (!next) throw new Error('--ref requires a value');
      args.essorRef = next;
    } else if (a === '--no-build') {
      args.skipBuild = true;
    } else if (a === '--port') {
      const next = argv[++i];
      if (!next) throw new Error('--port requires a value');
      args.port = Number(next);
    } else if (a === '--all') {
      args.suiteIds.push(...ALL_SUITE_IDS);
    } else if (a.startsWith('--')) {
      throw new Error(`unknown flag: ${a}`);
    } else {
      args.suiteIds.push(a);
    }
  }
  if (args.suiteIds.length === 0) args.suiteIds.push(...ALL_SUITE_IDS);
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const suites = args.suiteIds.map((id) => {
    const suite = findSuite(id);
    if (!suite) {
      throw new Error(`unknown suite: ${id}. Available: ${ALL_SUITE_IDS.join(', ')}`);
    }
    return suite;
  });

  mkdirSync(WORKSPACE, { recursive: true });

  console.warn(`[ecosystem-ci] preparing essor @ ${args.essorRef}...`);
  const essor = prepareEssor(args.essorRef, args.skipBuild);
  console.warn(`[ecosystem-ci] essor checked out at ${essor.sha.slice(0, 7)}`);

  const ciVersion = buildCiVersion(essor.sha);
  console.warn(`[ecosystem-ci] CI version = ${ciVersion}`);

  console.warn('[ecosystem-ci] starting verdaccio...');
  const verdaccio = await startVerdaccio(args.port);
  console.warn(`[ecosystem-ci] verdaccio listening on ${verdaccio.url}`);

  const cleanups: Array<() => void | Promise<void>> = [];
  cleanups.push(() => verdaccio.stop());

  let cleanedUp = false;
  const runCleanups = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    for (const c of cleanups.reverse()) {
      try {
        await c();
      } catch (error) {
        console.error('[ecosystem-ci] cleanup error:', error);
      }
    }
  };

  // Centralize signal handling here so an interrupt tears down *everything*
  // (verdaccio process + manifest restore), not just whatever module happened
  // to install the last handler. Modules register cleanups into `cleanups`.
  const onSignal = (signal: NodeJS.Signals) => async () => {
    console.warn(`\n[ecosystem-ci] received ${signal}, cleaning up...`);
    await runCleanups();
    process.exit(130);
  };
  process.once('SIGINT', onSignal('SIGINT'));
  process.once('SIGTERM', onSignal('SIGTERM'));

  let exitCode = 0;
  try {
    publishAllToVerdaccio(essor.root, verdaccio.url, ciVersion, (fn) => cleanups.push(fn));

    const results: SuiteResult[] = [];
    for (const suite of suites) {
      console.warn(`\n[ecosystem-ci] === suite: ${suite.id} ===`);
      const result = await runSuite(suite, {
        registryUrl: verdaccio.url,
        ciVersion,
        essorRoot: essor.root,
      });
      results.push(result);
      console.warn(
        `[ecosystem-ci] ${suite.id}: ${result.status} (${(result.durationMs / 1000).toFixed(1)}s)`,
      );

      writeFileSync(
        resolve(WORKSPACE, `result-${suite.id}.json`),
        JSON.stringify(
          { ciVersion, essorSha: essor.sha, essorRef: args.essorRef, results: [result] },
          null,
          2,
        ),
      );
    }

    writeFileSync(
      resolve(WORKSPACE, 'result.json'),
      JSON.stringify({ ciVersion, essorSha: essor.sha, essorRef: args.essorRef, results }, null, 2),
    );

    const failed = results.filter((r) => r.status !== 'success');
    if (failed.length) {
      console.error(`\n[ecosystem-ci] FAILED: ${failed.length}/${results.length} suite(s)`);
      for (const r of failed) {
        console.error(`  - ${r.id}: ${r.status}`);
      }
      exitCode = 1;
    } else {
      console.warn(`\n[ecosystem-ci] SUCCESS: ${results.length}/${results.length} suite(s)`);
    }
  } catch (error) {
    console.error('[ecosystem-ci] driver crashed:', error);
    exitCode = 2;
  } finally {
    await runCleanups();
  }

  process.exit(exitCode);
}

// Only run when invoked directly (`tsx ecosystem-ci.ts`), not when imported by tests.
if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exit(2);
  }
}
