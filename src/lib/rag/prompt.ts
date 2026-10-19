/**
 * prompt.ts —— 检索结果 → 提示词里的那一段（★ 纯函数，只负责排版与措辞）
 *
 * 措辞归这里管（README §二：「提示词不散落在组件里」），所以这个文件是
 * 「检索到的东西怎么跟模型说话」的**唯一**地方。两个消费者共用它：
 * 规划（工单 04）用它拼用户提示词，工单 06 的对照跑测用它保证两臂的措辞逐字相同
 * （★ 措辞不一样的话，那两臂差的就不只是"有没有检索"了，那张增益表当场失效）。
 *
 * ---------------------------------------------------------------------------
 * 两条硬约束，各对应一次会坏掉的东西
 *
 * **一、范例段必须带那句"不许照抄"。**
 *   不带的话，模型会把范例里的句子直接搬进正文——那本书就成了别人的书，
 *   而这个产品的第一句话是「以自己孩子为主角」。
 *   这句话不是客套，它是这一段存在的代价：给了范例就一定要给这条禁令。
 *
 * **二、空结果时**整段不出现**（返回空串），不是写一句「没有检索到范例」。**
 *   空段落在提示词里只会变成模型自由发挥的邀请，而"这次没有可参考的"
 *   是引擎自己的事，不该变成模型要处理的输入。
 *
 * ---------------------------------------------------------------------------
 * 出处进提示词，`why` 不进
 *
 *   出处的**标识**（书名 + 页码）给模型看：它让模型知道这是"别的书的片段"，
 *   而不是这本书还没写完的部分——不写的话，有的模型会以为这些是要接着写下去的内容。
 *   而 `why`（"命中 12 个 bigram · 相邻档 6-8"）是**给人的**：它进事件与 provenance，
 *   让"这本书为什么长这样"可答。把它塞进提示词只会占预算，模型不会因此写得更好。
 */

import type { RetrievePair } from './retrieve.ts'

/** 范例段那行标题。★ 刻意不说"同一个年龄档"：准入是相邻档也收（见 retrieve.ts），
 *  写死"同档"会让一句话变成不准确的事实 */
export const EXAMPLE_HEAD = '【可以照着这个节奏写——下面都是从别的书里挑出来的写完的片段】'

/** ★ 这一句是范例段的**前提**，不是可选项：给了范例就必须给这条禁令 */
export const NO_COPY_LINE =
  '只许参考它们的**节奏与用词**，**不许照抄句子**——那些是别人写的句子，抄进来这本就不是他的故事了。'

export const AVOID_HEAD = '【这些你已经给他写过了，这一本不要重复】'

/** 反例段里每条后面那句提醒。它对应"负向检索"这件事本身，模型得知道这不是参考材料 */
const AVOID_TAIL = '与你这次的要求很近'

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `   ${line}`)
    .join('\n')
}

/**
 * 拼出提示词里那一段（正例在前、反例在后）。
 *
 * ★ 顺序是**刻意**的：先给"可以照着写"，再给"不要重复"。
 *   反例放最后，模型读到的最后一件约束是"别重样"——
 *   这一栏技术方案上最新鲜的一条就是负向检索，把它放中间容易（实测里也常见）
 *   被前一段的范例盖过去。
 */
export function retrievalBlock(pair: RetrievePair): string {
  const sections: string[] = []

  if (pair.examples.length > 0) {
    const items = pair.examples
      .map(
        (hit, index) =>
          `${index + 1}. ${indent(hit.chunk.text).trimStart()}\n   ——出处：${hit.chunk.source}`,
      )
      .join('\n')
    sections.push([EXAMPLE_HEAD, NO_COPY_LINE, items].join('\n'))
  }

  if (pair.avoids.length > 0) {
    const items = pair.avoids
      .map(
        (hit, index) =>
          `${index + 1}. ${indent(hit.chunk.text).trimStart()}\n` +
          `   ——出处：${hit.chunk.source}（${AVOID_TAIL}）`,
      )
      .join('\n')
    sections.push([AVOID_HEAD, items].join('\n'))
  }

  // ★ 空就是**空串**：调用方拿到它之后直接不拼这一段，不要判空两遍
  return sections.join('\n\n')
}
