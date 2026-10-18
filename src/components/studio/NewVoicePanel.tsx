'use client'

/**
 * NewVoicePanel —— 「新建声音」：同意 → 采集 → 试听 → 生成
 *
 * 它是 `.scratch/voice-clone/` 这一轮真正的那件东西。五条按顺序写在下面，
 * 每一条都是别人踩过的地方：
 *
 * 1. **同意是这一步的前置条件，不是一句文案**。勾了才出现录音钮；而且这次勾选会变成
 *    `consentRef`（一个只指代"这一次授权"的凭据号）随请求发出去——服务端少了它就 400
 *    （`lib/voices/request.ts`）。"没有那一次同意就没有这条音色"因此在**接口上**成立，
 *    而不只在界面上成立。
 * 2. **我们发出去的样本 = 你刚听的那一段**。浏览器录到的是 webm/opus（厂商不收），
 *    所以中间要转成 16kHz 单声道 WAV（`lib/audio/capture.ts`）。试听放的**就是转好的
 *    那串字节**，不是原始录音——这样"发出去的东西有没有被转坏"当场就能听出来，
 *    而不是等生成出来听着不对再回头怀疑。
 * 3. **样本不留存**。它只活在内存与那一次请求体里：不落盘、不进本地记录、不进日志。
 *    这也是为什么这一屏没有"我的录音"列表——那种列表本身就是在留样本。
 * 4. **在录的那一刻要说清在录什么**（计时 + 一个静止模式下也读得出来的状态），
 *    以及**麦克风被拒/没有麦克风时**还有"选一个音频文件"那条路。
 * 5. **建完之后立刻真合成一次**，通了才说"能用了"；没通就说"还在部署中"
 *    （`list_voice` 里新建的音色 status 是 `DEPLOYING`，这是实测见过的真实状态）。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import {
  fmt,
  sampleProblem,
  toBase64,
  toSample,
  type Sample,
  type SampleProblem,
} from '@/lib/audio/capture.ts'
import { PREVIEW_LINE } from '@/lib/settings/preview-line.ts'
import { newConsentRef } from '@/lib/voices/consent.ts'
import type { MyVoice } from '@/lib/voices/state.ts'
import { useVoice } from '@/components/voices/VoiceProvider.tsx'

/** 厂商上限 60 秒。★ 到点自动停，但**不是**在理想的 20 秒处停——
 *  正说到一半被掐掉，比多录 10 秒难受得多 */
const HARD_MAX_MS = 60_000
/** 计时器每 100ms 一次：屏幕上要跳的是"秒数"，用 rAF 是浪费 */
const TICK_MS = 100

type Step = 'consent' | 'recording' | 'review' | 'creating' | 'done'

