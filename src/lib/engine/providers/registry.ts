/**
 * registry.ts —— 环境变量 → 能力包（"模型不写死"落地的唯一位置）
 *
 * 三条规则，都是这一层的事：
 *
 * 1. 模型 id 只能从环境变量来。代码里出现的每一个默认值都只是"没配时用什么"，
 *    并且会随 `id` 报出来，所以日志里永远看得见实际用的是哪个模型。
 *    2026 年这个领域版本号季度级变化（tech-selection §7.2 的原话），
 *    把 `wan2.7-image` 写进引擎，等于把一次选型变成一次改代码 + 重新过闸门。
 * 2. 读不到 key 就给显式错误，不静默降级（tech-selection §6 原文要求）。
 *    `mode: 'offline'` 是调用方声明的，不是 fallback 出来的。
 * 3. 能力之间可以共用供应商，但变量各归各：`VISION_*` 缺省时回落到 `LLM_*`
 *    （同一家供应商的对话模型多半同时支持图片输入），而 `IMAGE_*` 不回落到
 *    `LLM_*`——图像与对话的接口形状根本不同，回落只会把配置错误变成运行期 400。
 *
 * env 是参数不是 `process.env`：这样单元测试可以喂一张假表，
 * node 脚本与 Route Handler 各自传自己的来源，registry 本身不需要知道自己在哪跑。
 */

import { EngineError } from '../errors.ts'
import { createOpenAiText } from './openai-text.ts'
import { createOpenAiVision } from './openai-vision.ts'
import { createQwenSpeech } from './qwen-speech.ts'
import { createQwenImage } from './qwen-image.ts'
import { thinkingOffOf, visionThinkingOffOf } from './thinking.ts'
import { createFsStore, createMemoryStore } from './stores.ts'
import { createReplayImage, createReplayText, type ReplayManifest } from './replay.ts'
import type {
  AssetStore,
  ImageGenerator,
  PictureReviewer,
  ProviderBundle,
  ProviderMode,
  TextGenerator,
  PortraitAnalyzer,
  VisionComparator,
  VoiceSynthesizer,
} from './types.ts'

export type Env = Record<string, string | undefined>

export type RegistryInput = {
  env: Env
  mode: ProviderMode
  store?: AssetStore
  /** offline 模式必需：live 跑一次录下来的 manifest */
  manifest?: ReplayManifest
  /** 磁盘 store 的根目录；给了就用磁盘，否则用内存（测试与一次性脚本） */
  assetRoot?: string
}

/**
 * 文本 / 视觉在没有显式 `*_BASE_URL` 时的缺省地址。
 *
 * ★ 2026-10-22 从聚合站（`tokenrhythm.studio/v1`）改成 DeepSeek：全站的模型已经换到
 *   这一家，旧缺省会让"忘了配地址"的表现变成向一个不再使用的网关发请求——401/404
 *   看起来像 key 坏了，而真相是一个过期默认值。图像与语音本来就不回落（见各自注释）。
 */
const DEFAULT_BASE = 'https://api.deepseek.com/v1'

/**
 * 文本适配器的选项，从 env 派生。
 *
 * 这个函数被导出去，是为了让横评脚本用同一份选项建适配器。
 *   上一版横评自己 `createOpenAiText(deps, model, {jsonMode})`，于是它测的
 *   是"横评以为的生产配置"而不是生产配置——maxTokens、思考开关、超时三项全不一样。
 *   横评表的价值全押在"跑的就是要上线的那个配置"上，所以这份构造只留一处。
 */
export function textOptionsOf(env: Env): {
  jsonMode: 'none' | 'object' | 'schema'
  defaultMaxTokens?: number
  extra?: Record<string, unknown>
} {
  const thinking = (env['LLM_THINKING'] ?? 'off').trim()
  if (thinking !== 'on' && thinking !== 'off') {
    throw new EngineError(
      'provider-not-configured',
      `LLM_THINKING 只接受 on / off，当前是「${thinking}」`,
    )
  }
  return {
    jsonMode: jsonModeOf(env, 'LLM_JSON_MODE'),
    defaultMaxTokens: numberOf(env, 'LLM_MAX_TOKENS'),
    // 缺省关思考，这是实测决定的，不是偏好：
    //   思考模型会把 max_tokens 整条花在思考链上，正文一个字都不写
    //   （实测：预算 4096 → 正文 0 字符、思考 9072 字符、finish_reason=length）。
    //   开着它出厂的默认配置就是坏的；想开就 LLM_THINKING=on 并且把
    //   LLM_MAX_TOKENS 提到 16000（实测 5373–7417 tokens 才写完一张故事表）。
    //   例外：glm-5.3-flash 不允许关思考（HTTP 400 REASONING_REQUIRED），
    //   选到它只能 on + 16000，见 docs/tech-selection.md §9.1.1。
    //
    // ★ "怎么关"这个词随家而异，所以它由 `thinkingOffOf(modelId)` 一处决定
    //   （2026-10-21 补：DeepSeek 的默认是**开**，字段名也不同——写错的话两家都不报错，
    //   症状是思考一直开着）。这里只判"要不要关"。
    extra: thinking === 'on' ? undefined : thinkingOffOf(env['LLM_MODEL'] ?? ''),
  }
}

