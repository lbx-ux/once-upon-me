'use client'

/**
 * use-speech.ts —— 浏览器语音识别的一层薄壳（Web Speech API）
 *
 * 两处入口共用：创作输入框旁边那颗麦克风、共读版选择点下面那颗「用嘴说」。
 * 这一层只做"把一段话听完、把定稿交出去"，不判断内容——判断在 `speech.ts`
 * （纯函数、node 里能测），而这一层必须碰 `window`，所以它在测试里不出现。
 *
 * 六条约定，每条都对应一次会真发生的事：
 *
 * 1. **能力探测写在 effect 里**（`supported` 初值是 `null`）。
 *    服务端没有 `window`，首帧必须与服务端渲染一致；写成 `useState(detect())`
 *    会在 hydrate 时翻一次，React 会报 mismatch，而"按钮晚一帧出现"没有人看得出来。
 *
 * 2. **一次会话是一个对象，不是一组共享的 ref。**（2026-10-30 修掉的一个真 bug）
 *    浏览器的 `end` 是**异步**的：用户点一下停/取消，`abort()` 之后 `onend`
 *    可能要到下一帧才来。如果这期间用户又按了一次开始，旧会话的 `onend`
 *    会走到新会话身上——实测的坏法是"旧的那一次把新的 `rec` 引用清掉、
 *    把 `listening` 翻回 false"，而屏幕上那颗按钮还在听；更坏的一种是把旧句
 *    当成新句交出去（`finals` 是共享的）。所以每一次 `start()` 新建一个
 *    `Session`，所有可变状态（定稿、中间稿、计时器、取消标记）都挂在它上面，
 *    每个回调先问一句"我还是当前那一个吗"。
 *
 * 3. **一次会话只交一次定稿。** `onend` 与 `onerror` 都会来，浏览器不保证顺序；
 *    `session.delivered` 挡住第二次。重复提交的坏法是"孩子说了一遍，书翻了两页"。
 *
 * 4. **用户取消（`cancel`）不交定稿，也不报失败。**
 *    打字、点「开始创作」、离开这一屏都会取消——那些时候屏幕上不该弹一句
 *    "没听见"。取消会把会话从 `sessionRef` 上摘掉，于是它迟到的 `onend`
 *    连"我还是当前那一个吗"这一关都过不去。
 *
 * 5. **到点 `stop()`，不是 `abort()`。** 到点是为了把已经听到的那半句交出去，
 *    不是为了丢掉它。真正要丢的时候只有 `cancel()`。
 *
 * 6. **`continuous = false` + `maxAlternatives = 1`。**
 *    这一层要的是"一句话"，不是一段听写；多候选会让"选哪一条"变成第二个判断，
 *    而那个判断没有依据。连续识别在手机上调起一次要还很久，与"说完就关麦"相反。
 *
 * ★ 一句实话写在代码里：Chrome 的识别要把音频送到它自己的服务，连不上时
 *   `onerror` 给的是 `network`（`speech.ts` 有对应的那句人话）。Edge 走 Azure，
 *   一般能用；Firefox 没有这个 API。这不是这一层的 bug，是这一路的能力边界。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { speechTextOf, type SpeechFailure, type SpeechResultLike } from './speech.ts'

/**
 * 浏览器那几个事件的最小形状。TS 的 `lib.dom` 里没有 `SpeechRecognition`
 * （它至今不是标准），所以只能自己写一份——只写这一层用到的字段。
 */
type SpeechResultEvent = { resultIndex: number; results: ArrayLike<SpeechResultLike> }
type SpeechErrorEvent = { error: string }

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: SpeechResultEvent) => void) | null
  onerror: ((event: SpeechErrorEvent) => void) | null
  onend: (() => void) | null
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

/** 能力探测。★ 不导出：唯一的读者是下面这个 hook（`supported` 已经把它说出来了） */
function speechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null
}

/** 浏览器给的错误码 → 我们这一层的几种失败（文案在 `speech.ts`） */
function failureOf(error: string): SpeechFailure {
  switch (error) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'not-allowed'
    case 'no-speech':
      return 'no-speech'
    case 'network':
      return 'network'
    case 'audio-capture':
      return 'audio-capture'
    case 'aborted':
      return 'aborted'
    default:
      return 'unknown'
  }
}

/**
 * 一次识别会话的全部可变状态。
 * ★ 挂在会话上而不是 hook 上，理由见文件头第 2 条。
 */
type Session = {
  rec: SpeechRecognitionLike
  /** 已经定稿的文本 */
  finals: string
  /** 最后那段还没定稿的（点停时一起交出去，见 `onend`） */
  interim: string
  delivered: boolean
  cancelled: boolean
  failed: SpeechFailure | null
  timer: ReturnType<typeof setTimeout> | null
}

export type UseSpeechOptions = {
  /** 识别语言。缺省 `zh-CN`——这个产品的使用者只有一个语言 */
  lang?: string
  /** 最长听多久（毫秒）。到点自动 `stop`，把已经听到的交出去 */
  maxMs?: number
  /** 中间结果（含已经定稿的那部分），用来边听边往输入框里写 */
  onPartial?: (text: string) => void
  /** 定稿。一次会话最多来一次 */
  onFinal: (text: string) => void
  /**
   * 失败。`aborted` 也会来（那是用户自己取消的），调用方自己决定要不要说话；
   * 两处入口都选择不说——原因见 `speech.ts` 的 `speechFailureText`。
   */
  onFail?: (reason: SpeechFailure) => void
}

