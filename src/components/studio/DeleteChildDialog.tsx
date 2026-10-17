'use client'

/**
 * DeleteChildDialog —— 删一个孩子的确认框，唯一那一份
 *
 * 谁在用：`/character` 那张卡上的「删掉他」（`WallDelete.tsx`）与
 * `/character/<childId>` 底下那一节（`ChildDetail.tsx`）。
 *
 * ★ 抽出来的理由不是省几行，是**这两处必须说同一句话**：同一个标题、同一句警告、
 *   同一个按钮次序。两份实现迟早一处改了另一处没跟上，而"删"这件事上不一致的代价最重。
 *
 * ★ 2026-10-16 第二轮：用户把整份清单划掉了（"这些东西就不要写了，
 *   就直接确认删除还是算了"）。于是这个弹窗**从两步变成一步**：
 *
 *   | 改之前 | 改之后 |
 *   | --- | --- |
 *   | 打开先发 `GET /api/children/<id>` 取"要失去什么" | **不发了** |
 *   | 列出五行（档案 1 条 / 角色卡与参考图 3 条 / 他的书 11 条 / 缩略图 20 条 / 照片原图"没有"） | 只留一句警告 |
 *   | 有加载态："正在数要删什么…" | 打开就能用，没有加载态 |
 *
 *   ★ 代价照实记着：删一个孩子会连带删掉他的书（`books/<id>/` 里的
 *   `events.jsonl` 也在内），而这一屏**不再说出书名与本数**。
 *   ★ 要找回那份清单：`GET /api/children/<id>` 一个字没动（见那一处注释，
 *   它现在界面上没有消费者），把那次请求与 `DeletionReceiptRows` 的
 *   `done === false` 一档加回来就是原样。
 *   ★ 那句警告留着（它不是一个清单，是一句话）；"已经做出来的 N 本书会一起没"
 *   去掉了——那一句本来靠的就是那次 GET 取回来的数。
 *
 * ★ 一条**故意不做的**：删成功之后不留任何回执（书架上那条先例："成功之后页面
 *   不留任何回执"）——卡从墙上消失本身就是结果。
 *   ★ 但**删到一半失败是例外**：那时这个弹窗留着，把服务端那句话说出来
 *   （"这些位置没删干净：他的书、缩略图缓存"——**点名**，不是一串数字）。
 *   那不是"留下的记录"，是必须说的话。
 *   ★ 2026-10-17 补：这句话当时**送不到**——服务端删到一半时回的是
 *   `200 + { receipt }`，**没有 `message` 字段**，于是上面那句承诺停在注释里，
 *   家长看到的永远是这一屏自己的兜底话。现在服务端回 500 + `partialMessageOf(receipt)`
 *   （点名是哪几个位置）。这个绕了半天的弯值得记着：**"界面会显示服务端那句话"
 *   要靠一次真跑到那条分支才算数**，读代码时两边看起来都是对的。
 */

import { useState } from 'react'

import Dialog from '@/components/dialog/Dialog.tsx'
import type { DeletionReceipt } from '@/lib/child-deletion.ts'

export type DeleteChildDialogProps = {
  childId: string
  /** 弹窗标题里念他的名字。取的是**卡上那个名字**，不是再从服务端问一句 */
  name: string
  onCancel: () => void
  /**
   * 删干净了。★ **不带凭据**：墙那边要的只是"关掉 + 重取清单"（卡从墙上消失就是结果）。
   *   凭据仍然在响应里（这一屏拿它判 `complete`），只是没有人再画它了——
   *   详情页那张"终点页"在 2026-10-16 随删除入口一起删掉了（见 `ChildDetail.tsx`）。
   */
  onDeleted: () => void
}

type Phase =
  | { kind: 'asking' }
  | { kind: 'deleting' }
  /** 删到一半：有的位置没删干净。带**服务端那句原话**（它点名了是哪几个位置） */
  | { kind: 'partial'; message: string }
  | { kind: 'failed'; message: string }

