/**
 * /api/children/[childId] —— 改一个孩子的档案，或者删掉他（工单 03 第三刀 + 本轮）
 *
 * ```
 *   GET     /api/children/<childId>   预演：回一张"将要删掉什么"的凭据（一个字节都不动）
 *   PATCH   /api/children/<childId>   改档案：名字、读音、年龄档、两组标签
 *   DELETE  /api/children/<childId>   真删：回一张"删掉了什么"的凭据
 * ```
 *
 * 三个动词写在同一个文件里，虽然严格说"预演"更像一个子资源
 *   （`/deletion`）。合在这里的理由只有一个：三种拒绝（示例孩子 / 没有这个孩子 /
 *   参数不合法）在预演、改名与真删上必须给出同一句话，分成两个文件就要么复制一段，
 *   要么再抽一层——而复制的那一天起，两条路的拒绝理由就会开始不一样，
 *   症状是"预演说能删、真删说 403"。
 *   改名也走同一个 `refuse()`，所以示例孩子改不了（与删不掉是同一条规矩）。
 *
 * 预演是按需取的（不是详情页一渲染就去数一遍）：
 *   数一遍要遍历 `cards/`、`books/`、每个缩略图档位；大多数人永远不点删除，
 *   为这一屏的每一次浏览都付一次目录遍历，是把代价放在最不该放的地方。
 *
 * 拒绝的三种情形，话都不一样（合成一句"删除失败"等于什么都没说）：
 *   - 示例孩子 → 403：他的档案在 `public/` 里，删不掉；硬删只会让他"回来但没有形象"
 *   - 没有这个孩子 → 404
 *   - 删到一半失败 → 500 + 带上那张不完整的凭据（哪些删了、哪些没有），
 *     并且 `message` 点名是哪几个位置（`partialMessageOf`，与
 *     `/api/books/<bookId>` 那条 DELETE 同一套话术）。★ 2026-10-17 之前这里
 *     回的是 200 + 只有凭据：界面读不到那句话，于是家长看到的是自己那句兜底，
 *     "点名"三个字停在注释里
 *
 * 2026-10-17（工单 16）：三个动词原来都没有登录闸。真删这一条尤其要紧——
 *   它删的是"这个孩子名下的卡与书"，而那个孩子可以是别人家的。
 *   现在三处都过同一道闸，并且 `depsOf(userId)` 拿到的是调用者那一片：
 *   别人的 childId 在这里读不到档案 → 走那句 404「没有这个孩子」。
 */

import type { NextRequest } from 'next/server'
import { assetRoot } from '@/lib/books-runtime.ts'
import type { AgeBand } from '@/lib/engine/domain.ts'
import { createCardStore, createProfileStore } from '@/lib/engine/index.ts'
import { createUserStore, userSliceRoot } from '@/lib/asset-scope.ts'
import { requireCapability } from '@/lib/auth/session.ts'
// 与 `POST /api/children` 共用同一份"这段请求体算不算一份档案"（见该文件文件头）
import { parseChildBody } from '@/lib/children-body.ts'
import { childProfileOf, isDemoChildId } from '@/lib/children-source.ts'
import {
  deleteChildEverywhere,
  partialMessageOf,
  planDeletion,
  type DeletionReceipt,
} from '@/lib/child-deletion.ts'
import { userFailureOf } from '@/lib/provider-messages.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 示例孩子不能删：这句话要说清"为什么"，否则看起来像我们懒得做 */
const DEMO_REFUSAL =
  '这是随仓库发布的示例角色，删不掉——他的档案在 public/demo/ 里，是仓库内容。' +
  '真把他名下的图删掉的话，下一次列目录他会从 public/ 回来，变成一个"没有形象的孩子"。'

async function depsOf(userId: string): Promise<Parameters<typeof planDeletion>[1]> {
  const store = await createUserStore(assetRoot(), userId)
  return { store, cardStore: createCardStore(store), profiles: createProfileStore(store) }
}

/** 三种拒绝合在一处，三个动词共用（预演与真删对同一件事必须给出同一句话） */
async function refuse(
  childId: string,
  userId: string,
): Promise<{ response: Response; receipt?: DeletionReceipt } | null> {
  if (await isDemoChildId(childId)) {
    return {
      response: Response.json({ code: 'demo-child', message: DEMO_REFUSAL }, { status: 403 }),
    }
  }
  // ★ 查的是调用者那一片里的档案：别人的 childId 在这里不存在 → 那句 404。
  //   示例孩子照旧先判（它在 public/ 里，与谁那一片无关）
  const found = await childProfileOf(childId, userSliceRoot(assetRoot(), userId))
  if (!found) {
    return {
      response: Response.json(
        { code: 'child-not-found', message: '没有这个孩子（可能已经删掉了）。' },
        { status: 404 },
      ),
    }
  }
  return null
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ childId: string }> },
): Promise<Response> {
  // 预演要的是"我这一片里他会带走什么"，所以先认人再算（工单 16）
  const guard = await requireCapability(req, [])
  if (!guard.ok) return guard.response

  const { childId } = await params
  const denied = await refuse(childId, guard.session.userId)
  if (denied) return denied.response

  try {
    const receipt = await planDeletion(childId, await depsOf(guard.session.userId))
    return Response.json({ receipt })
  } catch (err) {
    const failure = userFailureOf(err)
    return Response.json(
      { code: failure.code, message: failure.message, retryable: failure.retryable },
      { status: failure.status },
    )
  }
}