export async function createProviders(input: RegistryInput): Promise<ProviderBundle> {
  const { env, mode } = input
  const store =
    input.store ?? (input.assetRoot ? await createFsStore(input.assetRoot) : createMemoryStore())

  if (mode === 'offline') {
    if (!input.manifest) {
      throw new EngineError(
        'provider-not-configured',
        'mode=offline 需要 manifest（先用 mode=live 跑一次并录制）。拒绝在没有资产的情况下假装离线可用',
      )
    }
    return {
      mode,
      text: createReplayText(store, input.manifest),
      image: createReplayImage(store, input.manifest),
      vision: null,
      // 离线不合成配音：书清单里已经带了 narrations（那是产物，见 ADR-0003），
      // 阅读器直接读盘上的音频文件。离线要的是"能重放已生成的"，不是"重新生成"
      voice: null,
      store,
    }
  }

  return {
    mode,
    text: textProviderOf(env),
    image: imageProviderOf(env),
    vision: visionProviderOf(env),
    voice: voiceProviderOf(env),
    store,
  }
}

/* 一组一组的构造：createProviders 与设置抽屉的"试一试"共用
 *
 * 为什么把它们单独导出来：设置抽屉里每一个"试一试"只该真的调那一个能力
 *   （实测那句话：探测要打真请求，不然等于没测）。而 `createProviders` 是全都要，
 *   少一项就抛错——拿它去做单项探测，等于逼着界面把四组都填满才能验一组。
 *   导出来之后构造仍然只有一处，不会出现"探测用的配置与生产配置不一样"
 *   （这正是 `textOptionsOf` 当初被导出的同一条理由）。
 */

export function textProviderOf(env: Env): TextGenerator {
  return createOpenAiText(
    {
      baseUrl: requireUrl(env, 'LLM_BASE_URL'),
      apiKey: requireKey(env, 'LLM_API_KEY'),
      timeoutMs: numberOf(env, 'LLM_TIMEOUT_MS'),
    },
    requireModel(env, 'LLM_MODEL'),
    textOptionsOf(env),
  )
}

/**
 * 图像那一路（2026-10-21 从 tokenrhythm 的 wan2.7-image 换成阿里云百炼的 qwen-image-3.0）。
 *
 * 三条与别处不同的地方，都是换家换出来的，不是偏好：
 *
 * 1. `IMAGE_BASE_URL` **没有可回落的默认值**（`required: true`），而且必须写成以 `/api/v1`
 *    结尾（`pathPrefix`）。别家能回落到 `DEFAULT_BASE` 是因为那两个接口共用聚合站的域名；
 *    这一家（阿里云百炼）的地址与语音那家是**同一个**（`https://dashscope.aliyuncs.com/api/v1`），
 *    而路径挂在 `/services/aigc/...` 而不是聚合站的 `/images/...`。
 *    回落到 DEFAULT_BASE 的表现是"配置看着齐了，然后一路 404"——与 `TTS_BASE_URL` 同一条判据。
 * 2. `IMAGE_SUPPORTS_REFERENCE` 那个开关不在了（工单 02 删的）。它是 W1 那条错误结论的
 *    化石："七个字段名都被挡回 ⇒ 这家吃不了参考图"，而实际只是没试另一条路由。
 *    能力现在由适配器自己表达：有没有 `edit` 方法。一个可能忘记同步的环境变量
 *    比一个方法签名更容易骗人。
 * 3. `IMAGE_PROMPT_EXTEND` 缺省 **off**（与厂商默认相反）。理由写在适配器
 *    `QwenImageOptions.promptExtend` 那一段：我们的 prompt 里带着角色卡的锚点段，
 *    让厂商的改写模型动它，等于把"判据与生成同源"交给一个没量过的黑盒。
 */
