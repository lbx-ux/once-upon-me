'use client'

/**
 * use-narration.ts —— 两个翻页阅读器共用的**朗读那一套**
 *
 * 起因是"第三份抄件"。`ReaderBook`（`/reader/[bookId]`）与 `BooklistReader`
 * （灵感书单那本样书）里各有一份 `speaking` / `audioFailed` / `audioRef` /
 * `stopSpeaking` / `toggleSpeaking` / `<audio onEnded onError>`，逐行几乎一样；
 * 而「自动朗读」（侧栏 设置 · 阅读偏好）要往这套逻辑里再加一条**会自己往前走的链**。
 * 再各抄一遍，两条链迟早漂成两个脾气——同一个产品里两个阅读器的朗读钮
 * 一个能自动翻一个不能，读起来像两个团队做的（`Dialog.tsx` 文件头为同一件事
 * 写过"两套关闭规矩"那笔账）。
 *
 * ★ **屏序号是这一层的单位**：第 k 屏（1-based）。封面是 `0`，封底是 `screenCount + 1`
 *   （叶数 = 屏数 + 1，见 `reader-model.ts` 的 `leafCountOf`）。
 *   "第几页"是两个阅读器各自的展示口径（`/reader` 报"第 N 页"、样书报"第 a–b 页"），
 *   由组件自己换算——所以 `audioFailed` 报出来的也是屏序号。
 *
 * ---------------------------------------------------------------------------
 * 自动朗读那一趟的三条规则
 *
 * 1. **按一下才开始**，而且按下那一刻就决定从哪儿念：在某一页上 = 从这一页往后念；
 *    在**封面或封底**上 = 从第 1 页念起（`autoCueOf` 的两个端点，那两屏不是页，
 *    自动朗读在它们上面没有别的可做）。
 *    ★ 为什么不"进阅读器就自己念"（用户 2026-10-17 拍板时否掉的那条）：
 *      浏览器不允许页面在**没人点过**的情况下出声，直接输网址进来的那种
 *      十有八九会被拦掉，而拦掉的样子与"这本书没有朗读"一模一样——
 *      一个说不清自己为什么没响的控件，证的是这一页想证的反面。
 * 2. **人翻页 = 人接管，这一趟就地结束**（`takeOver()`）。这条与两个阅读器里
 *    原本就写着的那句"翻页就停：朗读是『这一页的』"是同一条，只是现在多了一种
 *    走法——所以 ‹ › 永远说一不二，"按了 › 又自己翻回来"那种事不会发生。
 * 3. **声音跟着"翻到位的那一屏"走**（`settled`）。补间跑着的时候不起声音：
 *    不然孩子听见的是下一页的字、眼睛还停在上一页（翻页要 0.6 秒上下）。
 *
 * 两条防守，都是"不加就会以最难看的方式坏掉"：
 * · 音频读不出来 → **把这一趟关掉**。不关的话 `onEnded` 永远不来，
 *   这一屏就卡在"开着、却没声"，而界面上没有任何东西在说它卡住了。
 * · 正在念的那一屏不重放。这条链的依赖里有几个每次渲染都会换身份的东西，
 *   少了这一句，一次无关的 re-render 就会把进度拽回 0 秒（听感是一次结巴）。
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import { autoCueOf } from './reader-model.ts'
import type { TurnMode } from '@/lib/reading-prefs.ts'

export type NarrationOptions = {
  /** 第 k 屏（1-based）的朗读地址，长度 = 屏数；封面与封底**不在内**。`null` = 这一屏没录 */
  urls: readonly (string | null)[]
  /** **落定后**当前那一屏：`0` = 封面，`urls.length + 1` = 封底 */
  opening: number
  /** 补间停下了没有。★ 声音要等页翻到位再起（规则 3） */
  settled: boolean
  /** 翻到第 k 屏。**只有自动朗读这一趟会调它**——手动翻页走组件自己那条 `turn()` */
  goTo: (opening: number) => void
  /** 用户的阅读偏好（`lib/reading-prefs.ts`） */
  mode: TurnMode
}

/**
 * 朗读钮长什么样、说了什么。★ 算在 hook 里而不是各组件里：自动/手动 × 开/停
 * 是四种组合，两个阅读器各推一遍就是两份会漂的文案（`aria-label` 尤其容易漂，
 * 而它是读屏唯一的入口）。组件只管把 class 名套上去。
 */
export type NarrationButton = {
  label: string
  ariaLabel: string
  pressed: boolean
  /** ★ 手动模式下"这一屏没录"是禁用；自动模式下**永远可按**（见 hook 里那条注释） */
  disabled: boolean
}

export type Narration = {
  audioRef: RefObject<HTMLAudioElement | null>
  /** 判据 ①：**只要有一屏没有朗读，控件就不出现**（工单 08 §一） */
  fullyNarrated: boolean
  /** 正在念第几屏（`null` = 没在念）。★ 它属于"你正看着的那一屏" */
  speaking: number | null
  /** 读不出来的那一屏。**要说出来**，不许静默没声（判据 ②） */
  audioFailed: number | null
  /** 自动朗读这一趟开着没有 */
  autoOn: boolean
  button: NarrationButton
  /** 朗读钮按下去 */
  toggle: () => void
  /** 人翻页了 —— 叫它（规则 2） */
  takeOver: () => void
  /** 挂到 `<audio onEnded>` 上 */
  onEnded: () => void
  /** 挂到 `<audio onError>` 上 */
  onError: () => void
}

