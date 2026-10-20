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
 * 2. 合成回的是 URL，不是字节：`output.audio.url` 是签名 OSS 地址，
 *    实测 `expires_at` 约 24 小时后失效。下载在适配器内部完成——
 *    这正是 types.ts 文件头第 2 条那条约定（供应商地址过期这件事不该变成一条纪律）。
 * 3. 样本用 data URL 传，所以样本从不需要放到任何公开地址上。实测
 *    `create_voice` 的 `url` 字段接受 `data:audio/mpeg;base64,…` 并回 200。
 *    这一条是 §8.3 / §8.4「拿到 voice_id 后立即删样本」能真做到的前提：
 *    样本只在请求体里出现过，我们从未把它写到磁盘、对象存储或任何一个 URL 上。
 * 4. 音色绑定模型。实测：用 `qwen-audio-3.0-tts-flash` 克隆的音色去打
 *    `qwen-audio-3.1-tts-flash` → 400 `[cosyvoice]Engine error [411]`。
 *    所以 `clone` 的 `target_model` 必须是本适配器的 modelId，
 *    界面侧也要把"换模型 = 旧音色失效"讲出来，不许默默回落。
 * 5. 情绪标签只在三个模型上发，名单之外一个字符都不发。`MOOD_TAGS` 是 `Mood → 控制类标签`
 *    的翻译表（2026-10-19 接上；实测台账在 `docs/known-tradeoffs.md`）。
 *    名单之外不是"没效果"而是"乱来"：实测一个词表之外的无意义标签 `[zzzznope]`
 *    会被厂商当成某种控制符消费掉，时长 +23.1%（同时 `【zzzznope】` 全角括号不被识别、
 *    内容被念出来 +50.2%）——所以这里不做前缀匹配、不做猜测，精确命中才发。
 *    （这两个数是单次测的，但都远远超出这台机器量到的噪声底 0.24s。）
 *    不发标签时不报错（那会让换模型的人整本配音全挂，而这是新引入的故障），
 *    由 `narrateAll` 补一条非致命事件说清"这一本是平调"。
 *    ★ 顺带记一笔别踩的坑：这家 TTS 不确定——同一段文本、同一个请求连打 12 次，
 *    不带标签的那一档也出了 2 种版本（2.45s / 2.69s）。所以"两次字节不同"不能当作
 *    "标签生效了"的证据；要判效果得拿两组分布比（`.out/tts-mood-dist.mjs` 的噪声底量法）。
 * 6. `pronunciation`（读音纠正）本适配器还没接 —— 它要 SSML 的音素控制，没有实测过，
 *    所以非空时直接报错，与 tokenrhythm-image 对参考图的处理同一条道理：
 *    被忽略的输入会让上游以为它生效了，而症状要到"家长说名字念错了"时才浮出来。
 * 7. `sample_rate` 不发送。实测请求里写 `24000` 被忽略，回的是 48kHz；
 *    发一个不生效的参数会让下一个人以为语速/音质是靠它调的。
 *
 * 与 tokenrhythm-image 一样：本文件不 import React，也不假设浏览器 API。
 */

import { EngineError } from '../errors.ts'
import type { Mood } from '../domain.ts'
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

/**
 * `domain.ts` 的 `Mood` → 百炼的控制类标签。写在正文里，管到下一个标签为止，
 * 不需要额外参数。
 *
 * 形状照 `CHOICE_ICON_LABELS`：`Record<Mood, …>`，于是「加了一个 mood 却没给它配标签」
 *   是一个类型错误。运行时不报错的那种坏法最难查——它只表现为"这一页偶然地和别页
 *   一个调子"，没人会去翻这张表。`calm` 的 `null` 因此是写出来的决定，不是漏写。
 *
 * 只用控制类（只改怎么念），不用富语言类（`[giggles]` / `[sighing]` /
 *   `[clears throat]` 那一组）。后者会往音频里插进原文里没有的声音，与演示书那份
 *   稿子的第一条纪律"念的必须就是印的"冲突。要用得先过产品那一关，不是这里顺手能加的。
 *
 * `calm` 故意不发标签：平稳叙述就是这个音色的默认状态，发一个标签等于把"默认"
 *   说成"某个决定"。这一格也是最容易想改的一格——想让平静页多一点暖意，
 *   把它改成 `'[empathetic]'` 就够，改这一处，别处都不用动。
 *
 * `tense` 只取 `[trembling]`。词表里的 `[panicked]`（惊慌）/`[shouting]`（大喊）/
 *   `[crying]`（哭泣）对睡前童书太重：这一页是给 3–6 岁的孩子听的，
 *   一个听起来真在害怕的旁白比"没感情"更糟。挑这一档时"更贴切"不是标准，"更轻"才是。
 *
 * `joy` 与 `proud` 都落 `[excited]`——词表里没有更贴"自豪"的档，认下来比硬凑一个
 *   近义词好：凑出来的标签只会让"语气不对"变得难查。这两档在听感上会重合，是已知的。
 *
 * 哪几档真的量出来了（2026-10-19，音色 `longjielidou_v3.6`，过程在
 *   `docs/known-tradeoffs.md`）。这一栏是给下一个调这张表的人的起点：
 *
 *   | mood | 标签 | 量到了什么 |
 *   | --- | --- | --- |
 *   | joy / proud | `[excited]` | 基频明显抬高：F0 区间 316–322Hz，而对照 279–290Hz |
 *   | tense | `[trembling]` | 基频抬高（305–315Hz）且时长也长一点 |
 *   | wonder | `[amazed]` | 方向对但不稳：F0 区间 282–319Hz，与对照交叠（有时生效有时不生效） |
 *   | tender | `[empathetic]` | ★ 没测出效果：F0 283–289Hz，整个落在对照的 279–290Hz 里 |
 *   | calm | （不发） | 对照组本身 |
 *
 *   `tender` 那一格因此是明知的弱档：它可能仍有 F0 与时长都测不到的质感变化
 *   （气声、共鸣），我的度量看不到。要动它先听——`.out/mood-listening.mjs`
 *   会连 `[whispers]`（实测音高明显更低）一起出样本。
 */
