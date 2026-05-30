import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { run } from './exec';
import { writeNpmrc } from './npmrc';
import { WORKSPACE } from './paths';
import { ESSOR_PACKAGES, type EssorPackage } from './versions';

interface PkgManifest {
  name: string;
  version: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface PackageLocation {
  name: EssorPackage;
  dir: string;
  manifestPath: string;
  originalManifest: string;
}

function listPackages(essorRoot: string): PackageLocation[] {
  const packagesDir = resolve(essorRoot, 'packages');
  const dirs = readdirSync(packagesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const locations: PackageLocation[] = [];
  for (const dir of dirs) {
    const manifestPath = resolve(packagesDir, dir, 'package.json');
    try {
      const raw = readFileSync(manifestPath, 'utf8');
      const manifest: PkgManifest = JSON.parse(raw);
      if (!ESSOR_PACKAGES.includes(manifest.name as EssorPackage)) continue;
      locations.push({
        name: manifest.name as EssorPackage,
        dir: resolve(packagesDir, dir),
        manifestPath,
        originalManifest: raw,
      });
    } catch {
      // Skip directories without valid package.json
      continue;
    }
  }

  const missing = ESSOR_PACKAGES.filter((name) => !locations.some((loc) => loc.name === name));
  if (missing.length) {
    throw new Error(
      `ecosystem-ci: missing packages in essor checkout: ${missing.join(', ')}. ` +
        `Expected all 7 essor packages under ${packagesDir}/*.`,
    );
  }
  return locations;
}

/**
 * Bump every essor package in the checkout to `ciVersion` and publish them to
 * Verdaccio. The original manifests are restored via `registerCleanup`, which
 * the driver runs on completion, crash, or interrupt — so signal handling stays
 * centralized in ecosystem-ci.ts rather than spread across modules.
 */
export function publishAllToVerdaccio(
  essorRoot: string,
  registryUrl: string,
  ciVersion: string,
  registerCleanup: (fn: () => void) => void,
): void {
  const locations = listPackages(essorRoot);

  registerCleanup(() => {
    for (const loc of locations) {
      writeFileSync(loc.manifestPath, loc.originalManifest);
    }
  });

  for (const loc of locations) {
    const manifest: PkgManifest = JSON.parse(loc.originalManifest);
    manifest.version = ciVersion;
    writeFileSync(loc.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  mkdirSync(WORKSPACE, { recursive: true });
  const userconfigPath = resolve(WORKSPACE, '.npmrc.publish');
  writeNpmrc(userconfigPath, registryUrl, ['always-auth=true']);

  run(
    'pnpm',
    [
      '-r',
      '--filter',
      './packages/*',
      'publish',
      '--registry',
      registryUrl,
      '--no-git-checks',
      '--tag',
      'ci',
      '--access',
      'public',
    ],
    'pnpm publish (essor)',
    {
      cwd: essorRoot,
      env: {
        ...process.env,
        npm_config_registry: registryUrl,
        npm_config_userconfig: userconfigPath,
      },
    },
  );
}
