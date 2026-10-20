'use client'

/**
 * NewCharacterButton —— 「＋新建角色」那一颗（2026-10-17 变成客户端的）
 *
 * 它原来是一根 `<NextLink href="/character/new">`，直接写在
 *   `CharacterWall.tsx`（服务端组件）里。用户这一轮要「没有登录就去……
 *   生成人物……就出现一个弹窗，显示请登录」——而 `<Link>` 拦不住自己那一下导航：
 *   它点下去就走，来不及弹任何东西。
 *
 * 所以这一颗被摘出来做成客户端组件，与 `WallDelete` 同一个做法：
 *   整面墙仍然是服务端组件（`items` 还是那几个能序列化的字段），
 *   只有这一颗需要"先问一句再决定"的进了客户端。
 *
 * 登录了之后走的是同一段地址（`/character/new`），而且仍然是一次真导航
 *   （`router.push`），不是条件渲染——那一屏是服务端取数的，没有理由不走。
 */

import { useRouter } from 'next/navigation'
import { useCallback, type ReactNode } from 'react'

import { useSignInGate } from '@/components/auth/SignInGate.tsx'

/**
 * 两个地方要用它，皮不一样（右上角那颗「＋新建角色」与空态里那颗「去新建一个」），
 *   所以 `className` 与内容都是调用方给的。行为只有这一份——
 *   两处各写一遍"先问登录"的代价是它们会开始不一样，而那种不一样
 *   只在没登录的时候才看得见。
 */
export default function NewCharacterButton({
  className = 'cw__new',
  children = (
    <>
      <span className="cw__new-plus" aria-hidden="true">
        ＋
      </span>
      新建角色
    </>
  ),
}: {
  className?: string
  children?: ReactNode
}) {
  const router = useRouter()
  const gate = useSignInGate()

  const go = useCallback(async () => {
    const verdict = await gate.ask()
    if (verdict.kind === 'signed-in') router.push('/character/new')
  }, [gate, router])

  return (
    <>
      <button type="button" className={className} onClick={() => void go()}>
        {children}
      </button>
      {gate.dialog}
    </>
  )
}
