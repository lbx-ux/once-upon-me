/**
 * optimize.ts —— 「优化这句话」那颗按钮背后的话（v1）
 *
 * ★ 它优化的**只有一句话**：家长在输入框里写的"想讲什么"。
 *   主题那一格（从 `THEMES` 里挑的那个）**不进这里**——它是枚举值，改了就不是模板了。
 *   这条边界同时也是一条界面纪律：按钮必须长在它真正作用的那个框旁边，
 *   长在主题那一行，用户会以为"挑了恐龙再优化"会变成另一只恐龙。
 *
 * ★ 那句话说清了两件看起来矛盾的事（读 `story-plan.ts` 的 `storyPlanUser` 才看得到）：
 *   它在**主题**那一格没填时会被当作主题（`creation/state.ts`：
 *   `theme: state.theme.theme.trim() || wish`），填了的时候又作为
 *   "家长希望孩子从中得到"的**暗线**进分镜提示词。
 *   所以优化后必须**两处都读得通**：它得是一个具体的故事点子（当主题读要能开工），
 *   同时又不能变成一句台词或一个道理（当暗线读要还留着家长的意图）。
 *   这就是下面第 1 条与第 2 条并列的原因——少任何一条，另一种用法就坏掉。
 *
 * ★ 提示词不在组件里拼字符串（README §二），且带版本号（与 `story-plan@v1` 同一约定）。
 *   这一版不进任何产物的 provenance——它改的是**输入**，不是画出来的东西。
 *   版本号在这里的作用是排障：优化结果被投诉时，得能答"当时用的是哪一版"。
 */

import type { TextRequest } from '../engine/providers/types.ts'

export const PROMPT_OPTIMIZE_VERSION = 'prompt-optimize@v1'
/**
 * 建议句的长度上限，按**码点**数（`[...text].length`），不是字节。
 *
 * ★ 80 不是"大概齐"：消费者是那个 `rows={2}` 的输入框。框内宽在最大版心下
 *   约 812px（`--cl` 980 − 左右 padding 各 60 − 卡片 padding 各 24），
 *   17px 的汉字一行的量 ≈ 812 / 17 ≈ 47 个字，两行 94。
 *   80 留在里面，还够长到能写全"谁、在哪、遇到什么、最后怎么样"。
 * ★ 超了**不截断**：截一半的句子比长句子坏得多（它看起来像模型没写完）。
 *   超长只说"长了一点"，用不用由用户决定。
 */
export const OPTIMIZE_MAX_CHARS = 80

/** 采样温度。★ 太高会改掉家长的意图，太低会照着原句抄一遍——
 *  这两件事都是"优化按钮看起来没干活"。0.5 是中间，且它**不是**模型参数
 *  （不像 token 预算那样因模型而异），所以可以写在这里 */
export const OPTIMIZE_TEMPERATURE = 0.5

/* ★ 这一条调用**刻意不传** `maxTokens`，也不传超时预算。
 *
 *   token 预算是**模型的属性**，不是这次调用的属性：实测（`scripts/probe-thinking-budget.mts`，
 *   2026-10-13）思考模型会把预算整条吃光、正文一个字都不写——
 *   `qwen3.8-flash` 预算 4096 → 正文 0 字符 / 思考 9407 字符 / finish_reason=length。
 *   而"一句话的答案"看起来最该压预算，压下去正好踩中这一条：答案越短越像该省，
 *   实际结果是空回复。所以留给适配器（`LLM_MAX_TOKENS` / `LLM_THINKING` 在 `.env.local` 里调），
 *   与 `engine/plan.ts` 那条"预算随模型走，不随阶段走"是同一个判断。
 *   超时同理：适配器默认 180s 是"不把慢误判成不会"，要压到更低得先有实测的 P95 时延，
 *   而这个接口还没量过。**不许**在这里挑一个 30s 这种看起来合理的数。 */

export type OptimizeInput = {
  /** 家长自己写的那句话。★ 调用方要保证它已 trim 且非空 */
  wish: string
  /** 主角的名字。可选——卡还没建的时候也允许优化 */
  childName?: string
  /** 已经挑好的主题中文名。★ 它是枚举的中文名，不是用户输入 */
  themeLabel?: string
}

/** system：身份 + 两条必须做到 + 红线 + 长度。不随输入变化 */
export function optimizeSystem(): string {
  return [
    '你是给 4–6 岁孩子写绘本的编辑。家长写了一句"想讲什么"，你的活是把它改得更具体、',
    '更能开工，改完**仍然是**一句话。',
    '',
    '【必须做到】',
    '1. 这一句要能回答清楚：谁、在哪、遇到什么、最后怎么样。',
    '2. **保留家长原本的意图**。他写"想让孩子学会分享"，改完还是关于分享——',
    '   不许换成"冒险""勇气"这类别的主题。',
    '3. 用看得见的具体东西，不用"神奇""精彩""一段有趣的经历"这种空词。',
    '4. **主角永远是孩子本人**：给名字就用名字，没给就用"小朋友"。',
    '   家长写"恐龙""月亮"这种主题时，它们是孩子遇到的东西、伙伴或场景，',
    '   **不许**顶替主角变成"小恐龙的故事"——这一整套产品的立足点是"你的孩子是主角"。',
    '',
    '【绝对不许】',
    '- 不许出现：死亡、走失、生病、受伤、打架、二胎、父母分开、怪物吓人、恐怖、',
    '  危险动作的示范。这是给 4–6 岁孩子睡前听的故事。',
    '- 不许把家长没提的新角色或新设定当主线加进去。',
    '- 不许说教（"这个故事告诉我们……"）。道理让孩子自己从情节里得出来。',
    '- 不许出现书名号、引号、序号、括号注释。',
    '',
    `【长度】不超过 ${OPTIMIZE_MAX_CHARS} 个汉字。`,
    '【输出】只输出改好的那一句。前后不加解释、不加"优化后："这种标签、不加围栏。',
  ].join('\n')
}

