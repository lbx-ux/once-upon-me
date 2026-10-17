/**
 * /api/cards/analyze-photo —— 「读一遍这张照片，把八条锚点填好」（2026-10-15，用户提的）
 *
 * 用户原话：「增加一个功能，用户上传图片之后，可以让系统分析这个孩子的特征，
 * 然后填入这些数据」。所以这一层做的事只有一件：**把一张照片变成锚点 + 几个标签**。
 * ★ 是**七条**不是八条：要读的那几格由 `READ_SLOTS` 定，它不含「补充」
 *   （那是家长自己写的一格，适配器根本不读它，见 `domain.ts`）。
 *
 * ★ 它是**建议**，不是事实。产物会直接填进表单，而家长能改——所以这里的措辞、
 *   以及界面上的措辞，都不许写成"我们已经认出了你的孩子"。
 *   它读的是照片里**看得见**的东西；看不见的槽位模型被要求写「看不清」，
 *   而 `anchorsFromAnalysis` 会把太短的值丢掉（见 openai-vision.ts）。
 *
 * ★ 判据只有三条，全部复用现成的：同意（`parsePhotoForm` 只认字面量 `'true'`）、
 *   有照片、不超上限（`MAX_PHOTO_BYTES`）。**名字/年龄档/锚点那几条判据在这一层不适用**——
 *   这一条路发生在用户填表的中途，那时候名字多半还是空的，拿 `photoProblems` 一卡，
 *   功能就永远跑不起来（而它看起来只是"点了没反应"）。
 *
 * ★ 照片的字节与 `/api/cards/photo` 一样：**只在这一次请求的内存里**。
 *   读成 data URL、送出去、出作用域。这条路上没有一处把它写进 store。
 */

import type { NextRequest } from 'next/server'
import { toDataUrl } from '@/lib/engine/providers/http.ts'
import { visionProviderOf } from '@/lib/engine/providers/registry.ts'
import { parsePhotoForm } from '@/lib/photo-form.ts'
import { requireCapability } from '@/lib/auth/session.ts'
import { serverEnv } from '@/lib/settings/server-env.ts'
import { MAX_PHOTO_BYTES, megaOf } from '@/lib/photo-rules.ts'
import { userFailureOf } from '@/lib/provider-messages.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest): Promise<Response> {
  // ★ 读照片是**视觉**能力，与出形象的图像不是同一项（`/api/cards` 要 image，这里要 vision）。
  //   闸门放在最前面：没有权限时，那些字节**不该被读进来**
  //   ——与下面"没有同意，那些字节不该被看"是同一条纪律的两个入口
  const guard = await requireCapability(req, ['vision'])
  if (!guard.ok) return guard.response

  // 早退：与 /api/cards/photo 同一条（一个可以撒谎的头，真正生效的上限在下面）
  const declared = Number(req.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > MAX_PHOTO_BYTES * 1.1) {
    return Response.json(
      {
        code: 'invalid-request',
        message: `这次上传 ${megaOf(declared)}，超过了 ${megaOf(MAX_PHOTO_BYTES)} 的上限。`,
      },
      { status: 413 },
    )
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return Response.json(
      { code: 'invalid-request', message: '这次上传的内容读不出来（表单格式不对）。' },
      { status: 400 },
    )
  }

  const request = await parsePhotoForm(form)

  // ★ 同意这一条排在字节前面：没有同意，那些字节**不该被看**（同 photo-rules.ts 那句话）。
  //   ★ 2026-10-16：界面上写它的是「分析锚点」那一按（原来是个勾选框），这条守门没变
  if (!request.consent) {
    return Response.json(
      {
        code: 'invalid-request',
        message: '还没有同意把这张照片交出去。读这张照片也要先得到一次明确的同意。',
      },
      { status: 400 },
    )
  }
  if (request.photo.length === 0) {
    return Response.json({ code: 'invalid-request', message: '还没有选照片。' }, { status: 400 })
  }
  if (request.photo.length > MAX_PHOTO_BYTES) {
    return Response.json(
      {
        code: 'invalid-request',
        message: `这张照片 ${megaOf(request.photo.length)}，超过了 ${megaOf(MAX_PHOTO_BYTES)} 的上限。`,
      },
      { status: 400 },
    )
  }

  const vision = visionProviderOf(serverEnv())
  if (!vision) {
    // ★ 这一条要说清"没配"与"读不出来"的区别：前者要人去设置里配，后者再点一次
    return Response.json(
      {
        code: 'provider-not-configured',
        message: '没配视觉模型（VISION_MODEL），读不了照片——右边那八条你自己填。',
      },
      { status: 400 },
    )
  }

  /**
   * ★ mime 从表单里的 File 取，不另做嗅探：`parsePhotoForm` 只回字节，
   *   而 `toDataUrl` 需要一个 mime。为这一件事引入 sharp（`photo-card.ts` 用它归一化）
   *   会为了一个 3 行的判断多拉一次解码。
   *   取不到就按 jpeg——这条路收的都是手机照片，而错的 mime 只会让模型那边不好解，
   *   不会让这张照片变成别的东西。
   */
  const file = form.get('photo')
  const mime = file instanceof File && file.type !== '' ? file.type : 'image/jpeg'

  try {
    const analysis = await vision.analyzePortrait({
      photoDataUrl: toDataUrl(request.photo, mime),
      // 已经填好的锚点当**粒度参考**（"照着这个细度说"），不是标准答案
      ...(request.anchors.length > 0 ? { anchors: request.anchors } : {}),
    })
    return Response.json({
      anchors: analysis.anchors,
      lookTags: analysis.lookTags,
      ...(analysis.note ? { note: analysis.note } : {}),
      // ★ 哪一个模型读的，回给界面：这几条是"某个模型说的"，家长有权知道是哪个
      modelId: analysis.modelId,
    })
  } catch (err) {
    const failure = userFailureOf(err)
    return Response.json(
      { code: failure.code, message: failure.message, retryable: failure.retryable },
      { status: failure.status },
    )
  }
}
