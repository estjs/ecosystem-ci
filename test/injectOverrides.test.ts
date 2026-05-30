import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { injectOverrides } from '../utils/runSuite';

const CI_VERSION = '0.0.0-ci-abcdef0';

describe('injectOverrides', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(resolve(tmpdir(), 'overrides-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writePkg(pkg: Record<string, unknown>): void {
    writeFileSync(resolve(dir, 'package.json'), JSON.stringify(pkg, null, 2));
  }
  function readWorkspace(): Record<string, any> {
    return yaml.load(readFileSync(resolve(dir, 'pnpm-workspace.yaml'), 'utf8')) as Record<
      string,
      any
    >;
  }

  it('rewrites essor deps to the CI version and leaves other deps untouched', () => {
    writePkg({
      name: 'suite',
      dependencies: { essor: '^1.0.0', lodash: '^4.0.0' },
      devDependencies: { 'unplugin-essor': '^1.0.0' },
    });
    injectOverrides(dir, CI_VERSION);

    const pkg = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8'));
    expect(pkg.dependencies.essor).toBe(CI_VERSION);
    expect(pkg.dependencies.lodash).toBe('^4.0.0');
    expect(pkg.devDependencies['unplugin-essor']).toBe(CI_VERSION);
  });

  it('does not add essor deps that were not already present', () => {
    writePkg({ name: 'suite', dependencies: { essor: '^1.0.0' } });
    injectOverrides(dir, CI_VERSION);
    const pkg = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8'));
    expect(pkg.dependencies['@estjs/signals']).toBeUndefined();
  });

  it('writes pnpm-workspace.yaml overrides for every essor package', () => {
    writePkg({ name: 'suite' });
    injectOverrides(dir, CI_VERSION);
    const ws = readWorkspace();
    expect(ws.overrides.essor).toBe(CI_VERSION);
    expect(ws.overrides['@estjs/template']).toBe(CI_VERSION);
    expect(ws.overrides['babel-plugin-essor']).toBe(CI_VERSION);
  });

  it('merges into an existing pnpm-workspace.yaml without dropping keys', () => {
    writePkg({ name: 'suite' });
    writeFileSync(
      resolve(dir, 'pnpm-workspace.yaml'),
      yaml.dump({ packages: ['packages/*'], overrides: { 'left-pad': '1.0.0' } }),
    );
    injectOverrides(dir, CI_VERSION);
    const ws = readWorkspace();
    expect(ws.packages).toEqual(['packages/*']);
    expect(ws.overrides['left-pad']).toBe('1.0.0');
    expect(ws.overrides.essor).toBe(CI_VERSION);
  });
});
