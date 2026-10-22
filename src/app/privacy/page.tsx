import type { Metadata } from 'next'

import PrivacySheet from '@/components/privacy/PrivacySheet.tsx'
import { currentUserId } from '@/lib/auth/session.ts'

/**
 * `/privacy` —— 「我们怎么处理你和孩子的数据」（2026-10-21，工单 D-28）
 *
 * 不在 `(studio)` 路由组里：那一组的意思是"工作台的一屏，带着侧栏"，
 *   而这一屏与 `/login`、`/reader/*` 同一种——整幅的一页，没有侧栏。
 *
 * ★ 它**不要求登录**，这是这一屏的全部要点：同意这件事要在建账号之前就看得到。
 *   `/login` 的页脚与 `/account` 的身份卡各有一根链指过来（两处都是"人在做那件
 *   会留下东西的事"的地方：一处是注册，一处是看自己有什么）。
 *   未登录时唯一的差别是底下那颗按钮写「去登录」而不是「去个人主页」——
 *   判据在服务端这一层读一次就够，不用把登录态送去客户端。
 *
 * 取数是 `force-dynamic`：它只读一个 cookie，但那一个 cookie 决定页面上两颗按钮里
 *   有一颗写什么；缓存住的话会出现"已经登录的人在这一页上看到「去登录」"。
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '我们怎么处理你和孩子的数据 · 小主角',
  description:
    '这个站存了孩子的什么、存在哪儿、留多久、怎么删，以及照片与录音为什么从来没有落到磁盘上——每一条都写着怎么自己验。',
}

export default async function PrivacyPage() {
  const userId = await currentUserId()
  return <PrivacySheet signedIn={userId !== null} />
}