const MOOD_TAGS: Record<Mood, string | null> = {
  calm: null,
  wonder: '[amazed]',
  joy: '[excited]',
  tense: '[trembling]',
  tender: '[empathetic]',
  proud: '[excited]',
}

/**
 * 认这些标签的模型。依据：`realtime-tts-user-guide`「支持模型」一节（2026-10-19 取）。
 *
 * 精确匹配，不做前缀匹配。理由见文件头第 5 条：认错了厂商不是忽略不认识的标签，
 *   而是把它当控制符乱来（实测无意义标签 +23.1% 时长）。
 *   "qwen-audio-3.2-tts-flash 应该也认吧"这种推断在这里没有依据——
 *   要加一个模型，先照 `.out/tts-mood-probe.mjs` 量一遍。
 */
const MOOD_TAG_MODELS: readonly string[] = [
  'qwen-audio-3.1-tts-flash',
  'qwen-audio-3.0-tts-plus',
  'qwen-audio-3.0-tts-flash',
]

/**
 * 一段正文 + 一个 mood → 真正送进 `input.text` 的文本。
 *
 * 收 `string` 而不是 `Mood`：`mood` 的运行时来源是模型写的 JSON（`tree.ts` 已经把它
 * 收敛到 `MOODS` 里了，但那一层是兜底成 `calm`，不是"保证类型"）。
 * 收窄成 `Mood` 会把"模型写了个词表外的 mood"从正常情况变成一个类型断言，
 * 而断言在这里唯一的作用就是把一个可能的错值说成不可能——与 `hasChoiceIcon` 收
 * `string` 是同一条道理。词表外的值一律不发标签（发了就是文件头第 5 条那个乱来）。
 */
function speechTextOf(text: string, mood: string | undefined): string {
  const tag = mood ? ((MOOD_TAGS as Record<string, string | null>)[mood] ?? null) : null
  return tag === null ? text : `${tag}${text}`
}

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
  /** 这个模型认不认情绪标签（文件头第 5 条）。引擎据此决定要不要说一句"这一本是平调" */
  const supportsMood = MOOD_TAG_MODELS.includes(modelId)

  const requireKey = (): void => {
    if (!deps.apiKey) {
      throw new EngineError('provider-not-configured', 'TTS_API_KEY 未配置，语音能力不可用')
    }
  }

  return {
    id: `qwen-speech(${modelId})`,
    modelId,
    supportsMood,

    async synthesize(
      req: SynthesizeRequest,
      budget?: CallBudget,
    ): Promise<{ bytes: Uint8Array; mime: string }> {
      requireKey()
      // 文件头第 6 条：没接的能力不许装作接了（读音纠正仍欠着）
      if (req.pronunciation && Object.keys(req.pronunciation).length > 0) {
        throw new EngineError(
          'provider-call-failed',
          '本适配器还没有接读音纠正（多音字）。名字读音目前只进故事规划的 prompt，' +
            '没有进 TTS——要真纠正读音得先接 SSML 音素控制并实测（见 ' +
            'docs 的 ssml-latex-user-guide）。本次调用带了 pronunciation，' +
            '拒绝静默忽略：被忽略的读音会让"名字念错了"到家长那里才发现',
        )
      }
      if (!req.voiceId) {
        throw new EngineError('provider-not-configured', '没有指定音色（voiceId）')
      }

      // 文件头第 5 条：标签只在认它的模型上发。不在名单上就照原样送，
      //   由 `narrateAll` 去说"这一本是平调"——不在这里报错（那会让换模型的人
      //   整本配音全挂，而这是本次改动新引入的故障，不是配置错误）。
      const text = supportsMood ? speechTextOf(req.text, req.mood) : req.text

      const body = await requestJson(deps, {
        method: 'POST',
        path: SYNTH_PATH,
        body: {
          model: modelId,
          input: {
            text,
            voice: req.voiceId,
            format,
            // 不传 sample_rate：实测被忽略（文件头第 7 条）
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
      // 拿到就立刻下载（文件头第 2 条）。24 小时比起图像那家的 1 小时宽，
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
      // 时长没法在这里校验（要解码音频，适配器不该带解码器）。
      //   "推荐 10–20 秒、最长 60 秒"这条约束落在采集样本的界面上，
      //   不在这一层——这里只保证不把明显不合规的字节发出去。

      // ★ `consentRef` 在这里有意不发送：实测这一家的 create_voice 不要授权凭据
      //   （MiniMax 那条路要，见它的文档）。但它仍由调用方保管——删除凭据要能说出
      //   "这条音色是基于哪一次授权创建的"，那个记录在我们这边，不在厂商那边。
      //   这条与文件头第 5 条的区别是刻意的：那边漏的是能力，这边漏的是记账。

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
            // ★ 文件头第 3 条：样本以 data URL 进请求体，因此从不落到别处
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
     * 失败抛错不吞：删除凭据要能如实写下"这一处没删掉"，
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
