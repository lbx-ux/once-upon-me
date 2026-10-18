'use client'

/**
 * RevoiceDialog —— 重配这一页之前，先听得见现在这条、也改得动它念的那段话（工单 08）
 *
 * 用户的原话："点击重配的话，就直接出现录音的音频是什么，用户直接在上面修改就行。"
 *
 * 四条判断：
 *
 * 1. **先听得见**。上面是这一页现在的那条录音（`<audio controls>`），下面是它念的那段话。
 *    顺序不能反：录完之后"念成什么样"这件事只有耳朵能判，字面看不出来。
 * 2. ★ **那段话是可编辑的，而且改的就是书里那一页的字**。正文在 `book.json` 的
 *    `tree.nodes[i].body` 里，阅读器上那几段字读的是它——所以这里改完，
 *    **书上的文字也跟着变**，不只是一条新录音。这是刻意的（用户看到的就是"这段录音
 *    念的是什么"），但必须**说出来**，否则他改完去阅读器一看字变了会以为出了 bug。
 * 3. ★ **图不会跟着重画**，也要说出来。画面是按**原来**那段正文出的
 *    （`imagePrompt` 是规划给的另一条线），改了字之后可能图文对不上。
 *    要改的不只是错别字时，该做的是重画那一步——这句话是这一屏的出口。
 * 4. **一句一段**：阅读器把 `body` 的每个元素渲染成一个段落，所以这里按行编辑、
 *    按行存回去。揉成一大段会让书里那一页的排版跟着变。
 */

import { useState } from 'react'

import Dialog from '@/components/dialog/Dialog.tsx'
import type { RunPageView } from '@/lib/run-pages.ts'

export type RevoiceDialogProps = {
  page: RunPageView
  onCancel: () => void
  /** 改过的正文，一句一段。空行会被丢掉（服务端也会再挡一次） */
  onConfirm: (body: string[]) => void
  busy?: boolean
}

export default function RevoiceDialog({
  page,
  onCancel,
  onConfirm,
  busy = false,
}: RevoiceDialogProps) {
  const original = page.body.join('\n')
  const [text, setText] = useState(original)
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')

  /** 改过没有。★ 判据是**切分之后**那两份一不一样，不是字符串比不比得出来——
   *  多加一个换行不算改（它会被丢掉），而那个区别只有切分之后才看得见 */
  const changed = lines.join('\u0000') !== page.body.join('\u0000')
  const empty = lines.length === 0

  return (
    <Dialog
      title={`重配第 ${page.pageNo} 页`}
      onClose={onCancel}
      width={680}
      footer={
        <>
          <button type="button" className="dlg__ghost" onClick={onCancel}>
            算了
          </button>
          <button
            type="button"
            className="dlg__go"
            // 删空了不许发：服务端会拒（`index.ts` 的 `invalid-request`），
            // 而在这里拦住能让用户当场看见自己删空了
            disabled={busy || empty}
            onClick={() => onConfirm(lines)}
          >
            {busy ? '正在重配…' : changed ? '改完重新配音' : '重新配一遍'}
          </button>
        </>
      }
    >
      <p className="rdg__label">这一页现在的录音</p>
      {page.narrationUrl ? (
        /* ★ `preload="metadata"`，不是 `none`（2026-10-18，用户："我点开是0秒"）。
           `preload="none"` 下打开这个弹窗**一个字节都不拉**，于是原生播放器
           只能显示 `0:00` 与一条空进度条——家长看见的是"这一页没有录音"，
           而它其实有。这一屏的整个理由就是"先听得见"（文件头第 1 条），
           所以这里该在**打开的那一刻**就把时长拿到。
           ★ 实测代价就是这一页的音频（143,611 字节一条 206：浏览器发的是
             `Range: bytes=0-`，也就是整份）——换来 `duration=7.176s` 与可拖的进度条
             （修之前是 `NaN` 与 `seekable=0`）。读数与复现命令见
             `.scratch/w3-shared-reading/issues/09-audio-range.md`。
           ★ 阅读器那两个 `<audio>` 仍然是 `preload="none"`：那边是一本 20 页
             两三兆，而且从来不读 `duration`（只吃 `onEnded`），不是同一件事。 */
        <audio className="rvd__audio" src={page.narrationUrl} controls preload="metadata" />
      ) : (
        /* ★ 没有录音时说"没有"，不画一个空的播放器：一个点了不响的控件
           会让人以为是自己这边的声音坏了 */
        <p className="rvd__noaudio">这一页还没有录音。</p>
      )}

      <label className="rdg__supplement">
        <span className="rdg__label">这一页要念的话</span>
        <textarea
          className="dlg__textarea rvd__text"
          value={text}
          rows={4}
          onChange={(event) => setText(event.target.value)}
        />
        <span className="dlg__hint">
          一行一句，阅读器上也按行分段。
          {changed
            ? '改完这段字，书里这一页的文字也会跟着变——不只是换一条录音。'
            : '只点「重新配一遍」就照现在这段字重录，不改书上的字。'}
        </span>
        {changed && (
          <span className="dlg__hint dlg__hint--warn">
            图不会跟着重画：画面是按原来那段字出的，改完可能和图对不上。
            要改的不只是错别字的话，去那一页点「重画」。
          </span>
        )}
      </label>
    </Dialog>
  )
}
