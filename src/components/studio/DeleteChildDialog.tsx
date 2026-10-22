'use client'

/**
 * DeleteChildDialog —— 删一个孩子的确认框，唯一那一份
 *
 * 谁在用：`/character` 那张卡上的「删掉他」（`WallDelete.tsx`）与
 * `/character/<childId>` 底下那一节（`ChildDetail.tsx`）。
 *
 * ★ 抽出来的理由不是省几行，是这两处必须说同一句话：同一个标题、同一句警告、
 *   同一个按钮次序。两份实现迟早一处改了另一处没跟上，而"删"这件事上不一致的代价最重。
 *
 * ★ 2026-10-16 第二轮：用户把整份清单划掉了（"这些东西就不要写了，
 *   就直接确认删除还是算了"）。于是这个弹窗从两步变成一步：
 *
 *   | 改之前 | 改之后 |
 *   | --- | --- |
 *   | 打开先发 `GET /api/children/<id>` 取"要失去什么" | 不发了 |
 *   | 列出五行（档案 1 条 / 角色卡与参考图 3 条 / 他的书 11 条 / 缩略图 20 条 / 照片原图"没有"） | 只留一句警告 |
 *   | 有加载态："正在数要删什么…" | 打开就能用，没有加载态 |
 *
 *   代价照实记着：删一个孩子会连带删掉他的书（`books/<id>/` 里的
 *   `events.jsonl` 也在内），而这一屏不再说出书名与本数。
 *   要找回那份清单：`GET /api/children/<id>` 一个字没动（见那一处注释，
 *   它现在界面上没有消费者），把那次请求与 `DeletionReceiptRows` 的
 *   `done === false` 一档加回来就是原样。
 *   那句警告留着（它不是一个清单，是一句话）；"已经做出来的 N 本书会一起没"
 *   去掉了——那一句本来靠的就是那次 GET 取回来的数。
 *
 * 一条故意不做的：删成功之后不留任何回执（书架上那条先例："成功之后页面
 *   不留任何回执"）——卡从墙上消失本身就是结果。
 *   但删到一半失败是例外：那时这个弹窗留着，把服务端那句话说出来
 *   （"这些位置没删干净：他的书、缩略图缓存"——点名，不是一串数字）。
 *   那不是"留下的记录"，是必须说的话。
 *   2026-10-17 补：这句话当时送不到——服务端删到一半时回的是
 *   `200 + { receipt }`，没有 `message` 字段，于是上面那句承诺停在注释里，
 *   家长看到的永远是这一屏自己的兜底话。现在服务端回 500 + `partialMessageOf(receipt)`
 *   （点名是哪几个位置）。这个绕了半天的弯值得记着：**"界面会显示服务端那句话"
 *   要靠一次真跑到那条分支才算数**，读代码时两边看起来都是对的。
 *
 * ★★ 2026-10-21（工单 D-28 判据②）把上面"删成功之后不留回执"这一条**推翻了**，
 *   而且是明着推翻的：评分报告 §2.5 / §2.19 扣的正是"删除之后没有任何凭据"。
 *   `DeletionReceipt` 从 2026-10-15 起就一直在服务端算、一直在响应里回去
 *   （逐位置报条数），却在 2026-10-16 那一刀之后**没有任何界面消费者**——
 *   一份算出来没有人看的账单不是凭据，是注释。
 *
 *   推翻的是**哪一条**要说清，因为两件事长得很像：
 *   | 用户当时划掉的 | 今天加的 |
 *   | --- | --- |
 *   | 删**之前**那张"将要失去什么"的五行清单（"这些东西就不要写了，就直接确认删除还是算了"） | 删**之后**那一张"各删掉了多少"的条数凭据 |
 *   前者是让人在动手前读一份清单（用户明确不要），后者是动作完成后的一句回话
 *   （判据要的正是它）。所以这一屏仍然是**一步确认**：打开、看一句警告、按确认。
 *   多出来的只有最后那一屏，上面写着数。
 *
 *   ★ 那一屏的写法有两条讲究：
 *   ① 报的是**真删掉的条数**（`deletePrefix` 数的），不是预估。
 *   ② 没删到的位置要点名（`failed`），一个"共 32 条"会把"有一处一条都没删掉"糊过去。
 */

