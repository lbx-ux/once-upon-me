'use client'

/**
 * Desk.tsx —— 「画桌」：一页一格，画出来的每一格都看得见
 *
 * 原来这一屏是一行一行的文字日志（`cf__log`）。它说的事都对，但**看不见产出**——
 * 20 行的"第 13 页画好了"与一张第 13 页的画，是两件完全不同的事。
 * 这一屏是唯一能让"一页一页画出来"这个卖点自己说话的地方（#2 Agent 分压在这儿）。
 *
 * 四条设计判断，每条都有一个具体的坏法：
 *
 * 1. **空画框就是进度，不另画一根百分比条**。`plan-ready` 说 20 页，就摆 20 个虚线框；
 *    画好一页填一个。`20 格里画好了 7 格` 是**看得见的事实**，
 *    而一根 35% 的进度条是**编出来的数**——两者在屏幕上一样宽，但只有一个是真的。
 * 2. **图取不到时留相纸色的空框，不留碎图**（CLAUDE.md「图没到位就留一个语义上诚实的兜底」）。
 *    `illustration` 事件说的 `assetPath` 与文件落盘之间可能有先后，
 *    所以 `onError` 把那一格退回空框——一块干净的 `--card-paper`，
 *    而不是浏览器默认的碎图标。
 * 3. **不出声报错**：一格上的话只写那格的事（"不太像"、"正在重画"），
 *    整轮坏掉（`fatal`）由 `CreateFlow` 用 `role="alert"` 摊在画桌**上面**——
 *    藏进格子里的话，它就成了"第 7 页有点小问题"。
 * 4. **文案不在这里写**：每一格那句话来自 `describeEvent`（引擎侧唯一那一份）。
 *
 * ★ 静止模式（`prefers-reduced-motion`）下每一格都是**终态**：正在画那一格不呼吸，
 *   改用一圈静态描边。它不是动画驱动的东西，状态本来就是从事件来的。
 */

import { useState } from 'react'

import { assetUrlOf } from '@/lib/asset-url.ts'

import type { DeskState, Frame } from './frames.ts'

/** 一格里的图。★ 独立的组件是为了让"取不到图"这件事有一个自己的 state */
function Figure({ frame }: { frame: Frame }) {
  const [broken, setBroken] = useState(false)
  // 320 档派生小图：一屏可能同时有二十格，原图是 2.7 MB 那一档（共用 lib/thumbs.ts 那条路）
  const url = frame.assetPath ? assetUrlOf(frame.assetPath, 320) : null

  return (
    <div className="dk__frame" data-busy={frame.busy === 'drawing' ? 'true' : 'false'}>
      {url && !broken ? (
        // 原生 <img>：图经 /api/assets 出来，next/image 要另配 loader（README §五）
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="dk__art"
          src={url}
          // ★ 空的 alt：这一格旁边就写着"第 N 页"，读屏不必再念一遍
          alt=""
          width={320}
          height={320}
          onError={() => setBroken(true)}
        />
      ) : (
        /* 还没画到 / 图取不到：虚线铅笔框。两者视觉上一样是**刻意的**——
           家长不需要知道"是还没画"还是"画了但没取回来"，他需要知道"这一格还没有画" */
        <span className="dk__blank" aria-hidden="true" />
      )}

      <span className="dk__no">{frame.pageNo}</span>
      {frame.narrated && (
        <span className="dk__sound" title="这一页配好音了">
          {/* 小喇叭，内联 SVG：emoji 是扁平 clip-art，与水彩是两套画法（首页 §五 那条） */}
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M3.5 7.5h2.8L10 4.2v11.6l-3.7-3.3H3.5z" />
            <path
              d="M12.8 7.4a3.4 3.4 0 0 1 0 5.2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <span className="dk__sr">已配音</span>
        </span>
      )}

      {frame.note && (
        <p className="dk__note" data-tone={frame.noteTone}>
          {frame.note}
        </p>
      )}
    </div>
  )
}

export type DeskProps = {
  desk: DeskState
  /** 已经画好几格（`drawnCount`）。传进来而不是在这里数，是为了让它只有一处实现 */
  drawn: number
}

export default function Desk({ desk, drawn }: DeskProps) {
  return (
    <div className="dk">
      {/* ── 上面那一行：书名 + k/N + 现在在第几段 ─────────────────────── */}
      <header className="dk__head">
        <p className="dk__title">{desk.title ? `《${desk.title}》` : '正在编故事…'}</p>
        {desk.total > 0 && (
          <p className="dk__count">
            <b>{drawn}</b> / {desk.total} 页画好了
          </p>
        )}
      </header>

      {desk.stageLine && (
        <p className="dk__stage" role="status">
          {desk.stageLine}
        </p>
      )}

      {/* ── 那排画框 ─────────────────────────────────────────────────── */}
      {desk.frames.length > 0 && (
        <ol className="dk__frames">
          {desk.frames.map((frame) => (
            <li key={frame.pageNo}>
              <Figure frame={frame} />
            </li>
          ))}
        </ol>
      )}

      {/* ── 不属于任何一页的提醒（配音没接上这种）：**没有格子可去**，但丢掉
             家长就看不到"这本书没有朗读"了 ──────────────────────────────── */}
      {desk.notes.length > 0 && (
        <ul className="dk__notes">
          {desk.notes.map((note) => (
            <li key={note.key} data-tone={note.tone}>
              {note.text}
            </li>
          ))}
        </ul>
      )}

      {/* ── 书好了：整排收成一张封面 + 一条路 ───────────────────────────── */}
      {desk.ready && (
        <div className="dk__done">
          {desk.ready.coverPath && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="dk__cover"
              src={assetUrlOf(desk.ready.coverPath, 320)}
              alt=""
              width={160}
              height={160}
            />
          )}
          <div className="dk__done-text">
            <p className="dk__done-title">书做好了</p>
            <p className="dk__done-sub">
              共 {desk.total} 页
              {desk.ready.stats['redrawCount']
                ? `，其中重画了 ${desk.ready.stats['redrawCount']} 页`
                : ''}
              。
            </p>
            <a className="dk__open" href={`/reader/${desk.ready.bookId}`}>
              翻开来看看 →
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
