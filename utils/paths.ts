import { resolve } from 'node:path';

export const REPO_ROOT = resolve(import.meta.dirname, '..');
export const WORKSPACE = resolve(REPO_ROOT, 'workspace');
export const ESSOR_CHECKOUT = resolve(WORKSPACE, '.essor');
export const VERDACCIO_CONFIG = resolve(REPO_ROOT, 'verdaccio.yaml');
export const VERDACCIO_STORAGE = resolve(WORKSPACE, '.verdaccio');
export const ESSOR_REPO_URL = 'https://github.com/estjs/essor.git';
