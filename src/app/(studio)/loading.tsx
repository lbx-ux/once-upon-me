/**
 * app/(studio)/loading.tsx —— 工作台那一组的加载态
 *
 * ★ 为什么这一组要**单独一份**，而不是吃根目录那一份：
 *   根 `loading.tsx` 的边界在根布局底下、**在所有 layout 之外**，于是它一显形
 *   连壳（侧栏 + 顶栏）一起被换掉 —— 那读起来像"整个应用重启了"。
 *   这一份的边界在 `(studio)/layout` **里面**，被换掉的只有 `.studio` 那一块内容，
 *   壳原地不动。工作台又恰恰是全站唯一"每次进来都要现读盘"的一组
 *   （五屏都是 `force-dynamic`），慢的那一下正落在这里。
 *
 * ★ 与 AppShell 那颗转圈**分工**，不是重复：侧栏那个小转圈说"正在打开你点的那一格"
 *   （它挂在被点的那格上），这一张纸说"内容还在路上"。两者都不做 live region
 *   之外的第二遍播报 —— 见 SystemNotice.tsx 的文件头。
 */

import SystemNotice from '@/components/system/SystemNotice.tsx'

export default function StudioLoading() {
  return <SystemNotice kind="loading" scope="shell" />
}
