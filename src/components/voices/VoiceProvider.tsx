'use client'

/**
 * VoiceProvider —— 「声音」这件事的家（工单 06）
 *
 * 它是 `SettingsProvider` 活下来的那一半。2026-10-16 用户定下两件事，
 * 一件要删、一件要留：
 *
 *   · 「把前端用户自己输入 api-key 的模块取消了」 → `SettingsDrawer` 整格拆掉，
 *     `SettingsProvider` 里"模型与密钥"那一半（`settings` / `patch` / `env`）作废；
 *   · 「音色仍由用户选（含自己录的）」 → 音色那一半原样留着。
 *
 * ★ 名字必须跟着改，不能留旧名。留着的话它就开始撒谎：下一次有人为了找
 *   "站里的密钥配在哪儿"点进 `useSettings`，会在里面翻到一堆音色。代价是七个调用点
 *   一次机械改名——一次做完，比让每个人各猜一次便宜。
 *
 * ★ 三条判断：
 *
 * 1. **音色住本机，权限与"站里配好了没有"住服务端**。前者是"我要哪个嗓子"，
 *    后者是"我能不能用嗓子"——两个问题，两个家。所以这个 Provider 读 `useAuth()`，
 *    而不是自己再去请求一遍（再请求一遍就有两份 `permissions`，它们会漂）。
 *
 * 2. **`canNarrate` 由三条事实合成，但缺哪一条要说得出来**（`narrationBlockOf`）。
 *    用户看到"不能用"时下一步该做什么，恰好取决于缺的是哪一条：
 *    找站长开权限、等站里配好、还是自己挑一个。合成一个布尔就把这句话丢了。
 *
 * 3. **`usable` 那条判据的输入从"用户填的模型"换成"站里的模型"**。
 *    克隆音色绑死在创建它时的 TTS 模型上（实测跨模型 400 `Engine error [411]`），
 *    而在 ADR-0008 那会儿这个模型是用户自己填的、客户端就有；
 *    现在只有服务端有，所以它跟着 `/api/auth/me` 一起回来（见那条路由的注释）。
 *    ★ 不换成"那就不判了"：不判的代价是用户点进去撞一个厂商的 400，
 *    而那句报错里没有任何一句话告诉他"要重新录一条"。
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { useAuth } from '@/components/auth/AuthProvider.tsx'
import { voiceCatalog, type CatalogVoice } from '@/lib/voices/catalog.ts'
import {
  loadCurrentVoice,
  narrationBlockOf,
  saveCurrentVoice,
  speechBlockOf,
  type NarrationBlock,
  type SpeechBlock,
} from '@/lib/voices/state.ts'
import { addMyVoice, loadMyVoices, removeMyVoice, type MyVoice } from '@/lib/voices/store.ts'

export type VoiceContextValue = {
  /**
   * 可选的音色 = **预设 + 我录的**（`lib/voices/catalog.ts`）。
   * ★ 一个值只有一个家：`/home` 的那一格、`/voice` 那一屏、运行视图都读这一份，
   *   不各自去 map `DEFAULT_VOICES`（那样迟早有一处忘了滤掉"模型对不上"的那些）。
   */
  voices: CatalogVoice[]
  /** 现在选的那个音色 id。空串 = 还没挑 */
  current: string
  /** 我录的那些（带创建时间与授权凭据号，删除时要用） */
  myVoices: MyVoice[]
  /** 挑一个。**点一下即存**（用户 2026-10-16 定的：不用再按一次保存） */
  setVoice: (voiceId: string) => void
  /** 建好一条：写进本地记录，并把它设为当前音色（刚录完就想用它，不必再点一下） */
  rememberVoice: (voice: MyVoice) => void
  /**
   * 删掉一条：本地记录跟着走；如果当前音色正指着它，**清空并如实说明**——
   * 不悄悄回落到另一个声音（那是"你的书突然换了个嗓子"）
   */
  forgetVoice: (voiceId: string) => void
  /** 这一轮生成的书会不会有朗读。= `narrateBlock === null` */
  canNarrate: boolean
  /**
   * 缺的是哪一条（三条都齐时是 `null`）。★ 界面要说的是**这一条**，
   * 不是笼统的"还没配齐"——三句话对应用户三个不同的下一步。
   */
  narrateBlock: NarrationBlock | null
  /**
   * 语音这条路通不通（**不带"挑没挑音色"**）。`/voice` 那一屏上"听一句真的"、
   * 克隆、删除要的是这一条：那三件事都不需要"当前音色"这个前提。
   */
  speechBlock: SpeechBlock | null
}

const VoiceContext = createContext<VoiceContextValue | null>(null)

export function useVoice(): VoiceContextValue {
  const value = useContext(VoiceContext)
  if (!value) throw new Error('useVoice 必须在 <VoiceProvider> 里用')
  return value
}

export default function VoiceProvider({ children }: { children: React.ReactNode }) {
  /**
   * ★ 初值是空（服务端也渲染得出来），挂载后再读本机存的那一份。
   *   直接拿 localStorage 当初值会让服务端与客户端渲染出两个样子（hydration 不一致），
   *   这条纪律是从上一版原样带过来的，它救过一次。
   */
  const [current, setCurrent] = useState('')
  const [myVoices, setMyVoices] = useState<MyVoice[]>([])
  const { permissions, configured, speechModel } = useAuth()

  useEffect(() => {
    setCurrent(loadCurrentVoice())
    setMyVoices(loadMyVoices())
  }, [])

  const setVoice = useCallback((voiceId: string) => {
    setCurrent(voiceId)
    saveCurrentVoice(voiceId)
  }, [])

  /**
   * 建好一条音色。★ 两件事一起做，因为它们本来就是一件事的后果：
   * 记下来（本机那份列表）+ 把它设成当前音色（刚录完就想着用它）。
   */
  const rememberVoice = useCallback((voice: MyVoice) => {
    setMyVoices(addMyVoice(voice))
    setCurrent(voice.voiceId)
    saveCurrentVoice(voice.voiceId)
  }, [])

  /**
   * 删掉一条。★ 当前音色正指着它时**清空**，而不是回落到另一个声音：
   * 回落会让"我删掉的那个声音"变成"另一个陌生声音"，而用户只是不想要那一条。
   * 清空之后 `narrateBlock` 会是 `no-voice`，界面照那句话拦。
   */
  const forgetVoice = useCallback((voiceId: string) => {
    setMyVoices(removeMyVoice(voiceId))
    setCurrent((now) => {
      if (now !== voiceId) return now
      saveCurrentVoice('')
      return ''
    })
  }, [])

  const voices = useMemo<CatalogVoice[]>(
    () => voiceCatalog(myVoices, speechModel),
    [myVoices, speechModel],
  )

  const speechBlock = useMemo<SpeechBlock | null>(
    () => speechBlockOf({ serverHasSpeech: configured.speech, allowed: permissions.speech }),
    [configured.speech, permissions.speech],
  )

  const narrateBlock = useMemo<NarrationBlock | null>(
    () =>
      narrationBlockOf({
        serverHasSpeech: configured.speech,
        allowed: permissions.speech,
        voiceId: current,
      }),
    [configured.speech, permissions.speech, current],
  )

  const value = useMemo<VoiceContextValue>(
    () => ({
      voices,
      current,
      myVoices,
      setVoice,
      rememberVoice,
      forgetVoice,
      canNarrate: narrateBlock === null,
      narrateBlock,
      speechBlock,
    }),
    [voices, current, myVoices, setVoice, rememberVoice, forgetVoice, narrateBlock, speechBlock],
  )

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>
}
