import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeNpmrc } from '../utils/npmrc';

describe('writeNpmrc', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(resolve(tmpdir(), 'npmrc-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes the registry and a scheme-stripped auth token line', () => {
    const file = resolve(dir, '.npmrc');
    writeNpmrc(file, 'http://localhost:4873/');
    const content = readFileSync(file, 'utf8');
    expect(content).toContain('registry=http://localhost:4873/');
    expect(content).toContain('//localhost:4873/:_authToken=ecosystem-ci');
    expect(content.endsWith('\n')).toBe(true);
  });

  it('strips https as well as http from the auth token key', () => {
    const file = resolve(dir, '.npmrc');
    writeNpmrc(file, 'https://registry.example.com/');
    expect(readFileSync(file, 'utf8')).toContain('//registry.example.com/:_authToken=ecosystem-ci');
  });

  it('appends extra lines after the core lines', () => {
    const file = resolve(dir, '.npmrc');
    writeNpmrc(file, 'http://localhost:4873/', ['always-auth=true', 'auto-install-peers=true']);
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines.slice(2)).toEqual(['always-auth=true', 'auto-install-peers=true']);
  });
});
