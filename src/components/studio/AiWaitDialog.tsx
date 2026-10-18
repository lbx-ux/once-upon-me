'use client'

/**
 * AiWaitDialog —— 「AI 正在干活」那一张纸（唯一的实现）
 *
 * ## 它为什么存在
 *
 * 2026-10-18 第 28 刀，用户的原话是「现在这个 ai 分析锚点和制作人物的 ai 制作过程
 * 好不明显，用户有时候都没发现你在制作，这该怎么解决，是弄一个弹窗把分析，锚点，
 * 制作人物图片，修改人物图片这个 ai 制作过程全部放到弹窗上（这样用户就知道了）」。
 *
 * 那一刀之前，这四件活各有各的说法：
 *
 * | 活 | 之前 | 现在 |
 * | --- | --- | --- |
 * | 读照片（`/character/new` 左栏，~45 s） | 左栏里一列小字（12.5px） | **同一张纸**（屏幕正中，标题 21px） |
 * | 出他的第一张形象（右上角，~24 s） | 右上角一列小字，**滚下去就看不见了** | 同上 |
 * | 重画一版 / 出第一张（详情页） | **一个字都没有**，只有按钮变成「正在画…」 | 同上 |
 *
 * ★ 判据不是"弹窗更好看"，是**那几十秒里用户的眼睛在哪儿**：右上角那一列
 *   在标题行里，而用户此刻十有八九正在往下滚、看那八条锚点写对没有。
 *   屏幕正中那一张纸是"这一屏此刻唯一在发生的事"，它不会被滚走。
 *
 * ## 三条不许破的规矩
 *
 * 1. **不编进度**。这一张纸里只有：这件活叫什么（标题）、真事件组成的几步
 *    （`steps`）、一句"还在办"（`say`，每 8 秒换一句）。**没有百分比**，
 *    也没有秒数——理由在 `lib/use-rotating-line.ts` 文件头。
 * 2. **收起 ≠ 取消**，而且是**明说**的（`aside` 那一句）。请求已经在飞，
 *    服务端照样在花钱、照样会写出结果，我们停不下来。不说这一句，
 *    那颗「收起」就会被读成"停了"。
 *    ★ 2026-10-18 第 30 刀，这一句**用户重写了两版**（现在住在 `wait-copy.ts` 的
 *      `IMAGE_ASIDE` / `READ_ASIDE` 两个常量里）：它现在不只说"还在跑"，
 *      还答了跟着来的那个问题——**"那我要不要自己刷新一次?"**（会自动更新 / 自动填好）。
 *    ★ 于是它**没有**「取消」——一个点下去只是把纸收走的"取消"比没有更糟。
 * 3. **收起之后进度回原地**，不是消失：`NewChild` / `ChildDetail` 在弹窗收起时
 *    把**同一列** `WaitSteps` 画回它原来住的地方（用的是同一份 `wait-copy.ts`，
 *    所以字一模一样）。这就是"两个家"的来由。
 *
 * ## 谁负责开、谁负责关
 *
 * ★ 它自己**什么也不记**：开与关由调用方那一个 `busy`/`reading` 推出来——
 *   活干完了 `job` 变成 `null`，这一张纸自己就没了（不需要谁去关它）。
 *   失败则相反：先由调用方把 `job` 收起来、再弹一张 "没成" 的纸
 *   （`ProblemsDialog`，那种纸的底栏是「知道了」）。两张纸**不会同时在屏幕上**。
 */

import Dialog from '@/components/dialog/Dialog.tsx'
import WaitSteps from '@/components/studio/WaitSteps.tsx'
import { waitCopyOf, type WaitFacts, type WaitJob } from '@/components/studio/wait-copy.ts'
import { useRotatingLine } from '@/lib/use-rotating-line.ts'

export type AiWaitDialogProps = {
  job: WaitJob
  /** 只有 `draw` 用得到（它是两段式的），见 `wait-copy.ts` 的 `WaitFacts` */
  facts?: WaitFacts
  /** 收起。★ **不是取消**（见文件头第 2 条）：调用方只管把它藏起来 */
  onHide: () => void
}

export default function AiWaitDialog({ job, facts, onHide }: AiWaitDialogProps) {
  const copy = waitCopyOf(job, facts)
  // ★ 这一张纸开着的时候它一定在跑：`active` 恒为 true（活干完了它就没了）
  const say = useRotatingLine(copy.lines, true)

  return (
    <Dialog
      title={copy.title}
      onClose={onHide}
      /* 它比判据那几张纸窄：里面是一列字，宽了会读成"一张公告" */
      width={420}
      /* ★ **不传 `initialFocus`**（与删除那个弹窗同一条道理）：焦点落在面板自己身上，
         读屏第一句念的是这个窗口叫什么（"正在读这张照片"），而不是底下那颗「收起」。
         ★ 而"焦点到底落在谁身上"在这块预览面板里量不了：`document.hasFocus()` 为 false
           时 Chrome 不更新 `activeElement`（`DeleteChildDialog.tsx` 记过同一件事）。
           这一条要在前台窗口按一次 Tab 才算真验过——**没有**验过，别当它是读数。 */
      footer={
        <button type="button" className="dlg__ghost" onClick={onHide}>
          收起
        </button>
      }
    >
      {/* 「还在办」那一句。★ 它是这一张纸上唯一会变的东西，每 8 秒换一句——
          所以它**只能靠轮播**来说"我还在动"，一个百分比都给不出。
          ★ `aria-hidden`：它换一次读屏就念一次，而三步那边已经用 `role="status"`
            念过一遍了（与 `WaitSteps` 里那一句同一条纪律）。 */}
      <p className="aw__say" aria-hidden="true">
        {say}
      </p>
      <WaitSteps steps={copy.steps} />
      <p className="dlg__hint">{copy.aside}</p>
    </Dialog>
  )
}
