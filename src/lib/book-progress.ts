/**
 * book-progress.ts —— 断点：这一本画到哪儿了（2026-10-30）
 *
 * 补的是"画到一半失败"那一种：一本 20 页画到第 8 页，撞上厂商 429 / 超时 / 审核拦下，
 * 引擎按"一页失败不影响整本"吞掉、整本 0 页之外的失败会抛出。原来那一轮到此为止——
 * 8 页的图躺在盘上没人认领，用户既读不到书，也拿不回额度，还得先删掉才能重做。
 *
 * 现在：每画完一页落一次盘（`books/<书号>/progress.json`），下一次画同一本时
 * **跳掉已经画好的页**，只补缺的。额度也不扣第二次（一个书号只该收一次）。
 *
 * 四个决定：
 *
 * 1. **不写进 `book.json`。** 那是"这本书画好了"的标记，书架、阅读器、分享、打印
 *    全按它的存在与否分两档。往里写半本，等于让一本画到一半的书出现在书架上、
 *    点进去能读、还能生成分享链接——那比"画到一半失败"坏得多。
 *    所以断点单独一个文件，`book.json` 仍然是唯一的"完成"信号；装订完就把它删掉。
 * 2. **断点带故事指纹。** 页号与正文是故事的函数：家长改过一句、改过页数，
 *    第 8 页就不是刚才那个第 8 页了。指纹对不上 = 当作没有断点，从头画
 *    （并且覆盖掉旧断点，不留一份对不上的）。
 * 3. **读不到 / 读坏了就当没有。** 与 `readStory` 同一条：半截 JSON 是进程被杀时
 *    最后写的那一件的真实形状，它不是错误，是"没有断点"。
 * 4. **断点里存的是便宜能解析的纯数据**：`Illustration` / `Cover` / `Narration`
 *    本来就已经原样进 `book.json`，所以它们可序列化这件事是既成事实，不是新假设。
 */

import { canonicalDigest } from './engine/digest.ts'
import type { Cover, Illustration, Narration, StoryTree } from './engine/domain.ts'
import { bookDirOf } from './engine/index.ts'
import type { AssetStore } from './engine/providers/types.ts'

export const PROGRESS_FILE = 'progress.json'

export function progressPathOf(bookId: string): string {
  return `${bookDirOf(bookId)}/${PROGRESS_FILE}`
}

export type BookProgress = {
  schemaVersion: 1
  /** 这一版故事的指纹（`storyDigestOf`）。对不上 = 断点作废 */
  digest: string
  illustrations: readonly Illustration[]
  cover: Cover | null
  narrations: readonly Narration[]
}

/**
 * 这一版故事的指纹。
 *
 * ★ 只取"会影响画出来什么"的那几样：形态、书名、每一页。取整棵树也行
 * （`rootId` 是推导出来的），但少一样就少一处"改了却不作废"的漏洞——
 * 所以宁可多带，不带 `rootId` 是因为它跟着 nodes 一起变。
 */
export function storyDigestOf(tree: StoryTree): string {
  return canonicalDigest({ form: tree.form, title: tree.title, nodes: tree.nodes })
}

/** 读断点。没有 / 坏了 / 不是这个形状 → `null`（"没有断点"，不是错误） */
export async function readProgress(
  store: AssetStore,
  bookId: string,
): Promise<BookProgress | null> {
  let raw: unknown
  try {
    raw = await store.readJson<unknown>(progressPathOf(bookId))
  } catch {
    return null
  }
  return asProgress(raw)
}

/** 写断点。★ 调用方负责节流/串行：这一层只写一次 */
export async function writeProgress(
  store: AssetStore,
  bookId: string,
  value: Omit<BookProgress, 'schemaVersion'>,
): Promise<void> {
  await store.putJson({
    path: progressPathOf(bookId),
    value: { schemaVersion: 1, ...value } satisfies BookProgress,
  })
}

/** 装订完就删。★ 留着没有坏处也没有好处，但"删掉"让"盘上有断点"只有一个意思 */
export async function clearProgress(store: AssetStore, bookId: string): Promise<void> {
  await store.deletePrefix(progressPathOf(bookId)).catch(() => 0)
}

/**
 * 形状判据。★ 认不出的一律 `null`，不猜。
 *
 * 与 `lib/admin/state.ts` 那几份解析器同一条：**半份比没有更坏**。一个字段缺了的断点
 * 会让"跳过第 3 页"这件事悄悄成立，而盘上根本没有那张图——用户拿到一本缺页的书，
 * 而日志里一个字都不会提。
 */
export function asProgress(raw: unknown): BookProgress | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  if (record['schemaVersion'] !== 1) return null
  if (typeof record['digest'] !== 'string' || record['digest'] === '') return null

  const illustrations = record['illustrations']
  if (!Array.isArray(illustrations)) return null
  for (const item of illustrations) {
    if (!item || typeof item !== 'object') return null
    const page = item as Record<string, unknown>
    if (typeof page['pageNo'] !== 'number') return null
    const asset = page['asset']
    if (!asset || typeof asset !== 'object') return null
    if (typeof (asset as Record<string, unknown>)['path'] !== 'string') return null
  }

  const cover = record['cover']
  if (cover !== null && (typeof cover !== 'object' || Array.isArray(cover))) return null

  const narrations = record['narrations']
  if (!Array.isArray(narrations)) return null

  return {
    schemaVersion: 1,
    digest: record['digest'],
    illustrations: illustrations as Illustration[],
    cover: cover as Cover | null,
    narrations: narrations as Narration[],
  }
}