export function imageProviderOf(env: Env): ImageGenerator {
  return createQwenImage(
    {
      baseUrl: requireUrl(env, 'IMAGE_BASE_URL', { required: true, pathPrefix: '/api/v1' }),
      apiKey: requireKey(env, 'IMAGE_API_KEY'),
      timeoutMs: numberOf(env, 'IMAGE_TIMEOUT_MS'),
    },
    requireModel(env, 'IMAGE_MODEL'),
    {
      // ★ 没有缺省值：上一家那个 0.20 元是**那家**实测的一口价，对这一家不是任何东西。
      //   没配 `IMAGE_UNIT_COST_CNY` 就不记账（`costCny` 留空），也不编一个数
      ...(numberOf(env, 'IMAGE_UNIT_COST_CNY') === undefined
        ? {}
        : { unitCostCny: numberOf(env, 'IMAGE_UNIT_COST_CNY') }),
      promptExtend: promptExtendOf(env),
    },
  )
}

/** `IMAGE_PROMPT_EXTEND` 只接受 on / off，缺省 off。配错值要响，不悄悄当 off（同 `jsonModeOf`） */
function promptExtendOf(env: Env): boolean {
  const raw = (env['IMAGE_PROMPT_EXTEND'] ?? 'off').trim()
  if (raw === 'on') return true
  if (raw === 'off') return false
  throw new EngineError(
    'provider-not-configured',
    `IMAGE_PROMPT_EXTEND 只接受 on / off，当前是「${raw}」`,
  )
}

/**
 * 视觉那一路。★ 返回的是三个接口的交集（第三个 2026-10-19 加）：同一个适配器
 * 既做「这两张图是不是同一个人」（`compare`，给一致性 Agent 用）、
 * 「这张照片里的孩子长什么样」（`analyzePortrait`，给 /character/new 用），
 * 也做「这张画里有没有不该出现的东西」（`reviewPicture`，给内容审核用）。
 * 用交集而不是三个工厂：三者用的是同一个模型、同一把 key、同一套 HTTP 管道，
 * 分成三个 `visionProviderOf` 只会多三处"某个调用点忘了配超时"。
 */
export function visionProviderOf(
  env: Env,
): (VisionComparator & PortraitAnalyzer & PictureReviewer) | null {
  const visionKey = env['VISION_API_KEY'] || env['LLM_API_KEY'] || ''
  const visionModel = env['VISION_MODEL'] || ''
  if (!visionKey || !visionModel) return null
  return createOpenAiVision(
    {
      baseUrl: env['VISION_BASE_URL'] || env['LLM_BASE_URL'] || DEFAULT_BASE,
      apiKey: visionKey,
      // 与文本同一条道理：视觉比对的缺省超时要按它自己的载荷定（两张
      // 1440² 的图），不是按一句话定。缺省由适配器给（300s），这里只让 .env 能压过去
      timeoutMs: numberOf(env, 'VISION_TIMEOUT_MS'),
    },
    visionModel,
    {
      /**
       * 读照片那条路的 token 预算。
       *
       * 2026-10-16 补的出口，起因是一次用户报障：截图里写着
       *   `finish_reason=length · 正文 0 字 · 思考链 961 字`——预算是推理模型时
       *   最先要用完的那样东西，而适配器里原来把它硬编码成 700。缺省已经提到 4096
       *   （与文本那条路一致，见 `openai-vision.ts` 的 `DEFAULT_ANALYZE_MAX_TOKENS`），
       *   这一格是留给"换一个更重的推理模型"的。
       * 它不在设置抽屉里（那一格只有 base / key / 模型名）：抽屉是本机家长用的，
       *   而"这个模型要多大预算"是选型时才知道的事。要压它，写在 `env` 表里传进来
       *   （脚本与 e2e 都走这条路），不要为它加一个家长看不懂的输入框。
       */
      analyzeMaxTokens: numberOf(env, 'VISION_MAX_TOKENS'),
      // 同一个数管两处（读数与比对）：它是这个模型的属性（"它一次要想多久"），
      //   不是某一次调用的属性。原来只有读数那一格接了它，比对那一格写死 400
      //   （见 `DEFAULT_COMPARE_MAX_TOKENS` 那段：那让 8/8 页都判成"没法核对"）。
      //   要分开调就传 `VISION_COMPARE_MAX_TOKENS`——留这一格是因为比对的思考链更长，
      //   将来真撞线时，改它比改一个共用的数更不容易误伤读数那条路。
      compareMaxTokens:
        numberOf(env, 'VISION_COMPARE_MAX_TOKENS') ?? numberOf(env, 'VISION_MAX_TOKENS'),
      /**
       * 画面审核那条路的预算（`.scratch/safety` 工单 01）。
       *
       * 缺省回落 `VISION_MAX_TOKENS`，不回落 `VISION_COMPARE_MAX_TOKENS`：
       *   比对那一格是单独调过的（它的思考链最长），而审核这一问与读数同一量级。
       *   回落错了的表现是"只调了比对的预算，审核那条跟着涨"，而两边都看不出来。
       */
      safetyMaxTokens:
        numberOf(env, 'VISION_SAFETY_MAX_TOKENS') ?? numberOf(env, 'VISION_MAX_TOKENS'),
      /**
       * 关思考的字段（2026-10-21 补，换到 DeepSeek 那天）。
       *
       * ★ 视觉这一路**一律关思考**：它三条路要回来的都是一段结构化 JSON（像不像、有没有
       *   违禁、这孩子长什么样），不是需要推理链的开放问题；而思考链是先花掉 `max_tokens`
       *   的那一半（`DEFAULT_COMPARE_MAX_TOKENS` 那几段记的都是这个病）。
       *   规则本身在 `visionThinkingOffOf` 里：**只有 DeepSeek 要显式写**——它的默认是开。
       */
      extra: visionThinkingOffOf(visionModel),
    },
  )
}

