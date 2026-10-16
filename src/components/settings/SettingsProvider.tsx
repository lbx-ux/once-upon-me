'use client'

/**
 * SettingsProvider —— 模型与密钥这一份状态的家（工单 04）
 *
 * 它要做的事只有三件，但每件都有一个已经踩过的坑：
 *
 * 1. **key 只活在内存里**。刷新页面就没了，这是**认下来的代价**，不是待修的问题：
 *    ADR-0008 承诺"不落盘、不进日志、不进录制 manifest"，而设置页的本能就是持久化。
 *    所以这里把状态分成两半：`persisted`（base / 模型名 / 音色，写 localStorage）
 *    与 `secret`（key，只在 `useState` 里）。两者合成 `settings` 给外面用。
 *    ★ 不要为了"体验好一点"把 key 塞进 sessionStorage——sessionStorage 也是盘。
 * 2. **首屏必须服务端可渲染**。初值用 `DEFAULT_SETTINGS`（密钥为空），
 *    挂载后再从 localStorage 读回非密钥字段。直接读 localStorage 当初值会 hydration 不一致。
 * 3. **抽屉挂在 Provider 上**，不在各个页面里。这样 /create 与以后的主页共用一份，
 *    不会出现"两个抽屉各自一份状态、改了这边那边不知道"。
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import {
  DEFAULT_SETTINGS,
  loadStoredSettings,
  saveStoredSettings,
  speechReady,
  toEnv,
  type SettingsForm,
} from '@/lib/settings/state.ts'
import { voiceCatalog, type CatalogVoice } from '@/lib/voices/catalog.ts'
import { addMyVoice, loadMyVoices, removeMyVoice, type MyVoice } from '@/lib/voices/store.ts'
import SettingsDrawer from './SettingsDrawer.tsx'

export type SettingsContextValue = {
  settings: SettingsForm
  /** 改一组里的几个字段。key 也走这里——它只是不进持久层，不是不可改 */
  patch: (capability: keyof SettingsForm, fields: Partial<Record<string, string>>) => void
  /** 这一轮生成能不能跑（文本 + 图像齐了） */
  env: Record<string, string | undefined>
  /** 生成的书会不会有朗读 */
  canNarrate: boolean
  /**
   * 可选的音色 = **预设 + 我录的**（`lib/voices/catalog.ts`）。
   * ★ 它是设置的一部分：当前音色就是 `settings.speech.voice` 那一个字符串，
   *   所以这份表也住在这里——`/home`、设置抽屉、`/voice` 三处读它一个，
   *   不各自去 map `DEFAULT_VOICES`（那样迟早有一处忘了滤掉"模型对不上"的那些）。
   */
  voices: CatalogVoice[]
  /** 我录的那些（带创建时间与授权凭据号，删除时要用） */
  myVoices: MyVoice[]
  /** 建好一条：写进本地记录，并把它设为当前音色（刚录完就想用它，不必再点一下） */
  rememberVoice: (voice: MyVoice) => void
  /**
   * 删掉一条：本地记录跟着走；如果当前音色正指着它，**清空并如实说明**——
   * 不悄悄回落到另一个声音（那是"你的书突然换了个嗓子"）
   */
  forgetVoice: (voiceId: string) => void
  open: boolean
  openSettings: () => void
  closeSettings: () => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext)
  if (!value) throw new Error('useSettings 必须在 <SettingsProvider> 里用')
  return value
}

export default function SettingsProvider({ children }: { children: React.ReactNode }) {
  // ★ 初值是默认值（服务端也渲染得出来），挂载后再合并本地存的那半份
  const [settings, setSettings] = useState<SettingsForm>(DEFAULT_SETTINGS)
  /** 我录的音色。★ 与 settings 同一条路：初值空（服务端渲染得出来），挂载后再读盘 */
  const [myVoices, setMyVoices] = useState<MyVoice[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setSettings((current) => {
      const stored = loadStoredSettings()
      // 保留已经在内存里的 key（它们是本次会话填的），拿回非密钥字段
      return {
        text: { ...stored.text, apiKey: current.text.apiKey },
        image: { ...stored.image, apiKey: current.image.apiKey },
        vision: { ...stored.vision, apiKey: current.vision.apiKey },
        speech: { ...stored.speech, apiKey: current.speech.apiKey },
      }
    })
    setMyVoices(loadMyVoices())
  }, [])

  const patch = useCallback(
    (capability: keyof SettingsForm, fields: Partial<Record<string, string>>) => {
      setSettings((current) => {
        const next = {
          ...current,
          [capability]: { ...current[capability], ...fields },
        } as SettingsForm
        // ★ 持久化的白名单在 `storable()` 里（剥掉所有 apiKey）——这里不自己判断
        saveStoredSettings(next)
        return next
      })
    },
    [],
  )

  const env = useMemo(() => toEnv(settings), [settings])
  const canNarrate = useMemo(() => speechReady(settings), [settings])

  /**
   * 建好一条音色。★ 两件事一起做，因为它们本来就是一件事的后果：
   * 记下来（本地那份列表）+ 把它设成当前音色（刚录完就想着用它）。
   * 若模型现在还没填，`patch` 照写不误——`speechReady` 会如实说"还缺模型名"。
   */
  const rememberVoice = useCallback((voice: MyVoice) => {
    setMyVoices(addMyVoice(voice))
    setSettings((current) => {
      const next: SettingsForm = { ...current, speech: { ...current.speech, voice: voice.voiceId } }
      saveStoredSettings(next)
      return next
    })
  }, [])

  /**
   * 删掉一条。★ 当前音色正指着它时**清空**，而不是回落到另一个声音：
   * 回落会让"我删掉的那个声音"变成"另一个陌生声音"，而用户只是不想要那一条。
   * 清空之后界面会说"还要再挑一个"（`speechReady` 为 false 时那一屏本来就会拦）。
   */
  const forgetVoice = useCallback((voiceId: string) => {
    setMyVoices(removeMyVoice(voiceId))
    setSettings((current) => {
      if (current.speech.voice !== voiceId) return current
      const next: SettingsForm = { ...current, speech: { ...current.speech, voice: '' } }
      saveStoredSettings(next)
      return next
    })
  }, [])

  const voices = useMemo<CatalogVoice[]>(
    () => voiceCatalog(myVoices, settings.speech.model.trim()),
    [myVoices, settings.speech.model],
  )

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      patch,
      env,
      canNarrate,
      voices,
      myVoices,
      rememberVoice,
      forgetVoice,
      open,
      openSettings: () => setOpen(true),
      closeSettings: () => setOpen(false),
    }),
    [settings, patch, env, canNarrate, voices, myVoices, rememberVoice, forgetVoice, open],
  )

  return (
    <SettingsContext.Provider value={value}>
      {children}
      <SettingsDrawer />
    </SettingsContext.Provider>
  )
}
