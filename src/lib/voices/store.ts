/**
 * voices/store.ts —— 「我录的音色」这一份记录（localStorage）
 *
 * ★ 存的是什么、不存什么，是一条划出来的线：
 *   - **存 voiceId**。它不是密钥，它是个厂商侧标识符；`settings.speech.voice` 本来
 *     就在持久层里（`state.ts` 的 `STORABLE_FIELDS`），同一个东西不必两套规矩。
 *   - **不存样本**。§8.3 要求"拿到 voice_id 后立即删"——我们的实现是更强的那一条：
 *     样本从不上传以外的任何地方（不进这里、不落盘、不进日志）。这个文件里
 *     一个字节的音频都没有，那是设计，不是漏了。
 *
 * ★ 容错抄 `settings/state.ts` 那一套：读不懂就当空、坏一条丢一条。理由也一样——
 *   一个坏掉的 localStorage 不该让整屏打不开，而"猜"一条回来的代价是显示一个
 *   根本用不了的音色。
 */

export type MyVoice = {
  /** 厂商回的 voice_id */
  voiceId: string
  /** 用户起的名字。默认「我的声音」——不替他编一个"温柔妈妈音" */
  name: string
  /**
   * ★ 建它时的 TTS_MODEL。实测跨模型直接 400（`[cosyvoice]Engine error [411]`），
   *   所以这一条不是记账，是判据：当前模型与它对不上时，这张卡**不许选**。
   */
  modelId: string
  createdAt: number
  /**
   * 授权凭据号：删除时要能说出"这条音色是基于哪一次授权创建的"。
   * 那个记录在我们这边，不在厂商那边（`qwen-speech.ts` 的 clone 里有这段注释）。
   */
  consentRef: string
}

export const MY_VOICES_KEY = 'xiaozhujue.voices.v1'

/** 一条记录是不是完整。★ 逐个字段查，不 `as MyVoice` 硬转——存储里的东西不可信 */
function parseOne(raw: unknown): MyVoice | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const voiceId = typeof item['voiceId'] === 'string' ? item['voiceId'].trim() : ''
  const name = typeof item['name'] === 'string' ? item['name'].trim() : ''
  const modelId = typeof item['modelId'] === 'string' ? item['modelId'].trim() : ''
  const consentRef = typeof item['consentRef'] === 'string' ? item['consentRef'].trim() : ''
  const createdAt = typeof item['createdAt'] === 'number' ? item['createdAt'] : NaN
  if (voiceId === '' || name === '' || !Number.isFinite(createdAt)) return null
  return { voiceId, name, modelId, consentRef, createdAt }
}

/** 读回全部。新的在前（与书架那一屏同一个方向：最近做的在最上面） */
export function loadMyVoices(): MyVoice[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(MY_VOICES_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const seen = new Set<string>()
    const out: MyVoice[] = []
    for (const item of parsed) {
      const voice = parseOne(item)
      // ★ 同一个 voiceId 只留一条：两支一样的声音会有两张卡，用户怎么点都一样
      if (!voice || seen.has(voice.voiceId)) continue
      seen.add(voice.voiceId)
      out.push(voice)
    }
    return out.sort((a, b) => b.createdAt - a.createdAt)
  } catch {
    return []
  }
}

function write(voices: MyVoice[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(MY_VOICES_KEY, JSON.stringify(voices))
  } catch {
    // 隐私模式或配额满：这一次创建的音色照样能用（它在内存里），只是下次打开就不在列表里了。
    // ★ 不改成"那我存别处"——那是把失败变成违规（同 `settings/state.ts` 的 saveStoredSettings）
  }
}

/** 加一条。返回加完之后的那份（界面拿它直接渲染，不必再读一遍盘） */
export function addMyVoice(voice: MyVoice): MyVoice[] {
  const rest = loadMyVoices().filter((item) => item.voiceId !== voice.voiceId)
  const next = [voice, ...rest]
  write(next)
  return next
}

/** 删一条。返回删完之后的那份 */
export function removeMyVoice(voiceId: string): MyVoice[] {
  const next = loadMyVoices().filter((item) => item.voiceId !== voiceId)
  write(next)
  return next
}

/**
 * 一次授权的凭据号。★ 它只是"这一次授权"的名字，不指代任何个人：
 *   前缀 `local` + 时间戳 + 一小段随机，足以在排障时把一条音色对回一次操作。
 */
export function newConsentRef(at: number = Date.now()): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `local:${at.toString(36)}-${rand}`
}
