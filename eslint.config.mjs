import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { FlatCompat } from '@eslint/eslintrc'
import eslintConfigPrettier from 'eslint-config-prettier'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const compat = new FlatCompat({
  baseDirectory: __dirname,
})

/**
 * 「引擎不得 import React」这条硬约束的机械执法处。
 *
 * 为什么用 lint 而不是 code review：这条约束的价值恰恰在于**它不许被忘记**，
 * 而人 review 时的注意力是最不可靠的东西。写进 lint 之后，违反它的代价
 * 从"某天在 W3 发现引擎里混进了 hook"变成"当场提交不过闸门"。
 *
 * 三条各管一段：
 * - `react` / `next/*`：分层约束本身
 * - `@/components/**`：不许反向依赖（组件是引擎的消费者，不是它的部件）
 * - `window` / `document` / `localStorage`：DOM 事实。禁了它们，
 *   「一个 node 脚本要能跑完整本生成」才是**类型与 lint 层面成立**的事实，
 *   而不是"这次碰巧没用到"。
 */
const PURE_ENGINE_FILES = [
  'src/lib/engine/**/*.ts',
  'src/lib/schemas/**/*.ts',
  'src/lib/prompts/**/*.ts',
]

/**
 * 「客户端不许把引擎整包拖进 bundle」这条的机械执法处。
 *
 * 实测过的事故（W2，`/create` 第一次编译）：
 *
 * ```
 * src/lib/creation/state.ts → @/lib/engine/index.ts → providers/stores.ts → node:fs/promises
 * ⨯ Module build failed: UnhandledSchemeError: Reading from "node:fs/promises"
 *   is not handled by plugins
 * ```
 *
 * 起因只是"从 index 里取一个 `AGE_BANDS` 常量"。而 index 是引擎的公共入口，
 * 它把 registry / providers / 存储适配器一起带进来——那些是**服务端**的东西。
 * 手动修一次只能修这一次；写成规则之后，下一处同样的 import 当场过不了闸门。
 *
 * ★ 这条不改分层约定，是把它说清楚：**引擎对 UI 的接口分两半**——
 *   · 跑一本（`runBook` / `createProviders` / 卡存储）：只在服务端用，走 `engine/index.ts`
 *   · 事件协议与领域常量（`events.ts` / `domain.ts`）：浏览器安全，**直接从叶子模块取**
 *   两半都是引擎的接口，只是生命周期不同。
 */
const CLIENT_LAYERS = [
  'src/components/**/*.tsx',
  'src/components/**/*.ts',
  'src/lib/creation/**/*.ts',
]

const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    files: CLIENT_LAYERS,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/lib/engine/index.ts', '*/engine/index.ts'],
              message:
                '客户端层不许 import engine/index（它会把 providers 与 node:fs 拖进浏览器 bundle）。' +
                '要事件协议或领域常量请从 @/lib/engine/events.ts 或 @/lib/engine/domain.ts 取；' +
                '要跑一本书请放到 Route Handler 里',
            },
          ],
        },
      ],
    },
  },
  {
    files: PURE_ENGINE_FILES,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react',
              message:
                '引擎层禁止 import React：lib/engine 必须能被 node 脚本直接跑（CLAUDE.md 四条硬约束之一）',
            },
            { name: 'react-dom', message: '引擎层禁止 import React' },
          ],
          patterns: [
            {
              group: ['next/*', '@/components/**', 'server-only'],
              message:
                '引擎层禁止：next/*（运行时专属，读 env 请走 providers/registry 的参数）、@/components/**（反向依赖）、server-only（引擎要同时在 node 脚本与 Route Handler 里跑）',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: '引擎层不许依赖 DOM' },
        { name: 'document', message: '引擎层不许依赖 DOM' },
        { name: 'localStorage', message: '引擎层不许依赖浏览器存储（资产走 providers/stores）' },
        { name: 'sessionStorage', message: '引擎层不许依赖浏览器存储' },
        { name: 'navigator', message: '引擎层不许依赖浏览器 API' },
        { name: 'location', message: '引擎层不许依赖浏览器 API' },
      ],
    },
  },
  // 关闭所有与 Prettier 冲突的格式类规则 —— 格式交给 Prettier，lint 只管正确性。
  // 必须放在最后，否则会被前面的配置覆盖回来。
  eslintConfigPrettier,
  {
    // `.next*/**` 里的 `*` 是给 `pnpm dev:preview` 用的：它按 NEXT_DIST_DIR 把产物写到
    // `.next-preview/`。少了这个通配，`eslint .` 会去 lint 那些打包产物 ——
    // 实测过：多出 1414 条问题（123 个 error），全是 `.next-preview/**` 里的构建产物。
    // 构建产物不进 lint，这一条对 `.next` 和 `.next-preview` 是同一个理由。
    // ★ `.claude/**` 这一条是补的，症状与 `.next-preview` 那次同源：
    //   并行会话在 `.claude/worktrees/<name>/` 下开一个**完整的仓库副本**，
    //   而 `eslint .` 会把它整个 lint 一遍。实测（2026-10-14）：把一条 worktree
    //   算进来，问题数从「0 error / 2 warning」变成 **1631 error / 19534 warning**——
    //   真问题的信号被彻底淹掉，闸门从此等于没有。
    //   `.out/` 里有生成的产物与一次性探针，本来就该忽略（它是 gitignored 的草稿区）。
    //   ★ `server/**` 是 2026-10-16 加的：那是 Java 那一半（`server/`），
    //   它有自己的闸门（`mvn test`）。ESLint 读不了 .java，却会去读它 `target/` 里的
    //   yml/json —— 与 `.next-preview` 那次同一个形状。
    ignores: [
      'node_modules/**',
      '.next*/**',
      'out/**',
      'build/**',
      '.out/**',
      '.claude/**',
      'server/**',
      'next-env.d.ts',
    ],
  },
]

export default eslintConfig
