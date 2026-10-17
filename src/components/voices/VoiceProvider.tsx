'use client'

/**
 * VoiceProvider —— 「声音」这件事的家（工单 06；工单 16 换成服务端那一份）
 *
 * 它是 `SettingsProvider` 活下来的那一半。2026-10-16 用户定下两件事，
 * 一件要删、一件要留：
 *
 *   · 「把前端用户自己输入 api-key 的模块取消了」 → `SettingsDrawer` 整格拆掉，
 *     `SettingsProvider` 里"模型与密钥"那一半（`settings` / `patch` / `env`）作废；
 *   · 「音色仍由用户选（含自己录的）」 → 音色那一半原样留着。
 *
 * ★★ 2026-10-17（工单 16）：「音色仍由用户选」这条没变，**但它存在哪儿变了**——
 *   从浏览器 localStorage 搬到账号上（用户的原话：「音色一并挂到账号上」）。
 *   理由只有一条而它足够：**换台设备就没了**。
 *
 *   于是这个文件里有三处跟着变，每一处都是那一条的直接后果：
 *
 *   1. **初始值不再是"挂载后读本机"**，而是一次 `GET /api/voices`。
 *      ★ "初值是空、挂载后再填"这条纪律**照样成立**（服务端也渲染得出来，
 *      hydration 不会不一致）——变的只是填进去的来源。
 *   2. **每一次改动都等服务的回话**，然后拿它**整份替换**本地状态，
 *      而不是自己推算"这一步之后应该是什么样"。失败时**什么都不改**：
 *      界面上仍然是服务端说的那一份，而不是"我以为我改成了"。
 *   3. **`voiceError` 是新的**。原来那几处写本机（localStorage）失败是静默的
 *      ——写不进去只影响"下次打开"，而这次失败意味着**这次也没成**，
 *      静默就等于骗人。所以失败要有一句话，由界面显出来（见 `VoicePicker`）。
 *
 * ★ 两条判断没变：
 *
 * 1. **音色住服务端，权限与"站里配好了没有"也住服务端**——但它们仍然是**两个家**：
 *    前者是"我要哪个嗓子"（我们的库），后者是"我能不能用嗓子"（Java 的权限）。
 *    所以这个 Provider 读 `useAuth()`，而不是自己再去请求一遍（再请求一遍
 *    就有两份 `permissions`，它们会漂）。
 *
 * 2. **`canNarrate` 由三条事实合成，但缺哪一条要说得出来**（`narrationBlockOf`）。
 *    用户看到"不能用"时下一步该做什么，恰好取决于缺的是哪一条：
 *    找站长开权限、等站里配好、还是自己挑一个。合成一个布尔就把这句话丢了。
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { useAuth } from '@/components/auth/AuthProvider.tsx'
import { voiceCatalog, type CatalogVoice } from '@/lib/voices/catalog.ts'
import {
  chooseVoice,
  fetchVoices,
  forgetVoiceOnServer,
  rememberVoiceOnServer,
} from '@/lib/voices/client.ts'
import {
  narrationBlockOf,
  speechBlockOf,
  type MyVoice,
  type NarrationBlock,
  type SpeechBlock,
} from '@/lib/voices/state.ts'

export type VoiceContextValue = {
  /**
   * 可选的音色 = **预设 + 我录的**（`lib/voices/catalog.ts`）。
   * ★ 一个值只有一个家：`/home` 的那一格、`/voice` 那一屏、运行视图都读这一份，
   *   不各自去 map `DEFAULT_VOICES`（那样迟早有一处忘了滤掉"模型对不上"的那些）。
   */
  voices: CatalogVoice[]
  /** 现在选的那个音色 id。空串 = 还没挑 */
  current: string
  /** 我录的那些（服务端那一份，名字 / 模型 / 时间） */
  myVoices: MyVoice[]
  /** 挑一个。**点一下即存**（用户 2026-10-16 定的：不用再按一次保存），存到账号上 */
  setVoice: (voiceId: string) => void
  /** 建好一条：记到账号上，并把它设为当前音色（刚录完就想用它，不必再点一下） */
  rememberVoice: (voice: MyVoice) => void
  /**
   * 从我的列表里删掉一条（**不碰厂商那边**，解绑是 `/api/voice/delete`）。
   * 服务端那边如果它正是当前，会把当前清空——**不回落**到另一个声音
   * （回落会让"我删掉的那个声音"变成另一个陌生声音）。
   *
   * ★ **回一个 Promise<boolean>**，与另外两个不一样：删除那条路上界面要说一句话
   *   （"记录删了，厂商那边没确认解绑"），而那句话的两半是**两次请求**的结果。
   *   不等它就只能猜，猜错的那一次说的是一句关于隐私的假话。
   */
  forgetVoice: (voiceId: string) => Promise<boolean>
  /**
   * 最近一次改动没成的那句话。`null` = 没有出过问题。
   * ★ 它必须被**显示出来**：这一轮的每一次改动都是"立刻生效"的，
   *   静默失败会让界面停在一个与账号里不一样的状态上，而它看起来完全正常。
   */
  voiceError: string | null
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
   * ★ 初值是空（服务端也渲染得出来），挂载后再去问服务端要那一份。
   *   这条纪律是从上一版原样带过来的（那时读的是 localStorage），它救过一次：
   *   拿外部状态当初值会让服务端与客户端渲染出两个样子。
   */
  const [current, setCurrent] = useState('')
  const [myVoices, setMyVoices] = useState<MyVoice[]>([])
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const { permissions, configured, speechModel, user } = useAuth()

  /**
   * 一次改动的统一收尾：把服务端回的那一份**整份**装进来。
   *
   * ★ 五处（读、切、记、删）都走这一步，与 `AdminScreen#settle` 同一个形状与
   *   同一个理由：自己推算"应该是什么样"的那一天起，"界面显示"与"账号里是什么"
   *   就开始各说各话，而下一次做书用的是**账号里那一份**。
   */
  const apply = useCallback((next: { voices: MyVoice[]; current: string }) => {
    setMyVoices(next.voices)
    setCurrent(next.current)
    setVoiceError(null)
  }, [])

  /**
   * 首屏那一份。
   *
   * ★ 依赖里是 `user.userId` 而不是空数组：登出再登录换一个人时，
   *   上一任的音色**必须**被换掉。空数组会让"甲登出、乙登入"之后
   *   乙看到甲的音色（而这个 Provider 不随登录态重挂）。
   *   取不到人（未登录）时清空——那是对的答案，声音本来就不属于游客。
   */
  useEffect(() => {
    if (!user) {
      setMyVoices([])
      setCurrent('')
      return
    }
    let alive = true
    void fetchVoices().then((result) => {
      if (!alive) return
      if (result.ok) apply(result.data)
      // ★ 读不到时**不改**（保持空）+ 说一句：把"读不到"显示成"你没有音色"
      //   会让人以为自己录的那些没了
      else setVoiceError(result.message)
    })
    return () => {
      alive = false
    }
  }, [user, apply])

  const settle = useCallback(
    (
      run: Promise<
        { ok: true; data: { voices: MyVoice[]; current: string } } | { ok: false; message: string }
      >,
    ) => {
      void run.then((result) => {
        if (result.ok) apply(result.data)
        else setVoiceError(result.message)
      })
    },
    [apply],
  )

  const setVoice = useCallback(
    (voiceId: string) => {
      // ★ 只带 id：名字与模型交给服务端拿它已经记着的那一份（见 `client.ts` 那段）
      settle(chooseVoice(voiceId))
    },
    [settle],
  )

  /**
   * 建好一条音色。★ 两件事一起做，因为它们本来就是一件事的后果：
   * 记下来（账号上那份列表）+ 把它设成当前音色（刚录完就想着用它）。
   */
  const rememberVoice = useCallback(
    (voice: MyVoice) => {
      settle(rememberVoiceOnServer(voice))
    },
    [settle],
  )

  const forgetVoice = useCallback(
    (voiceId: string): Promise<boolean> =>
      forgetVoiceOnServer(voiceId).then((result) => {
        if (result.ok) {
          apply(result.data)
          return true
        }
        setVoiceError(result.message)
        return false
      }),
    [apply],
  )

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
      voiceError,
      canNarrate: narrateBlock === null,
      narrateBlock,
      speechBlock,
    }),
    [
      voices,
      current,
      myVoices,
      setVoice,
      rememberVoice,
      forgetVoice,
      voiceError,
      narrateBlock,
      speechBlock,
    ],
  )

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>
}
