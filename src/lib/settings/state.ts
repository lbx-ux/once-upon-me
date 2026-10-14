/**
 * settings/state.ts —— 模型与密钥的**唯一形状**（从创作流里搬出来的那一步）
 *
 * 前身是 `src/lib/creation/to-env.ts`（创作流第 3 步的表单）。搬出来之后有三处变化，
 * 每条都有理由：
 *
 * 1. **按能力分组，一组一套**（`text` / `image` / `vision` / `speech`）。
 *   原来是"一个 baseUrl + 三个模型名"——那只在一个供应商成立。
 *   ★ 现在图像在聚合站（`…/v1`）、语音在阿里云百炼（`…/api/v1`），
 *   **路径形状根本不同**（实测：百炼的 `SpeechSynthesizer` 挂在 `/api/v1/services/...`），
 *   共用一个 base 必然有一家是错的。
 * 2. **key 不进持久层**。`storable()` 是唯一的写入口，它**按字段名剥掉所有 apiKey**。
 *   ADR-0008 那三条（不落盘、不进日志、不进录制 manifest）在"设置页"这个位置最容易破，
 *   因为设置页的本能就是持久化。所以持久化的白名单是**写出来的**，不是"除了 key 都能存"。
 * 3. **`voice`（音色）与模型绑定**。实测百炼的克隆音色跨模型直接 400
 *   （`[cosyvoice]Engine error [411]`），所以音色是 `speech` 组的字段，
 *   换模型时界面上必须提示旧音色会失效，不能默默回落。
 *
 * ★ 原来那三条纪律一条都没丢（空值不写进表 / 图像不回落到文本 / 固定档位不暴露给用户），
 *   他们的测试也一起搬过来了（`state.test.ts`）。
 */

/** 一组能力需要的三件事。字段名与环境变量无关，映射只发生在 `toEnv` 这一处 */
export type CapabilityForm = {
  baseUrl: string
  apiKey: string
  model: string
}

/** 语音多一个音色。它可以是预置名（`longjielidou_v3.6`）也可以是一个克隆来的 voice_id */
export type SpeechForm = CapabilityForm & { voice: string }

export type SettingsForm = {
  text: CapabilityForm
  image: CapabilityForm
  vision: CapabilityForm
  speech: SpeechForm
}

/**
 * 默认值。★ 与 `.env.local` 对齐，因为它们**是实测在跑的那几个**——
 * 原来的 `DEFAULT_MODEL_FORM` 里图像写的是 W1 横评推荐的 `qwen-image-2.0`，
 * 而真正跑通、且带参考图能力的是 `wan2.7-image`。默认值该是"验过的"，不是"推荐的"。
 */
export const DEFAULT_SETTINGS: SettingsForm = {
  text: {
    baseUrl: 'https://tokenrhythm.studio/v1',
    apiKey: '',
    model: 'qwen3.8-flash',
  },
  image: {
    baseUrl: 'https://tokenrhythm.studio/v1',
    apiKey: '',
    model: 'wan2.7-image',
  },
  // 留空 = 不做视觉比对，引擎走"未核对"路径（会如实说，不假装通过）
  vision: {
    baseUrl: 'https://tokenrhythm.studio/v1',
    apiKey: '',
    model: '',
  },
  speech: {
    baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
    apiKey: '',
    model: 'qwen-audio-3.0-tts-flash',
    voice: '',
  },
}

/**
 * 两个预置音色。★ 产品定义说"系统提供两个默认音色"，这里就是那两个：
 * 一个男童声、一个女童声（都是百炼的"儿童陪伴"档，不是成人音色念童书）。
 * 选它们的依据是**人耳听过**（2026-10-14，用户听完说"这几个声音可以的"）；
 * 没有听过的音色不放进这张表。
 */
export const DEFAULT_VOICES: { id: string; label: string }[] = [
  { id: 'longjielidou_v3.6', label: '男童声（5 岁）' },
  { id: 'longpaopao_v3.6', label: '女童声（5 岁）' },
]

/** 界面文案用。"看不见就等于没配"——固定档位要能读出来，但不给填 */
export const FIXED_KNOBS_NOTE =
  '思考链默认关、单次预算 4096、视觉比对超时 300s、图像单张成本按 0.2 元记账。' +
  '这几档不在设置里：默认值是实测定的（开着思考的模型会把预算整条花在思考链上，正文一个字不写），' +
  '交到手上只会多一种坏配置。要改就改服务端的 .env.local。'

