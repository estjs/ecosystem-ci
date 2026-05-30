import type { Suite } from './utils/runSuite';

export const SUITES: Suite[] = [
  {
    id: 'essor-router',
    source: { type: 'git', repo: 'https://github.com/estjs/essor-router.git' },
    commands: ['pnpm typecheck', 'pnpm test'],
  },
  {
    id: 'athen',
    source: { type: 'git', repo: 'https://github.com/estjs/athen.git' },
    commands: ['pnpm build', 'pnpm test'],
  },
  {
    id: 'test-utils',
    source: { type: 'git', repo: 'https://github.com/estjs/test-utils.git' },
    commands: ['pnpm typecheck', 'pnpm test', 'pnpm build'],
  },
];

export const ALL_SUITE_IDS = SUITES.map((s) => s.id);

export function findSuite(id: string): Suite | undefined {
  return SUITES.find((s) => s.id === id);
}
