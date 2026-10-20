/**
 * settings/model-config.ts —— 管理页那一屏能改什么、改完长什么样（2026-10-17）
 *
 * ★ 一个模块答三个问题，因为这三个问题的答案必须是同一份：
 *   1. 界面上有哪几格（`CAPABILITIES`）；
 *   2. 送来的字段名合不合法、对应哪个环境变量（同一个 `CAPABILITIES`）；
 *   3. 现在生效的是什么、以及一个 key 有没有配（`modelConfigView`）。
 *   分成三处的代价是很具体的：界面加一格而校验没加，那一格**看起来能填、
 *   填了不生效**——最难查的一类。
 *
 * key 只进不出。`modelConfigView` 对 `secret` 那一格永远只回
 *   "配没配 + 从哪儿来的"，不回值。这与口令那条是同一条纪律
 *   （`AdminController#resetPassword`：口令不被回显），理由也一样：
 *   回显出去就多了一份要删的副本（浏览器内存、调试工具、截图）。
 *   代价是站长看不出"现在这把 key 是哪一个"——他要知道就得重新填一次。
 *   这一条是故意选的那一边：key 填错的表现是 401，而那会立刻暴露；
 *   而 key 泄出去不会。
 *
 * 只判形状，不判厂商语义：这里只挡住"http:// 开头"这种明显不是地址的值。
 *   像「TTS 的 BASE_URL 必须写成 xxx/api/v1」那种规则属于引擎
 *   （`registry.ts` 的 `requireUrl({ pathPrefix })`），在这里再写一遍就是两份规则，
 *   而它们迟早会不一样。
 */

import { describeProviders } from '@/lib/engine/providers/registry.ts'
import { DEFAULT_IMAGE_SIZE } from '@/lib/prompts/image.ts'
import { modelConfigFile, readOverrides } from './runtime-config.ts'
import { serverEnv } from './server-env.ts'
import { PREVIEW_LINE } from './preview-line.ts'
import type { Capability, FieldId, FieldView, ModelConfigView } from './model-config-state.ts'

type FieldSpec = {
  id: FieldId
  /** 对应的环境变量名 */
  env: string
  label: string
  /** 是不是秘密。★ 秘密那一格的值永远不回给浏览器 */
  secret: boolean
}

type CapabilitySpec = {
  id: Capability
  label: string
  /** 这个能力是干什么用的，界面上那行小字 */
  hint: string
  fields: FieldSpec[]
  /** 改这个能力时要提醒的一句话。没有就不显示 */
  warn?: string
}

/**
 * ★ 「测试连通」那一按到底发出去什么——写在这里，因为界面那句话要说的就是它。
 *
 * 2026-10-18 加的（用户给了四张参考截图：那一栏底下有一颗「测试连通」）。
 * 它与 `testLineOf` 底下那四句是同一件事的两种说法，所以必须挨着：
 * 分开写的话，副标题写着"64 token 上限"而路由发的是 4096，谁也不会发现——
 * 而这正是"字写得很具体、做的是另一件事"这种最坏的错。
 * 于是路由从这里 import（`app/api/admin/model-test/route.ts`），不自己抄一份。
 */
export const TEST_REQUEST = {
  text: {
    /** 一句话、尽量小：这一按问的是"通不通"，不是"文笔如何" */
    line: '用一句话回答：你能给三岁小孩写睡前故事吗？',
    /** 上限 64 是在防跑飞：不设上限时一个失控的模型能吐几千 token（那是钱） */
    maxTokens: 64,
  },
  image: {
    /** 缺省提示词：一句一定画得出来的，让"通不通"不被内容问题遮住 */
    prompt: '简笔水彩风：一只戴围巾的小猫，坐在窗台上',
    /** 用产品自己那个尺寸（与跨页插画同源），不是随便挑一个方图：见路由文件头第 4 条 */
    size: DEFAULT_IMAGE_SIZE,
  },
  speech: {
    /** 与音色卡上印的那句同一个常量（`preview-line.ts`） */
    line: PREVIEW_LINE,
  },
} as const

/**
 * 每张卡标题底下那行小字：这一按会做什么。
 *
 * 四句都写实（"一句话"、"与跨页插画同一个尺寸"），因为它们各自是站长
 *   判断"这一项能不能用"的半个判据——一句笼统的"测试连通"什么都说明不了。
 */
