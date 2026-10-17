/**
 * `PUT|DELETE /api/admin/model-config/<capability>` —— 改一个能力的模型配置 / 恢复默认
 *
 * ```
 *   PUT  { "model": "qwen3.8-flash", "baseUrl": "https://…/v1", "apiKey": "sk-…", "voice": null }
 *     → 与 GET 同一份 view（界面照它整块替换）
 *   DELETE
 *     → 同上。这个能力那几格回到 `.env.local` 里的值
 *   400 { "code": "bad-base-url"   } / { "code": "unknown-field" } / { "code": "bad-json" }
 * ```
 *
 * ★ **空的 `apiKey` 表示"这次不改"**，不是"清掉它"。清掉是 `DELETE`（界面上是
 *   「恢复默认」那个按钮）。两件事分开是刻意的：合成一件的话，一个人只想换个
 *   模型名，会把已经配好的 key 一起清掉——而症状要到下一次生成才出现（401），
 *   那时他早就不记得自己刚才动过什么。
 *
 * ★ 写完之后**立刻回一份新的 view**，而不是回 204：界面要显示"现在生效的配置"，
 *   而那正是 `describeProviders(serverEnv())` 现读出来的东西。
 *   回 204 的话界面只能自己拼一份"我以为改成了"的样子——这个仓库里
 *   已经为这件事写过两次注释了（权限开关、申请队列）。
 *
 * ★ 写的是磁盘上那份被 gitignore 的文件。**写之前把值 trim**，
 *   与读的时候同一条纪律（复制粘贴带一个尾空格是最常见的"key 明明对却 401"）。
 */

import { NextResponse, type NextRequest } from 'next/server'

import { AUTH_ROUTE_CONFIG, badJson, jsonBody } from '@/lib/auth/bff.ts'
import { requireAdmin } from '@/lib/auth/session.ts'
import {
  applyPatch,
  capabilitySpec,
  checkField,
  clearCapability,
  keepKnownKeys,
  modelConfigView,
} from '@/lib/settings/model-config.ts'
import type { FieldId } from '@/lib/settings/model-config-state.ts'
import { readOverrides, writeOverrides } from '@/lib/settings/runtime-config.ts'

export const runtime = AUTH_ROUTE_CONFIG.runtime
export const dynamic = AUTH_ROUTE_CONFIG.dynamic

function bad(code: string, message: string, status = 400): NextResponse {
  return NextResponse.json({ code, message }, { status })
}

/** 两个动词共用的那一段：闸 + 能力名 + 拿到那份 spec */
async function open(
  request: NextRequest,
  ctx: { params: Promise<{ capability: string }> },
): Promise<
  | { ok: true; spec: NonNullable<ReturnType<typeof capabilitySpec>> }
  | { ok: false; response: NextResponse }
> {
  const gate = await requireAdmin(request)
  if (!gate.ok) return { ok: false, response: gate.response }

  const { capability } = await ctx.params
  const spec = capabilitySpec(capability)
  if (!spec) {
    // ★ 认不出的能力名要说出来（不是当成 404 页面）：拼错一个字母
    //   在界面上看起来就是"保存了但没生效"
    return { ok: false, response: bad('unknown-capability', `没有「${capability}」这个能力`) }
  }
  return { ok: true, spec }
}

export async function PUT(
  request: NextRequest,
  ctx: { params: Promise<{ capability: string }> },
): Promise<NextResponse> {
  const opened = await open(request, ctx)
  if (!opened.ok) return opened.response

  const body = await jsonBody<Record<string, unknown>>(request)
  if (!body) return badJson()

  // ★ 只校验**这个能力真有**的那几格。
  //   第一版这里是遍历全部四个字段名，于是「语音」有而别人没有的 `voice`
  //   让文字/图像/视觉三个能力的保存**全都 400**——而语音那一条是通的，
  //   所以从外面看起来像"只有语音能用"。端到端验的第四条判据逮住了它。
  const patch: Partial<Record<FieldId, string>> = {}
  for (const field of opened.spec.fields) {
    const verdict = checkField(opened.spec, field.id, body[field.id])
    if (!verdict.ok) return bad(verdict.code, verdict.message)
    patch[field.id] = verdict.value
  }

  // ★ 而多出来的字段一律拒——**包括"别的能力那一格"**（给文字送 `voice`）。
  //   忽略的话，界面把字段名拼错就是"保存成功但什么都没改"
  const mine = new Set(opened.spec.fields.map((field) => field.id))
  for (const key of Object.keys(body)) {
    if (!mine.has(key as FieldId)) {
      return bad('unknown-field', `${opened.spec.label}没有「${key}」这一项`)
    }
  }

  // ★ 一格都没填就别写文件：那只会把 mtime 推一下，而"什么都没改"与
  //   "改了一下又改回来"在排查时长得一样
  if (Object.values(patch).every((value) => (value ?? '') === '')) {
    return bad('nothing-to-change', '这几格都是空的，没有任何改动')
  }

  const next = keepKnownKeys(applyPatch(readOverrides(), opened.spec, patch))
  await writeOverrides(next)

  return NextResponse.json(modelConfigView())
}

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ capability: string }> },
): Promise<NextResponse> {
  const opened = await open(request, ctx)
  if (!opened.ok) return opened.response

  // ★ 把这个能力的几格从文件里去掉，而不是往文件里写一份 `.env` 的值：
  //   写进去之后基线再改也跟不上（文件压过环境变量），而"恢复默认"的意思
  //   就是**重新跟着基线走**
  const next = keepKnownKeys(clearCapability(readOverrides(), opened.spec))
  await writeOverrides(next)

  return NextResponse.json(modelConfigView())
}
