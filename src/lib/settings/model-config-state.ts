/**
 * settings/model-config-state.ts —— 模型配置那一屏的**形状**（纯函数，没有 fs、没有引擎）
 *
 * ★ 为什么单独一个文件，而不是跟在 `model-config.ts` 里：那一份 import 了
 *   `describeProviders`（`engine/providers/registry.ts`），也就是整个 provider 层。
 *   而**浏览器那一侧也要读同一份形状**（`lib/admin/client.ts` 要 parse 它、
 *   组件要拿它的类型）。两者放在一起的话，管理页的 bundle 里会多出一个
 *   provider 注册表——里面有各家厂商的 base URL 与请求构造代码。
 *   这和 `admin/state.ts` / `admin/server.ts` 的分法是同一条：
 *   纯的（能在 node 里跑、能被测试钉住）与碰 I/O 的分开。
 *
 * ★ 这一份里**没有环境变量名**。名字（`LLM_API_KEY` 之类）属于服务端那一份
 *   （`model-config.ts` 的 `CAPABILITIES`）——浏览器不需要知道这些键叫什么，
 *   它只需要知道"有四行、每行三格、格子上写着什么"。少一层知识就少一处会漂。
 */

export type Capability = 'text' | 'image' | 'vision' | 'speech'

/** 界面上那几格的字段名（线上传的就是这几个词，与厂商无关） */
export type FieldId = 'model' | 'baseUrl' | 'apiKey' | 'voice'

export type FieldView = {
  id: FieldId
  label: string
  /** 是不是秘密。★ 秘密那一格的 `value` 永远是 `null` */
  secret: boolean
  configured: boolean
  /** 值从哪儿来：管理页写的 / 环境变量 / 没有 */
  source: 'admin' | 'env' | null
  /**
   * **环境变量里也有一份**（哪怕此刻被管理页那份压着）。
   *
   * ★ 它只为「恢复默认」那一次确认服务：`source: 'admin'` 时，
   *   点下去之后这一格是回到环境变量、还是**变成一个空值**，是两件完全不同的事
   *   （后者会让这个能力当场用不了）。界面上要把这两句话分开说，
   *   而它靠的就是这一位。
   */
  fallback: boolean
  value: string | null
}

export type SectionView = {
  id: Capability
  label: string
  hint: string
  /**
   * 「测试连通」那一按**会做什么**（服务端按 `TEST_REQUEST` 写的那句话）。
   * ★ 它由服务端给而不是浏览器写死：那一按真发出去的东西（token 上限、图片尺寸、
   *   要念的那句台词）也只有服务端知道，两处各写一份就会漂。
   */
  testLine: string
  /** 测试那一格预填什么（文字与视觉没有输入，是空串） */
  testSeed: string
  fields: FieldView[]
  warn: string | null
}

