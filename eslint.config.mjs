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

const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
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
    ignores: ['node_modules/**', '.next*/**', 'out/**', 'build/**', 'next-env.d.ts'],
  },
]

export default eslintConfig
