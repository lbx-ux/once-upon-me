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
 *    ★ **2026-10-16 改口**：用户看过这一屏之后说"正在画怎么空拉拉的，来点交互效果，
 *      比如加个进度条这些的"，于是下面加了 `.dk__bar` 那一条。
 *      改的**不是**这条判断，是它反对的那件事：它反对的是**编分母**（当时引擎没有
 *      任何一条事件说得出一页画了几成，所以任何一根条都只能自己估），
 *      而今天这根条的分子分母是 `drawnCount / total`——与那排空画框**是同一个数**
 *      （推导在 `frames.ts` 的 `drawnRatio`，那里有测试）。
 *      空画框留着：它说的是"哪几页"，条说的是"走到哪儿了"，两个问题不一样。
 *    ★ 仍然**没有**的东西：没有"还剩多久"、没有 spinner、没有百分比数字。
 *      理由见 `desk.css` 文件头第 3 条（那一条一个字没改）。
 * 2. **图取不到时留相纸色的空框，不留碎图**（CLAUDE.md「图没到位就留一个语义上诚实的兜底」）。
 *    `illustration` 事件说的 `assetPath` 与文件落盘之间可能有先后，
 *    所以 `onError` 把那一格退回空框——一块干净的 `--card-paper`，
 *    而不是浏览器默认的碎图标。
 * 3. **不出声报错**：一格上的话只写那格的事（"不太像"、"正在重画"），
 *    整轮坏掉（`fatal`）由 `CreateFlow` 用 `role="alert"` 摊在画桌**上面**——
 *    藏进格子里的话，它就成了"第 7 页有点小问题"。
 * 4. **文案不在这里写**：每一格那句话来自 `describeEvent`（引擎侧唯一那一份）。
 * 5. ★ **岔路那几格标出来**（2026-10-18，工单 05 §三）。共读版的两条支在这排格子上
 *    长得和普通页一模一样（按 `pageNo` 摆成一排），家长会把"第 4 页、第 5 页"
 *    读成连续的两页——而它们其实是**两条不同的路**，孩子只会读到其中一条。
 *    所以给那几格挂一条窄色带 + 一颗 A / B 角标，并在整排上面说一句它是怎么回事。
 *    ★ 归属**从事件来**（`plan-ready` 的 `branchPages` → `Frame.via`），不是
 *      从"第 N 格之后都算岔路"猜的：平铺顺序与支上的路本来就不是一回事
 *      （验证夹具里 a 支的第 4 页排在 b 支那几页**前面**）。
 *    ★ 一条都没有时不出现（独读版、以及 2026-10-18 之前落盘的旧日志）。
 *
 * ★ 静止模式（`prefers-reduced-motion`）下每一格都是**终态**：正在画那一格不呼吸，
 *   改用一圈静态描边。它不是动画驱动的东西，状态本来就是从事件来的。
 *
 * 6. ★ **编故事那几分钟不能只有一句话**（2026-10-18，用户："这个编故事和用户一点都没有
 *    互动感，就直接说正在编故事，这个地方优化一下，哪怕把字体变成橙色呢"）。
 *    这一段是**整条流水线上最长的一段没有任何产出的时间**（`plan-ready` 之前
 *    屏幕上一条事件都没有，连一个空画框都摆不出来），而它原来只是一行灰字。
 *    现在它有三样东西：一句话在**轮着换**（`plan-lines.ts`，说的是这件活在做什么）、
 *    一个**橙色的**标题（这一屏上"正在忙"的那一支色）、以及**真的失败过一次时**
 *    那句原话（`desk.planning` ——"第 2 次重写：故事结构不对"）。
 *    ★ 三样都是真的：轮播那几句不承诺时刻（有测试），重写那句来自事件。
 *      这一屏**仍然没有**百分比、秒数、"还剩多久"（第 1 条的末尾那句一个字没改）。
 */

import { useState, type CSSProperties } from 'react'

import { assetUrlOf } from '@/lib/asset-url.ts'
import { useRotatingLine } from '@/lib/use-rotating-line.ts'

import { drawnCount, drawnRatio, hasBranches, type DeskState, type Frame } from './frames.ts'
import { PLAN_LINES } from './plan-lines.ts'