export default function DeleteChildDialog({
  childId,
  name,
  onCancel,
  onDeleted,
}: DeleteChildDialogProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'asking' })

  const busy = phase.kind === 'deleting'

  async function confirm(): Promise<void> {
    if (busy) return
    setPhase({ kind: 'deleting' })
    try {
      const response = await fetch(`/api/children/${encodeURIComponent(childId)}`, {
        method: 'DELETE',
      })
      const payload = (await response.json().catch(() => null)) as {
        receipt?: DeletionReceipt
        message?: string
      } | null
      // ★ 示例角色走的正是这一条：服务端 403 + 那句"他的档案在 public/demo/ 里…"。
      //   这里**原样显示服务端那句话**，不在客户端另编一句（守卫在服务端，理由也在那儿）
      if (!payload?.receipt) {
        setPhase({ kind: 'failed', message: payload?.message ?? '没删掉。' })
        return
      }
      if (payload.receipt.complete) {
        onDeleted()
        return
      }
      // ★ 判据是凭据上的 `complete`，**不是状态码**：删到一半服务端回的是 500
      //   （它确实是一次服务端失败），而"回什么码"与"删干净没有"是两件事——
      //   这条路上 500 是**带着凭据**回来的，读码会把这张凭据连同那句话一起丢掉。
      // ★ 兜底那句是给"响应体形状不对"用的（比如中间有个代理换掉了正文）；
      //   正常路径上服务端一定带着点名的 `message`（见文件头 2026-10-17 那条）
      setPhase({
        kind: 'partial',
        message: payload.message ?? '有些位置没删干净。可以再删一次——重复删是安全的。',
      })
    } catch {
      // ★ 网络断在删除这种动作上，"可能发生了、也可能没有"是**事实**，照实说
      setPhase({
        kind: 'failed',
        message: '网络断了。删除可能已经发生，也可能没有——刷新这一页看还在不在。',
      })
    }
  }

  const failed = phase.kind === 'failed'
  const partial = phase.kind === 'partial'

  return (
    <Dialog
      title={`删掉 ${name}？`}
      onClose={onCancel}
      /* 清单没了之后这一屏只剩一句话 + 两颗按钮，用不着"这一本要怎么做"那档 620 的宽度 */
      width={460}
      /* ★ **不传 `initialFocus`**（也就是让它落在面板自己身上），这条动作的性质决定的：
         焦点一进来就压在"确认删除"上，读屏会先念那颗按钮，而用户还没听见这是一件
         不可逆的事——模态的壳里写着同一条道理（它举的例子是"停止重画"）。
         ★ 而"焦点到底落在谁身上"在这块预览面板里**量不了**：
         `document.hasFocus()` 为 false 时 Chrome 不更新 `activeElement`
         （实测点开弹窗后 `activeElement` 一直是 `BODY`，手动 `focus()` 也一样）。
         所以这一条要在前台窗口按一次 Tab 才算真验过——**没有**验过，别当它是读数。 */
      footer={
        failed ? (
          <button type="button" className="dlg__ghost" onClick={onCancel}>
            知道了
          </button>
        ) : (
          <>
            <button
              type="button"
              className="dlg__danger"
              disabled={busy}
              onClick={() => void confirm()}
            >
              {busy ? '正在删…' : partial ? '再删一次' : '确认删除'}
            </button>
            <button type="button" className="dlg__ghost" disabled={busy} onClick={onCancel}>
              算了
            </button>
          </>
        )
      }
    >
      {partial || failed ? (
        <p className="dlg__hint dlg__hint--warn">{phase.message}</p>
      ) : (
        <p className="dlg__hint dlg__hint--warn">
          <strong>删了就回不来了</strong>——没有回收站，也没有备份。
        </p>
      )}
    </Dialog>
  )
}
