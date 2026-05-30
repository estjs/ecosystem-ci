import { execSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from './exec';
import { ESSOR_CHECKOUT, ESSOR_REPO_URL, WORKSPACE } from './paths';

export interface EssorCheckout {
  root: string;
  sha: string;
}

export function prepareEssor(ref: string, skipBuild = false): EssorCheckout {
  mkdirSync(WORKSPACE, { recursive: true });

  if (existsSync(ESSOR_CHECKOUT)) {
    // Reuse existing clone — fetch + reset to requested ref. This makes local
    // iteration fast; CI checkouts start from a clean workspace anyway.
    run('git', ['fetch', '--depth', '50', 'origin', ref], 'git fetch', { cwd: ESSOR_CHECKOUT });
    run('git', ['reset', '--hard', 'FETCH_HEAD'], 'git reset', { cwd: ESSOR_CHECKOUT });
    run('git', ['clean', '-fdx'], 'git clean', { cwd: ESSOR_CHECKOUT });
  } else {
    run('git', ['clone', '--depth', '50', ESSOR_REPO_URL, ESSOR_CHECKOUT], 'git clone essor', {
      cwd: WORKSPACE,
    });
    run('git', ['fetch', '--depth', '50', 'origin', ref], 'git fetch ref', { cwd: ESSOR_CHECKOUT });
    run('git', ['checkout', 'FETCH_HEAD'], 'git checkout ref', { cwd: ESSOR_CHECKOUT });
  }

  const sha = execSync('git rev-parse HEAD', { cwd: ESSOR_CHECKOUT, encoding: 'utf8' }).trim();

  // Drop any leftover workspace dir inside essor so we don't recursively
  // shadow our own working tree if the clone overlaps.
  rmSync(resolve(ESSOR_CHECKOUT, 'workspace'), { recursive: true, force: true });

  // Inject `minimum-release-age=0` into the essor checkout's .npmrc so that
  // ALL subsequent pnpm calls — including the sub-process pnpm install that
  // turbo spawns for each package's deps-status check — skip the supply-chain
  // age policy. CI intentionally tests freshly-published commits, so the
  // policy would otherwise block builds whenever a dep was just released.
  appendFileSync(resolve(ESSOR_CHECKOUT, '.npmrc'), '\nminimum-release-age=0\n');

  // --config.minimumReleaseAge=0 is redundant now (covered by .npmrc above)
  // but kept for clarity: the top-level install also respects the flag.
  run(
    'pnpm',
    ['install', '--no-frozen-lockfile', '--config.minimumReleaseAge=0'],
    'pnpm install (essor)',
    { cwd: ESSOR_CHECKOUT },
  );

  if (!skipBuild) {
    // Use essor's own root `build` script rather than invoking the per-package
    // builds directly. The root script runs `gen:version` first, which writes
    // packages/core/src/version.ts — building the packages without it fails
    // with "Could not resolve './version'".
    run('pnpm', ['run', 'build'], 'pnpm build (essor)', { cwd: ESSOR_CHECKOUT });
  }

  return { root: ESSOR_CHECKOUT, sha };
}
