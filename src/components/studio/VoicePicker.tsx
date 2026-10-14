'use client'

/**
 * VoicePicker —— 工作台的「声音」那一屏
 *
 * ★ 选音色这件事**没法用文字判断**。"男童声（5 岁）"这五个字不告诉你它念童书是什么调子——
 *   本轮就是听了三段真音频才定下这两个默认音色的。所以这里每张卡都能**听一句真的**，
 *   那句还是演示书第 1 页的原句（真语料，不是"测试文本一二三"）。
 *
 * ★ 「上传自己的声音」这一条**只做了一句说明，没做控件**。
 *   克隆音色的闭环（录音 → 拿 voice_id → 能删）在引擎侧已经验过，
 *   但界面上还没有采集与授权的那一步——摆一个传上去没用的上传框就是假装
 *   （CLAUDE.md「没有的东西直说没有」）。所以这里写明"还没做"。
 */

import { useRef, useState } from 'react'

import { DEFAULT_VOICES, speechReady } from '@/lib/settings/state.ts'
import { useSettings } from '@/components/settings/SettingsProvider.tsx'

export default function VoicePicker() {
  const { settings, patch, env } = useSettings()
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const configured = speechReady(settings)

  const preview = async (voiceId: string): Promise<void> => {
    const el = audioRef.current
    if (!el) return
    if (playing === voiceId) {
      el.pause()
      setPlaying(null)
      return
    }
    setError(null)
    setPlaying(voiceId)
    try {
      const response = await fetch('/api/voice/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ env, voiceId }),
      })
      if (!response.ok) {
        throw new Error((await response.text()).slice(0, 120) || `HTTP ${response.status}`)
      }
      const buffer = await response.arrayBuffer()
      // 试听不落盘：把字节包成一个本次会话内的对象地址，换一段就 revoke
      const url = URL.createObjectURL(
        new Blob([buffer], { type: response.headers.get('content-type') ?? 'audio/mpeg' }),
      )
      el.src = url
      await el.play()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPlaying(null)
    }
  }

  return (
    <section className="vc">
      <header className="vc__head">
        <h1 className="vc__title">声音</h1>
        <p className="vc__sub">
          选一个音色，之后做的每一本书都用它念。已经做完的书不会重录——
          朗读是那一本书的产物，不是设置的一个视图。
        </p>
      </header>

      {!configured && (
        <p className="vc__warn" role="alert">
          语音还没配齐（要 Key、模型名和音色三样）。现在能选音色，但<strong>听不到</strong>，
          做出来的书也没有朗读。去「模型与密钥」补上。
        </p>
      )}

      <ul className="vc__grid">
        {DEFAULT_VOICES.map((voice) => {
          const selected = settings.speech.voice === voice.id
          return (
            <li key={voice.id}>
              <article className="vc__card" data-selected={selected}>
                <button
                  type="button"
                  className="vc__pick"
                  onClick={() => patch('speech', { voice: voice.id })}
                  aria-pressed={selected}
                >
                  <span className="vc__name">{voice.label}</span>
                  <span className="vc__id">{voice.id}</span>
                  <span className="vc__state">{selected ? '当前音色' : '选它'}</span>
                </button>
                <button
                  type="button"
                  className="vc__listen"
                  onClick={() => void preview(voice.id)}
                  disabled={!configured}
                >
                  {playing === voice.id ? '正在听…' : '听一句真的'}
                </button>
              </article>
            </li>
          )
        })}
      </ul>

      {error && (
        <p className="vc__error" role="alert">
          试听没成功：{error}
        </p>
      )}

      <div className="vc__own">
        <h2 className="vc__own-title">用自己的声音</h2>
        {/* ★ 这一句是"没有的东西直说没有"。引擎侧的闭环（创建 → 使用 → 删除 voice_id）
            已经实测通过，缺的是界面上的采集与授权那一步 */}
        <p className="vc__own-body">
          还没做。要放的是：录 10–20 秒你自己的声音 → 生成一个只属于这本书的音色 →
          不想要时能删掉。做好了会出现在这里。
        </p>
      </div>

      {/* 试听是一次性的：不缓存、不进资产根 */}
      <audio ref={audioRef} aria-hidden="true" onEnded={() => setPlaying(null)} />
    </section>
  )
}
