/**
 * probe-optimize.mts —— 「优化提示词」在**真模型**上到底把话改成了什么样
 *
 * ```bash
 * node scripts/probe-optimize.mts          # 默认那几句含糊的话
 * node scripts/probe-optimize.mts --n=3    # 只跑前 3 句
 * ```
 *
 * 为什么要有这支脚本（工单 07 §五 的两条验收）
 * ---------------------------------------------------------------------------
 * 那两条都要求**人读**："贴实际输入输出到 Comments"、"优化后没有引入不适宜内容
 * （人工读一遍，并在 Comments 写'读了 N 条'）"。所以这里不写任何关于输出的断言——
 * 为 LLM 的输出写断言，等于把"测过"变成一个假的数（工单 07 §四 自己写着这条）。
 *
 * 它做三件机械的事，然后交给人读：
 *   1. 把每一句原话与改后的话并排打出来，这样"改没改出意图"一眼可见
 *   2. 数长度，与 `OPTIMIZE_MAX_CHARS` 对一下（超了的会被标出来）
 *   3. 拿一张**红线词表**扫一遍，命中的标 ⚠ —— ★ 这只是"请重点读这一条"，
 *      不是判据。词表能扫出"生病"，扫不出"她把小猫送回家时小猫已经不在了"
 *      这种要读完才知道的。把它当成通过的证明，就是拿一个工具的盲区当答案。
 *
 * ★ 它走的是**路由用的是同一份代码**：`optimizeSystem/optimizeUser/cleanSuggestion`
 *   三件，一句提示词都不在这里重抄。抄一份的话，改提示词的人不会想到来改脚本，
 *   于是量出来的是一份早就不存在的话（`check-scrim.mts` 付过这个学费）。
 * ★ 它**不经 HTTP**：直接调 `textProviderOf`。探针要的是"这个提示词在这个模型上
 *   是什么效果"，中间隔一层路由只会多一个会坏的地方，不会多一分证据。
 */

import { textProviderOf } from '../src/lib/engine/providers/registry.ts'
import {
  cleanSuggestion,
  isTooLong,
  OPTIMIZE_MAX_CHARS,
  OPTIMIZE_TEMPERATURE,
  optimizeRequest,
  PROMPT_OPTIMIZE_VERSION,
  suggestionLength,
} from '../src/lib/prompts/optimize.ts'
import { arg, readEnv } from './env.mts'

/** 家长真的会写出来的那种话：短、含糊、或是一个主题词。不是"测试文本一二三" */
const CASES: { wish: string; childName?: string; themeLabel?: string }[] = [
  { wish: '想让孩子学会分享' },
  { wish: '关于月亮的' },
  { wish: '别老玩手机了' },
  { wish: '勇敢一点', childName: '小满' },
  { wish: '想讲一个恐龙的故事', themeLabel: '恐龙' },
  { wish: '睡觉' },
]

/** 红线词表：只用来**标出重点**，不是判据（理由见文件头第 3 条） */
const RED_WORDS = [
  '死',
  '走丢',
  '丢失',
  '生病',
  '受伤',
  '流血',
  '打架',
  '欺负',
  '二胎',
  '弟弟妹妹出生',
  '离婚',
  '分开',
  '怪物',
  '恐怖',
  '吓人',
  '鬼',
  '危险',
  '刀',
  '火',
]

const n = Number(arg('n', String(CASES.length)))
const env = await readEnv()
const text = textProviderOf(env)

console.log(`\n== 优化提示词 ${PROMPT_OPTIMIZE_VERSION}`)
console.log(
  `   模型 ${text.modelId} · 温度 ${OPTIMIZE_TEMPERATURE} · 上限 ${OPTIMIZE_MAX_CHARS} 字`,
)
console.log(`   跑 ${Math.min(n, CASES.length)} 条，走的是路由用的同一份提示词\n`)

let redHits = 0
for (const [index, item] of CASES.slice(0, n).entries()) {
  const startedAt = Date.now()
  const response = await text.complete(optimizeRequest(item))
  const suggestion = cleanSuggestion(response.text)
  const length = suggestionLength(suggestion)
  const hits = RED_WORDS.filter((word) => suggestion.includes(word))
  if (hits.length > 0) redHits += 1

  console.log(`── ${index + 1}/${Math.min(n, CASES.length)}  ${Date.now() - startedAt}ms`)
  console.log(`   原句：${item.wish}${item.childName ? `（主角 ${item.childName}）` : ''}`)
  console.log(`   改后：${suggestion || '（空——路由会把这种情况判成失败）'}`)
  console.log(
    `   ${length} 字${isTooLong(suggestion) ? `  ✗ 超过 ${OPTIMIZE_MAX_CHARS}` : ''}` +
      `${hits.length > 0 ? `   ⚠ 命中红线词 ${hits.join('、')}（请读一遍再定）` : ''}\n`,
  )
}

console.log(
  `== 读完这 ${Math.min(n, CASES.length)} 条再下结论。` +
    `${redHits > 0 ? `其中 ${redHits} 条命中了红线词，对着上面的 ⚠ 逐条读。` : '词表一条都没命中——'}` +
    `\n   ★ 词表没命中不等于没问题：它扫不出"读完才知道不对劲"的那种。\n`,
)
