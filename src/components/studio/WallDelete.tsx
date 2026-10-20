'use client'

/**
 * WallDelete —— 角色卡上那颗「删掉他」：点一下就地弹出确认框
 *
 * 2026-10-16 那一刀之前，这颗是一根链去详情页的锚点
 *   （`/character/<id>#delete`），用户要先跳一屏、滚到底、再点一次才谈得上删。
 *   用户的原话："现在的删除是点击删除之后进入人物详细页才能删除，改一下，
 *   用户在卡片那点击删除之后，就直接出现一个弹窗，询问用户是否删除"。
 *
 * 于是这一屏多了一个客户端组件——但没有多第二份实现：
 *   那个确认框（标题、那句"删了就回不来了"、两颗按钮）全在 `DeleteChildDialog.tsx` 里，
 *   详情页底下那一节用的是同一个组件。原来那颗锚点的注释写着
 *   "这里再做一个就地确认，这一屏就得变成客户端组件、`DeletionReceipt` 要搬第二份"
 *   ——那一半的担心是对的，所以这一刀先把凭据抽出来再动手。
 *
 * 只有这一颗是客户端的：整面墙仍然是服务端组件（`CharacterWall.tsx`），
 *   传下来的 `items` 还是那几个能序列化的字段。
 *
 * 删成功之后页面不留回执（书架上那条先例）：卡从墙上消失本身就是结果，
 *   `router.refresh()` 让服务端那份清单重新读一次。
 *   删到一半失败是例外——那时弹窗留着，把服务端那句"哪些位置没删干净"说出来。
 *
 * 关掉弹窗时也刷新一次（`onCancel` 里那一下）：用户可能在"删到一半"那句之后
 *   按「算了」离开，而那一刻已经有的东西确实删掉了——不刷新的话墙上那张卡
 *   是旧的。清单没变时 `router.refresh()` 什么也不会闪。
 */

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import DeleteChildDialog from '@/components/studio/DeleteChildDialog.tsx'

export type WallDeleteProps = {
  childId: string
  name: string
}

export default function WallDelete({ childId, name }: WallDeleteProps) {
  const router = useRouter()
  const [asking, setAsking] = useState(false)

  /** 两种情况共用同一个收尾：删掉了、或者"删到一半"之后按了「算了」——两次都要重取清单 */
  function close(): void {
    setAsking(false)
    router.refresh()
  }

  return (
    <>
      <button type="button" className="cw__del" onClick={() => setAsking(true)}>
        删掉他
      </button>
      {asking ? (
        <DeleteChildDialog childId={childId} name={name} onCancel={close} onDeleted={close} />
      ) : null}
    </>
  )
}
