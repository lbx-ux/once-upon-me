/**
 * registry.ts —— 环境变量 → 能力包（"模型不写死"落地的唯一位置）
 *
 * 三条规则，都是这一层的事：
 *
 * 1. **模型 id 只能从环境变量来**。代码里出现的每一个默认值都只是"没配时用什么"，
 *    并且会随 `id` 报出来，所以日志里永远看得见实际用的是哪个模型。
 *    2026 年这个领域版本号季度级变化（tech-selection §7.2 的原话），
 *    把 `wan2.7-image` 写进引擎，等于把一次选型变成一次改代码 + 重新过闸门。
 * 2. **读不到 key 就给显式错误，不静默降级**（tech-selection §6 原文要求）。
 *    `mode: 'offline'` 是调用方**声明**的，不是 fallback 出来的。
 * 3. **能力之间可以共用供应商，但变量各归各**：`VISION_*` 缺省时回落到 `LLM_*`
 *    （同一家供应商的对话模型多半同时支持图片输入），而 `IMAGE_*` 不回落到
 *    `LLM_*`——图像与对话的接口形状根本不同，回落只会把配置错误变成运行期 400。
 *
 * env 是**参数**不是 `process.env`：这样单元测试可以喂一张假表，
 * node 脚本与 Route Handler 各自传自己的来源，registry 本身不需要知道自己在哪跑。
 */

import { EngineError } from '../errors.ts'
import { createOpenAiText } from './openai-text.ts'
import { createOpenAiVision } from './openai-vision.ts'
import { createTokenrhythmImage } from './tokenrhythm-image.ts'
import { createFsStore, createMemoryStore } from './stores.ts'
import { createReplayImage, createReplayText, type ReplayManifest } from './replay.ts'
import type { AssetStore, ProviderBundle, ProviderMode } from './types.ts'

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

const DEFAULT_BASE = 'https://tokenrhythm.studio/v1'

/**
 * 文本适配器的选项，**从 env 派生**。
 *
 * ★ 这个函数被导出去，是为了让横评脚本用**同一份**选项建适配器。
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
    // ★ 缺省**关**思考，这是实测决定的，不是偏好：
    //   思考模型会把 max_tokens 整条花在思考链上，正文一个字都不写
    //   （实测：预算 4096 → 正文 0 字符、思考 9072 字符、finish_reason=length）。
    //   开着它出厂的默认配置就是坏的；想开就 LLM_THINKING=on 并且把
    //   LLM_MAX_TOKENS 提到 16000（实测 5373–7417 tokens 才写完一张故事表）。
    //   例外：glm-5.3-flash **不允许**关思考（HTTP 400 REASONING_REQUIRED），
    //   选到它只能 on + 16000，见 docs/tech-selection.md §9.1.1。
    extra: thinking === 'on' ? undefined : { enable_thinking: false },
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
      voice: null,
      store,
    }
  }

  const text = createOpenAiText(
    {
      baseUrl: requireUrl(env, 'LLM_BASE_URL'),
      apiKey: requireKey(env, 'LLM_API_KEY'),
      timeoutMs: numberOf(env, 'LLM_TIMEOUT_MS'),
    },
    requireModel(env, 'LLM_MODEL'),
    textOptionsOf(env),
  )

  const image = createTokenrhythmImage(
    {
      baseUrl: requireUrl(env, 'IMAGE_BASE_URL'),
      apiKey: requireKey(env, 'IMAGE_API_KEY'),
      timeoutMs: numberOf(env, 'IMAGE_TIMEOUT_MS') ?? 180_000,
    },
    requireModel(env, 'IMAGE_MODEL'),
    {
      // 参考图能力**在 tokenrhythm 这条图像接口上是实测的"没有"**（7 个候选字段名
      // 全被 400「请求包含未知字段」挡回，见 tokenrhythm-image.ts 文件头第 4 条）。
      // 这个开关留着是为了换供应商时只动一行；填 1 而这家仍不支持，
      // 适配器会**直接报错**，不会把参考图悄悄丢掉——丢掉的参考图比报错贵得多。
      supportsReference: env['IMAGE_SUPPORTS_REFERENCE'] === '1',
      unitCostCny: numberOf(env, 'IMAGE_UNIT_COST_CNY') ?? 0.2,
    },
  )

  const visionKey = env['VISION_API_KEY'] || env['LLM_API_KEY'] || ''
  const visionModel = env['VISION_MODEL'] || ''
  const vision =
    visionKey && visionModel
      ? createOpenAiVision(
          {
            baseUrl: env['VISION_BASE_URL'] || env['LLM_BASE_URL'] || DEFAULT_BASE,
            apiKey: visionKey,
            // 与文本同一条道理：视觉比对的缺省超时要按**它自己的载荷**定（两张
            // 1440² 的图），不是按一句话定。缺省由适配器给（300s），这里只让
            // .env 能压过去
            timeoutMs: numberOf(env, 'VISION_TIMEOUT_MS'),
          },
          visionModel,
        )
      : null

  return { mode, text, image, vision, voice: null, store }
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

function requireUrl(env: Env, name: string): string {
  const value = env[name]?.trim() || DEFAULT_BASE
  if (!/^https?:\/\//.test(value)) {
    throw new EngineError(
      'provider-not-configured',
      `${name} 必须是 http(s) 地址，当前是「${value}」`,
    )
  }
  // 供应商的路径都挂在 /v1 下；漏写就补上，写错成 /v2 则不猜
  return /\/v\d+$/.test(value.replace(/\/+$/, '')) ? value : value.replace(/\/+$/, '') + '/v1'
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
    // 文本这一行**必须带上思考开关与预算**：它们是"实际生效的配置"的一部分，
    // 而且默认值与平台默认值**相反**（我们默认关思考）。看不见就等于没配
    text:
      one('文本', 'LLM_API_KEY', 'LLM_MODEL', 'LLM_BASE_URL') +
      `（思考 ${(env['LLM_THINKING'] ?? 'off').trim() === 'on' ? '开' : '关'}，` +
      `预算 ${env['LLM_MAX_TOKENS']?.trim() || '4096（缺省）'}）`,
    image: one('图像', 'IMAGE_API_KEY', 'IMAGE_MODEL', 'IMAGE_BASE_URL'),
    // 视觉比对缺 key 时回落到 LLM 的 key，所以这里报"用哪个 key"而不是"VISION_API_KEY 空不空"
    vision: env['VISION_MODEL']?.trim()
      ? `视觉比对: ${env['VISION_MODEL'].trim()} @ ${(env['VISION_BASE_URL'] || env['LLM_BASE_URL'] || DEFAULT_BASE).replace(/^https?:\/\//, '')}（key 取 ${env['VISION_API_KEY']?.trim() ? 'VISION_API_KEY' : 'LLM_API_KEY'}）`
      : '视觉比对: 未配置 VISION_MODEL —— 引擎会走「未核对」路径，不会假装通过',
    voice: '未配置（W4 落地）',
  }
}
