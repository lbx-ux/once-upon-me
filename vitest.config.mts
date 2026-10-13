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
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
