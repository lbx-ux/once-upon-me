/**
 * story-plan.ts —— 分镜 / 故事树规划的提示词（v1）
 *
 * ★ 提示词不散落在组件里（README §二 预留结构），且**每个模块都带版本号**。
 *   版本号进 `Provenance.promptVersion`，于是"这本书是哪版提示词生成的"永远可答——
 *   这是 ADR-0003 里"预生成资产要有版本与失效管理"那一条的落实处。
 *   改文案就 +1，别偷偷改：改了不升版，横评数据与线上产物就对不上了。
 */

import type { AgeBand, BookForm } from '../engine/domain.ts'
import { planJsonSchema } from '../schemas/story.ts'

export const STORY_PLAN_VERSION = 'story-plan@v1'

/** 适龄档 → 语言约束。这是 #3「RAG 技术应用」里"4 岁和 8 岁复杂度可对比"的对照物 */
const AGE_RULES: Record<AgeBand, string> = {
  '4-': '每句不超过 12 字；全篇只用最常见的动词与名词；一句一个动作，不写因果从句；拟声词可以多用。',
  '4-6': '每句 12–18 字；可以有"因为…所以…"但只套一层；允许 2–3 个稍难的词，上下文要能猜出意思。',
  '6-8': '每句 18–26 字；可以有对话与心理描写；允许一个比喻；可以出现少量成语但要能望文生义。',
  '8+': '每句不限，但避免长定语；可以有伏笔与反转；词汇不必回避，但不要炫技。',
}

const FORM_RULES: Record<BookForm, string> = {
  solo: [
    '这是**睡前**听的线性故事：约 {pages} 页，一页一个画面一句话。',
    '不许出现选择点（choice 字段一律省略）。',
    '节奏要求：前 3 页建立世界，中间逐步升温，倒数第 2 页最安静，最后一页收束到"该睡了"。',
    '不要悬念钩子、不要突然惊吓、不要越玩越兴奋的情节——它的终点是睡着。',
  ].join('\n'),
  shared: [
    '这是**白天陪玩**的故事树：主干 {pages} 页，其中 2–3 处是选择点。',
    '选择点的两个选项必须**孩子能懂且立刻看得出差别**（"骑上恐龙背" vs "钻进船肚子"），',
    '并且两条分支都要能走回同一个结尾附近——不许分叉后变成两个故事。',
    '分支节点用 from 指向父节点、via 标 a/b；每个选择点必须恰好两个子节点。',
    'choice.prompt 是给家长念的引导提问（"你觉得他应该怎么做？为什么？"），不是选项。',
  ].join('\n'),
}

const RED_LINES = [
  '绝对不能出现：恐怖、暴力、死亡、自伤、歧视（性别/外貌/家庭结构）、危险动作的可模仿示范。',
  '可以出现情绪（害怕、难过、想妈妈），但必须在故事内被接住，不能悬着结束。',
  '不要写"教他做人"的段落。道理让孩子自己从情节里得出来；说教味是这一行最严的失败。',
].join('\n')

export type StoryPlanInput = {
  childName: string
  nameReading: string
  ageBand: AgeBand
  interestTags: readonly string[]
  lookTags: readonly string[]
  theme: string
  wish?: string
  form: BookForm
  pages: number
}

/** system：身份、硬约束、输出形状。不随书变化，所以可以整段缓存 */
export function storyPlanSystem(): string {
  return [
    '你是中文绘本的文字作者兼分镜师，写给 3–8 岁孩子听，由爸爸妈妈朗读。',
    '你的产出是一份 JSON 分镜表，不是散文——不要寒暄、不要解释你做了什么、不要围栏之外再加字。',
    '',
    '【输出形状】',
    '严格按下述结构输出：title 是书名（≤8 字，不要出现孩子名字，名字在页面上另排），',
    'nodes 是页表，顺序就是阅读顺序。',
    JSON.stringify(planJsonSchema()),
    '',
    '【内容红线】',
    RED_LINES,
  ].join('\n')
}

export function storyPlanUser(input: StoryPlanInput): string {
  return [
    `主角：${input.childName}（名字念 ${input.nameReading}，别念错）。`,
    `年龄档：${input.ageBand}。语言规则：${AGE_RULES[input.ageBand]}`,
    input.interestTags.length > 0
      ? `爱好：${input.interestTags.join('、')}。至少让其中两项真的参与情节，不要只当背景板。`
      : '',
    input.lookTags.length > 0
      ? `外貌标签（形象由角色卡负责，这里只作参考，不要写进画面 prompt）：${input.lookTags.join('、')}。`
      : '',
    `主题：${input.theme}。`,
    input.wish
      ? `家长希望孩子从中得到：${input.wish}。注意这是**给作者的暗线**，不许写成台词。`
      : '',
    '',
    FORM_RULES[input.form].replaceAll('{pages}', String(input.pages)),
    '',
    '【每页的四个字段】',
    '- scene：这一页发生了什么（给插画与审核看，不印在页上）',
    '- body：朗读正文，一句一条，1–3 条',
    '- imagePrompt：**页级**画面描述（场景 / 动作 / 光线 / 构图）。' +
      '不要描述主角的长相——那是角色卡的职责，重复描述会打架；' +
      '不要要求画面里出现任何文字或数字；不要写"留白""安全边距"这类排版词。',
    '- mood：calm / wonder / joy / tense / tender / proud 之一，它决定配音语气',
  ]
    .filter(Boolean)
    .join('\n')
}
