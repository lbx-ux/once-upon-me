/**
 * /api/cards/photo —— 「用他的照片出一张形象」（工单 03 的第二条路）
 *
 * 这一层故意薄：解析 multipart、把字段凑成 `PhotoCardRequest`、调 `cardFromPhoto`、
 * 把错误按"错在谁"映射成状态码。所有有判据的东西都在 `lib/photo-card.ts`，
 * 因为那里能被测试——而这一条路上最要紧的一句话（照片原图不落盘）
 * 必须有测试撑着，不能只是一句注释。
 *
 * 为什么用 `multipart/form-data` 而不是把照片塞进 JSON 的 base64：
 *   手机照片 3–8 MB，base64 会先胖 33%，再被 JSON.parse 整份复制一次。
 *   而这条路本来就不需要 JSON 的嵌套结构——字段是平的，照片是二进制。
 *   `req.formData()` 是运行时原生的，不引依赖。
 *
 * 为什么不合进 `/api/cards`（那条从零描述的路）：
 *   两条路的请求形状不一样（JSON vs multipart）、错误分流不一样（锚点不合格 vs 照片不合格）、
 *   隐私承诺也不一样（这条要同意、要不落盘）。合成一个 handler 里去 `if (contentType)`，
 *   下一个读它的人要先在脑子里分叉，而分叉错了的症状是"照片那条路走了锚点那份校验"。
 *
 * 状态码按"错在谁"分（与 `/api/cards/revise` 同一条）：
 *   表单缺字段、没勾同意、照片太大 → 400（用户改一下就能过）；
 *   key 不对、平台限流 → 由 `userFailureOf` 分。
 */

import type { NextRequest } from 'next/server'
import { createUserStore } from '@/lib/asset-scope.ts'
import { assetRoot } from '@/lib/books-runtime.ts'
import { assetUrlOf } from '@/lib/asset-url.ts'
import { createCardStore } from '@/lib/engine/index.ts'
import { imageProviderOf } from '@/lib/engine/providers/registry.ts'
import { cardFromPhoto } from '@/lib/photo-card.ts'
// 表单解析在 `lib/photo-form.ts`，不在这个文件里导出：Next 给 Route Handler
//   生成的类型只允许这里导出标准字段，多导一个函数 `pnpm typecheck` 就红
import { parsePhotoForm } from '@/lib/photo-form.ts'
import { MAX_PHOTO_BYTES, megaOf, photoProblems } from '@/lib/photo-rules.ts'
import { userFailureOf } from '@/lib/provider-messages.ts'
import { requireCapability } from '@/lib/auth/session.ts'
import { serverEnv } from '@/lib/settings/server-env.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest): Promise<Response> {
  // 用照片建卡要图像（出那张标准像）与视觉（读照片）两项。
  //   比 `/api/cards` 多一项是对的：那条只看锚点出图，这一条真的把照片交给模型读过
  const guard = await requireCapability(req, ['image', 'vision'])
  if (!guard.ok) return guard.response

  // 早退：Content-Length 说了多大就先拦一次，省掉把 200 MB 读进内存再发现它太大。
  // 多留一成给 multipart 的边界与那几个文字字段；真正生效的上限在 `photoProblems`，
  // 因为这一行读的是一个可以撒谎的头
  const declared = Number(req.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > MAX_PHOTO_BYTES * 1.1) {
    return Response.json(
      {
        code: 'invalid-request',
        message: `这次上传 ${megaOf(declared)}，超过了 ${megaOf(MAX_PHOTO_BYTES)} 的上限。用手机相册里的原图就行，不用先裁。`,
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

  // 字节只活在 request.photo 这个局部对象里：读完 → 归一化 → 当 data URL 送出去 →
  //   出作用域。这条路上没有一处把它写进 store（见 lib/photo-card.ts 文件头第 1 条）
  const request = await parsePhotoForm(form)

  const problems = photoProblems(request)
  if (problems.length > 0) {
    return Response.json(
      { code: 'invalid-request', message: problems.join('；'), extra: problems },
      { status: 400 },
    )
  }

  const root = assetRoot()
  const store = await createUserStore(root, guard.session.userId)
  const cardStore = createCardStore(store)

  // 直接取图像那一个，不用 `createProviders`（理由同 `/api/cards/revise`）：
  //   这条路一步文本、一步视觉、一步语音都不需要，按组构造的工厂就该按组用
  let image
  try {
    image = imageProviderOf(serverEnv())
  } catch (err) {
    return failureResponse(err)
  }

  try {
    const result = await cardFromPhoto(request, { store, cardStore, image })
    return Response.json({
      cardId: result.card.cardId,
      revision: result.card.revision,
      // 图的地址由服务端给（`assetUrlOf`），不让客户端拼 `/api/assets/cards/<id>/…`：
      //   参考图的名字带内容指纹，客户端拼不出来——它只能拼一个"latest"之类的假路径，
      //   而那会 404（这一条我在写这一屏时踩过一次，见 03 的 Comments）
      referenceUrl: assetUrlOf(result.card.reference.path),
      // 归一化做了什么，逐条给界面。★ 这是"我们处理了你的照片"那句话的原料，
      //   在服务端拼好再给出去，界面不许自己编一句（编的那句迟早与归一化做的事不一致）
      processed: {
        notes: result.notes,
        width: result.width,
        height: result.height,
      },
    })
  } catch (err) {
    return failureResponse(err)
  }
}

function failureResponse(err: unknown): Response {
  const failure = userFailureOf(err)
  return Response.json(
    { code: failure.code, message: failure.message, retryable: failure.retryable },
    { status: failure.status },
  )
}
