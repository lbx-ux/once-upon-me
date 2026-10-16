/**
 * voices/catalog.ts —— 一张表：**预设 + 我录的**
 *
 * ★ 为什么要有这个文件，而不是让各处继续 `DEFAULT_VOICES.map(...)`：
 *   捞过界的东西会各写一遍。`/home` 的药丸、设置抽屉的两颗钮、`/voice` 那一屏，
 *   三处都得知道"除了系统给的两个，用户自己还有几条"——三处各写一遍，
 *   迟早有一处忘了过滤"模型对不上的那些"。
 *
 * ★ `usable` 是一等字段，不是界面自己推的：
 *   克隆音色建的时候绑死在当时的 TTS_MODEL 上（实测跨模型 400 `Engine error [411]`）。
 *   判据只有这一处产生，界面照它禁用 + 照 `why` 说话——**不许默默让用户点进去撞 400**。
 *   （预设音色**不判定**：我们没有"它支持哪些模型"的实测记录，不编一个。）
 */

import { DEFAULT_VOICES, type VoiceOption } from '@/lib/settings/state.ts'
import type { MyVoice } from './store.ts'

export type CatalogVoice = VoiceOption & {
  /** 来源。★ 标在**来源**上，不是记录里的一个字段——字段会说谎，来源不会（同角色墙的「示例」） */
  source: 'preset' | 'mine'
  /** 只有我录的有：建它的模型与时间 */
  modelId?: string
  createdAt?: number
  /** 现在能不能选。预设恒为 true（见文件头） */
  usable: boolean
  /** 不能选时给用户的一句人话 */
  why?: string
}

/**
 * ★ 克隆音色**没有**"调性"那句话，这里给的是**空串**，不是一句"用你自己录的那段声音合成"。
 *   原先那句话 2026-10-16 被用户从卡片上划掉了，理由是**同义反复**：卡片上写着「我的声音」，
 *   再补一句"用你自己录的那段声音合成"是把同一件事说两遍。
 *   ★ 改成空串、而不是让每个界面自己去判断来源：这样"有没有厂商描述"这件事只有**一处**在说，
 *     而所有渲染 `tone` 的地方（音色卡、`/home` 的下拉、以后任何新界面）自动什么都不写。
 */
const MINE_TONE = ''

export function voiceCatalog(mine: MyVoice[], currentModelId: string): CatalogVoice[] {
  const presets: CatalogVoice[] = DEFAULT_VOICES.map((voice) => ({
    ...voice,
    source: 'preset',
    usable: true,
  }))

  const cloned: CatalogVoice[] = mine.map((voice) => {
    const matches = voice.modelId !== '' && voice.modelId === currentModelId
    return {
      id: voice.voiceId,
      name: voice.name,
      tone: MINE_TONE,
      source: 'mine',
      modelId: voice.modelId,
      createdAt: voice.createdAt,
      usable: matches,
      ...(matches
        ? {}
        : {
            why:
              `录它时用的语音模型是 ${voice.modelId || '（没记下来）'}，` +
              `与现在的 ${currentModelId || '（还没填）'} 不是同一个。` +
              `厂商那边音色是绑模型的——选它会被拒（实测报 400），所以要重新录一条。`,
          }),
    }
  })

  return [...presets, ...cloned]
}

/** 现在选中的那一条在不在表里（删掉音色之后 `speech.voice` 可能指着一个不存在的 id） */
export function findVoice(voices: CatalogVoice[], id: string): CatalogVoice | null {
  return voices.find((voice) => voice.id === id) ?? null
}