export function voiceProviderOf(env: Env): VoiceSynthesizer | null {
  const voiceKey = env['TTS_API_KEY']?.trim() || ''
  const voiceModel = env['TTS_MODEL']?.trim() || ''
  if (!voiceKey || !voiceModel) return null
  return createQwenSpeech(
    {
      // ★ 这一家不回落到 DEFAULT_BASE。别的能力回落是因为同一家供应商的
      //   两个接口共用域名；语音这家（阿里云百炼）既不在聚合站上，路径也是
      //   `/api/v1/services/...` 而不是聚合站的 `/v1/images/...`。
      //   回落到 DEFAULT_BASE 的表现是"配了一半，然后一路 404"——
      //   那正是本文件头第 2 条要挡的静默降级。
      baseUrl: requireUrl(env, 'TTS_BASE_URL', { required: true, pathPrefix: '/api/v1' }),
      apiKey: voiceKey,
      timeoutMs: numberOf(env, 'TTS_TIMEOUT_MS'),
    },
    voiceModel,
    { voicePrefix: env['TTS_VOICE_PREFIX']?.trim() || undefined },
  )
}

function requireKey(env: Env, name: string): string {
  const value = env[name]?.trim()
  if (!value) {
    throw new EngineError(
      'provider-not-configured',
      `${name} 未配置。真实密钥只写 .env.local（仓库公开，提交上去撤不回来）`,
    )
  }
  return value
}

/**
 * 取一个 base 地址。
 *
 * 缺省行为是"空值回落到 DEFAULT_BASE"（文本/图像都靠它），
 * 但语音那家不能回落（见调用处注释），所以这里给两个开关：
 * - `required`：空值直接报错，不回落
 * - `pathPrefix`：要求的路径前缀。写错时的表现是所有请求 404，
 *   而 404 不会告诉你"你少写了 /api"，所以要在配置期就说出来
 */
function requireUrl(
  env: Env,
  name: string,
  opts: { required?: boolean; pathPrefix?: string } = {},
): string {
  const raw = env[name]?.trim() || ''
  if (!raw) {
    if (opts.required) {
      throw new EngineError(
        'provider-not-configured',
        `${name} 未配置。这一项没有可回落的默认值：` +
          `它的接口形状与其他几家不同，猜一个地址只会换来一串 404`,
      )
    }
    return DEFAULT_BASE
  }
  if (!/^https?:\/\//.test(raw)) {
    throw new EngineError(
      'provider-not-configured',
      `${name} 必须是 http(s) 地址，当前是「${raw}」`,
    )
  }
  // 供应商的路径都挂在 /v1 下；漏写就补上，写错成 /v2 则不猜
  const base = /\/v\d+$/.test(raw.replace(/\/+$/, ''))
    ? raw.replace(/\/+$/, '')
    : raw.replace(/\/+$/, '') + '/v1'
  if (opts.pathPrefix && !base.endsWith(opts.pathPrefix)) {
    throw new EngineError(
      'provider-not-configured',
      `${name} 要写成以 ${opts.pathPrefix} 结尾的地址（当前「${base}」）。` +
        `例：https://dashscope.aliyuncs.com${opts.pathPrefix}`,
    )
  }
  return base
}