export function useNarration({ urls, opening, settled, goTo, mode }: NarrationOptions): Narration {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [speaking, setSpeaking] = useState<number | null>(null)
  const [audioFailed, setAudioFailed] = useState<number | null>(null)
  const [autoOn, setAutoOn] = useState(false)

  const screenCount = urls.length
  const fullyNarrated = screenCount > 0 && urls.every((url) => url !== null)
  /** 落定的这一屏有得念（封面与封底没有，没录的那一屏也没有） */
  const canSpeak = opening >= 1 && opening <= screenCount && (urls[opening - 1] ?? null) !== null

  const stop = useCallback(() => {
    const el = audioRef.current
    if (el) {
      el.pause()
      el.currentTime = 0
    }
    setSpeaking(null)
  }, [])

  /**
   * 念第 k 屏。
   * ★ 换屏必须**重设 `src`**：不重设就会从上一屏的播放位置接着放
   *   （症状是"点了没声"，因为上一段已经放完了）。
   */
  const speak = useCallback(
    (screen: number) => {
      const el = audioRef.current
      const url = urls[screen - 1] ?? null
      if (!el || !url) return
      el.src = url
      setAudioFailed(null)
      // ★ `play()` 返回 promise；被浏览器拦下或文件读不到时它会 reject。
      //   不接住的话控制台一条 unhandled rejection，而界面上什么都没发生——
      //   正是判据 ② 要挡的那种"静默没声"。
      //   ★ 自动朗读里起不来就**把这一趟停掉**：这一屏不会再有 `onEnded`，
      //     不关就是"开着却没声"地卡在这儿（与下面 `onError` 同一条）。
      void el.play().catch(() => {
        setAudioFailed(screen)
        setAutoOn(false)
      })
      setSpeaking(screen)
    },
    [urls],
  )

  /** 离开这一屏时把声音停掉。不然翻到别的页面，书还在念 */
  useEffect(() => () => audioRef.current?.pause(), [])

  /* ── 自动朗读：声音跟着"翻到位的那一屏"走（规则 1、3）───────────────────── */

  useEffect(() => {
    if (!autoOn || !settled) return
    const cue = autoCueOf(opening, screenCount)
    if (cue.kind === 'begin') {
      // 封面。★ 翻到第 1 屏就返回：翻页要花几百毫秒，这一帧起声音是抢跑
      goTo(1)
      return
    }
    if (cue.kind === 'done') {
      // 封底：这些字念完了
      setAutoOn(false)
      return
    }
    // 正在念的那一屏不重放（见文件头那条防守）
    if (speaking === cue.screen) return
    if ((urls[cue.screen - 1] ?? null) === null) {
      // 判据 ① 挡住了这种书，所以这里到不了；到得了说明数据变了，照实停下
      setAutoOn(false)
      return
    }
    speak(cue.screen)
  }, [autoOn, settled, opening, screenCount, goTo, speaking, urls, speak])

  const toggle = useCallback(() => {
    if (mode === 'auto') {
      if (autoOn) {
        setAutoOn(false)
        stop()
        return
      }
      // 封面与封底上按下去都是"从头念一遍"（规则 1）
      if (autoCueOf(opening, screenCount).kind !== 'speak') goTo(1)
      setAutoOn(true)
      return
    }
    // 手动：念 / 停，念的永远是**当前这一屏**
    if (!canSpeak) return
    if (speaking === opening) stop()
    else speak(opening)
  }, [mode, autoOn, opening, screenCount, goTo, canSpeak, speaking, stop, speak])

  /** 人翻页了：停声、这一趟结束（规则 2） */
  const takeOver = useCallback(() => {
    stop()
    setAutoOn(false)
  }, [stop])

  /**
   * 一段念完了。手动：回到安静就完事（"念完就停"是这一屏一直以来的规矩）；
   * 自动：往下翻一屏，剩下的交给上面那条 effect。
   * ★ 最后一屏念完就是"翻到封底"，于是那条 effect 判到 `done`，自己收工。
   */
  const onEnded = useCallback(() => {
    setSpeaking(null)
    if (mode === 'auto' && autoOn) goTo(opening + 1)
  }, [mode, autoOn, opening, goTo])

  /**
   * 音频读不出来。★ 除了记下"是哪一屏"，还要**把自动朗读停掉**：
   * 不关的话 `onEnded` 永远不来，这一趟就卡在"开着却没声"——而界面上
   * 没有任何东西在说它卡住了（判据 ② 要的就是不让这种沉默发生）。
   */
  const onError = useCallback(() => {
    if (speaking !== null) setAudioFailed(speaking)
    setSpeaking(null)
    setAutoOn(false)
  }, [speaking])

  const button: NarrationButton =
    mode === 'auto'
      ? {
          label: autoOn ? '■ 停止' : '▶ 自动朗读',
          // 封面与封底上那一下的意思是"从头念一遍"；在某一页上是"从这一页往后念"
          ariaLabel: autoOn
            ? '停止自动朗读'
            : canSpeak
              ? '从这一页开始自动朗读'
              : '从第一页开始自动朗读',
          pressed: autoOn,
          // ★ 自动模式下永远可按：这种书已经过了判据 ①（整本都有朗读），
          //   而封面与封底上按下去是"从头念一遍"，不是"这一面没有可念的"
          disabled: false,
        }
      : {
          label: speaking === opening ? '■ 停止' : '▶ 朗读',
          ariaLabel: canSpeak
            ? speaking === opening
              ? '停止朗读这一页'
              : '朗读这一页'
            : '封面与封底没有朗读',
          pressed: speaking === opening,
          disabled: !canSpeak,
        }

  return {
    audioRef,
    fullyNarrated,
    speaking,
    audioFailed,
    autoOn,
    button,
    toggle,
    takeOver,
    onEnded,
    onError,
  }
}