export default function NewVoicePanel({ onClose }: { onClose: () => void }) {
  const { rememberVoice } = useVoice()
  const [consented, setConsented] = useState(false)
  const [step, setStep] = useState<Step>('consent')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [sample, setSample] = useState<Sample | null>(null)
  const [problem, setProblem] = useState<SampleProblem | null>(null)
  const [name, setName] = useState('我的声音')
  const [error, setError] = useState<string | null>(null)
  /** 建完之后那次真合成的结果：能用了 / 还在部署中 */
  const [deploy, setDeploy] = useState<'ready' | 'deploying' | null>(null)
  const [created, setCreated] = useState<MyVoice | null>(null)
  /**
   * 试听地址。★ 放在 state 里而不是只放 ref：`<audio src>` 是渲染的一部分，
   * 只在 ref 里改的话，设好地址那一次重渲染不一定排得上。ref 那份只是给
   * 卸载时的清理用的（那时 state 已经读不到了）
   */
  const [url, setUrl] = useState<string | null>(null)

  const panelRef = useRef<HTMLDivElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const startedAtRef = useRef(0)
  const urlRef = useRef<string | null>(null)

  /** 收麦：录完/离开这一屏都要停掉音轨，否则浏览器那个"正在使用麦克风"的红点会一直亮着 */
  const stopMic = useCallback((): void => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  /** 换/放掉那个地址。★ 先 revoke 旧的再设新的：留下一个已吊销的地址，播放时才报错 */
  const putUrl = useCallback((next: string | null): void => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    urlRef.current = next
    setUrl(next)
  }, [])

  // Esc 关、卸载时把麦克风与那个地址一起放掉
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // 正在生成时不许关：那一下会把"到底成了没有"断在半路
      if (event.key === 'Escape' && step !== 'creating') onClose()
    }
    window.addEventListener('keydown', onKey)
    panelRef.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose, step])

  useEffect(() => {
    return () => {
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
      stopMic()
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    }
  }, [stopMic])

  /** 一段录到/选到的音频 → 我们要发出去的那份样本 */
  const takeSample = async (blob: Blob): Promise<void> => {
    try {
      const next = await toSample(blob)
      putUrl(URL.createObjectURL(new Blob([next.bytes], { type: next.mime })))
      setSample(next)
      setProblem(sampleProblem(next.durationMs))
      setError(null)
      setStep('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStep('consent')
    }
  }

  const startRecording = async (): Promise<void> => {
    setError(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('这个浏览器给不了麦克风（可能需要 https）。用下面那个「选一个音频文件」吧。')
      return
    }
    let stream: MediaStream
    try {
      // ★ 关掉三件"好听但不像你"的处理：回声消除/降噪/自动增益都会改音色，
      //   而这一屏要的正是"像你"
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
    } catch (err) {
      const name = (err as { name?: string }).name ?? ''
      setError(
        name === 'NotAllowedError'
          ? '麦克风没被允许。可以在地址栏那把权限打开再试，或者直接选一个音频文件。'
          : '没能打开麦克风（这台机器上可能没有）。用下面那个「选一个音频文件」吧。',
      )
      return
    }
    streamRef.current = stream
    const recorder = new MediaRecorder(stream)
    recorderRef.current = recorder
    chunksRef.current = []
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data)
    }
    recorder.onstop = () => {
      const type = recorder.mimeType || 'audio/webm'
      const blob = new Blob(chunksRef.current, { type })
      stopMic()
      void takeSample(blob)
    }
    startedAtRef.current = Date.now()
    setElapsedMs(0)
    recorder.start()
    setStep('recording')
    timerRef.current = window.setInterval(() => {
      const ms = Date.now() - startedAtRef.current
      setElapsedMs(ms)
      if (ms >= HARD_MAX_MS) recorderRef.current?.stop()
    }, TICK_MS)
  }

  const stopRecording = (): void => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }

  const backToStart = (): void => {
    putUrl(null)
    setSample(null)
    setProblem(null)
    setElapsedMs(0)
    setStep('consent')
  }

  const create = async (): Promise<void> => {
    if (!sample) return
    setStep('creating')
    setError(null)
    const consentRef = newConsentRef()
    let voice: MyVoice
    try {
      const response = await fetch('/api/voice/clone', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          // ★ 请求体里**没有 env** 了（2026-10-17）：密钥由站长分配，只从服务端环境来
          sampleBase64: toBase64(sample.bytes),
          mime: sample.mime,
          name,
          consentRef,
        }),
      })
      if (!response.ok) {
        throw new Error((await response.text()).slice(0, 200) || `HTTP ${response.status}`)
      }
      const data = (await response.json()) as { voiceId?: string; modelId?: string; name?: string }
      if (!data.voiceId) throw new Error('厂商那边没有回 voice_id')
      // ★ 2026-10-17（工单 16）：这里原来还带一个 consentRef——那份记录住在
      //   localStorage 时，它被原样存下来。现在记录住在账号上（voices 表），
      //   而凭据号是**一次性**的东西：进了持久层，下一次有人读它就会以为
      //   那是一次仍然有效的授权。所以它只走请求，不进记录。
      voice = {
        voiceId: data.voiceId,
        name: data.name ?? name,
        modelId: data.modelId ?? '',
        createdAt: Date.now(),
      }
    } catch (err) {
      // ★ 失败就说失败：卡片不出现、本地记录不写。绝不"先记下来，回头再慢慢修"——
      //   那样列表里会有一条永远发不出声的音色
      setError(err instanceof Error ? err.message : String(err))
      setStep('review')
      return
    }
    rememberVoice(voice)
    setCreated(voice)
    setStep('done')
    // 建完立刻真合成一次：厂商那边新建的可能是 DEPLOYING，界面不许假装秒好
    try {
      const probe = await fetch('/api/voice/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ voiceId: voice.voiceId, text: PREVIEW_LINE }),
      })
      setDeploy(probe.ok ? 'ready' : 'deploying')
    } catch {
      setDeploy('deploying')
    }
  }

  const blocked = problem?.level === 'block'
  const canRecord = consented && step !== 'creating'

  return (
    <div className="nv" data-step={step}>
      <div
        className="nv__scrim"
        onClick={() => step !== 'creating' && onClose()}
        aria-hidden="true"
      />
      <div
        className="nv__panel"
        role="dialog"
        aria-modal="true"
        aria-label="新建声音"
        ref={panelRef}
        tabIndex={-1}
      >
        <header className="nv__head">
          <h2 className="nv__title">录一段你的声音</h2>
          <button
            type="button"
            className="nv__close"
            onClick={onClose}
            disabled={step === 'creating'}
            aria-label="关闭"
          >
            ✕
          </button>
        </header>

        {/* ① 同意。★ 它排在所有动作之前，而且勾了才出现录音钮 */}
        {step === 'consent' && (
          <>
            <div className="nv__consent">
              {/* ★ 2026-10-16 用户把这一段砍掉了一半：原来三条，现在两条。
                  砍掉的是"这段录音不会留下来…"那一条（还有底部那句同样意思的）。
                  **它说的那件事没有变**，只是不再占一段话——它挪到了「开始录音」那颗钮的
                  `title` 上（鼠标停一下、读屏读一下都有），同页头那条横幅的处理。
                  ★ 第二条原来写的是"只录你自己"，用户指出那是错的：爸爸录、妈妈录都行，
                  那句话把家里另一位挡在外面了。现在的说法是"录的是给孩子念书的那个人"。 */}
              <p>
                <strong>录的是给孩子念书的那个人</strong>——爸爸、妈妈、家里谁都行，别录孩子。
                这条音色会拿它合成，所以它属于录音里的那个人。
              </p>
              <p>
                <strong>之后念书的是合成出来的声音</strong>，不是你的录音。像不像要听过才知道，
                所以下一步会让你先听一遍。
              </p>
            </div>
            <label className="nv__check">
              <input
                type="checkbox"
                checked={consented}
                onChange={(event) => setConsented(event.target.checked)}
              />
              {/* ★ 2026-10-16 用户把原来那句长标签（"我确认：录的是大人自己的声音，不是孩子的"）
                  划掉了——上面两条已经把这件事说完了，勾选框只是**那一次同意**本身。
                  所以它留成最短的一句「我同意」，而不是再复述一遍。
                  ★ 框**没有去掉**：上面那段话是"说明"，勾才是"同意"——而"录音前单独一次同意"
                  这条（用户自己的口径，写在 `.scratch/voice-clone/spec.md`）需要一个动作来兑现。
                  去掉框 = 只剩说明，`consentRef` 那个凭据也就没有对应的事件了。 */}
              <span>我同意</span>
            </label>

            <div className="nv__acts">
              <button
                type="button"
                className="nv__go"
                onClick={() => void startRecording()}
                disabled={!canRecord}
                title={
                  consented
                    ? /* ★ 上面那条被砍掉的话在这里：按钮上是唯一还能读到它的地方 */
                      '开始录音。录的这一段只用来生成音色——它只在生成的那一次请求里出现过，不落盘、不留档'
                    : '先勾上面那一条'
                }
              >
                开始录音
              </button>
              {/* ★ 第二条路：麦克风被拒、或手里本来就有一段录音时，别让人卡在这一步 */}
              <label className="nv__file">
                <input
                  type="file"
                  accept="audio/*"
                  disabled={!canRecord}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) void takeSample(file)
                    event.target.value = ''
                  }}
                />
                <span>或选一个音频文件</span>
              </label>
            </div>
          </>
        )}

        {/* ② 在录。★ 状态靠**文字**（秒数）说，不靠一个会动的点 */}
        {step === 'recording' && (
          <div className="nv__recording">
            <p className="nv__rec-state">
              <span className="nv__dot" aria-hidden="true" />
              正在录 · <strong>{fmt(elapsedMs)}</strong>
            </p>
            <p className="nv__rec-hint">
              念一段话，或者就聊两句今天干了什么。10–20 秒最像你； 最长到 60 秒会自动停。
            </p>
            <div className="nv__acts">
              <button type="button" className="nv__go" onClick={stopRecording}>
                录好了
              </button>
            </div>
          </div>
        )}

        {/* ③ 试听 + 起名 */}
        {(step === 'review' || step === 'creating') && sample && (
          <>
            <div className="nv__review">
              <p className="nv__review-title">
                你录的这一段（{fmt(sample.durationMs)}）
                <span className="nv__review-note">发出去的就是这一段：16kHz 单声道 WAV</span>
              </p>
              {/* 播放器用原生 `controls`：这一屏要的是"能不能听清"，不是又一套自绘控件 */}
              <audio className="nv__audio" controls src={url ?? undefined} />
              {problem && (
                <p className="nv__problem" data-level={problem.level} role="status">
                  {problem.message}
                </p>
              )}
              <label className="nv__name">
                <span>给它起个名字</span>
                <input
                  type="text"
                  value={name}
                  maxLength={24}
                  disabled={step === 'creating'}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
            </div>
            <div className="nv__acts">
              {/* ★ 2026-10-18 用户："正在生成音频这太单调了，好歹加一个'创作'那优化提示词
                  那样的呼吸灯样式啊"。原来这一颗忙起来落进 `:disabled`，
                  而那条把底色换成 `--dot`（18% 的墨）压白字——**忙被画成了坏**，
                  而且那四个字几乎读不出来。现在忙有自己的 `data-busy`
                  （实心橙 + 一圈荡出去的光，与 `.cl__optimize` 逐条同款），
                  `:disabled` 只管"真的不能用"（名字空着）。
                  ★ `aria-busy`：字面上"正在生成…"会说，但读屏的语义要靠它。 */}
              <button
                type="button"
                className="nv__go"
                data-busy={step === 'creating' ? 'true' : 'false'}
                aria-busy={step === 'creating' || undefined}
                onClick={() => void create()}
                disabled={blocked || step === 'creating'}
              >
                {step === 'creating' ? '正在生成…' : '生成音色'}
              </button>
              <button
                type="button"
                className="nv__ghost"
                onClick={backToStart}
                disabled={step === 'creating'}
              >
                重录
              </button>
            </div>
          </>
        )}

        {/* ④ 成了 / 还在部署 */}
        {step === 'done' && created && (
          <div className="nv__done">
            <p className="nv__done-title">「{created.name}」建好了</p>
            <p className="nv__done-state" data-state={deploy ?? 'checking'}>
              {deploy === 'ready'
                ? '已经能用了：这一句就是用它合成出来的（在下面那张卡上按「听一句真的」）。'
                : deploy === 'deploying'
                  ? '厂商那边还在部署这条音色（新建的音色不一定是秒好的）。过一会儿再按「听一句真的」试试。'
                  : '正在试它能不能出声…'}
            </p>
            <div className="nv__acts">
              <button type="button" className="nv__go" onClick={onClose}>
                好
              </button>
            </div>
          </div>
        )}

        {error && (
          <p className="nv__error" role="alert">
            没成：{error}
          </p>
        )}

        {/* ★ 这里原来还有一句"这一段只用来生成音色，生成完就没了…"。用户把它划掉了
            （与上面那一段是同一件事说两遍），同一件事只在「开始录音」那颗钮的 `title` 里留一份。 */}
      </div>
    </div>
  )
}
