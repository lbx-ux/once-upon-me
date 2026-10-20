'use client'

/**
 * RedrawDialog —— 重画这一页之前，先说清"原来发的是什么、这次要改什么"（工单 08）
 *
 * 用户的原话："用户点击重画，就出现一个弹窗，上面显示原来的提示词，原来的提示词
 * 不可以修改，然后还有一个补充的输入框，用户可以输入这一次画的纰漏是什么。"
 *
 * 四条判断：
 *
 * 1. ★ 原来那段提示词是只读的，而且它就是真正发出去的那一份。
 *    它由服务端的 `pagePrompt()` 现算（与 `illustrateNode` 同一个函数），
 *    不是这里拼的——客户端拼一遍的话，屏幕上显示的和实际发出去的从第一天起就会分家，
 *    而"我看到的就是它发给模型的"正是这个弹窗存在的理由。
 * 2. ★ 补充是"接上去"，不是"改掉它"。摆法上就看得出来：它在原来那段提示词下面，
 *    是"再加一句"而不是第二个 prompt 输入框。
 *    2026-10-16 这里原来还有一句说明（"你写的会接在「情绪」后面，原来的提示词不会变"），
 *      用户按着截图划掉了。代价记在这里：这个界面从此不说"接上去"这件事了，
 *      用户有理由以为那格会替换掉上面那段，于是写一遍完整的画面描述。
 *      要接回来的话接在这一格下面，别另起一段（那正是被划掉的位置）。
 * 3. 不写补充也能重画（就是"再抽一张"）。这是最常见的用法，所以主按钮不必等输入。
 * 4. 上一版那张图要摆出来：说"这一次哪里不对"之前得看得见上一版。
 */

import { useState } from 'react'

import Dialog from '@/components/dialog/Dialog.tsx'
import type { RunPageView } from '@/lib/run-pages.ts'

export type RedrawDialogProps = {
  page: RunPageView
  onCancel: () => void
  /** 补充可以为空串（= 纯重画，不写任何修正） */
  onConfirm: (fixNote: string) => void
  busy?: boolean
}

/** 与 `[pageNo]/route.ts` 的 `MAX_FIX_NOTE` 是同一个数。这里只为把输入框拦住，权威在服务端 */
const MAX_FIX_NOTE = 200

export default function RedrawDialog({
  page,
  onCancel,
  onConfirm,
  busy = false,
}: RedrawDialogProps) {
  const [fixNote, setFixNote] = useState('')

  return (
    <Dialog
      title={`重画第 ${page.pageNo} 页`}
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
            disabled={busy}
            onClick={() => onConfirm(fixNote.trim())}
          >
            {busy ? '正在重画…' : '重画这一页'}
          </button>
        </>
      }
    >
      <div className="rdg__grid">
        {/* 上一版那张图。★ 没有图（这一页当初就没做出来）时**不画空框**，
            只用一句话说清——一个灰框在这里会被读成"加载中" */}
        {page.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="rdg__art" src={page.imageUrl} alt={`第 ${page.pageNo} 页现在这一版`} />
        ) : (
          <p className="rdg__noart">这一页现在还没有图。</p>
        )}

        <div className="rdg__what">
          <p className="rdg__label">原来发给模型的那段话</p>
          {/* ★ 只读：`readOnly` + 不可编辑的样子（`dlg__readonly`）。
              做成可编辑的输入框，用户会以为自己改的就是提示词——
              而真正能被个性化的是下面那一格 */}
          <pre className="dlg__readonly rdg__prompt">{page.prompt}</pre>
        </div>
      </div>

      <label className="rdg__supplement">
        <span className="rdg__label">这一次哪里不对（可以空着）</span>
        <textarea
          className="dlg__textarea"
          value={fixNote}
          rows={3}
          maxLength={MAX_FIX_NOTE}
          placeholder="例如：头发比标准像长，脸上多了一只手，眼神太凶"
          onChange={(event) => setFixNote(event.target.value)}
        />
      </label>
    </Dialog>
  )
}
