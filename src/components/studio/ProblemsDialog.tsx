'use client'

/**
 * ProblemsDialog —— 「你现在过不去」那一张纸：说清是哪几处，念完就散
 *
 * 两个用法，靠 `tone` 分档（不是一个用法的两种皮肤，是两种处境）：
 *
 * | tone | 什么时候 | 纸上是什么 |
 * | --- | --- | --- |
 * | `fix` | 按了那颗按钮，但还差几处（`/character/new` 的那份判据） | 一张清单：要做什么 |
 * | `failed` | 等了几十秒，结果是没成（服务端那句话） | 一句话：发生了什么 |
 *
 * 它替掉的是右上角一列 12.5px 的小字（`/character/new` 的 `.nc__problems`
 *   与 `.nc__error`）。用户 2026-10-18 的原话是「当用户输入好信息之后，出现了什么问题，
 *   应该出一个弹窗来提示用户，现在这样子有点不明显」——他截的图就是那列小字。
 *   那列小字位置上有个硬伤：它住在标题行的右上角（第七刀把按钮挪那儿了），
 *     而用户填完名字/照片/锚点之后，视口多半停在左下——他按完按钮
 *     视线根本不在那一角。判据看不见就等于没有。
 *
 * 底栏只有一颗「知道了」：这两张纸都没有第二个选择——要改的清单不是选择题，
 *   失败的复盘也不是。★ 于是也没有 `initialFocus`：焦点落在纸自己身上，
 *   读屏先念"这一张纸是说什么的"，而不是先念那颗确认键
 *   （与 `DeleteChildDialog` 同一个取舍）。
 *
 * 「知道了」= 收起来，不是"问题解决了"：调用方那边只是把这一份状态清掉，
 *   下一次按按钮会重新算一遍判据（`/character/new` 就是这么接的）。
 *   于是"改好了没有"永远由服务端/引擎那份判据回答，不是由"他点过知道了"回答。
 */

import Dialog from '@/components/dialog/Dialog.tsx'

export type ProblemsDialogProps = {
  title: string
  /** 一句小字，摆在正文前面（可选）。比如"补完再按一次那颗按钮" */
  lede?: string
  /** 一条或多条。★ `failed` 那档一般只有一条（失败的原因只有一句） */
  items: readonly string[]
  tone: 'fix' | 'failed'
  onClose: () => void
}

export default function ProblemsDialog({ title, lede, items, tone, onClose }: ProblemsDialogProps) {
  return (
    <Dialog
      title={title}
      onClose={onClose}
      /* 判据那一列最长的一句是「外貌锚点：眼睛含页级概念「笑」，应留在页级 prompt」，
         480 放得下它；再宽就成了一张公告 */
      width={480}
      footer={
        <button type="button" className="dlg__ghost" onClick={onClose}>
          知道了
        </button>
      }
    >
      {lede ? <p className="dlg__hint">{lede}</p> : null}
      {tone === 'fix' ? (
        <ul className="dlg__list">
          {items.map((item) => (
            /* `key` 用文字本身：`/character/new` 那三条判据已经按内容去过重
               （两套判据会重复说"名字还没填"，TSX 那边有一处 `new Set`），
               所以这里不会撞 key——真撞上说明过滤那一处坏了，那时 React 会报出来，
               比默默少显示一条好 */
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        /* 失败那档用壳里的危险色：它是"没成"，不是"待办"。
           与 `DeleteChildDialog` 的 partial/failed 两档同一条样式、同一个道理 */
        items.map((item) => (
          <p className="dlg__hint dlg__hint--warn" key={item}>
            {item}
          </p>
        ))
      )}
    </Dialog>
  )
}
