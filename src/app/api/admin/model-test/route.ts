/**
 * `POST /api/admin/model-test` —— 「测试连通」：拿现在生效的那份配置**真打一次**
 *
 * ```
 *   POST { "capability": "text" | "image" | "vision" | "speech",
 *          "prompt"?: "…",          // 只有图像用
 *          "photo"?:  "data:image/…" }   // 只有视觉用
 *   → 200 { ok, capability, ms, modelId, text?, imageDataUrl?, audioDataUrl?, anchors?, message? }
 *   400 { code: "bad-capability" | "bad-json" | "invalid-request", message }
 *   403 { code: "not-admin" | "not-signed-in" }
 * ```
 *
 * 站长为什么要它（2026-10-18，用户给了四张参考截图）：模型配置这一屏原来**只能填**，
 * 填完没有任何办法知道它到底通不通——而配错的坏法是"保存成功、真的生成一本书时
 * 才以 404 的面目出现"，那时已经过了几页十几秒的出图。
 * 「测试连通」把那个发现时刻从"生成一本书"提到"点一下"。
 *
 * ★ 五条判断，每条都对应一个具体的坏法：
 *
 * 1. **闸是 `requireAdmin`**，与 `/api/admin/model-list` 同一条。这一按**真花钱**
 *    （图像一口价 0.2 元/张，见 `.env.example`），而"谁能按"不是界面上藏按钮能管的。
 *
 * 2. **四支都走现成的按组工厂**（`textProviderOf` / `imageProviderOf` /
 *    `visionProviderOf` / `voiceProviderOf`），与 `/api/optimize`、
 *    `/api/cards/analyze-photo` 是同一条纪律：按组构造的工厂就该按组用。
 *    拿 `createProviders` 做这件事的话，只想测文字的人会因为没配**语音**密钥整条跑不起来
 *    ——而那正是这一屏要回答的问题之一（"哪一项还没配"）。
 *
 * 3. **文字那一支要的是"一句话"，不是一份 JSON**（`plainText: true`）。
 *    不写它的话，`LLM_JSON_MODE=object` 会把这次调用套上 `response_format`，
 *    而 OpenAI 兼容层要求 messages 里出现 "json" 这个词——一个测连通的最小请求
 *    会以 400 结束，看起来像"这一家不通"（理由与实测见 `types.ts` 的 `plainText`）。
 *
 * 4. **图像那一支用 `DEFAULT_IMAGE_SIZE`**（与跨页插画同一个尺寸），不是随便挑一个方图：
 *    这一按要回答的是"**这一家能不能用来出这本书**"。
 *    而尺寸白名单是模型级的（`tokenrhythm-image.ts` 的 `SIZES_BY_MODEL`），
 *    挑一个产品不用的尺寸去测，通不通都不说明产品能不能跑。
 *
 * 5. **失败一律 `adminFailureOf(err)`**（`lib/provider-messages.ts`）。它把厂商回的
 *    401/403/404/429/5xx 翻成人话、并**原样附上厂商那一段原文**——
 *    站长排障要的正是那一段。★ 这一层绝不另编一句"失败"顶上去：
 *    那样四种坏法会读成同一句话，而这个按钮存在的唯一意义就是把它们分开。
 *
 * ★ **不落盘、不进日志**：图与音频以 data URL 回给浏览器（服务端写盘就要管清理，
 *   而它是一次性的，与 `/api/voice/preview` 那条注释同一个理由）；
 *   key 一个字节都不出现在这一层的任何输出里。
 * ★ **不自动重试**：超时不重试是图像那条路既有的纪律（异步任务可能已在服务端建单，
 *   盲目重试会重复扣费，见 `.env.example` 的 `IMAGE_TIMEOUT_MS` 那几句）。
 */

import { NextResponse, type NextRequest } from 'next/server'

import { badJson, jsonBody } from '@/lib/auth/bff.ts'
import { requireAdmin } from '@/lib/auth/session.ts'
import {
  imageProviderOf,
  textProviderOf,
  visionProviderOf,
  voiceProviderOf,
} from '@/lib/engine/providers/registry.ts'
import { MAX_PHOTO_BYTES, megaOf } from '@/lib/photo-rules.ts'
import { adminFailureOf } from '@/lib/provider-messages.ts'
import { TEST_REQUEST } from '@/lib/settings/model-config.ts'
import { serverEnv } from '@/lib/settings/server-env.ts'

// ★ 段配置必须是**字面量**：成员表达式 Next 读不了，而它只在 `pnpm build` 那一刻才报（判据见 lib/route-config.test.ts）
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CAPABILITIES = ['text', 'image', 'vision', 'speech'] as const
type Capability = (typeof CAPABILITIES)[number]

/**
 * ★ 发出去的那点东西**从 `TEST_REQUEST` 来**（`lib/settings/model-config.ts`），
 *   不在这条路由里另写一份：管理页上那张卡底下那行小字说的就是它
 *   （"上限 64 token"、"与跨页插画同一个尺寸"）。两处各写一份的话，
 *   副标题会停在 64 而这里发 4096——那种"字写得很具体、做的是另一件事"谁也不会发现。
 */

/** data URL 的字节数（base64 三个字符两字节）。★ 用它判上限，不 maxLength 一串数字 */
function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',')
  const body = comma >= 0 ? dataUrl.slice(comma + 1) : ''
  return Math.floor((body.length * 3) / 4)
}

function bad(code: string, message: string, status = 400): NextResponse {
  return NextResponse.json({ code, message }, { status })
}