function requireModel(env: Env, name: string): string {
  const value = env[name]?.trim()
  if (!value) {
    throw new EngineError(
      'provider-not-configured',
      `${name} 未配置。模型名一律写在 .env.local 里，代码不写死——换模型不许改代码`,
    )
  }
  return value
}

function numberOf(env: Env, name: string): number | undefined {
  const raw = env[name]?.trim()
  if (!raw) return undefined
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

function jsonModeOf(env: Env, name: string): 'none' | 'object' | 'schema' {
  const raw = (env[name] ?? 'object').trim()
  // 横评要按档分别测（档位是判据的一部分），所以配错的值必须响，不能悄悄当 none
  if (raw === 'none' || raw === 'object' || raw === 'schema') return raw
  throw new EngineError(
    'provider-not-configured',
    `${name} 只接受 none / object / schema，当前是「${raw}」`,
  )
}

/** 给启动自检与 /api/health 用：不抛错地报告每一项能不能用、用的是哪个模型 */
export function describeProviders(env: Env): Record<string, string> {
  const one = (label: string, key: string, model: string, base?: string) => {
    if (!env[key]?.trim()) return `${label}: 未配置`
    return `${label}: ${env[model]?.trim() || '缺模型名'} @ ${(env[base ?? '']?.trim() || DEFAULT_BASE).replace(/^https?:\/\//, '')}`
  }
  return {
    // 文本这一行必须带上思考开关与预算：它们是"实际生效的配置"的一部分，
    // 而且默认值与平台默认值相反（我们默认关思考）。看不见就等于没配
    text:
      one('文本', 'LLM_API_KEY', 'LLM_MODEL', 'LLM_BASE_URL') +
      `（思考 ${(env['LLM_THINKING'] ?? 'off').trim() === 'on' ? '开' : '关'}，` +
      `预算 ${env['LLM_MAX_TOKENS']?.trim() || '4096（缺省）'}）`,
    // 图像这一行把"提示词改写"也报出来：它与厂商默认相反（我们关着），
    //   而"实际生效的配置"里少了这一项，就会有人按文档以为它是开的
    image: (() => {
      if (!env['IMAGE_API_KEY']?.trim()) return '图像: 未配置'
      const base = env['IMAGE_BASE_URL']?.trim()
      if (!base) return '图像: 缺 IMAGE_BASE_URL（这一项没有可回落的默认值）'
      return (
        `图像: ${env['IMAGE_MODEL']?.trim() || '缺模型名'} @ ${base.replace(/^https?:\/\//, '')}` +
        `（提示词改写 ${promptExtendOf(env) ? '开' : '关'}）`
      )
    })(),
    // 视觉比对缺 key 时回落到 LLM 的 key，所以这里报"用哪个 key"而不是"VISION_API_KEY 空不空"
    vision: env['VISION_MODEL']?.trim()
      ? `视觉比对: ${env['VISION_MODEL'].trim()} @ ${(env['VISION_BASE_URL'] || env['LLM_BASE_URL'] || DEFAULT_BASE).replace(/^https?:\/\//, '')}（key 取 ${env['VISION_API_KEY']?.trim() ? 'VISION_API_KEY' : 'LLM_API_KEY'}）`
      : '视觉比对: 未配置 VISION_MODEL —— 引擎会走「未核对」路径，不会假装通过',
    // 语音这一行要报出音色也要报：换了模型而音色没跟着换的表现是
    // `[cosyvoice]Engine error [411]`，一句厂商内部错误，看不出是配置问题
    voice: (() => {
      if (!env['TTS_API_KEY']?.trim() || !env['TTS_MODEL']?.trim()) {
        return '语音: 未配置（这本书没有朗读）'
      }
      const model = env['TTS_MODEL'].trim()
      const voiceId = env['TTS_VOICE']?.trim()
      return `语音: ${model} @ ${(env['TTS_BASE_URL']?.trim() || '缺 TTS_BASE_URL').replace(/^https?:\/\//, '')}（音色 ${voiceId || '未指定 —— 生成时要给 voiceId'}，克隆音色绑定模型，换模型即失效）`
    })(),
  }
}
