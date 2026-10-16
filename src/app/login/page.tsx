import type { Metadata } from 'next'

import LoginPage from '@/components/auth/LoginPage.tsx'

export const metadata: Metadata = {
  title: '登录 · 小主角',
  description: '验证手机号，继续你的绘本创作。',
}

/**
 * `/login` —— 登录（全屏一页）
 *
 * ★ **不在 `(studio)` 路由组里**：那一组的意思是"工作台的一屏，带着侧栏"，
 *   而登录页是整幅的（左栏一段画面 + 右栏表单），与 `/create`、`/reader/*` 同一种。
 *   页面上没有侧栏，所以也没有"未登录时侧栏显示什么"这个循环。
 *
 * ★ `?next=` 在这一层读（服务端拿得到，也就省掉给 `useSearchParams` 套一层的 Suspense）。
 *   侧栏点「请登录」时带的是**当时那一页的路径**，登录完回到那儿。
 *   取值的白名单在 `lib/auth/state.ts` 的 `safeNext()` 里——**这一层不自己判**，
 *   因为它同时是"服务端渲染的字符串"和"要送进 router 的路径"，只该有一个判据。
 */
export default async function LoginRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  // 数组（`?next=a&next=b`）不取第一条，直接当没有——多值说明这不是我们生成的链接
  const next = typeof params['next'] === 'string' ? params['next'] : undefined

  return <LoginPage next={next} />
}