function testLineOf(capability: Capability): string {
  switch (capability) {
    case 'text':
      return `发一句话，看它回不回得上（上限 ${TEST_REQUEST.text.maxTokens} token）`
    case 'image':
      return `按一个提示词，真出一张 ${TEST_REQUEST.image.size.replace('x', '×')} 的图——与跨页插画同一个尺寸`
    case 'vision':
      return '带一张本地图片，让它读一遍里面有什么（走的是角色卡「分析这张照片」那条路）'
    case 'speech':
      return '按「音色」那一格，合成一句试听台词'
  }
}

/**
 * 测试那一格预填什么（没有输入的那两项是空串）。
 * 由服务端给而不是浏览器写死：图像那句缺省提示词在路由里也用（`TEST_REQUEST`），
 *   两处各写一份的话，界面预填的与真发出去的就成了两句话。
 */
function testSeedOf(capability: Capability): string {
  if (capability === 'image') return TEST_REQUEST.image.prompt
  if (capability === 'speech') return TEST_REQUEST.speech.line
  return ''
}

/**
 * 四个能力 × 各自那几格。
 *
 * 顺序与 `describeProviders` 返回的四行一致，也与工作台上那四项能力
 *   （写故事 / 画插画 / 核对面孔 / 朗读）一致——三个地方说的必须是同一件事。
 */
export const CAPABILITIES: CapabilitySpec[] = [
  {
    id: 'text',
    label: '文字对话',
    hint: '写故事',
    fields: [
      { id: 'model', env: 'LLM_MODEL', label: '模型名', secret: false },
      { id: 'baseUrl', env: 'LLM_BASE_URL', label: '接口地址', secret: false },
      { id: 'apiKey', env: 'LLM_API_KEY', label: 'API key', secret: true },
    ],
  },
  {
    id: 'image',
    label: '图像生成',
    hint: '画插画',
    fields: [
      { id: 'model', env: 'IMAGE_MODEL', label: '模型名', secret: false },
      { id: 'baseUrl', env: 'IMAGE_BASE_URL', label: '接口地址', secret: false },
      { id: 'apiKey', env: 'IMAGE_API_KEY', label: 'API key', secret: true },
    ],
  },
  {
    id: 'vision',
    label: '视觉理解',
    hint: '核对面孔',
    fields: [
      { id: 'model', env: 'VISION_MODEL', label: '模型名', secret: false },
      { id: 'baseUrl', env: 'VISION_BASE_URL', label: '接口地址', secret: false },
      { id: 'apiKey', env: 'VISION_API_KEY', label: 'API key', secret: true },
    ],
    warn: '视觉缺 key 时会回落到文字那把——但它量不到，界面上照实按「未配置」显示。',
  },
  {
    id: 'speech',
    label: '语音合成',
    hint: '朗读',
    fields: [
      { id: 'model', env: 'TTS_MODEL', label: '模型名', secret: false },
      { id: 'baseUrl', env: 'TTS_BASE_URL', label: '接口地址', secret: false },
      { id: 'apiKey', env: 'TTS_API_KEY', label: 'API key', secret: true },
      // 音色与模型是绑在一起的：克隆音的 id 在另一个模型上直接 400
      { id: 'voice', env: 'TTS_VOICE', label: '音色', secret: false },
    ],
    warn: '克隆出来的音色绑定在创建它时的那个模型上——换了模型，之前录的那些就用不了了（厂商报的是 [411] 一句内部错误）。',
  },
]

export function capabilitySpec(id: string): CapabilitySpec | null {
  return CAPABILITIES.find((item) => item.id === id) ?? null
}

/* 读：现在生效的是什么 */

