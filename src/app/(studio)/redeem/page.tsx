import { redirect } from 'next/navigation'

import RedeemPanel from '@/components/studio/RedeemPanel.tsx'
import { currentUserId } from '@/lib/auth/session.ts'
import { readCreditView } from '@/lib/credits/server.ts'

/**
 * /redeem —— 兑换额度（2026-10-30）
 *
 * 必须登录：兑换是往一个账号上加东西，而"加到谁头上"只有会话说得清。
 * 未登录直接送去登录页，`next` 带回这一屏——与 `/admin` 那一条同一个做法。
 *
 * 首屏就在服务端读好余额与流水：这一屏要回答的第一个问题是"我现在还剩几本"，
 * 而先亮一屏「—」再跳一次数字，会让人以为兑换把它弄丢了。
 */

export const dynamic = 'force-dynamic'

export const metadata = { title: '兑换额度 · 小主角' }

export default async function RedeemPage() {
  const userId = await currentUserId()
  if (!userId) redirect(`/login?next=${encodeURIComponent('/redeem')}`)

  const view = await readCreditView()
  return <RedeemPanel initialBalance={view?.balance ?? null} entries={view?.entries ?? []} />
}
