import process from 'node:process';

export const ESSOR_PACKAGES = [
  'essor',
  '@estjs/server',
  '@estjs/shared',
  '@estjs/signals',
  '@estjs/template',
  'unplugin-essor',
  'babel-plugin-essor',
] as const;

export type EssorPackage = (typeof ESSOR_PACKAGES)[number];

export function buildCiVersion(essorSha?: string): string {
  // Prefer the *essor* sha we're testing, not the ecosystem-ci repo's sha.
  // GITHUB_SHA at runtime is essor-ecosystem-ci's sha and is meaningless to
  // downstream consumers.
  const sha = essorSha?.slice(0, 7);
  const tag = sha || `local-${Date.now().toString(36)}`;
  return `0.0.0-ci-${tag}`;
}

export function detectEssorRef(): string {
  return process.env.ESSOR_REF || process.env.INPUT_REF || 'main';
}