/**
 * ★ 能持久化的字段——**白名单**，不是"除了 key 都行"。
 *   key 一旦出现在这里，ADR-0008 的"不落盘"就是假的。
 */
const STORABLE_FIELDS = ['baseUrl', 'model', 'voice'] as const

/** 剥掉所有密钥，只留下可以放心写进 localStorage 的那部分 */
export function storable(form: SettingsForm): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  for (const [capability, value] of Object.entries(form)) {
    const group: Record<string, string> = {}
    for (const field of STORABLE_FIELDS) {
      const raw = (value as Record<string, unknown>)[field]
      if (typeof raw === 'string') group[field] = raw
    }
    out[capability] = group
  }
  return out
}

/**
 * 读回来。localStorage 里**不该**有 key，但如果将来有人手改过、或旧版本写过，
 * 这里也一律丢弃——不信任存储内容，而不是信任写入口。
 */
export function mergeStored(raw: unknown, fallback: SettingsForm = DEFAULT_SETTINGS): SettingsForm {
  const next: SettingsForm = {
    text: { ...fallback.text },
    image: { ...fallback.image },
    vision: { ...fallback.vision },
    speech: { ...fallback.speech },
  }
  if (!raw || typeof raw !== 'object') return next
  for (const [capability, value] of Object.entries(raw as Record<string, unknown>)) {
    const group = next[capability as keyof SettingsForm] as Record<string, string> | undefined
    if (!group || !value || typeof value !== 'object') continue
    for (const field of STORABLE_FIELDS) {
      const item = (value as Record<string, unknown>)[field]
      // ★ key 在这一步被第二次挡掉：即使存储里有，也不读进来
      if (typeof item === 'string') group[field] = item
    }
  }
  return next
}

/** 表 → 一张 per-request 的 `Env`（ADR-0008 的兑现处）。空值一律不写进表 */
export function toEnv(form: SettingsForm): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {}
  const put = (key: string, value: string): void => {
    const trimmed = value.trim()
    // ★ 空串不写：registry 对空串与缺位的处理一样，但"表里有个空串"会让排障误以为配过
    if (trimmed !== '') env[key] = trimmed
  }

  put('LLM_MODEL', form.text.model)
  put('LLM_API_KEY', form.text.apiKey)
  put('LLM_BASE_URL', form.text.baseUrl)

  put('IMAGE_MODEL', form.image.model)
  put('IMAGE_API_KEY', form.image.apiKey)
  put('IMAGE_BASE_URL', form.image.baseUrl)

  // 视觉不回落：接口形状与对话不同，回落只会把配置错误变成运行期 400
  put('VISION_MODEL', form.vision.model)
  put('VISION_API_KEY', form.vision.apiKey)
  put('VISION_BASE_URL', form.vision.baseUrl)

  put('TTS_MODEL', form.speech.model)
  put('TTS_API_KEY', form.speech.apiKey)
  put('TTS_BASE_URL', form.speech.baseUrl)
  put('TTS_VOICE', form.speech.voice)

  return env
}

/**
 * "跑不动"的判据。★ 只算**必需**的两项：文本与图像。
 * 视觉缺了走"未核对"（会如实说），语音缺了这本书没有朗读（也如实说）——
 * 那两条是降级路径，不是坏配置，所以不进 missingRequired。
 */
export function missingRequired(form: SettingsForm): string[] {
  const env = toEnv(form)
  const missing: string[] = []
  if (!env['LLM_MODEL']) missing.push('文本模型名')
  if (!env['LLM_API_KEY']) missing.push('文本 API key')
  if (!env['IMAGE_MODEL']) missing.push('图像模型名')
  if (!env['IMAGE_API_KEY']) missing.push('图像 API key')
  return missing
}

/** 语音这一组够不够用（界面上"这本书会不会有朗读"的判据） */
export function speechReady(form: SettingsForm): boolean {
  const env = toEnv(form)
  return Boolean(env['TTS_API_KEY'] && env['TTS_MODEL'] && env['TTS_VOICE'])
}

export const SETTINGS_STORAGE_KEY = 'xiaozhujue.settings.v1'

/** 读 localStorage。**只在客户端调用**（这一层被服务端 import 时它会返回 null） */
export function loadStoredSettings(): SettingsForm {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    return mergeStored(JSON.parse(raw) as unknown)
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveStoredSettings(form: SettingsForm): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(storable(form)))
  } catch {
    // 隐私模式或配额满：设置照样在本次会话里有效，只是下次要重填。
    // ★ 这里**不许**改成"那我把 key 也存别处"——那是把失败变成违规
  }
}
