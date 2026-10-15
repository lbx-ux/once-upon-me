/**
 * /api/children/[childId] —— 删掉一个孩子（工单 03 第三刀）
 *
 * ```
 *   GET     /api/children/<childId>   预演：回一张"将要删掉什么"的凭据（一个字节都不动）
 *   DELETE  /api/children/<childId>   真删：回一张"删掉了什么"的凭据
 * ```
 *
 * ★ 两个动词**写在同一个文件里**，虽然严格说"预演"更像一个子资源
 *   （`/deletion`）。合在这里的理由只有一个：三种拒绝（示例孩子 / 没有这个孩子 /
 *   参数不合法）在预演与真删上**必须给出同一句话**，分成两个文件就要么复制一段，
 *   要么再抽一层——而复制的那一天起，两条路的拒绝理由就会开始不一样，
 *   症状是"预演说能删、真删说 403"。
 *
 * ★ 预演是**按需**取的（不是详情页一渲染就去数一遍）：
 *   数一遍要遍历 `cards/`、`books/`、每个缩略图档位；大多数人永远不点删除，
 *   为这一屏的每一次浏览都付一次目录遍历，是把代价放在最不该放的地方。
 *
 * ★ 拒绝的三种情形，话都不一样（合成一句"删除失败"等于什么都没说）：
 *   - 示例孩子 → 403：他的档案在 `public/` 里，删不掉；硬删只会让他"回来但没有形象"
 *   - 没有这个孩子 → 404
 *   - 删到一半失败 → 500 + **带上那张不完整的凭据**（哪些删了、哪些没有）
 */

import { assetRoot } from '@/lib/books-runtime.ts'
import { createCardStore, createFsStore, createProfileStore } from '@/lib/engine/index.ts'
import { childProfileOf, isDemoChildId } from '@/lib/children-source.ts'
import {
  deleteChildEverywhere,
  DeletionPartialError,
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

async function depsOf(): Promise<Parameters<typeof planDeletion>[1]> {
  const store = await createFsStore(assetRoot())
  return { store, cardStore: createCardStore(store), profiles: createProfileStore(store) }
}

/** 三种拒绝合在一处，两个动词共用（预演与真删对同一件事必须给出同一句话） */
async function refuse(
  childId: string,
): Promise<{ response: Response; receipt?: DeletionReceipt } | null> {
  if (await isDemoChildId(childId)) {
    return {
      response: Response.json({ code: 'demo-child', message: DEMO_REFUSAL }, { status: 403 }),
    }
  }
  const found = await childProfileOf(childId)
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
  _req: Request,
  { params }: { params: Promise<{ childId: string }> },
): Promise<Response> {
  const { childId } = await params
  const denied = await refuse(childId)
  if (denied) return denied.response

  try {
    const receipt = await planDeletion(childId, await depsOf())
    return Response.json({ receipt })
  } catch (err) {
    const failure = userFailureOf(err)
    return Response.json(
      { code: failure.code, message: failure.message, retryable: failure.retryable },
      { status: failure.status },
    )
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ childId: string }> },
): Promise<Response> {
  const { childId } = await params
  const denied = await refuse(childId)
  if (denied) return denied.response

  try {
    const receipt = await deleteChildEverywhere(childId, await depsOf())
    return Response.json({ receipt })
  } catch (err) {
    // ★ 删到一半失败：凭据**一起回去**。只说"删除失败"会让人以为一样都没删，
    //   而"确实删了一半"与"什么都没删"要让家长做两件不同的事（前者不用重试，
    //   后者可以重试）。重试本身是安全的：`deletePrefix` 对不存在的路径回 0
    if (err instanceof DeletionPartialError) {
      const failure = userFailureOf(err)
      return Response.json(
        { code: failure.code, message: failure.message, retryable: true, receipt: err.receipt },
        { status: failure.status },
      )
    }
    const failure = userFailureOf(err)
    return Response.json(
      { code: failure.code, message: failure.message, retryable: failure.retryable },
      { status: failure.status },
    )
  }
}
