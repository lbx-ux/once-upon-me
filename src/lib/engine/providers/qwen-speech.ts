/**
 * qwen-speech.ts —— 语音能力适配器（阿里云百炼 Qwen-Audio-TTS + voice-enrollment）
 *
 * 实测结论全部来自 2026-10-14 的探测（`node .out/tts-probe.mjs` / `.out/tts-probe2.mjs`，
 * 完整记录在 `.scratch/app-restructure/spec.md` §1.2c）。六条不显然的规则：
 *
 * 1. **BASE_URL 要写到 `/api/v1`**，不是域名根。资源段是 `/services/audio/tts/...`，
 *    与聚合站那套 `/v1/images/...` 不同构，所以这一家不能与 IMAGE_* 共用 base。
 *    实测 `TTS_BASE_URL=https://dashscope.aliyuncs.com` 配 `requireUrl` 会补成
 *    `/v1`（错的），必须写成 `https://dashscope.aliyuncs.com/api/v1`。
 * 2. **合成回的是 URL，不是字节**：`output.audio.url` 是签名 OSS 地址，
 *    实测 `expires_at` 约 24 小时后失效。下载在适配器内部完成——
 *    这正是 types.ts 文件头第 2 条那条约定（供应商地址过期这件事不该变成一条纪律）。
 * 3. **样本用 data URL 传，所以样本从不需要放到任何公开地址上**。实测
 *    `create_voice` 的 `url` 字段接受 `data:audio/mpeg;base64,…` 并回 200。
 *    这一条是 §8.3 / §8.4「拿到 voice_id 后立即删样本」能**真做到**的前提：
 *    样本只在请求体里出现过，我们从未把它写到磁盘、对象存储或任何一个 URL 上。
 * 4. **音色绑定模型**。实测：用 `qwen-audio-3.0-tts-flash` 克隆的音色去打
 *    `qwen-audio-3.1-tts-flash` → 400 `[cosyvoice]Engine error [411]`。
 *    所以 `clone` 的 `target_model` **必须**是本适配器的 modelId，
 *    界面侧也要把"换模型 = 旧音色失效"讲出来，不许默默回落。
 * 5. **不静默丢字段**。`pronunciation`（读音纠正）与 `mood`（情绪）本适配器**都还没接**
 *    —— 前者要 SSML 的音素控制，后者要情感标签，两者都**没有实测过**，
 *    所以它们非空时**直接报错**，与 tokenrhythm-image 对参考图的处理同一条道理：
 *    被忽略的输入会让上游以为它生效了，而症状要到"家长说名字念错了"时才浮出来。
 * 6. **`sample_rate` 不发送**。实测请求里写 `24000` 被忽略，回的是 48kHz；
 *    发一个不生效的参数会让下一个人以为语速/音质是靠它调的。
 *
 * 与 tokenrhythm-image 一样：本文件不 import React，也不假设浏览器 API。
 */

import { EngineError } from '../errors.ts'
import {
  base64,
  fetchBytes,
  findFirst,
  findMediaUrl,
  requestJson,
  traceOf,
  type HttpDeps,
} from './http.ts'
import type { CallBudget, CloneRequest, SynthesizeRequest, VoiceSynthesizer } from './types.ts'

/** BASE_URL 已含 `/api/v1`（见文件头第 1 条），所以路径只写资源段 */
const SYNTH_PATH = '/services/audio/tts/SpeechSynthesizer'
const CUSTOMIZE_PATH = '/services/audio/tts/customization'

/** 复刻与音色管理走同一个端点，靠 `input.action` 分流 */
const ENROLL_MODEL = 'voice-enrollment'

/** 样本要求（文档原文）：WAV(16bit)/MP3/M4A，≤10MB。时长 10–20s 推荐、≤60s */
const SAMPLE_MIMES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
]
const MAX_SAMPLE_BYTES = 10 * 1024 * 1024

export type QwenSpeechOptions = {
  /** 缺省 mp3。实测输出恒为 mp3（48kHz/320kbps），见文件头第 6 条 */
  format?: 'mp3' | 'wav' | 'pcm' | 'opus'
  /** create_voice 的 prefix：只影响厂商回给我们的 voice_id 长相，语义上无意义 */
  voicePrefix?: string
  /** 单次合成的超时。实测一句 0.7–1.5s，但网络抖动要留余量 */
  synthTimeoutMs?: number
}

