'use client'

/**
 * SettingsDrawer —— 模型与密钥的抽屉（工单 04）
 *
 * 形态是**抽屉不是侧栏**，理由三条（工单里定的）：
 *   ① 侧栏要占横向空间，而这一屏的空间是给书的（阅读器是单页书、创作流有表单）；
 *   ② 设置是"一天改一次"的东西，不是每次都看的东西——它的存在感应该在打开那一刻最大；
 *   ③ 抽屉在窄屏天然退化成全屏，一套实现两端成立。
 *
 * 四条不显然的约定：
 *
 * 1. **按能力分组，不按供应商分组**。用户想的是"我要让哪个能力动起来"，
 *    不是"这家供应商有几个 key"。所以四组 = 文字 / 图像 / 语音 / 视觉。
 * 2. **没接线的不出现**。语音这一组在配音落地之前是不存在的（那时摆一个灰色占位组
 *    就是"假装有"）。现在它在了，因为它真能响。
 * 3. **key 那一格上面写着它是临时的**。"刷新要重填"这件事必须写在填之前，
 *    不是等用户刷新后发现丢了再猜。
 * 4. **花用户钱的按钮要说价钱**。图像的"试一试"是 ¥0.2 一次，写在按钮上。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { FIXED_KNOBS_NOTE, type SettingsForm } from '@/lib/settings/state.ts'
import { useSettings } from './SettingsProvider.tsx'

type ProbeState = { busy: boolean; ok: boolean | null; detail: string }

const IDLE: ProbeState = { busy: false, ok: null, detail: '' }

const GROUPS: {
  key: keyof SettingsForm
  title: string
  hint: string
  probe: { capability: 'text' | 'image' | 'speech'; label: string; costs?: string } | null
}[] = [
  {
    key: 'text',
    title: '文字（写故事）',
    hint: '故事分镜与三个校验都走它',
    probe: { capability: 'text', label: '试一试' },
  },
  {
    key: 'image',
    title: '图像（画插画）',
    hint: '一页一张，尺寸与成本都是实测值',
    probe: { capability: 'image', label: '试一试', costs: '这次会花约 ¥0.2（一口价）' },
  },
  {
    key: 'speech',
    title: '语音（朗读）',
    hint: '这本书会不会有朗读，就看这一组填齐了没有',
    probe: { capability: 'speech', label: '试一试', costs: '这一次几乎不花钱（几个字）' },
  },
  {
    key: 'vision',
    title: '视觉（核对形象）',
    hint: '留空 = 不核对，引擎会如实标"未核对"，不会假装通过',
    // ★ 视觉没有便宜的探测法：它要**两张图**才有意义，而"试一试"不该为了探测去画一张。
    //   与其做一个假的，不如说清该去哪儿验（出形象那一步本来就会真跑一次比对）
    probe: null,
  },
]

export default function SettingsDrawer() {
  const { settings, patch, env, canNarrate, voices, open, closeSettings } = useSettings()
  const panelRef = useRef<HTMLDivElement>(null)
  const [probes, setProbes] = useState<Record<string, ProbeState>>({})

  /* ── Esc 关闭 + 焦点关在抽屉里 ──────────────────────────────────────────── */

  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    if (!panel) return

    const focusables = (): HTMLElement[] =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute('disabled'))

    // 打开就聚焦**第一个输入框**，而不是第一个可聚焦元素：
    // 后者是右上角那个关闭钮（它在 DOM 里排第一），键盘用户一进来就落在"关闭"上，
    // 得 Tab 过整页才能到要填的地方——实测过，那正是"抽屉能开但不好用"的样子
    const inputs = Array.from(panel.querySelectorAll<HTMLElement>('input, select'))
    ;(inputs[0] ?? focusables()[0])?.focus()

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeSettings()
        return
      }
      if (event.key !== 'Tab') return
      const list = focusables()
      if (list.length === 0) return
      const first = list[0]
      const last = list[list.length - 1]
      if (!first || !last) return
      // 焦点环绕：抽屉是模态的，Tab 不许跑到背后的页面上
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, closeSettings])

  /* ── 真打请求的那个"试一试" ────────────────────────────────────────────── */

  const runProbe = useCallback(
    async (capability: 'text' | 'image' | 'speech') => {
      setProbes((prev) => ({ ...prev, [capability]: { busy: true, ok: null, detail: '' } }))
      try {
        const response = await fetch('/api/settings/probe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ capability, env }),
        })
        const data = (await response.json()) as { ok?: boolean; ms?: number; detail?: string }
        setProbes((prev) => ({
          ...prev,
          [capability]: {
            busy: false,
            ok: data.ok === true,
            detail: `${data.ok ? '通了' : '没通'} · ${data.ms ?? '?'}ms · ${data.detail ?? ''}`,
          },
        }))
      } catch (err) {
        setProbes((prev) => ({
          ...prev,
          [capability]: {
            busy: false,
            ok: false,
            detail: err instanceof Error ? err.message : String(err),
          },
        }))
      }
    },
    [env],
  )

  if (!open) return null

  const field = (
    group: keyof SettingsForm,
    name: 'baseUrl' | 'apiKey' | 'model' | 'voice',
    label: string,
    placeholder: string,
    type: 'text' | 'password' = 'text',
  ) => (
    <label className="sd__row" key={`${group}-${name}`}>
      <span className="sd__label">{label}</span>
      <input
        className="sd__input"
        type={type}
        value={(settings[group] as unknown as Record<string, string>)[name] ?? ''}
        placeholder={placeholder}
        autoComplete={type === 'password' ? 'off' : undefined}
        spellCheck={false}
        onChange={(event) => patch(group, { [name]: event.target.value })}
      />
    </label>
  )

  return (
    <div className="sd" data-open="true">
      {/* 遮罩点一下就关。★ 它是给鼠标的捷径，键盘那条路是 Esc（上面那个 effect） */}
      <div className="sd__scrim" onClick={closeSettings} aria-hidden="true" />
      <div
        className="sd__panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="模型与密钥"
      >
        <header className="sd__head">
          <h2 className="sd__title">模型与密钥</h2>
          <button type="button" className="sd__close" onClick={closeSettings} aria-label="关闭设置">
            ✕
          </button>
        </header>

        {/* ★ 这句话必须写在填之前。key 的生存期是"这次会话"，不是缺陷而是承诺的代价 */}
        <p className="sd__note sd__note--warn">
          <b>key 只活在这次会话里</b>，刷新就要重填——这是我们不存你密钥的代价（ADR-0008：
          不落盘、不进日志、不进录制文件）。地址、模型名、音色会记住。
        </p>
        <p className="sd__note">
          朗读这一组 {canNarrate ? '已配齐' : '还没配齐'}：
          {canNarrate ? '接下来生成的书会有朗读。' : '接下来生成的书不会有朗读，界面上会如实说明。'}
        </p>

        <div className="sd__body">
          {GROUPS.map((group) => {
            const probe = group.probe
            const state = probes[probe?.capability ?? ''] ?? IDLE
            return (
              <section className="sd__group" key={group.key}>
                <h3 className="sd__group-title">{group.title}</h3>
                <p className="sd__group-hint">{group.hint}</p>
                {field(group.key, 'baseUrl', '地址', 'https://…/v1')}
                {field(group.key, 'apiKey', 'Key', '只活在这次会话里', 'password')}
                {field(group.key, 'model', '模型', '模型名一律自己填，代码里不写死')}
                {group.key === 'speech' && (
                  <>
                    {/* ★ 两个默认音色做成**两个按钮**而不是下拉：
                        下拉里"未选"与"自定义"会是同一个空值，看不出区别；
                        而且产品定义要的就是"系统提供两个默认音色"，两个按钮把它说清了 */}
                    <div className="sd__row">
                      <span className="sd__label">默认音色</span>
                      <div className="sd__voices">
                        {/* ★ 表来自 `SettingsProvider`（预设 + 我录的）：自己录的那条也要能在这里选到，
                            而"模型对不上"的那条会被 `voiceCatalog` 标成不可选（`title` 说明原因） */}
                        {voices.map((voice) => (
                          <button
                            type="button"
                            key={voice.id}
                            className="sd__voice"
                            aria-pressed={settings.speech.voice === voice.id}
                            disabled={!voice.usable}
                            title={voice.why}
                            onClick={() => patch('speech', { voice: voice.id })}
                          >
                            {voice.name}
                          </button>
                        ))}
                      </div>
                    </div>
                    {field('speech', 'voice', '音色 id', '预置名，或克隆来的 voice id')}
                    <p className="sd__group-hint">
                      音色绑定模型（实测：换个模型直接报 400）。换模型之后要重新选音色，
                      界面不会替你悄悄回落成另一个声音。
                    </p>
                  </>
                )}
                {probe ? (
                  <div className="sd__probe">
                    <button
                      type="button"
                      className="sd__probe-btn"
                      disabled={state.busy}
                      onClick={() => void runProbe(probe.capability)}
                    >
                      {state.busy ? '正在试…' : probe.label}
                    </button>
                    {probe.costs && <span className="sd__cost">{probe.costs}</span>}
                    {state.detail && (
                      <p className="sd__probe-out" data-ok={state.ok === true}>
                        {state.detail}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="sd__group-hint">
                    这一组没有「试一试」：视觉比对要两张图才有意义，为了探测去画一张图不划算。
                    要验它，请在出形象那一步出一张——那时会真跑一次比对，结果会如实显示。
                  </p>
                )}
              </section>
            )
          })}
        </div>

        <footer className="sd__foot">
          <p className="sd__note">{FIXED_KNOBS_NOTE}</p>
        </footer>
      </div>
    </div>
  )
}
