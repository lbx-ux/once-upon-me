/**
 * /api/children —— 有哪些孩子，以及新建一个
 *
 * ```
 *   GET   /api/children   创作流第 1 步「选一个小主角」的数据源
 *   POST  /api/children   新建一个孩子的档案
 * ```
 *
 * ★ GET 回的是**界面视图**（`ChildPickerItem`），不是原始档案：
 *   图地址在服务端算好（`?w=240` 那一档），客户端不拼宽度——
 *   档位是一张封闭表，权威在 `lib/thumbs.ts`。
 * ★ 取数在 `children-list.ts`，与「小主角」那一屏、形象页同一份实现：
 *   "档案对卡"这件事只该有一处（各写一遍 join 的症状是同一份数据
 *   在两个页面上归属不同的孩子）。
 *
 * POST 一件事：把「他是谁」落成一个 `children/<childId>.json`。
 * ★ 它**不**建角色卡（见下面的 `POST` 那段注释）。
 *
 * ★ 2026-10-17（工单 16）：两个动词原来**都没有登录闸**——孩子是谁、叫什么，
 *   是这一整站里最私人的一件东西，而它对匿名请求是公开的。
 *   现在匿名 401，登录的人只看得见自己那一片（别人的孩子在他那里不存在）。
 */

import type { NextRequest } from 'next/server'
import { assetRoot } from '@/lib/books-runtime.ts'
import type { AgeBand } from '@/lib/engine/domain.ts'
import { createProfileStore } from '@/lib/engine/index.ts'
import { createUserStore, userSliceRoot } from '@/lib/asset-scope.ts'
import { requireCapability } from '@/lib/auth/session.ts'
// ★ 校验只有一份：新建与改名收的是同一份东西（见 children-body.ts 的文件头）
import { parseChildBody } from '@/lib/children-body.ts'
import { listChildPicker } from '@/lib/children-list.ts'
import { userFailureOf } from '@/lib/provider-messages.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 有哪些孩子。创作流第 1 步与「小主角」那一屏读的是同一份 */
export async function GET(req: NextRequest): Promise<Response> {
  const guard = await requireCapability(req, [])
  if (!guard.ok) return guard.response

  return Response.json({
    children: await listChildPicker(userSliceRoot(assetRoot(), guard.session.userId)),
  })
}

/**
 * 生成一个新孩子的 childId。
 *
 * ★ 与 `creation/state.ts` 的 `makeChildId` 同一个形状（`kid-` + 6 位 36 进制），
 *   也同样是**随机**的：中文名推不出 slug，而用序号（kid-1、kid-2）会让两台机器
 *   上的"第一个孩子"撞成同一个目录。这里不 import 那一个，是因为它活在客户端模块里
 *   （`creation/state.ts` 给浏览器用），服务端从这里引会把整包拖过来——
 *   而这个形状是**协议**（由 `SAFE_CHILD_ID` 定义），不是实现。
 */
function newChildId(): string {
  return `kid-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 新建一个孩子的档案。
 *
 * ★ 它**不**建角色卡。档案与卡是两份东西（`profile.ts` 文件头的表），
 *   而"有档案、没形象"是一个**正常状态**——刚建档、还没出图的孩子就是这样，
 *   家长在出图失败之后也会停在这里。分成两条路之后，这个地方的失败变得可解释：
 *   "档案存下了，只是图没出来" 与 "什么都没存下" 是两句不同的话，
 *   而合成一条的话，它们在界面上长得一模一样。
 * ★ `childId` **由服务端生成**，不是客户端传上来的。理由与卡号不含时间戳同源：
 *   它会被拼进路径（`children/<childId>.json`），也会出现在 URL 上。
 *   让客户端给，就是把"合法路径段"这件事交给一个可以随便填的地方，
 *   而这一层的校验只能事后挡（`profile-store` 的 `SAFE_CHILD_ID`）。
 *   生成在服务端，则非法值**在这一层根本不存在**。
 * ★ 名字的合法性判据在 `buildChildRecord` 里（引擎侧），这里不重写一遍：
 *   本层只做"JSON 的形状对不对"，不合格就交给引擎抛 `profile-invalid`。
 */
export async function POST(req: NextRequest): Promise<Response> {
  // 新建一个档案不是一次生成（不调任何模型），所以不要任何能力
  const guard = await requireCapability(req, [])
  if (!guard.ok) return guard.response

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ code: 'bad-json', message: '请求体不是合法的 JSON' }, { status: 400 })
  }

  const { body, problems } = parseChildBody(raw)
  if (!body) {
    return Response.json(
      { code: 'invalid-request', message: problems.join('；'), extra: problems },
      { status: 400 },
    )
  }

  const store = await createUserStore(assetRoot(), guard.session.userId)
  const profiles = createProfileStore(store)

  try {
    const record = await profiles.save({
      childId: newChildId(),
      name: body.name,
      nameReading: body.nameReading,
      // 年龄档的合法值由引擎判（`validateChildRecord` 读 `AGE_BANDS`），这里不抄
      ageBand: body.ageBand as AgeBand,
      // ★ 性别（第 23 刀）：`parseChildBody` 已经把它验过一遍（只认 boy/girl），
      //   没选就**不带这个键**——"有才写"这条口径与 `buildChildRecord` 那边一致
      ...(body.gender ? { gender: body.gender } : {}),
      lookTags: body.lookTags,
      interestTags: body.interestTags,
      createdAt: Date.now(),
    })
    return Response.json({ childId: record.childId, profile: record })
  } catch (err) {
    const failure = userFailureOf(err)
    return Response.json(
      { code: failure.code, message: failure.message, retryable: failure.retryable },
      { status: failure.status },
    )
  }
}
