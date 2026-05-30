import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only our own tests. `workspace/` (cloned downstream repos) and `storage/`
    // (verdaccio package cache) contain thousands of foreign test files that
    // must never be collected.
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