export function createQwenSpeech(
  deps: HttpDeps,
  modelId: string,
  opts: QwenSpeechOptions = {},
): VoiceSynthesizer {
  const format = opts.format ?? 'mp3'
  const prefix = opts.voicePrefix ?? 'xiaozhujue'
  const synthTimeoutMs = opts.synthTimeoutMs ?? 60_000

  const requireKey = (): void => {
    if (!deps.apiKey) {
      throw new EngineError('provider-not-configured', 'TTS_API_KEY 未配置，语音能力不可用')
    }
  }

  return {
    id: `qwen-speech(${modelId})`,
    modelId,

    async synthesize(
      req: SynthesizeRequest,
      budget?: CallBudget,
    ): Promise<{ bytes: Uint8Array; mime: string }> {
      requireKey()
      // 文件头第 5 条：没接的能力不许装作接了
      if (req.pronunciation && Object.keys(req.pronunciation).length > 0) {
        throw new EngineError(
          'provider-call-failed',
          '本适配器还没有接读音纠正（多音字）。名字读音目前只进故事规划的 prompt，' +
            '没有进 TTS——要真纠正读音得先接 SSML 音素控制并实测（见 ' +
            'docs 的 ssml-latex-user-guide）。本次调用带了 pronunciation，' +
            '拒绝静默忽略：被忽略的读音会让"名字念错了"到家长那里才发现',
        )
      }
      if (req.mood) {
        throw new EngineError(
          'provider-call-failed',
          `本适配器还没有接情绪标签（收到 mood=${req.mood}）。` +
            'Qwen-Audio-TTS 文档提到情感/富语言标签，但**没有实测过**中文童书场景该用哪套标签，' +
            '所以拒绝静默忽略——忽略它只会让每一页都读成同一个调子，而没人知道为什么',
        )
      }
      if (!req.voiceId) {
        throw new EngineError('provider-not-configured', '没有指定音色（voiceId）')
      }

      const body = await requestJson(deps, {
        method: 'POST',
        path: SYNTH_PATH,
        body: {
          model: modelId,
          input: {
            text: req.text,
            voice: req.voiceId,
            format,
            // 不传 sample_rate：实测被忽略（文件头第 6 条）
          },
        },
        signal: budget?.signal,
        timeoutMs: budget?.timeoutMs ?? synthTimeoutMs,
      })

      const url = findMediaUrl(body)
      if (!url) {
        throw new EngineError(
          'provider-call-failed',
          '语音响应里没有可用的音频地址（字段层级可能变了）',
          { traceId: traceOf(body) || undefined, detail: body },
        )
      }
      // ★ 拿到就立刻下载（文件头第 2 条）。24 小时比起图像那家的 1 小时宽，
      //   但"宽"不是"可以依赖"：过期与否不该由我们记住。
      const { bytes, mime } = await fetchBytes(url, { signal: budget?.signal })
      return { bytes, mime }
    },

    async clone(req: CloneRequest, budget?: CallBudget): Promise<{ voiceId: string }> {
      requireKey()
      if (req.sampleBytes.byteLength === 0) {
        throw new EngineError('provider-call-failed', '克隆声音的样本是空的')
      }
      if (req.sampleBytes.byteLength > MAX_SAMPLE_BYTES) {
        throw new EngineError(
          'provider-call-failed',
          `样本超过 10MB（当前 ${(req.sampleBytes.byteLength / 1024 / 1024).toFixed(1)}MB）。` +
            '文档要求 ≤10MB、10–20 秒为宜',
        )
      }
      if (!SAMPLE_MIMES.includes(req.mime.toLowerCase())) {
        throw new EngineError(
          'provider-call-failed',
          `样本格式 ${req.mime} 不在支持列表里（WAV 16bit / MP3 / M4A）`,
        )
      }
      // ★ 时长没法在这里校验（要解码音频，适配器不该带解码器）。
      //   "推荐 10–20 秒、最长 60 秒"这条约束落在**采集样本的界面**上，
      //   不在这一层——这里只保证不把明显不合规的字节发出去。

      // ★ `consentRef` 在这里**有意不发送**：实测这一家的 create_voice 不要授权凭据
      //   （MiniMax 那条路要，见它的文档）。但它仍由调用方保管——删除凭据要能说出
      //   "这条音色是基于哪一次授权创建的"，那个记录在我们这边，不在厂商那边。
      //   这条与文件头第 5 条的区别是刻意的：那边漏的是**能力**，这边漏的是**记账**。

      const body = await requestJson(deps, {
        method: 'POST',
        path: CUSTOMIZE_PATH,
        body: {
          model: ENROLL_MODEL,
          input: {
            action: 'create_voice',
            // 文件头第 4 条：音色绑定模型，写死成本适配器的 modelId
            target_model: modelId,
            prefix,
            // ★ 文件头第 3 条：样本以 data URL 进请求体，因此**从不落到别处**
            url: `data:${req.mime};base64,${base64(req.sampleBytes)}`,
          },
        },
        signal: budget?.signal,
        timeoutMs: budget?.timeoutMs ?? 120_000,
      })

      const voiceId = findFirst(body, ['voice_id'])
      if (voiceId === null) {
        throw new EngineError('provider-call-failed', '创建音色没有返回 voice_id', {
          traceId: traceOf(body) || undefined,
          detail: body,
        })
      }
      return { voiceId: String(voiceId) }
    },

    /**
     * ★ 生命周期方法（types.ts 文件头第 3 条）：删孩子时必须调它解绑。
     *
     * 失败**抛错不吞**：删除凭据要能如实写下"这一处没删掉"，
     * 一个把失败变成 `{released:false}` 又不说的实现，会让凭据看起来是干净的。
     * 实测（`.out/tts-probe2.mjs`）：delete 之后再用同一个 voice_id 合成 → 400，
     * `list_voice` 的 `total_count` 归 0 —— 所以返回 true 是有依据的，不是"发了请求就算成"。
     */
    async release(voiceId: string, budget?: CallBudget): Promise<{ released: boolean }> {
      requireKey()
      await requestJson(deps, {
        method: 'POST',
        path: CUSTOMIZE_PATH,
        body: {
          model: ENROLL_MODEL,
          input: { action: 'delete_voice', voice_id: voiceId },
        },
        signal: budget?.signal,
        timeoutMs: budget?.timeoutMs ?? 60_000,
      })
      return { released: true }
    },
  }
}