export type ModelConfigView = {
  file: string
  /** 引擎自己那四句话（`describeProviders`），键是 text / image / vision / voice */
  effective: Record<string, string>
  sections: SectionView[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

const FIELD_IDS: readonly FieldId[] = ['model', 'baseUrl', 'apiKey', 'voice']
const CAPABILITY_IDS: readonly Capability[] = ['text', 'image', 'vision', 'speech']

function parseField(raw: unknown): FieldView | null {
  const value = asRecord(raw)
  if (!value) return null

  const id = value['id']
  if (typeof id !== 'string' || !FIELD_IDS.includes(id as FieldId)) return null
  if (typeof value['label'] !== 'string') return null
  if (typeof value['secret'] !== 'boolean') return null
  if (typeof value['configured'] !== 'boolean') return null
  if (typeof value['fallback'] !== 'boolean') return null

  const source = value['source']
  if (source !== null && source !== 'admin' && source !== 'env') return null
  // ★ `value` 必须是字符串或 null。秘密那一格**必须**是 null——
  //   服务端要是哪天把它填上了，这里整份不认：让一个 key 悄悄流进浏览器，
  //   比管理页显示不出来严重得多（那一条见 `model-config.ts` 文件头）
  const fieldValue = value['value']
  if (fieldValue !== null && typeof fieldValue !== 'string') return null
  if (value['secret'] === true && fieldValue !== null) return null

  return {
    id: id as FieldId,
    label: value['label'],
    secret: value['secret'],
    configured: value['configured'],
    source,
    fallback: value['fallback'],
    value: fieldValue,
  }
}

function parseSection(raw: unknown): SectionView | null {
  const value = asRecord(raw)
  if (!value) return null

  const id = value['id']
  if (typeof id !== 'string' || !CAPABILITY_IDS.includes(id as Capability)) return null
  if (typeof value['label'] !== 'string' || typeof value['hint'] !== 'string') return null
  // ★ 这两句是 2026-10-18 加的，而这里**跟别的格子一样严**：缺了就整份不认。
  //   放宽成"缺就当空串"的话，服务端哪天少回了这一句，界面上那颗「测试连通」
  //   会变成一颗底下没有说明的按钮——而它按下去要花钱
  if (typeof value['testLine'] !== 'string' || typeof value['testSeed'] !== 'string') return null
  if (!Array.isArray(value['fields'])) return null

  const fields: FieldView[] = []
  for (const item of value['fields']) {
    const field = parseField(item)
    if (!field) return null
    fields.push(field)
  }

  const warn = value['warn']
  if (warn !== null && typeof warn !== 'string') return null

  return {
    id: id as Capability,
    label: value['label'],
    hint: value['hint'],
    testLine: value['testLine'],
    testSeed: value['testSeed'],
    fields,
    warn,
  }
}

/**
 * 读回来的那一坨 → `ModelConfigView`。认不出来就是 `null`（不抛）。
 *
 * ★ 任意一格形状不对就**整份拒绝**，与 `parseOverview` 同一条：这是给管理员
 *   改全站配置用的表。半份表比没有更坏——他能看见的三格是真的，
 *   看不见的那一格还是旧的，而他会以为自己刚把四项都改完了。
 */
export function parseModelConfigView(raw: unknown): ModelConfigView | null {
  const value = asRecord(raw)
  if (!value) return null
  if (typeof value['file'] !== 'string') return null
  const effective = asRecord(value['effective'])
  if (!effective) return null
  if (!Array.isArray(value['sections'])) return null

  const sections: SectionView[] = []
  for (const item of value['sections']) {
    const section = parseSection(item)
    if (!section) return null
    sections.push(section)
  }

  const described: Record<string, string> = {}
  for (const [key, text] of Object.entries(effective)) {
    if (typeof text === 'string') described[key] = text
  }

  return { file: value['file'], effective: described, sections }
}

/* ── 模型候选（2026-10-17：「输入地址就能拉列表」那一条）───────────────────── */

/**
 * 一次「拉候选」的结果。
 *
 * ★ `ok: false` **不是请求失败**（HTTP 仍然是 200）：地址没配、那边不认 key、
 *   那个地址没有 `/models`——三种都只意味着"这一格没有候选可给"，而它仍然能手填。
 *   所以形状里带的是 `message`（给人看的一句话），不是 `code`。
 */
export type ModelCandidates = {
  ok: boolean
  /** 拉的那个地址（`https://…/v1/models`）。给界面显示用——它**不含 key** */
  endpoint: string
  ids: string[]
  message: string | null
}

/**
 * 读回来的那一坨 → `ModelCandidates`。认不出来就是 `null`（不抛）。
 *
 * ★ 这一份**不整份拒绝**（与 `parseModelConfigView` 相反）：候选只是便利，
 *   少了几个 id 不该让整格变成一句红字。缺 `ids` 就当成空表，缺 `message`
 *   就当成没有话说——但 `ok` 必须是**真的布尔值**，否则我们说不清该不该报红。
 */
export function parseModelCandidates(raw: unknown): ModelCandidates | null {
  const value = asRecord(raw)
  if (!value) return null
  if (typeof value['ok'] !== 'boolean') return null

  const ids = Array.isArray(value['ids'])
    ? value['ids'].filter((item): item is string => typeof item === 'string')
    : []
  const message = typeof value['message'] === 'string' ? value['message'] : null
  const endpoint = typeof value['endpoint'] === 'string' ? value['endpoint'] : ''
  return { ok: value['ok'], endpoint, ids, message }
}

/* ── 「测试连通」那一次的结果（2026-10-18）────────────────────────────────── */

/**
 * 一次真打厂商接口的结果。
 *
 * ★ 形状里**同时**带着两种东西，而它们服务两个不同的读者：
 *   · `ok` + `message` + `ms` + `modelId` —— 给站长判断"这一项现在能不能用"；
 *   · `text` / `imageDataUrl` / `audioDataUrl` / `anchors` —— **通的证据本身**。
 *
 * ★ 为什么要把图与音频整体带回来（data URL，图像那一张一两 MB）：
 *   服务端把它写盘再回一个 URL，就要管清理，而这是一次性的东西
 *   （同 `/api/voice/preview` 那条注释）。它只在这一次响应里存在。
 *   代价是这条响应会很大——所以**只有成功那一支才有它们**。
 *
 * ★ `ms` 是**这一次真花的时间**（出图十几秒是常态）。不写它的话，
 *   "通了"与"快不快"就只能靠感觉，而这个数正是"这一家能不能用来出图"的一半判据。
 */
export type ModelTestResult = {
  ok: boolean
  capability: Capability
  /** 这一次用了多少毫秒（服务端量的墙上时间） */
  ms: number
  /** 引擎说的模型名。没配起来时是空串 */
  modelId: string
  /** 文字那一支它回的话 / 视觉那一支它自己写的说明。没有就是 null */
  text: string | null
  /** 图像那一支出的一张图（data URL） */
  imageDataUrl: string | null
  /** 语音那一支合成的那段音频（data URL） */
  audioDataUrl: string | null
  /** 视觉那一支读出来的锚点（槽位 → 值）。别的能力永远是空数组 */
  anchors: { slot: string; value: string }[]
  /** 没通时那句**能照做的话**（`userFailureOf` 翻的）；通了时通常是 null */
  message: string | null
}

/**
 * 读回来的那一坨 → `ModelTestResult`。认不出来就是 `null`（不抛）。
 *
 * ★ 与 `parseModelCandidates` 同一条松紧：**必须有的那几样**（`ok` / `capability` /
 *   `ms`）不齐就整份不认——没有它们，界面说不清"这一格现在是什么状态"；
 *   其余几样缺了就当空（一次文字测试本来就没有图）。
 */
export function parseModelTestResult(raw: unknown): ModelTestResult | null {
  const value = asRecord(raw)
  if (!value) return null
  if (typeof value['ok'] !== 'boolean') return null
  if (typeof value['ms'] !== 'number' || !Number.isFinite(value['ms'])) return null

  const capability = value['capability']
  if (typeof capability !== 'string' || !CAPABILITY_IDS.includes(capability as Capability)) {
    return null
  }

  const text = (key: string): string | null =>
    typeof value[key] === 'string' && value[key] !== '' ? (value[key] as string) : null

  const anchors: { slot: string; value: string }[] = []
  if (Array.isArray(value['anchors'])) {
    for (const item of value['anchors']) {
      const row = asRecord(item)
      if (!row) continue
      if (typeof row['slot'] !== 'string' || typeof row['value'] !== 'string') continue
      anchors.push({ slot: row['slot'], value: row['value'] })
    }
  }

  return {
    ok: value['ok'],
    capability: capability as Capability,
    ms: value['ms'],
    modelId: typeof value['modelId'] === 'string' ? value['modelId'] : '',
    text: text('text'),
    imageDataUrl: text('imageDataUrl'),
    audioDataUrl: text('audioDataUrl'),
    anchors,
    message: text('message'),
  }
}
