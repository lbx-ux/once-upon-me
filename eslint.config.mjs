import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { FlatCompat } from '@eslint/eslintrc'
import eslintConfigPrettier from 'eslint-config-prettier'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const compat = new FlatCompat({
  baseDirectory: __dirname,
})

const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
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