/** 从当前 `serverEnv()`（已经含了覆盖）+ 文件本身，拼出那一屏要看的东西 */
export function modelConfigView(): ModelConfigView {
  const env = serverEnv()
  const overrides = readOverrides()

  return {
    file: modelConfigFile(),
    effective: describeProviders(env),
    sections: CAPABILITIES.map((cap) => ({
      id: cap.id,
      label: cap.label,
      hint: cap.hint,
      // 这两句给「测试连通」那一块用：一句是"这一按会做什么"，一句是那一格的预填值。
      //   都由服务端给（见 `TEST_REQUEST` 那段），浏览器不另写一份
      testLine: testLineOf(cap.id),
      testSeed: testSeedOf(cap.id),
      warn: cap.warn ?? null,
      fields: cap.fields.map((field): FieldView => {
        const fromAdmin = (overrides[field.env] ?? '').trim() !== ''
        const fromEnv = (env[field.env] ?? '').trim() !== ''
        return {
          id: field.id,
          label: field.label,
          secret: field.secret,
          configured: fromAdmin || fromEnv,
          source: fromAdmin ? 'admin' : fromEnv ? 'env' : null,
          // ★ 注意这里读的是 `process.env` 而不是 `env`：`env` 是"最终生效的那份"
          //   （覆盖已经压上去了），拿它判"有没有兜底"永远为真。
          //   要回答的是"去掉覆盖之后还剩什么"，所以只能看环境变量本身。
          fallback: (process.env[field.env] ?? '').trim() !== '',
          // ★ 秘密那一格不给值；别的给到底（站长要看着当前模型改）
          value: field.secret ? null : (env[field.env] ?? null),
        }
      }),
    })),
  }
}

/* 写：改 / 恢复默认 */

/**
 * 一个字段该不该收。返回值是 trim 过的字符串，或者一句为什么不行。
 *
 * 空串不是错误，它表示"这一格没填"。怎么理解它由调用方决定
 *   （每格的意思不同：`apiKey` 空 = 不改，其它格空 = 不改，清空走另一个动作）。
 *   把"空"判成错误会把"我只想换模型名"变成一次失败。
 */
export type FieldVerdict =
  { ok: true; value: string } | { ok: false; code: string; message: string }

export function checkField(spec: CapabilitySpec, id: FieldId, raw: unknown): FieldVerdict {
  const field = spec.fields.find((item) => item.id === id)
  if (!field) {
    // 这个能力没有这一格（比如给文字能力送 `voice`）。当错误而不是忽略：
    //   忽略的话，界面把字段名拼错就是"保存成功但什么都没改"
    return { ok: false, code: 'unknown-field', message: `${spec.label}没有「${id}」这一项` }
  }
  if (raw === undefined || raw === null) return { ok: true, value: '' }
  if (typeof raw !== 'string') {
    return { ok: false, code: 'bad-json', message: '字段必须是字符串' }
  }

  const value = raw.trim()
  if (id === 'baseUrl' && value !== '' && !/^https?:\/\/\S+$/i.test(value)) {
    // 只查这一个形状。厂商要求的前后缀（比如 TTS 那份要带 /api/v1）
    //   归引擎判——那是"这个地址对不对"，不是"这是不是一个地址"
    return {
      ok: false,
      code: 'bad-base-url',
      message: '接口地址要写成 http(s)://… 的样子（完整的地址，不是域名片段）',
    }
  }
  return { ok: true, value }
}

/**
 * 把一次改动并进现有的覆盖。
 *
 * 只有非空的值会被写进去：空的表示"这一格这次没填"，而不是"清掉它"。
 *   清掉是另一个动作（`clearCapability`），因为"我不想改"与"我要去掉它"
 *   是两件事——合成一个的话，一个人只想换模型名，会把 key 一起清掉，
 *   而下一次生成才报 401。
 */
export function applyPatch(
  current: Record<string, string>,
  spec: CapabilitySpec,
  patch: Partial<Record<FieldId, string>>,
): Record<string, string> {
  const next = { ...current }
  for (const field of spec.fields) {
    const value = (patch[field.id] ?? '').trim()
    if (value !== '') next[field.env] = value
  }
  return next
}

/** 把这个能力的几格从覆盖里去掉 → 回到 `.env.local` 那一份（界面上的「恢复默认」） */
export function clearCapability(
  current: Record<string, string>,
  spec: CapabilitySpec,
): Record<string, string> {
  const next = { ...current }
  for (const field of spec.fields) delete next[field.env]
  return next
}

/** 只留清单上认得的键。★ 写之前最后过一道，见 `readOverrides` 那条同样的注释 */
export function keepKnownKeys(overrides: Record<string, string>): Record<string, string> {
  const known = new Set(CAPABILITIES.flatMap((cap) => cap.fields.map((f) => f.env)))
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(overrides)) {
    if (known.has(key)) out[key] = value
  }
  return out
}