export type UseSpeech = {
  /** `null` = 还没到浏览器上（SSR / 首帧）；`true` / `false` = 能力探测的答案 */
  supported: boolean | null
  listening: boolean
  start: () => void
  /** 停，并把已经听到的定稿交出去 */
  stop: () => void
  /** 停，并且什么都不要交（用户打字 / 离开这一屏） */
  cancel: () => void
}

export function useSpeechInput(options: UseSpeechOptions): UseSpeech {
  const [supported, setSupported] = useState<boolean | null>(null)
  const [listening, setListening] = useState(false)

  /* 回调放 ref：不然每次渲染换一个新函数，`start` 的依赖就会变，
     而它一旦变，正在听的那一次其实没停（sessionRef 还在），下一次 start 就变成 no-op 了 */
  const handlersRef = useRef(options)
  useEffect(() => {
    handlersRef.current = options
  })

  const sessionRef = useRef<Session | null>(null)

  useEffect(() => {
    setSupported(speechRecognitionCtor() !== null)
  }, [])

  /**
   * 收掉一次会话：清计时器；只有它**还是当前那一个**时才动共享状态。
   * ★ 这一个判断就是文件头第 2 条那个 bug 的修法：旧会话迟到的 `end`
   *   不能把新会话的 `sessionRef` 与 `listening` 一起收掉。
   */
  const finish = useCallback((session: Session) => {
    if (session.timer !== null) {
      clearTimeout(session.timer)
      session.timer = null
    }
    if (sessionRef.current === session) {
      sessionRef.current = null
      setListening(false)
    }
  }, [])

  const start = useCallback(() => {
    const Ctor = speechRecognitionCtor()
    if (!Ctor) {
      handlersRef.current.onFail?.('unsupported')
      return
    }
    // 已经在听：一次只允许一个会话。再按一次走的是调用方的 stop
    if (sessionRef.current) return

    const rec = new Ctor()
    rec.lang = handlersRef.current.lang ?? 'zh-CN'
    rec.continuous = false
    rec.interimResults = true
    rec.maxAlternatives = 1

    const session: Session = {
      rec,
      finals: '',
      interim: '',
      delivered: false,
      cancelled: false,
      failed: null,
      timer: null,
    }
    sessionRef.current = session

    rec.onresult = (event) => {
      if (sessionRef.current !== session) return
      // 重建而不是增量：理由与不变量都写在 `speech.ts` 的 `speechTextOf` 上
      const { finals, interim } = speechTextOf(event.results)
      session.finals = finals
      session.interim = interim
      const text = (finals + interim).trim()
      if (text !== '') handlersRef.current.onPartial?.(text)
    }

    rec.onerror = (event) => {
      if (sessionRef.current !== session) return
      // 用户自己取消的那一次不算失败（见文件头第 4 条）
      if (session.cancelled) return
      const reason = failureOf(event.error)
      session.failed = reason
      handlersRef.current.onFail?.(reason)
    }

    rec.onend = () => {
      /*
       * 先收自己；再判断"还要不要交"。
       * ★ 定稿 + 最后那段没定稿的一起交：用户点停的那一刻，浏览器常常还没把它
       *   标成 final，只认定稿会得到"没听见"，而屏幕上刚写出来的字被撤回——
       *   那是这一路最像坏掉的一刻。中间结果是他真说过的，点停就是确认。
       */
      const current = sessionRef.current === session
      finish(session)
      if (!current || session.cancelled || session.delivered) return
      session.delivered = true
      const text = (session.finals + session.interim).trim()
      session.interim = ''
      if (text !== '') {
        handlersRef.current.onFinal(text)
        return
      }
      // 没定稿、也没报过错：真的什么都没听到
      if (session.failed === null) {
        handlersRef.current.onFail?.('no-speech')
      }
    }

    try {
      rec.start()
    } catch {
      // 已经开始过 / 权限策略拒绝：两种情况都只能报一次
      finish(session)
      handlersRef.current.onFail?.('unknown')
      return
    }

    // 若引擎在 start() 里同步地报错/结束，会话已经收掉了：不要再把灯点亮、也不要再上计时器
    if (sessionRef.current !== session) return
    setListening(true)
    session.timer = setTimeout(() => {
      // 会话可能已经自己结束了（或者被新会话顶掉）：到点只停"当前那一个"
      if (sessionRef.current !== session) return
      try {
        rec.stop()
      } catch {
        // 已经停了：onend 会走同一条收尾
      }
    }, handlersRef.current.maxMs ?? 8000)
  }, [finish])

  const stop = useCallback(() => {
    const session = sessionRef.current
    if (!session) return
    try {
      session.rec.stop()
    } catch {
      // 已经停了
    }
  }, [])

  const cancel = useCallback(() => {
    const session = sessionRef.current
    if (!session) return
    session.cancelled = true
    try {
      session.rec.abort()
    } catch {
      // 已经停了
    }
    finish(session)
  }, [finish])

  /* 卸载时收麦。★ 不调 `cancel()`：那会 setState；这里只要把识别停掉 */
  useEffect(() => {
    const sessions = sessionRef
    return () => {
      const session = sessions.current
      if (!session) return
      session.cancelled = true
      if (session.timer !== null) clearTimeout(session.timer)
      try {
        session.rec.abort()
      } catch {
        // 已经停了
      }
    }
  }, [])

  return { supported, listening, start, stop, cancel }
}
