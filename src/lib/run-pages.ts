/**
 * run-pages.ts —— 一本书 → 运行视图上那两个弹窗要的每页数据（纯函数）
 *
 * | 字段 | 谁在用 | 为什么不能让客户端自己算 |
 * | --- | --- | --- |
 * | `body` | 重配那个可编辑的正文框 | 它在 `book.json` 的 `tree.nodes` 里，客户端只有事件流 |
 * | `prompt` | 重画那个只读的"原来的提示词" | ★ 它必须就是发出去的那一份：这里调的是 `pagePrompt()`，与 `illustrateNode` 同一个函数。客户端拼一遍的话，屏幕上显示的和实际发出去的会从第一天起分家 |
 * | `imageUrl` / `narrationUrl` | 两个弹窗各自的"现在这一版" | 资产路径 → 地址那条翻译只有一条（`book-source.ts` 的 `runtimeAssetUrl`，以 `urlOf` 递进来） |
 *
 * 为什么不复用阅读器那条（`book-source.ts` 的 `ReaderPage`）：它给的是给人看的
 *   三样（图、音、正文），这里要的是给下一次生成用的三样（页级描述、场景、组装好的
 *   提示词）。两个读者、两种形状，硬合成一个接口就得让它同时长出两套字段。
 *
 * 纯函数（不碰文件系统、不碰 URL 拼法），所以"提示词是拿哪一版的卡组装的"
 *   这类判断能在 node 里被钉住——Route Handler 里只能靠手工发请求去测。
 */

import { pagePrompt } from './prompts/image.ts'
import { linearOrder, type Book, type CharacterCard } from './engine/index.ts'

export type RunPageView = {
  pageNo: number
  /** 正文，一句一段（阅读器按元素分段落，所以这里也按元素给） */
  body: string[]
  /** 页级画面描述。重画弹窗里那个只读的"原来的提示词"就是它 */
  imagePrompt: string
  scene: string
  /**
   * 这一页会发给模型的完整提示词（角色段 + 页级 + 构图 + 负极清单）。
   *
   * 它不含家长补充的那一句——补充是这一次才有的、还没发生。
   *   弹窗里必须说清这一点（"你写的会接在这后面"），
   *   否则用户会以为改了这句就等于改了提示词。
   */
  prompt: string
  /** 这一页现在的图。null = 这一页没做出来 */
  imageUrl: string | null
  /** 这一页现在的录音。null = 这一页没有朗读 */
  narrationUrl: string | null
  /**
   * 画面审核的结论（`.scratch/safety` 工单 01）。`null` = 这一页没审过/旧书没有这一位。
   *
   * ★ 2026-10-21 晚加：此前这条结论**只在运行时的那条事件流里出现过**
   *   （`frames.ts` 把 `review` 事件折成卡片上那行红字），而 `book.json` 里那份
   *   `pictureReview` / `needsHumanReview` 没有任何界面读。于是刷新一次之后，
   *   "这一页画面上有不该出现的东西"这句话就消失了——而书还能照样生成。
   *   这份数据就是为了让那句话活过刷新。
   */
  review: { verdict: 'pass' | 'flag' | 'unavailable'; reason: string } | null
}

/**
 * 一本书 + 它的卡 → 每一页那一份。
 *
 * `urlOf(资产路径, 想要的宽度)` 由调用方给（路由传 `runtimeAssetUrl`）：
 * 显示多大是显示的事，这一层只负责把路径交给它——与 `library.ts` 对封面
 * 那条规矩是同一条（那里是 `coverUrlOf`）。
 */
export function runPagesOf(
  book: Book,
  card: CharacterCard,
  urlOf: (assetPath: string, width: number) => string,
  width: number,
): RunPageView[] {
  const illustrationOf = new Map(book.illustrations.map((item) => [item.pageNo, item]))
  /**
   * ★ 只取正文那一段（`part` 缺省 = body）。
   *   共读版的选择点那一页有四段录音（正文 / 提问 / 选项 A / 选项 B），按页号建表时
   *   后写的会盖掉先写的——最后留下的恰好是选项 B。重配弹窗把它标成"这一页现在的录音"，
   *   家长听到的却是孩子选 B 时那一句（2026-10-22 审查）。
   *   这一屏要的是"这一页的正文"，本来就是 body；其余三段由阅读器按 `part` 自己取。
   */
  const narrationOf = new Map(
    book.narrations
      .filter((item) => (item.part ?? 'body') === 'body')
      .map((item) => [item.pageNo, item]),
  )
  const failed = new Set(book.errors.map((item) => item.pageNo))

  return linearOrder(book.tree).map((node) => {
    const illustration = illustrationOf.get(node.pageNo)
    const narration = narrationOf.get(node.pageNo)
    return {
      pageNo: node.pageNo,
      body: [...node.body],
      imagePrompt: node.imagePrompt,
      scene: node.scene,
      prompt: pagePrompt({
        card,
        page: node.imagePrompt,
        mood: node.mood,
      }),
      imageUrl:
        illustration && !failed.has(node.pageNo) ? urlOf(illustration.asset.path, width) : null,
      narrationUrl: narration ? urlOf(narration.asset.path, width) : null,
      review: illustration?.pictureReview
        ? {
            verdict: illustration.pictureReview.verdict,
            reason: illustration.pictureReview.reason ?? '',
          }
        : null,
    }
  })
}