/**
 * 改档案：名字、读音、年龄档、两组标签（用户 2026-10-15 提的第 5 条）。
 *
 * ```
 *   PATCH /api/children/<childId>   { name, nameReading, ageBand, lookTags, interestTags }
 * ```
 *
 * 它收的是那五个可编辑字段的完整一份，不是 JSON Patch 那种局部指令。
 *   名字叫 PATCH 是因为语义是"改这个已有的资源"；传半份会被判"名字还没填"，
 *   这是对的——一个能把名字改成空字符串的接口才是可怕的。
 * `childId` 只从 URL 来，不认 body 里的那一个：认了就有了
 *   "PATCH /children/a 把 a 改成 b 的档案"这种歧义，而那需要另一整套语义才说得清。
 * 复用 `refuse()`，所以示例角色同样改不了（403 + 那句理由）。
 *   这不是偷懒：档案落在 `children/<id>.json`，而示例孩子的档案在 `public/demo/` 里；
 *   在本地写一份同名档案会得到一个"覆盖过示例的孩子"——删除那一刀已经证明
 *   那种状态会让人困惑（`isDemo` 与 `demoId` 因此不是一件事）。
 *   要改就新建一个自己的。一句话讲得清：仓库里的东西不改。
 * `createdAt` 传 `Date.now()` 是故意的：`profiles.save` 里有一条
 *   "已有档案的 createdAt 不可被改写"（`profile-store.ts`），这一处正好走在那条守卫上，
 *   而验证步骤就是读回来确认它没被刷掉。守卫在别人的用例里生效，不算验过。
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ childId: string }> },
): Promise<Response> {
  // 改档案不要能力（不调模型），但要认人：不然就能改别人家孩子的名字
  const guard = await requireCapability(req, [])
  if (!guard.ok) return guard.response

  const { childId } = await params
  const denied = await refuse(childId, guard.session.userId)
  if (denied) return denied.response

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

  const { profiles } = await depsOf(guard.session.userId)
  try {
    // 名字合不合法、年龄档在不在 `AGE_BANDS` 里，由引擎判（`buildChildRecord`
    // 会抛 `profile-invalid`）——这一层不重写一遍判据
    const record = await profiles.save({
      childId,
      name: body.name,
      nameReading: body.nameReading,
      ageBand: body.ageBand as AgeBand,
      // ★ 性别（第 23 刀）。★ 这一条必须传：`profiles.save` 写的是整条记录，
      //   不传就等于"这一次改档案把性别擦掉了"。实测过一次同类事故的不是这个字段，
      //   但形状一样——`updatedAt` 那条注释就在下面。
      //   没选就不带这个键：`buildChildRecord` 那边也是"有才写"（见那里的注释）
      ...(body.gender ? { gender: body.gender } : {}),
      lookTags: body.lookTags,
      interestTags: body.interestTags,
      createdAt: Date.now(),
      /**
       * ★ 必须传。`NewChildRecord.updatedAt` 的契约写在引擎里那句话上：
       *   "改名时传当前时间；不传就等于没改过"（`profile.ts`）。
       *   第一版我没传，于是改完名读回来 `updatedAt === createdAt`——
       *   这条档案看起来"从来没动过"，而它刚刚被动过。
       *   是验证步骤（读回磁盘对时间戳）抓出来的，不是读代码读出来的。
       */
      updatedAt: Date.now(),
    })
    return Response.json({ profile: record })
  } catch (err) {
    const failure = userFailureOf(err)
    return Response.json(
      { code: failure.code, message: failure.message, retryable: failure.retryable },
      { status: failure.status },
    )
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ childId: string }> },
): Promise<Response> {
  // 真删。闸门在最前面，理由见文件头：删的是"这个孩子名下的卡与书"，
  //   而这个孩子可以是别人家的——没有这一道，一个 DELETE 就能把陌生人的作品清掉
  const guard = await requireCapability(req, [])
  if (!guard.ok) return guard.response

  const { childId } = await params
  const denied = await refuse(childId, guard.session.userId)
  if (denied) return denied.response

  try {
    const receipt = await deleteChildEverywhere(childId, await depsOf(guard.session.userId))
    // 判据取"这句话有没有"，不取 `receipt.complete`：两者等价（有一个位置失败就有一个名字），
    //   但取这句话能让"回 500"与"有一句点名的解释"变成同一件事——
    //   "回了 500 却没话说"这种组合就写不出来了
    const message = partialMessageOf(receipt)
    if (message !== null) {
      // 删到一半失败：500 + 凭据 + 点名那句话，与 `/api/books/<bookId>` 的 DELETE 同一套。
      //   三样东西各有一个理由：
      //   · 凭据一起回去：只说"删除失败"会让家长以为一样都没删，而
      //     "确实删了一半"与"什么都没删"要让人做两件不同的事（前者不用重试，
      //     后者可以重试；重试本身是安全的：`deletePrefix` 对不存在的路径回 0）
      //   · 500 而不是 200：200 会让这一趟在日志与监控里长得像成功，而它不是
      //   · 点名哪几个位置：这一层存在的全部意义就是"删掉了"这三个字能被检查，
      //     而"有些位置没删干净"没说是哪几处，等于把那份清单又还给了一次信任
      //   这里不走 `userFailureOf`：手上没有异常，只有一张凭据（同删书那条）
      return Response.json(
        { code: 'asset-write-failed', message, retryable: true, receipt },
        { status: 500 },
      )
    }
    return Response.json({ receipt })
  } catch (err) {
    const failure = userFailureOf(err)
    return Response.json(
      { code: failure.code, message: failure.message, retryable: failure.retryable },
      { status: failure.status },
    )
  }
}