/** 一格里的图。★ 独立的组件是为了让"取不到图"这件事有一个自己的 state */
function Figure({ frame }: { frame: Frame }) {
  const [broken, setBroken] = useState(false)
  // 320 档派生小图：一屏可能同时有二十格，原图是 2.7 MB 那一档（共用 lib/thumbs.ts 那条路）
  const url = frame.assetPath ? assetUrlOf(frame.assetPath, 320) : null

  return (
    <div
      className="dk__frame"
      // ★ 忙就是忙：画与配音都算。★ 而**哪一种**忙另给一个属性——
      //   两者在屏幕上是不同的事（一个在出图、一个在出声），
      //   合成一个 `data-busy` 就没有任何地方能区分它们了
      data-busy={frame.busy !== null ? 'true' : 'false'}
      data-busy-kind={frame.busy ?? undefined}
      // ★ 这一格有没有画。**给 CSS 用的是这一个属性，不是"里面有没有 .dk__art"**：
      //   图取不到时那一格会退回空框（下面那个 `broken`），而它仍然是"画好了"的一页
      data-filled={url && !broken ? 'true' : 'false'}
      // ★ 这一格属于哪一条支（工单 05 §三）。`null` = 主干上的页。
      //   属性留给 CSS 做左边那道窄色带，字母见下面那颗角标
      data-branch={frame.via ?? undefined}
    >
      {/* 窄色带：沿左边一整条。★ 它在**整排**上的样子才是重点——
          几格同色连成一段，"这几页是另一条路"一眼就看得出来，
          而单看一格只是一个记号 */}
      {frame.via && <span className="dk__band" aria-hidden="true" />}
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

      {/* 哪一条支（工单 05 §三）。★ 字母与闸门那一屏的「选项 A / 选项 B」是同一对
          字母——家长在那里改过的那两颗按钮，在这里认得出是哪一条。
          ★ `data-side` 是给 CSS 的：A 蓝、B 橙（2026-10-18 用户要的），
            颜色写在 `desk.css` 那一族规则里，这里只说"我是哪一支" */}
      {frame.via && (
        <span
          className="dk__branch"
          data-side={frame.via}
          title="这一页在岔路上：只有选了它那一条的孩子才会读到"
        >
          {frame.via === 'a' ? 'A' : 'B'}
          <span className="dk__sr">岔路 {frame.via === 'a' ? 'A' : 'B'} 支</span>
        </span>
      )}
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

/**
 * 一格底下那两颗（工单 05）。**只在整本做完之后才解锁**——用户的原话是
 * "在此期间用户不能修改"，而这一屏要能说得出"为什么现在还点不动"。
 *
 * ★ 两颗按钮**各自带可见文字**，不做成图标：它们决定了"重来一次要花一次钱"，
 *   而一个只有图标的动作在点下去之前不说清楚它做什么（`CreateLanding` 那两颗
 *   优化/换一句之所以能只留图标，是因为它们不动钱包）。
 */
function FrameActions({ pageNo, actions }: { pageNo: number; actions: DeskActions }) {
  const busyHere = actions.busy?.pageNo === pageNo
  const busyKind = busyHere ? actions.busy?.kind : undefined
  return (
    <div className="dk__acts">
      <button
        type="button"
        className="dk__act"
        disabled={!actions.ready || actions.busy !== null}
        onClick={() => actions.onRerun(pageNo, 'image')}
      >
        {busyKind === 'image' ? '正在重画…' : '重画'}
      </button>
      {actions.voiceOn && (
        <button
          type="button"
          className="dk__act"
          disabled={!actions.ready || actions.busy !== null}
          onClick={() => actions.onRerun(pageNo, 'audio')}
        >
          {busyKind === 'audio' ? '正在重配…' : '重配'}
        </button>
      )}
    </div>
  )
}

export type DeskActions = {
  /** 整本做完了没有。没做完时两颗都是禁用的（"在此期间用户不能修改"） */
  ready: boolean
  /** 这一本有没有配音。没有就只留「重画」——一个点不动的「重配」是假控件 */
  voiceOn: boolean
  /** 正在重做的那一页。`null` = 没有 */
  busy: { pageNo: number; kind: 'image' | 'audio' } | null
  onRerun: (pageNo: number, kind: 'image' | 'audio') => void
}

export type DeskProps = {
  desk: DeskState
  /**
   * ★ 原来还有一个 `drawn: number`（"已经画好几格"）。删掉了（2026-10-16）：
   *   它唯一的读者是那一行 `k / N 页画好了`，而那一行整块搬去了阶段轨
   *   （「逐页画 3 / 3」）。**一个传进来却没有读者的数字**会让下一个人以为
   *   这一屏还在某处显示它，然后去改一个不影响任何东西的 prop。
   *   `drawnCount()` 仍然在 `frames.ts`（阶段轨在用它），只是不再路过这里。
   */
  /** 不传 = 这一屏不给单页重做（每一格底下就没有那两颗按钮） */
  actions?: DeskActions
  /**
   * 这一本**已经发布**了没有。它只改收尾那一块的措辞：
   * 草稿说"每一页都做完了"（还在等你确认），成品才说"书做好了"。
   * ★ 不说这一句的话，草稿上那句"书做好了"与底下那颗「确定生成」互相打脸。
   */
  published?: boolean
  /**
   * 这一轮**还在跑**（服务端还在出图 / 配音）。它只决定一件事：
   * 进度条上那道走光扫不扫。
   *
   * ★ 为什么不是"由 `desk` 推"：画桌上没有任何一条事件说得出"这条流还开着"——
   *   最后一条事件停在哪儿，与"后面还有没有"是两件事（一轮跑完与一轮卡住，
   *   在事件流里长得一样）。所以这个事实由**拿着连接的那一方**（`GenerationRun`）给，
   *   而它也是唯一知道这件事的地方。
   */
  live?: boolean
}

export default function Desk({ desk, actions, published = false, live = false }: DeskProps) {
  const drawn = drawnCount(desk)
  const ratio = drawnRatio(desk)
  /**
   * 现在是不是在**编故事**那一段（还没有书名 = `plan-ready` 还没到）。
   *
   * ★ 判据是 `desk.stage === 'planning' && desk.title === null`，两个都要：
   *   重跑一本已经画过的书时，日志里**老的那条 `plan-ready` 还在**，那一刻
   *   `stage` 已经是 `planning` 而 `title` 不是 null —— 那不是"在编故事"，
   *   是"在重编这一本的故事，而屏幕上是上一版的画"，两者要说的话不一样。
   */
  const planning = desk.stage === 'planning' && desk.title === null
  /** 轮着播的那一句。`active` 为假时它回到第一句（见 `useRotatingLine`） */
  const planLine = useRotatingLine(PLAN_LINES, planning)
  return (
    <div className="dk">
      {/* ── 现在在第几段 + 走到哪儿了 ───────────────────────────────────
          ★ 2026-10-16 删掉了原来那一行 `dk__head`（书名 + `k / N 页画好了`）。
            两个原因，都是**屏幕上的实话**：
            ① 书名与 `k / N` 运行视图**都已经在说**了（那是它的 h1 和阶段轨上
               「逐页画 3 / 3」那一格）。同一句话说两遍不是冗余，是让读的人
               怀疑这两处哪一个才对。
            ② 更要紧的是这一行下面那条 `dk__stage`：`book-ready` 的原文是
               「书做好了：**xiaoyu-r1-4c1007d9223a**」——引擎那句话是给日志与 MCP
               看的（`describeEvent` 是全仓库唯一那一份），但摊在家长面前就是
               一个内部书号。所以收尾之后**不摊它**：运行视图自己那句
               「每一页都做完了」说得比它好，而且是给人看的。
          ★ 运行中那句仍然要留（"正在画第 7 页"是这一屏的卖点），只是收尾之后让位。
          ★ 2026-10-16 用户说"正在画怎么空拉拉的……比如加个进度条这些的"，
            于是在这句话下面补了一条真的进度条（下面 `.dk__bar` 那一段）。
            **没有另加一个数字**：`k / N` 仍然只在阶段轨上说一处（上面第 ① 条）。
            条的长度、那条走光、以及下面的说明都在 CSS 里，判据写在 `desk.css` 文件头。
          ★ 2026-10-18（文件头第 6 条）：编故事那一段换成轮播的那一句 + 橙色。
            其余阶段照旧摊引擎的原话——它们说的都是"正在画第 7 页"这种具体的事。 */}
      {(planning || (desk.stageLine && !desk.ready)) && (
        <div className="dk__prog">
          {planning ? (
            <p className="dk__stage" data-planning="true" role="status">
              {planLine}
            </p>
          ) : (
            <p className="dk__stage" role="status">
              {desk.stageLine}
            </p>
          )}
          {/* ★ 编故事那一段**真的失败过一次**时说的那句原话（`desk.planning`）。
              它只说"正在重写"以及**为什么**——第几次、什么事——不留历史，
              下一版写成了它就消失（`plan-ready` 那一处清）。
              ★ 用 `role="status"`：它是一条会自己出现的进展，不是一处错误，
                也不该抢读屏的焦点（真正的硬失败仍然走上面那个 `role="alert"`）。 */}
          {planning && desk.planning && (
            <p className="dk__plan-retry" role="status">
              {desk.planning}
            </p>
          )}
          {/* ★ 页数还不知道时（`plan-ready` 之前）**不摆这条**：
              一根分母是 0 的条只能画成"刚起步"的样子，那是在编一个进度 */}
          {desk.total > 0 && (
            <div
              className="dk__bar"
              role="progressbar"
              aria-label="已经画好的页数"
              aria-valuemin={0}
              aria-valuemax={desk.total}
              aria-valuenow={drawn}
              // 每一页一格刻度：这条于是与下面那排画框**数得上来是同一件事**
              style={{ '--dk-total': desk.total } as CSSProperties}
            >
              <span className="dk__bar-fill" style={{ width: `${ratio * 100}%` }} />
              {/* 走光：**只说在动**，不说还剩多久（引擎没报，见 desk.css 文件头第 3 条）。
                  整轮跑完之后（`live` 为假）它不出现——静止的条不该还在动 */}
              {live && <span className="dk__bar-beam" aria-hidden="true" />}
            </div>
          )}
        </div>
      )}

      {/* ── 那排画框 ─────────────────────────────────────────────────── */}
      {desk.frames.length > 0 && (
        <>
          {/* ★ 岔路那一句（工单 05 §三）。只在真的有支时才说，而且只说一次：
              角标（A / B）与左边缘那道窄色带是**标记**，标记不解释就得让人自己猜。
              ★ 措辞里没有"分支""树"这些词：家长看到的是一本书里两段不同的结尾
              ★ 2026-10-18 起**两条支的颜色不一样了**（A 蓝、B 橙，用户要的），
                所以这一句必须把颜色对上号——颜色自己说不了"哪一支是哪一支" */}
          {hasBranches(desk) && (
            <p className="dk__branches">
              标着 A / B 的是岔路那几页——<b className="dk__branches-a">蓝色是 A</b>、
              <b className="dk__branches-b">橙色是 B</b>
              。两条路各是一个完整的结尾，孩子只会读到其中一条。
            </p>
          )}
          <ol className="dk__frames">
            {desk.frames.map((frame) => (
              // ★ key 用**图的路径**，不是页码（2026-10-16）。理由是"这一格的图换了"
              //   在屏幕上是一件新事：换了 key 才会重新挂载，那一下的入场动画
              //   （`.dk__frame[data-filled='true']` 那圈闪 + `.dk__art` 的淡入）才播得出来。
              //   按页码做 key 的话，重画之后新图是**原地换 src**，屏幕上什么都不发生——
              //   而"我点的那一下有反应"正是用户点重画之后要看的东西
              <li key={frame.assetPath ?? `page-${frame.pageNo}`}>
                <Figure frame={frame} />
                {actions && <FrameActions pageNo={frame.pageNo} actions={actions} />}
              </li>
            ))}
          </ol>
        </>
      )}

      {/* 为什么现在还点不动重做。★ 禁用要给理由，不是灰着不说 */}
      {actions && !actions.ready && (
        <p className="dk__hint">每一页都完成之后，这里就能对单独一页重画 / 重配。</p>
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

      {/* ── 整排收成一张封面 + 一条路 ─────────────────────────────────────
             ★ 草稿也能翻开看——用户要先看过每一页才敢点「确定生成」，
             把那一条路藏到他发布之后，等于让他闭着眼确认 */}
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
            <p className="dk__done-title">{published ? '书做好了' : '每一页都做完了'}</p>
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
