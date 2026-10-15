import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

/**
 * vitest 配置
 *
 * environment 用 'node' 而不是 jsdom：本仓库第一批测试只测**纯函数**
 * （轮播索引、指针→倾斜角度、共用数学）。GSAP 是否真的把 transform 写到了元素上、
 * ScrollTrigger 在哪个滚动位置触发——那些是浏览器事实，用 preview 实测并截图，
 * 用 jsdom 测只会测到 GSAP 的内部行为，它一升级测试就碎。
 *
 * include 只收 src 下的 .test.ts：脚本目录 scripts/ 与 .next 里的产物不该被扫。
 *
 * ★ `@` 这个别名**必须与 tsconfig.json 的 `paths` 一致**，见下面那条注释。
 */
export default defineConfig({
  /**
   * 与 Next 一样把 `@/` 指到 `src/`。
   *
   * 为什么要有它：`src/components/creation/frames.ts`（事件流 → 画桌的纯函数）
   * 要 import `@/lib/engine/events.ts`——那是**全仓库组件层的写法**。
   * 没有这个别名，那个文件只能改成 `../../lib/...` 才测得动，
   * 也就是**让生产代码的 import 去迁就测试运行器**，方向正好反了。
   * 别名加上之后，任何"组件目录下的纯函数"都能按仓库本来的写法写，并且能被测。
   */
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