/** user：只用真实存在的信息。★ 没有的字段**不写占位**——写了模型会拿它编 */
export function optimizeUser(input: OptimizeInput): string {
  return [
    `家长写的原句：${input.wish.trim()}`,
    input.childName ? `主角的名字：${input.childName}。` : '',
    input.themeLabel ? `已经挑好的主题：${input.themeLabel}。` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * 一次调用要发的东西，**整份**从这里出。
 *
 * ★ 为什么连形状也收进这一处：`scripts/probe-optimize.mts`（真模型上读那几句改成了什么样）
 *   与 `/api/optimize`（线上那条路）必须是**同一次调用**，否则探针量的是另一件事——
 *   这个项目为"量具与被量对象要同源"已经付过学费（`check-scrim.mts` 读 CSS 本身）。
 *   探针自己拼 `{system, user, temperature}` 的话，漏掉的正好是最容易漏的那个字段。
 *
 * ★ `plainText: true` 是**必须**的，不是优化：这一路要的是一句话，不是 JSON，
 *   而 `LLM_JSON_MODE=object` 下适配器会无条件带 `response_format`，真实网关直接 400
 *   （实测报文与理由见 `TextRequest.plainText`）。**不许**为了绕过它往提示词里塞 "json"。
 */
export function optimizeRequest(input: OptimizeInput): TextRequest {
  return {
    system: optimizeSystem(),
    user: optimizeUser(input),
    temperature: OPTIMIZE_TEMPERATURE,
    plainText: true,
    // ★ 不给 maxTokens、不给超时预算：理由见上面那一段注释
  }
}

/** 成对包住的符号。★ `"` 与 `'` 同一个字符既是开也是闭，处理方式见 `stripWrapping` */
const OPEN_CLOSE: readonly (readonly [string, string])[] = [
  ['「', '」'],
  ['『', '』'],
  ['“', '”'],
  ['‘', '’'],
  ['《', '》'],
  ['【', '】'],
  ['"', '"'],
  ["'", "'"],
]

/** 行首那种"我在回答你"的标签。模型被要求别写，但它偶尔还是会写 */
const LABEL_RE = /^(优化后|优化|建议|改写后|改后|可以写成|改成)\s*[:：]\s*/
const ORDER_RE = /^\d+\s*[.、)]\s*/

function stripWrapping(input: string): string {
  let text = input
  let changed = true
  while (changed && text.length > 2) {
    changed = false
    for (const [open, close] of OPEN_CLOSE) {
      if (!text.startsWith(open) || !text.endsWith(close)) continue
      // ★ 开闭同字符时，只有整句里正好出现两次才剥。
      //   不判这一条的话，`"a" 与 "b"` 会被削成 `a" 与 "b`——把句子腰斩，
      //   而且看起来还像一句正经话，不会有人发现
      if (open === close && text.split(open).length - 1 !== 2) continue
      text = text.slice(open.length, text.length - close.length).trim()
      changed = true
      break
    }
  }
  return text
}

/** 中日的标点与汉字。落在两边的那个多出来的空格要去掉（理由见下） */
const CJK = '\\u3000-\\u303f\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef'
const CJK_SPACE_RE = new RegExp(`(?<=[${CJK}])\\s+(?=[${CJK}])`, 'g')

/**
 * 把模型回的那段字收拾成"一句"。
 *
 * 五步，每一步都对应一种真的会回来的形状：
 *   ① 围栏（```）——要求了别写，但它偶尔还是包
 *   ② 行首标签与序号（"优化后："、"1. "）
 *   ③ 整句被引号/书名号包住（★ 剥**成对的外层**，不动句子内部的引号）
 *   ④ 换行与连续空白合成一个空格
 *   ⑤ 中文字之间那个空格去掉——④ 会把 `月亮，\n轻轻` 变成 `月亮， 轻轻`，
 *      而中文正文里标点后面本来就没有空格，留着就是一处排版伤
 *
 * ★ ③ 要先于 ② 也后于 ②：`“优化后：xxx”` 与 `优化后：“xxx”` 两种都出现过，
 *   所以剥一次引号、剥一次标签、再剥一次引号。
 */
export function cleanSuggestion(raw: string): string {
  let text = raw.trim()
  text = text
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()
  text = stripWrapping(text)
  text = text.replace(LABEL_RE, '').replace(ORDER_RE, '').trim()
  text = stripWrapping(text)
  text = text.replace(/\s+/g, ' ').replace(CJK_SPACE_RE, '')
  return text.trim()
}

/** 长度按码点算：一个汉字、一个 emoji 都是 1（`String.length` 会把它们算错） */
export function suggestionLength(text: string): number {
  return [...text].length
}

export function isTooLong(text: string): boolean {
  return suggestionLength(text) > OPTIMIZE_MAX_CHARS
}
