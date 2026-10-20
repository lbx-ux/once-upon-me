/**
 * voices/catalog.ts —— 一张表：预设 + 我录的
 *
 * 为什么要有这个文件，而不是让各处继续 `DEFAULT_VOICES.map(...)`：
 *   捞过界的东西会各写一遍。`/home` 的药丸、设置抽屉的两颗钮、`/voice` 那一屏，
 *   三处都得知道"除了系统给的两个，用户自己还有几条"——三处各写一遍，
 *   迟早有一处忘了过滤"模型对不上的那些"。
 *
 * `usable` 是一等字段，不是界面自己推的：
 *   克隆音色建的时候绑死在当时的 TTS_MODEL 上（实测跨模型 400 `Engine error [411]`）。
 *   判据只有这一处产生，界面照它禁用 + 照 `why` 说话——不许默默让用户点进去撞 400。
 *   （预设音色不判定：我们没有"它支持哪些模型"的实测记录，不编一个。）
 *
 * 2026-10-17：模型从"用户填的"换成"站里的"之后，多了一种状态——不知道。
 *   以前那个模型名来自本机持久层，随时读得到；现在它来自 `GET /api/auth/me`，
 *   而那个人可能没登录（`/voice` 这一屏不要求登录就能打开），那时这个值是空串。
 *   空串不是"模型不匹配"：我们根本不知道站里配的是哪个模型，凭什么说他录的
 *   那条对不上？所以在那一档上 `usable` 是 `true`（不拦），`why` 也不写。
 *   真正的原因（没登录 / 没权限 / 站里没配语音）由 `lib/voices/state.ts` 的
 *   `speechBlockOf` 说，那一句才是真的——而它说的是"这三件事里的哪一件"，
 *   比一句编出来的"模型对不上"有用得多。
 *   这一条是"没核到的就不写"（CLAUDE.md §不糊弄）在那个判断上的兑现：
 *   一个我们没核过的结论，宁可不给，也不能长得像给过了。
 */

import { DEFAULT_VOICES, type MyVoice, type VoiceOption } from '@/lib/voices/state.ts'

export type CatalogVoice = VoiceOption & {
  /** 来源。★ 标在来源上，不是记录里的一个字段——字段会说谎，来源不会（同角色墙的「示例」） */
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
 * 克隆音色没有"调性"那句话，这里给的是空串，不是一句"用你自己录的那段声音合成"。
 *   原先那句话 2026-10-16 被用户从卡片上划掉了，理由是同义反复：卡片上写着「我的声音」，
 *   再补一句"用你自己录的那段声音合成"是把同一件事说两遍。
 *   改成空串、而不是让每个界面自己去判断来源：这样"有没有厂商描述"这件事只有一处在说，
 *     而所有渲染 `tone` 的地方（音色卡、`/home` 的下拉、以后任何新界面）自动什么都不写。
 */
const MINE_TONE = ''

export function voiceCatalog(mine: MyVoice[], serverModelId: string): CatalogVoice[] {
  const presets: CatalogVoice[] = DEFAULT_VOICES.map((voice) => ({
    ...voice,
    source: 'preset',
    usable: true,
  }))

  /**
   * 2026-10-17（实测到的）：服务端那几行里会有预置音色——`choose` 的语义是
   *   "选一个库里还没有的 id 会顺手把它记下来"（预置就是这样进来的：不这么做，
   *   "当前音色"就没地方记）。所以按 id 去重，把它们从「我录的」里剔掉：
   *   不剔的话，选了豆豆之后那一屏会长出第二张豆豆——一张带 `tone`（预置那张），
   *   一张不带（记录那张），而用户只知道他选了一个豆豆。
   *   判据是 id 在不在预置表里，不是"名字像不像"：预置是两个常量，
   *   这个判断在编译期就是确定的；靠名字去猜的话，用户给自己的音色起名"豆豆"
   *   就会被静默藏起来。
   */
  const presetIds = new Set(DEFAULT_VOICES.map((voice) => voice.id))
  const cloned: CatalogVoice[] = mine
    .filter((voice) => !presetIds.has(voice.voiceId))
    .map((voice) => {
      /**
       * 三种情形，先分清再判（见文件头最后一段）：
       *   · 站里的模型还不知道（没登录 / 站里没配）→ 不判，`usable: true`
       *   · 录它时没记下模型                        → 判不了，拦住并如实说"没记下来"
       *   · 两个都知道，且对不上                    → 拦住并说清是哪一个对不上
       */
      const unknownServer = serverModelId === ''
      const noRecord = voice.modelId === ''
      const matches = !unknownServer && !noRecord && voice.modelId === serverModelId
      const usable = unknownServer || matches
      return {
        id: voice.voiceId,
        name: voice.name,
        tone: MINE_TONE,
        source: 'mine',
        modelId: voice.modelId,
        createdAt: voice.createdAt,
        usable,
        ...(usable
          ? {}
          : {
              why:
                `录它时用的语音模型是 ${noRecord ? '（没记下来）' : voice.modelId}，` +
                `与现在的 ${serverModelId} 不是同一个。` +
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