/** 四个分支共用的收尾：一次失败要**带上这一次花的时间**，与成功那条一样 */
function failureOf(capability: Capability, startedAt: number, err: unknown): NextResponse {
  const failure = adminFailureOf(err)
  return NextResponse.json({
    ok: false,
    capability,
    ms: Date.now() - startedAt,
    modelId: '',
    message: failure.message,
    // ★ 失败那条路径上**没有** data URL / 文本：那些是"通的证据"，
    //   而在这里出现只会让界面把一个空字符串当成结果
    text: null,
    imageDataUrl: null,
    audioDataUrl: null,
    anchors: [],
  })
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const gate = await requireAdmin(request)
  if (!gate.ok) return gate.response

  const body = await jsonBody<Record<string, unknown>>(request)
  if (!body) return badJson()

  const capability = String(body['capability'] ?? '').trim()
  if (!CAPABILITIES.includes(capability as Capability)) {
    return bad('bad-capability', `不认识的 capability：${capability || '（空）'}`)
  }
  const cap = capability as Capability
  const env = serverEnv()
  const startedAt = Date.now()

  /* ── 文字：一句话，64 token 上限 ───────────────────────────────────────── */
  if (cap === 'text') {
    try {
      const text = textProviderOf(env)
      const answer = await text.complete({
        system: '你是一个说话简洁的助手。',
        user: TEST_REQUEST.text.line,
        // ★ 见文件头第 3 条：要的是纯文本，不套 response_format
        plainText: true,
        maxTokens: TEST_REQUEST.text.maxTokens,
      })
      return NextResponse.json({
        ok: true,
        capability: cap,
        ms: Date.now() - startedAt,
        modelId: answer.modelId,
        text: answer.text.trim(),
        imageDataUrl: null,
        audioDataUrl: null,
        anchors: [],
        message: null,
      })
    } catch (err) {
      return failureOf(cap, startedAt, err)
    }
  }

  /* ── 图像：一个提示词，一张与跨页插画同尺寸的图 ────────────────────────── */
  if (cap === 'image') {
    const prompt = String(body['prompt'] ?? '').trim() || TEST_REQUEST.image.prompt
    try {
      const image = imageProviderOf(env)
      const picture = await image.generate({ prompt, size: TEST_REQUEST.image.size })
      const mime = picture.mime || 'image/png'
      return NextResponse.json({
        ok: true,
        capability: cap,
        ms: Date.now() - startedAt,
        modelId: picture.modelId,
        text: null,
        // ★ 图整体回给浏览器（见文件头最后一段）：它只在这一次响应里存在
        imageDataUrl: `data:${mime};base64,${Buffer.from(picture.bytes).toString('base64')}`,
        audioDataUrl: null,
        anchors: [],
        message: null,
      })
    } catch (err) {
      return failureOf(cap, startedAt, err)
    }
  }

  /* ── 视觉：带一张本地图片，让它读一遍里面有什么 ─────────────────────────── */
  if (cap === 'vision') {
    const photo = String(body['photo'] ?? '').trim()
    if (!photo.startsWith('data:image/')) {
      return bad('invalid-request', '还没选本地图片（要一张真的图片，不是文件路径）')
    }
    if (dataUrlBytes(photo) > MAX_PHOTO_BYTES) {
      return bad(
        'invalid-request',
        `这张图 ${megaOf(dataUrlBytes(photo))}，超过了 ${megaOf(MAX_PHOTO_BYTES)} 的上限`,
        413,
      )
    }

    const vision = visionProviderOf(env)
    if (!vision) {
      // ★ 「没配」与「打不通」必须分开说：前者是去上面那几格补，后者再点一次
      return bad(
        'provider-not-configured',
        '这一项还没配全：视觉缺 VISION_MODEL 或一把 key（VISION_API_KEY，缺省回落到 LLM_API_KEY）。' +
          '在上面那几格填上并保存之后再点测试。',
      )
    }
    try {
      const analysis = await vision.analyzePortrait({ photoDataUrl: photo })
      return NextResponse.json({
        ok: true,
        capability: cap,
        ms: Date.now() - startedAt,
        modelId: analysis.modelId,
        // ★ 模型自己那句话（"为什么这么读"）。它是**说法**不是事实——
        //   在角色卡那一路由家长核对，在这一屏只是"它真的回话了"的证据
        text: analysis.note ?? null,
        imageDataUrl: null,
        audioDataUrl: null,
        anchors: analysis.anchors.map((item) => ({ slot: item.slot, value: item.value })),
        message: null,
      })
    } catch (err) {
      return failureOf(cap, startedAt, err)
    }
  }

  /* ── 语音：按「音色」那一格合成一句试听台词 ─────────────────────────────── */
  const voiceId = (env['TTS_VOICE'] ?? '').trim()
  if (voiceId === '') {
    return bad(
      'invalid-request',
      '这一项还缺一个音色：在「音色」那一格填一个（模型厂商那边的音色 id），保存之后再点测试',
    )
  }
  const voice = voiceProviderOf(env)
  if (!voice) {
    return bad(
      'provider-not-configured',
      '这一项还没配全：语音缺 TTS_MODEL 或 TTS_API_KEY。在上面那几格填上并保存之后再点测试。',
    )
  }
  try {
    const speech = await voice.synthesize({ voiceId, text: TEST_REQUEST.speech.line })
    const mime = speech.mime || 'audio/mpeg'
    return NextResponse.json({
      ok: true,
      capability: cap,
      ms: Date.now() - startedAt,
      modelId: voice.modelId,
      text: TEST_REQUEST.speech.line,
      imageDataUrl: null,
      audioDataUrl: `data:${mime};base64,${Buffer.from(speech.bytes).toString('base64')}`,
      anchors: [],
      message: null,
    })
  } catch (err) {
    return failureOf(cap, startedAt, err)
  }
}
