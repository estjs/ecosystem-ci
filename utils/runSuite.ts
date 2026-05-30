import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import yaml from 'js-yaml';
import { capture } from './exec';
import { writeNpmrc } from './npmrc';
import { WORKSPACE } from './paths';
import { ESSOR_PACKAGES } from './versions';

export type SuiteSource =
  | { type: 'local'; root: string; subpath?: string }
  | { type: 'git'; repo: string; ref?: string; subpath?: string };

export interface Suite {
  id: string;
  source: SuiteSource;
  commands: string[];
}

export interface StepResult {
  cmd: string;
  ok: boolean;
  exitCode: number;
  durationMs: number;
  tail: string;
}

export interface SuiteResult {
  id: string;
  status: 'success' | 'failure' | 'setup-failed';
  durationMs: number;
  steps: StepResult[];
  setupError?: string;
}

export interface RunSuiteOptions {
  registryUrl: string;
  ciVersion: string;
  essorRoot: string;
}

export async function runSuite(suite: Suite, opts: RunSuiteOptions): Promise<SuiteResult> {
  const started = Date.now();
  const workRoot = resolve(WORKSPACE, suite.id);
  const subpath = suite.source.subpath;
  const workDir = subpath ? resolve(workRoot, subpath) : workRoot;

  try {
    await prepareWorkdir(suite, workRoot, opts.essorRoot);
    // Overrides + registry must live at the workspace root (where the cloned
    // repo's own pnpm-workspace.yaml lives), not in the per-package subdir.
    injectOverrides(workRoot, opts.ciVersion);
    writeNpmrc(resolve(workRoot, '.npmrc'), opts.registryUrl, [
      'shamefully-hoist=false',
      'auto-install-peers=true',
      'strict-peer-dependencies=false',
    ]);
    rmSync(resolve(workRoot, 'pnpm-lock.yaml'), { force: true });
  } catch (error) {
    return {
      id: suite.id,
      status: 'setup-failed',
      durationMs: Date.now() - started,
      steps: [],
      setupError: error instanceof Error ? error.message : String(error),
    };
  }

  const installResult = await runCommand(
    workDir,
    'pnpm install --no-frozen-lockfile',
    opts.registryUrl,
  );
  if (!installResult.ok) {
    return {
      id: suite.id,
      status: 'failure',
      durationMs: Date.now() - started,
      steps: [installResult],
    };
  }

  const steps: StepResult[] = [installResult];
  for (const cmd of suite.commands) {
    const stepResult = await runCommand(workDir, cmd, opts.registryUrl);
    steps.push(stepResult);
    if (!stepResult.ok) {
      return {
        id: suite.id,
        status: 'failure',
        durationMs: Date.now() - started,
        steps,
      };
    }
  }

  return {
    id: suite.id,
    status: 'success',
    durationMs: Date.now() - started,
    steps,
  };
}

async function prepareWorkdir(suite: Suite, workRoot: string, essorRoot: string): Promise<void> {
  rmSync(workRoot, { recursive: true, force: true });
  mkdirSync(workRoot, { recursive: true });

  if (suite.source.type === 'local') {
    const src = resolve(essorRoot, suite.source.root);
    cpSync(src, workRoot, {
      recursive: true,
      filter: (s: string) => {
        const lower = s.toLowerCase();
        if (lower.endsWith('node_modules')) return false;
        if (lower.endsWith('/dist')) return false;
        if (lower.endsWith('/.turbo')) return false;
        if (lower.endsWith('/.cache')) return false;
        return true;
      },
    });
    return;
  }

  const cloneResult = await capture(
    'git',
    [
      'clone',
      '--depth',
      '1',
      ...(suite.source.ref ? ['--branch', suite.source.ref] : []),
      suite.source.repo,
      workRoot,
    ],
    { cwd: process.cwd() },
  );
  if (!cloneResult.ok) {
    throw new Error(`git clone failed:\n${cloneResult.tail}`);
  }
}

export function injectOverrides(workRoot: string, ciVersion: string): void {
  // Rewrite essor deps in the root manifest so version specs match the CI build.
  const manifestPath = resolve(workRoot, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, any>;
  rewriteEssorDeps(manifest.dependencies, ciVersion);
  rewriteEssorDeps(manifest.devDependencies, ciVersion);
  rewriteEssorDeps(manifest.peerDependencies, ciVersion);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  // pnpm 10 no longer reads `pnpm.overrides` from package.json — overrides must
  // live in pnpm-workspace.yaml. Force every essor package (including transitive
  // ones pulled by the suite's own deps) to resolve to the CI version.
  const wsPath = resolve(workRoot, 'pnpm-workspace.yaml');
  const ws = (existsSync(wsPath) ? (yaml.load(readFileSync(wsPath, 'utf8')) ?? {}) : {}) as Record<
    string,
    any
  >;

  ws.overrides = ws.overrides ?? {};
  for (const pkg of ESSOR_PACKAGES) {
    ws.overrides[pkg] = ciVersion;
  }
  writeFileSync(wsPath, yaml.dump(ws));
}

function rewriteEssorDeps(deps: Record<string, string> | undefined, ciVersion: string): void {
  if (!deps) return;
  for (const pkg of ESSOR_PACKAGES) {
    if (pkg in deps) deps[pkg] = ciVersion;
  }
}

async function runCommand(workDir: string, cmd: string, registryUrl: string): Promise<StepResult> {
  const started = Date.now();
  // shell: true runs `cmd` through the platform shell (/bin/sh on Unix,
  // cmd.exe on Windows), so suite commands like `pnpm test` stay portable.
  const result = await capture(cmd, [], {
    cwd: workDir,
    shell: true,
    env: {
      ...process.env,
      CI: 'true',
      ECOSYSTEM_CI: 'essor',
      // Force the Verdaccio registry via env too. The suite's .npmrc also sets
      // it, but the env var guarantees it wins regardless of any registry
      // config the cloned repo ships with.
      npm_config_registry: registryUrl,
    },
  });
  return {
    cmd,
    ok: result.ok,
    exitCode: result.exitCode,
    durationMs: Date.now() - started,
    tail: result.tail,
  };
}
