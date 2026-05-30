import { writeFileSync } from 'node:fs';

/** Auth token written into generated .npmrc files. Verdaccio accepts any value. */
const AUTH_TOKEN = 'ecosystem-ci';

/**
 * Write an `.npmrc` pointing at the Verdaccio registry with a dummy auth token.
 * `extraLines` appends registry-specific options (publish vs. install differ).
 */
export function writeNpmrc(filePath: string, registryUrl: string, extraLines: string[] = []): void {
  const noScheme = registryUrl.replace(/^https?:/, '');
  const lines = [`registry=${registryUrl}`, `${noScheme}:_authToken=${AUTH_TOKEN}`, ...extraLines];
  writeFileSync(filePath, `${lines.join('\n')}\n`);
}
