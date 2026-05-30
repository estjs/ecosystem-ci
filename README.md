# essor-ecosystem-ci

**English** · [简体中文](README.zh-CN.md)

Integration test runner for the [essor](https://github.com/estjs/essor) ecosystem — it answers one question: *"I changed essor, who downstream breaks?"* Inspired by [vuejs/ecosystem-ci](https://github.com/vuejs/ecosystem-ci).

It builds the essor commit you point it at, publishes the packages to a throwaway local registry, then installs and tests each downstream project (router, athen, test-utils, …) against that exact build — and aggregates everything into a single Markdown report.

## Quick start

```bash
pnpm install

pnpm test                                    # all suites against essor main
pnpm test --suite essor-router               # one suite
pnpm test --suite essor-router --ref feat/x  # a specific essor ref
pnpm test --suite athen --no-build           # reuse the cached essor build
pnpm test --suite athen --port 4881          # use a different Verdaccio port
pnpm report                                  # render the Markdown report
```

The first run clones and fully builds essor (a few minutes). It's then cached in `workspace/.essor/`, so later runs with `--no-build` are fast. To force a rebuild, delete that directory.

> **Requirements:** Node ≥ 20.11 (CI uses 24.x) · pnpm 10.x (must match the `packageManager` field) · git. pnpm 10 behavior is assumed — overrides are written to `pnpm-workspace.yaml`, which pnpm 9 and earlier ignore.

## CLI

Flags follow `pnpm test` (equivalent to `tsx ecosystem-ci.ts`):

| Flag | Default | Meaning |
|---|---|---|
| `--suite <id>` / `<id>` | — | Suite to run; repeatable. A bare id is treated as positional |
| `--all` | — | Add every configured suite |
| `--ref <ref>` | `main` | essor branch / tag / sha to test |
| `--no-build` | off | Skip rebuilding essor; reuse the cached checkout + dist |
| `--port <n>` | `4873` | Verdaccio listen port |

With no suite given, all suites run. Any unrecognized `--flag` is a hard error.

- **Ref resolution:** `--ref` › `$ESSOR_REF` › `$INPUT_REF` › `main`.
- **CI version:** `0.0.0-ci-<sha7>` (e.g. `0.0.0-ci-f2c6459`), or `0.0.0-ci-local-<base36 time>` when no sha is known.
- **Report sink:** if `$GITHUB_STEP_SUMMARY` is set, `pnpm report` appends the report there; otherwise it prints to stdout.

## How it works

Each stage maps to a module (`ecosystem-ci.ts` → `utils/*`):

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Prepare essor      utils/essor.ts                          │
│    clone/fetch ref → pnpm install → pnpm run build            │
│    (build runs gen:version → packages/core/src/version.ts)    │
├─────────────────────────────────────────────────────────────┤
│ 2. Start Verdaccio    utils/verdaccio.ts                      │
│    local private registry, default http://localhost:4873/     │
├─────────────────────────────────────────────────────────────┤
│ 3. Publish 7 packages utils/publish.ts                        │
│    versions rewritten to 0.0.0-ci-<sha7>, pushed to registry  │
├─────────────────────────────────────────────────────────────┤
│ 4. Run each suite     utils/runSuite.ts                       │
│    clone downstream → inject overrides → point at Verdaccio   │
│    → pnpm install → run suite.commands in order               │
├─────────────────────────────────────────────────────────────┤
│ 5. Aggregate          aggregate.ts                            │
│    collect result-*.json → render Markdown → comment.md       │
└─────────────────────────────────────────────────────────────┘
```

The driver pins the essor **sha** (via `git rev-parse HEAD`) right after cloning, so a force-push mid-run can't change what was tested — the pinned sha appears in the report.

## Suites

| Suite | Repo | Commands |
|---|---|---|
| `essor-router` | [estjs/essor-router](https://github.com/estjs/essor-router) | `pnpm typecheck` → `pnpm test` |
| `athen` | [estjs/athen](https://github.com/estjs/athen) | `pnpm build` → `pnpm test` |
| `test-utils` | [estjs/test-utils](https://github.com/estjs/test-utils) | `pnpm typecheck` → `pnpm test` → `pnpm build` |

### Add a downstream

1. Append a `Suite` to `SUITES` in `config.ts`:

   ```ts
   const suite: Suite = {
     id: 'my-repo',
     source: { type: 'git', repo: 'https://github.com/foo/bar.git', ref: 'main' },
     commands: ['pnpm test'],
   };
   ```

2. Add `my-repo` to the `matrix.suite` list in `.github/workflows/ecosystem-ci.yml`. **Config and workflow must stay in sync**, or CI fails with `unknown suite`.

A suite has three fields: `id` (unique; selects the suite and names its output file), `source`, and `commands` (run **in order** — the first failure marks the suite `failure`). `source` is one of:

```ts
type SuiteSource =
  | { type: 'git'; repo: string; ref?: string; subpath?: string } // remote repo
  | { type: 'local'; root: string; subpath?: string }; // dir in the essor checkout
```

`ref` pins the downstream branch/tag; `subpath` runs commands in `workRoot/subpath` (a monorepo subpackage); `local` `root` is relative to the essor checkout. Any essor-family dependency in the downstream (`dependencies` / `devDependencies` / `peerDependencies`) is rewritten to the CI version automatically — no manual edits needed.

## Output

Everything lands under `workspace/`:

| Path | Contents |
|---|---|
| `result.json` | Aggregate: `ciVersion` / `essorSha` / `essorRef` + all suite results |
| `result-<suite>.json` | A single suite's result (one per CI matrix job) |
| `comment.md` | The Markdown report from `pnpm report` |
| `.essor/` | Cached essor checkout (kept across runs for speed) |
| `.verdaccio/` | Verdaccio storage (wiped each run) |
| `<suite>/` | Working copy of each suite |

A suite's `status` is `success` (install + all commands passed), `failure` (install or a command failed — `steps` records which, its exit code, and an output tail), or `setup-failed` (the prepare stage threw — see `setupError`).

## CI

`.github/workflows/ecosystem-ci.yml` runs the downstream suites:

- **Scheduled:** Mon / Wed / Fri at 05:13 UTC against `main`.
- **Manual** (`workflow_dispatch`): `ref` (essor branch/tag/sha, default `main`), `suite` (one id; empty = run all), `pr_number` (PR in `estjs/essor` to comment on).

One matrix job per suite gives parallelism and clean failure isolation; a final `report` job downloads all artifacts and posts a combined comment. The report looks like:

```markdown
## ❌ essor ecosystem-ci · `f2c6459` on `main` · 1 failure(s)

Total runtime: 104.6s · 3 suite(s)

| Suite | Status | Duration |
|---|---|---|
| `essor-router` | ❌ fail | 37.6s |
| `athen` | ✅ pass | 45.2s |
| `test-utils` | ✅ pass | 21.9s |

<details><summary>❌ essor-router — `pnpm typecheck` (exit 2)</summary>
…tail of the failing command's output…
</details>
```

### Cross-repo PR comments

With `pr_number`, the `report` job posts a sticky comment to `estjs/essor#<pr>`. This needs a PAT with **Issues:Write** on `estjs/essor`, stored as the secret **`ESSOR_PR_TOKEN`**; without it the step is skipped silently. The reverse trigger (`/ecosystem-ci run` on an essor PR → this workflow) lives in `estjs/essor`'s `ecosystem-ci-comment.yml` and uses a token stored there as `ECOSYSTEM_CI_PAT`. One PAT can serve both if it has `actions: write` on this repo and `issues: write` on `estjs/essor` (a classic `repo` + `workflow` PAT works; fine-grained PATs need both explicitly).

## Design notes

- **Verdaccio over `pkg.pr.new`.** One devDep and a YAML config — no external account or GitHub App, debuggable offline. Swapping to continuous releases later means replacing `utils/publish.ts` with a registry adapter.
- **Publish all 7 packages.** A downstream depends on a subset, but an override only takes effect when it matches a dependency that actually exists. Publishing all 7 is cheap and forgiving.
- **Overrides live in `pnpm-workspace.yaml`.** pnpm 10 no longer reads `pnpm.overrides` from `package.json`. The runner merges the 7 overrides into each suite's root `pnpm-workspace.yaml`, forcing every essor package — transitive ones included — to the CI version. The essor checkout's own nested `workspace/` is removed before install so it can't capture this repo's tree.
- **Registry forced two ways.** Each suite gets an `.npmrc` (`registry=…`) *and* runs with `npm_config_registry` set, so any registry config the downstream ships is overridden regardless.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `No matching version … from registry.npmjs.org` | Registry not pointed at Verdaccio — usually a hard-coded registry in the downstream. The runner sets both `.npmrc` and `npm_config_registry`; check neither was stripped. |
| essor build: `Could not resolve './version'` | Build via essor's root `build` (runs `gen:version` first); don't build `packages/*` directly. |
| `The "pnpm" field … is no longer read` | pnpm 10 dropped `pnpm.overrides` from `package.json`; overrides belong in `pnpm-workspace.yaml`. |
| monorepo downstream with `workspace:*` won't install | Don't use `--ignore-workspace`; the runner respects the downstream's `pnpm-workspace.yaml` and only merges overrides in. |
| rebuilding essor is slow | Run once, then add `--no-build`. Delete `workspace/.essor/` to force a rebuild. |
| a suite shows `failure` | Usually a real compatibility break, not a harness bug — read the collapsed output in `comment.md`. |

**Exit codes** — `pnpm test`: `0` all passed · `1` a suite failed · `2` the driver crashed. `pnpm report`: `0` all success · `1` any non-success (on CI this step uses `continue-on-error`, so the comment posts regardless).

## Developing this runner

```bash
pnpm lint        # eslint (@estjs/eslint-config)
pnpm typecheck   # tsc --noEmit
pnpm test:unit   # vitest run — unit tests in test/
```

`.github/workflows/ci.yml` runs all three on every push / PR to `main`. Unit tests cover the pure helpers (`config`, `versions`, `npmrc`, `exec`, `parseArgs`, `aggregate` rendering, override injection). The entry files (`ecosystem-ci.ts`, `aggregate.ts`) guard `main()` behind an `import.meta.url` check, so tests can import their helpers without executing the driver.
