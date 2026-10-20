/**
 * app/loading.tsx —— 页面这一级的加载态
 *
 * 这一层包住的是根布局底下那棵树（也就是整页）。工作台那一组另有自己的一份
 * （`app/(studio)/loading.tsx`），因为那一档不能盖住壳 —— 差别与理由在
 * `components/system/SystemNotice.tsx` 的文件头。
 *
 * 它只对真的在等的时候可见：这一档晚 120ms 才显形（CSS 里的
 *   `animation-delay`，与 AppShell 的 `PENDING_SHOW_AFTER_MS` 同一个数）。
 *   静态页（`/` 与 `/booklist` 那几屏）构建期就渲染完了，根本走不到这里；
 *   走得到的是 `force-dynamic` 的那几屏与"第一次打开发电机还要现读盘"的情况。
 */

import SystemNotice from '@/components/system/SystemNotice.tsx'

export default function RootLoading() {
  return <SystemNotice kind="loading" scope="page" />
}