import { useState } from 'react'

import Dialog from '@/components/dialog/Dialog.tsx'
import type { DeletionReceipt } from '@/lib/child-deletion.ts'

export type DeleteChildDialogProps = {
  childId: string
  /** 弹窗标题里念他的名字。取的是卡上那个名字，不是再从服务端问一句 */
  name: string
  onCancel: () => void
  /**
   * 删干净了。★ 不带凭据：墙那边要的只是"关掉 + 重取清单"（卡从墙上消失就是结果）。
   *   凭据仍然在响应里（这一屏拿它判 `complete`），只是没有人再画它了——
   *   详情页那张"终点页"在 2026-10-16 随删除入口一起删掉了（见 `ChildDetail.tsx`）。
   */
  onDeleted: () => void
}

type Phase =
  | { kind: 'asking' }
  | { kind: 'deleting' }
  /** 删干净了。★ 带着凭据停在这一屏，等家长读完按「知道了」才关（工单 D-28 判据②） */
  | { kind: 'done'; receipt: DeletionReceipt }
  /** 删到一半：有的位置没删干净。带**服务端那句原话**（它点名了是哪几个位置） */
  | { kind: 'partial'; message: string; receipt: DeletionReceipt }
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
      // 示例角色走的正是这一条：服务端 403 + 那句"他的档案在 public/demo/ 里…"。
      //   这里原样显示服务端那句话，不在客户端另编一句（守卫在服务端，理由也在那儿）
      if (!payload?.receipt) {
        setPhase({ kind: 'failed', message: payload?.message ?? '没删掉。' })
        return
      }
      if (payload.receipt.complete) {
        // ★ 2026-10-21（D-28 判据②）：这里原来是 `onDeleted()` 直接关掉。
        //   现在先停在这一屏把凭据念完——那些数是服务端刚数出来的，
        //   而"删掉了"这三个字本来就该对着清单被检查（`child-deletion.ts` 文件头第一句）
        setPhase({ kind: 'done', receipt: payload.receipt })
        return
      }
      // 判据是凭据上的 `complete`，不是状态码：删到一半服务端回的是 500
      //   （它确实是一次服务端失败），而"回什么码"与"删干净没有"是两件事——
      //   这条路上 500 是带着凭据回来的，读码会把这张凭据连同那句话一起丢掉。
      // 兜底那句是给"响应体形状不对"用的（比如中间有个代理换掉了正文）；
      //   正常路径上服务端一定带着点名的 `message`（见文件头 2026-10-17 那条）
      setPhase({
        kind: 'partial',
        message: payload.message ?? '有些位置没删干净。可以再删一次——重复删是安全的。',
        receipt: payload.receipt,
      })
    } catch {
      // 网络断在删除这种动作上，"可能发生了、也可能没有"是事实，照实说
      setPhase({
        kind: 'failed',
        message: '网络断了。删除可能已经发生，也可能没有——刷新这一页看还在不在。',
      })
    }
  }

  const failed = phase.kind === 'failed'
  const partial = phase.kind === 'partial'
  const done = phase.kind === 'done'

  return (
    <Dialog
      /* 删完之后标题不再是一个问句：事已经做了，那一行该说的是结果（工单 D-28 判据②）。
         ★ 名字仍然留在标题里——这一屏唯一能认出"删的是谁"的地方就是这一行 */
      title={done || partial ? `删掉 ${name}` : `删掉 ${name}？`}
      onClose={onCancel}
      /* 确认那一屏只剩一句话 + 两颗按钮，用不着"这一本要怎么做"那档 620 的宽度；
         凭据那一屏要列四行，460 会把「角色卡与参考图」挤到换行，所以按状态给两个数 */
      width={done || partial ? 520 : 460}
      /* 不传 `initialFocus`（也就是让它落在面板自己身上），这条动作的性质决定的：
         焦点一进来就压在"确认删除"上，读屏会先念那颗按钮，而用户还没听见这是一件
         不可逆的事——模态的壳里写着同一条道理（它举的例子是"停止重画"）。
         而"焦点到底落在谁身上"在这块预览面板里量不了：
         `document.hasFocus()` 为 false 时 Chrome 不更新 `activeElement`
         （实测点开弹窗后 `activeElement` 一直是 `BODY`，手动 `focus()` 也一样）。
         所以这一条要在前台窗口按一次 Tab 才算真验过——没有验过，别当它是读数。 */
      footer={
        failed ? (
          <button type="button" className="dlg__ghost" onClick={onCancel}>
            知道了
          </button>
        ) : done ? (
          // ★ 删完了只剩一件事：读完关掉。**不给"再删一次"**——凭据上 `complete` 为真
          //   就说明四个位置一条都没剩，再删一次是一句没有意义的话
          <button type="button" className="dlg__ghost" onClick={onDeleted}>
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
      {done ? (
        // ── 删完之后那一屏：报数（工单 D-28 判据②）────────────────────────
        <>
          <p className="dlg__hint">
            删掉了。下面每个位置后面跟的是 <strong>真正删掉的条数</strong>
            （服务端数出来的，不是预估）：
          </p>
          <ReceiptRows receipt={phase.receipt} />
        </>
      ) : partial ? (
        <>
          <p className="dlg__hint dlg__hint--warn">{phase.message}</p>
          <p className="dlg__hint">已经删掉的那部分（没列出来的位置就是没删掉）：</p>
          <ReceiptRows receipt={phase.receipt} />
        </>
      ) : failed ? (
        <p className="dlg__hint dlg__hint--warn">{phase.message}</p>
      ) : (
        <p className="dlg__hint dlg__hint--warn">
          <strong>删了就回不来了</strong>——没有回收站，也没有备份。
        </p>
      )}
    </Dialog>
  )
}

/**
 * 一张凭据那几行。★ 只画**条数**，不画字节数：
 *   凭据里 `bytes` 只有角色卡那一处有（`child-deletion.ts` 解释过为什么书那几处没有），
 *   画一半的位置会让人以为另一半是 0 字节。
 *
 * ★ **每一个位置都列出来，0 条的也列**，并把凭据自己那句 `note` 抄在数后面。
 *   凭据那边写着一条规矩："凡 0 条都必须解释，否则读者分不清'没删到'与'本来就没有'"——
 *   界面这一层要是把 0 条那几行滤掉，那条规矩就白写了：
 *   一个只用过两次的家长删完会看到一行（"他的档案 1 条"），
 *   而他会以为"就删了这一个文件"。列全之后他看到的是四行，
 *   其中"照片原图：0 条 · 从来就没有落盘过"那一行是这个产品该说的一句话。
 *
 * ★ 一处失败的位置要点名（`failed`）：一句"共 32 条"会把"他的书一条都没删掉"糊过去，
 *   而那张凭据存在的全部意义正是"能逐条被检查"。
 */
function ReceiptRows({ receipt }: { receipt: DeletionReceipt }) {
  return (
    <div className="dcd__receipt">
      <ul className="dcd__places">
        {receipt.places.map((place) => (
          <li className="dcd__place" key={place.place}>
            <span className="dcd__place-name">{place.place}</span>
            {place.failed ? (
              <span className="dcd__place-bad">没删掉（{place.failed}）</span>
            ) : (
              <span className="dcd__place-count">{place.deleted} 条</span>
            )}
            {place.note ? <span className="dcd__place-note">{place.note}</span> : null}
          </li>
        ))}
      </ul>
      {receipt.books.length > 0 ? (
        <p className="dcd__books">
          一并删掉的书：{receipt.books.map((book) => `《${book.title}》`).join('、')}
        </p>
      ) : null}
      <p className="dcd__total">共 {receipt.totalFiles} 条文件</p>
    </div>
  )
}
