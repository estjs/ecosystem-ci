# essor-ecosystem-ci

[English](README.md) · **简体中文**

[essor](https://github.com/estjs/essor) 生态系统的集成测试运行器——它只回答一个问题:*"我改了 essor,下游谁会炸?"* 灵感来自 [vuejs/ecosystem-ci](https://github.com/vuejs/ecosystem-ci)。

它会构建你指定的 essor commit,把包发布到一个用完即弃的本地 registry,然后让每个下游项目(router、athen、test-utils……)针对这个确切的构建产物安装并测试,最后把一切汇总成一份 Markdown 报告。

## 快速开始

```bash
pnpm install

pnpm test                                    # 针对 essor main 运行所有 suite
pnpm test --suite essor-router               # 单个 suite
pnpm test --suite essor-router --ref feat/x  # 指定 essor ref
pnpm test --suite athen --no-build           # 复用缓存的 essor 构建
pnpm test --suite athen --port 4881          # 使用不同的 Verdaccio 端口
pnpm report                                  # 渲染 Markdown 报告
```

首次运行会克隆并完整构建 essor(几分钟),之后缓存在 `workspace/.essor/`,因此后续配合 `--no-build` 会很快。要强制重建,删掉该目录即可。

> **环境要求:** Node ≥ 20.11(CI 用 24.x) · pnpm 10.x(必须与 `packageManager` 字段一致) · git。本工具假定 pnpm 10 的行为——overrides 写在 `pnpm-workspace.yaml`,而 pnpm 9 及更早版本会忽略它。

## 命令行

参数跟在 `pnpm test`(等价于 `tsx ecosystem-ci.ts`)之后:

| 参数 | 默认 | 含义 |
|---|---|---|
| `--suite <id>` / `<id>` | — | 要运行的 suite,可重复;裸 id 视为位置参数 |
| `--all` | — | 添加全部已配置的 suite |
| `--ref <ref>` | `main` | 要测试的 essor 分支 / tag / sha |
| `--no-build` | 关 | 跳过重建 essor,复用缓存的 checkout + dist |
| `--port <n>` | `4873` | Verdaccio 监听端口 |

未指定 suite 时运行全部。任何无法识别的 `--flag` 都会直接报错。

- **ref 解析顺序:** `--ref` › `$ESSOR_REF` › `$INPUT_REF` › `main`。
- **CI 版本号:** `0.0.0-ci-<sha7>`(例如 `0.0.0-ci-f2c6459`),拿不到 sha 时为 `0.0.0-ci-local-<base36 时间戳>`。
- **报告去向:** 若设置了 `$GITHUB_STEP_SUMMARY`,`pnpm report` 会把报告追加到该文件;否则打印到 stdout。

## 工作原理

每个阶段对应一个模块(`ecosystem-ci.ts` → `utils/*`):

```
┌─────────────────────────────────────────────────────────────┐
│ 1. 准备 essor         utils/essor.ts                          │
│    clone/fetch ref → pnpm install → pnpm run build            │
│    (build 先跑 gen:version → packages/core/src/version.ts)    │
├─────────────────────────────────────────────────────────────┤
│ 2. 启动 Verdaccio     utils/verdaccio.ts                      │
│    本地私有 registry,默认 http://localhost:4873/             │
├─────────────────────────────────────────────────────────────┤
│ 3. 发布 7 个包        utils/publish.ts                        │
│    版本改写为 0.0.0-ci-<sha7>,推送到 registry                │
├─────────────────────────────────────────────────────────────┤
│ 4. 运行每个 suite     utils/runSuite.ts                       │
│    clone 下游 → 注入 overrides → 指向 Verdaccio →             │
│    pnpm install → 按顺序执行 suite.commands                   │
├─────────────────────────────────────────────────────────────┤
│ 5. 汇总               aggregate.ts                            │
│    收集 result-*.json → 渲染 Markdown → comment.md            │
└─────────────────────────────────────────────────────────────┘
```

驱动器在克隆后立即用 `git rev-parse HEAD` 钉住 essor 的 **sha**,因此运行中途的 force-push 无法改变被测内容——被钉住的 sha 会出现在报告里。

## Suites

| Suite | 仓库 | 命令 |
|---|---|---|
| `essor-router` | [estjs/essor-router](https://github.com/estjs/essor-router) | `pnpm typecheck` → `pnpm test` |
| `athen` | [estjs/athen](https://github.com/estjs/athen) | `pnpm build` → `pnpm test` |
| `test-utils` | [estjs/test-utils](https://github.com/estjs/test-utils) | `pnpm typecheck` → `pnpm test` → `pnpm build` |

### 新增一个下游

1. 在 `config.ts` 的 `SUITES` 中追加一个 `Suite`:

   ```ts
   const suite: Suite = {
     id: 'my-repo',
     source: { type: 'git', repo: 'https://github.com/foo/bar.git', ref: 'main' },
     commands: ['pnpm test'],
   };
   ```

2. 把 `my-repo` 加到 `.github/workflows/ecosystem-ci.yml` 的 `matrix.suite` 列表里。**config 与 workflow 必须保持同步**,否则 CI 会以 `unknown suite` 报错。

一个 suite 有三个字段:`id`(唯一,用于选择 suite 并命名其产物文件)、`source`、`commands`(**按顺序**执行——第一个失败即把该 suite 标记为 `failure`)。`source` 二选一:

```ts
type SuiteSource =
  | { type: 'git'; repo: string; ref?: string; subpath?: string } // 远程仓库
  | { type: 'local'; root: string; subpath?: string }; // essor checkout 内的目录
```

`ref` 钉住下游分支/tag;`subpath` 让命令在 `workRoot/subpath` 运行(monorepo 子包);`local` 的 `root` 相对于 essor checkout。下游中任何 essor 系列依赖(`dependencies` / `devDependencies` / `peerDependencies`)都会被自动改写为 CI 版本——无需手动编辑。

## 产物

所有产物都落在 `workspace/` 下:

| 路径 | 内容 |
|---|---|
| `result.json` | 汇总:`ciVersion` / `essorSha` / `essorRef` + 全部 suite 结果 |
| `result-<suite>.json` | 单个 suite 的结果(每个 CI matrix job 一份) |
| `comment.md` | `pnpm report` 生成的 Markdown 报告 |
| `.essor/` | 缓存的 essor checkout(跨运行保留以提速) |
| `.verdaccio/` | Verdaccio 存储(每次运行清空) |
| `<suite>/` | 每个 suite 的工作副本 |

suite 的 `status` 为 `success`(install 与全部命令通过)、`failure`(install 或某命令失败——`steps` 记录是哪条、其退出码及输出末尾片段)或 `setup-failed`(准备阶段抛错——见 `setupError`)。

## CI

`.github/workflows/ecosystem-ci.yml` 运行下游 suite:

- **定时:** 每周一 / 三 / 五 UTC 05:13,针对 `main`。
- **手动**(`workflow_dispatch`):`ref`(essor 分支/tag/sha,默认 `main`)、`suite`(单个 id,留空 = 全跑)、`pr_number`(要评论的 `estjs/essor` PR 编号)。

每个 suite 一个 matrix job,带来并行与清晰的失败隔离;最后一个 `report` job 下载所有产物并发布合并后的评论。报告形如:

```markdown
## ❌ essor ecosystem-ci · `f2c6459` on `main` · 1 failure(s)

Total runtime: 104.6s · 3 suite(s)

| Suite | Status | Duration |
|---|---|---|
| `essor-router` | ❌ fail | 37.6s |
| `athen` | ✅ pass | 45.2s |
| `test-utils` | ✅ pass | 21.9s |

<details><summary>❌ essor-router — `pnpm typecheck` (exit 2)</summary>
…失败命令的输出末尾片段…
</details>
```

### 跨仓库 PR 评论

带 `pr_number` 时,`report` job 会向 `estjs/essor#<pr>` 发布固定评论。这需要一个对 `estjs/essor` 拥有 **Issues:Write** 的 PAT,存为 secret **`ESSOR_PR_TOKEN`**;没有它时该步骤被静默跳过。反向触发(在 essor PR 评论 `/ecosystem-ci run` → 本工作流)位于 `estjs/essor` 的 `ecosystem-ci-comment.yml`,使用存在那边、名为 `ECOSYSTEM_CI_PAT` 的 token。单个 PAT 若同时拥有对本仓库的 `actions: write` 和对 `estjs/essor` 的 `issues: write`,即可身兼两职(经典 `repo` + `workflow` PAT 即可;细粒度 PAT 需两处分别显式授权)。

## 设计说明

- **用 Verdaccio 而非 `pkg.pr.new`。** 只需一个 devDep 加一份 YAML 配置——无需外部账号或 GitHub App,离线可调试。将来要换成消费持续发布版本,只需把 `utils/publish.ts` 换成 registry 适配器。
- **发布全部 7 个包。** 下游只依赖其中一部分,但 override 只有匹配到**确实存在**的依赖时才生效。7 个全发,成本低又稳妥。
- **overrides 放在 `pnpm-workspace.yaml`。** pnpm 10 不再读 `package.json` 里的 `pnpm.overrides`。运行器把 7 个 override 合并进每个 suite 根目录的 `pnpm-workspace.yaml`,强制每个 essor 包(含传递依赖)都到 CI 版本。install 前会先删掉 essor checkout 自带的内嵌 `workspace/`,使其无法捕获本仓库的目录树。
- **registry 双重强制。** 每个 suite 既生成 `.npmrc`(`registry=…`),又在运行时设置 `npm_config_registry`,无论下游自带什么 registry 配置都会被覆盖。

## 故障排查

| 现象 | 原因 / 修复 |
|---|---|
| `No matching version … from registry.npmjs.org` | registry 没指向 Verdaccio——通常是下游里硬编码的 registry。运行器会同时设置 `.npmrc` 和 `npm_config_registry`,检查二者是否被剥掉。 |
| essor 构建 `Could not resolve './version'` | 走 essor 的根 `build`(它先跑 `gen:version`);不要直接构建 `packages/*`。 |
| `The "pnpm" field … is no longer read` | pnpm 10 弃用了 `package.json` 里的 `pnpm.overrides`;overrides 应放在 `pnpm-workspace.yaml`。 |
| 带 `workspace:*` 的 monorepo 下游装不上 | 不要用 `--ignore-workspace`;运行器尊重下游的 `pnpm-workspace.yaml`,只合并 overrides。 |
| 重建 essor 太慢 | 先跑一次,之后加 `--no-build`。删 `workspace/.essor/` 可强制重建。 |
| 某个 suite 显示 `failure` | 多半是真实的兼容性破坏而非 harness bug——看 `comment.md` 里折叠的输出。 |

**退出码** —— `pnpm test`:`0` 全部通过 · `1` 某 suite 失败 · `2` 驱动器崩溃。`pnpm report`:`0` 全部 success · `1` 存在非 success(CI 上该步骤用 `continue-on-error`,因此评论照常发布)。

## 开发本运行器

```bash
pnpm lint        # eslint(@estjs/eslint-config)
pnpm typecheck   # tsc --noEmit
pnpm test:unit   # vitest run —— test/ 下的单元测试
```

`.github/workflows/ci.yml` 在每次 push / 向 `main` 的 PR 上运行这三道关卡。单元测试覆盖纯函数辅助模块(`config`、`versions`、`npmrc`、`exec`、`parseArgs`、`aggregate` 渲染、override 注入)。入口文件(`ecosystem-ci.ts`、`aggregate.ts`)用 `import.meta.url` 判断守卫 `main()`,因此测试可导入其辅助函数而不触发驱动器执行。
