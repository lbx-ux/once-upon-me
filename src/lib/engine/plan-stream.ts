/**
 * plan-stream.ts —— 把流式到的那段**半成品 JSON** 读成"故事正在一页页写出来"
 *
 * 为什么需要它（工单 07 §一.2）：规划期的输出是一整张 JSON 故事表，
 * **token 级的原始 JSON 打到屏幕上就是噪音**——那是把内部状态当成产品。
 * 家长要看懂的是"故事正在被一页一页写出来"，不是 `{"title":"云上的…`。
 *
 * ★ 唯一的规矩：**只认已经闭合的东西**。
 *   半个字段不算数——否则会出现"第 7 页的正文先闪出半句再改掉"，
 *   而屏幕上闪过的每一个字都必须是模型真的写完的字。
 *   所以这里**不试图解析不完整的 JSON**（那是另一件难得多的事）：
 *   它只做一次单遍扫描，看已经闭合的字符串与已经闭合的对象。
 *
 * 三条实现上的取舍：
 *
 * 1. **不引 `JSON.parse` 去猜半截文档**，只在"一个字符串确实闭合了"之后，
 *    用 `JSON.parse` 解那**一个**字符串字面量（`\n`、`\"`、`\uXXXX` 都由它处理）。
 *    手写反转义是这一类代码最常见的错处，而解一个完整字面量是平台保证正确的事。
 * 2. **坏字面量丢掉，不抛**。扫到解不开的字符串（模型写坏了转义）时，跳过它继续扫：
 *    这一层的产出是"屏幕上显示什么"，不是"这份数据合不合法"——
 *    合不合法由 `plan.ts` 的校验说了算，而它拿到的是完整文本。
 * 3. **纯函数、无状态**。界面上每来一段 delta 就整段重扫一次（O(n²) 的错觉，
 *    但 n 是一张故事表的长度，实测量级在几万字符，重扫一次是微秒级）。
 *    换成"维护游标"的写法就得处理"累计文本被换掉"这类情况，
 *    而它换来的性能在一个已经要花几十秒的过程里没有任何意义。
 */

/** 一页的正文行是 `body: string[]`（见 schemas/story.ts 的四字段契约） */
const BODY_KEY = 'body'
/** 标题是唯一的、第一层的那一个 */
const TITLE_KEY = 'title'
/** 一页 = 一个节点对象。它的 `}` 落了才算"这一页写完了" */
const NODE_DEPTH = 3

export type PlanProgress = {
  /** 已经闭合的标题。null = 还没写到它（或者写坏了） */
  title: string | null
  /** **已经闭合的正文句子**，按到达顺序。每一句都是模型真写完的 */
  lines: readonly string[]
  /**
   * 已经写完的页数（节点的 `}` 落了才算）。
   *
   * ★ 不用"看到了 `scene` 键"来数页：那是"这一页刚开始写"，
   *   用它报"已写出 6 / 20 页"会**多报一页**，而且那一页随时可能被模型改掉。
   */
  pages: number
}

const EMPTY: PlanProgress = { title: null, lines: [], pages: 0 }

export function readPlanProgress(raw: string): PlanProgress {
  if (raw === '') return EMPTY

  let title: string | null = null
  const lines: string[] = []
  let pages = 0

  /** 括号深度（字符串内部的不算） */
  let depth = 0
  /** 上一个闭合的字符串，还不知道它是键还是值 */
  let candidate: string | null = null
  /** 上一个闭合的、**后面跟着冒号**的字符串 = 它是键 */
  let key: string | null = null
  let inString = false
  let escaped = false
  let stringStart = 0

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i] ?? ''

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
        candidate = decodeLiteral(raw.slice(stringStart, i))
      }
      continue
    }

    if (ch === '"') {
      inString = true
      escaped = false
      stringStart = i + 1
      continue
    }
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') continue

    if (ch === ':') {
      // 前面那个字符串是键。值随后到
      key = candidate
      candidate = null
      continue
    }

    if (candidate !== null) {
      // 这个字符串是**值**，键是上一个键。没有键（数组里的裸值）就不管它
      if (key === TITLE_KEY && depth === 1 && title === null) title = candidate
      else if (key === BODY_KEY && depth >= NODE_DEPTH) lines.push(candidate)
      // ★ 只清 candidate，**不清 key**：`body` 是一个字符串数组，
      //   第二个元素到达时键还是那个 `body`。清掉它的症状很具体——
      //   每页正文只显示第一句，而后面的句子全被丢掉（实测就这么错过一次）。
      //   键会在遇到下一个 `:` 时被覆盖，所以"留着"不会让两个字段串味。
      candidate = null
    }

    if (ch === '{' || ch === '[') {
      depth += 1
      continue
    }
    if (ch === '}' || ch === ']') {
      // 节点对象闭合 = 这一页写完了（写坏的半页不算，它连 } 都没有）
      if (ch === '}' && depth === NODE_DEPTH) pages += 1
      depth = Math.max(0, depth - 1)
      continue
    }
    // 数字、true/false/null、逗号：都不影响上面那几件事
  }

  return { title, lines, pages }
}

/**
 * 把一段**已经闭合**的 JSON 字符串字面量解成真正的字符（`\n` → 换行、`\"` → 引号）。
 *
 * 解不开就回 null（那个字符串被丢掉）。坏转义在模型输出里不罕见，
 * 而"为了显示一行正文把整屏弄崩"是完全不能接受的失败方式。
 */
function decodeLiteral(body: string): string | null {
  try {
    const parsed = JSON.parse(`"${body}"`) as unknown
    return typeof parsed === 'string' ? parsed : null
  } catch {
    return null
  }
}
