/**
 * state.ts —— 创作流的状态与"表单 → 请求体"的两次转换（纯函数，可测）
 *
 * 状态只活在一个客户端组件里（`useReducer`），**不装 Zustand**：
 * 跨页面的状态只有"这一轮生成"，而它落在磁盘上（`books/<id>/`），不落在内存里。
 * README §二 曾预判 W2 会装 Zustand，那是预判；判据是"有没有真的跨组件共享的活状态"。
 *
 * 两个转换函数与引擎的领域类型对齐，**合法值都从引擎 import，不抄字面量**：
 * 抄一份的症状是"表单里能选中的年龄档，引擎拒绝"。
 */

// ★ 从 `engine/domain.ts` 这个**叶子模块**取值，不从 `engine/index.ts` 取：
//   index 是引擎的公共入口，它把 registry / providers 一起拖进来，
//   而 providers/stores 要 `node:fs/promises` —— 浏览器那边编译不动，实测报
//   `UnhandledSchemeError: Reading from "node:fs/promises" is not handled by plugins`。
//   这条不是绕开分层约定：**引擎对 UI 的接口本来就分两半**——
//   跑一本的 API（只在服务端用，走 index）与事件协议 / 领域常量（浏览器安全，走叶子模块）。
//   eslint 里有一条规则守着这一条（`engine/index` 不许出现在客户端层）。
import {
  AGE_BANDS,
  childWordOf,
  type AgeBand,
  type CharacterAnchor,
  type Gender,
} from '@/lib/engine/domain.ts'
import { DEFAULT_ANCHORS } from './default-anchors.ts'

export type ChildForm = {
  /** 表单层生成一次，整轮稳定。中文名推不出 slug，所以不拿名字当 id */
  childId: string
  name: string
  /** 读音确认：多音字读错，家长第一秒就发现（产品定义 Step 1） */
  nameReading: string
  ageBand: AgeBand
  /**
   * 性别（2026-10-16 第 23 刀）。★ 它决定标准像提示词里的称呼（小男孩/小女孩）。
   *   表单里是必填（见 `childProblems`），但**类型上是可选**——
   *   老档案与示例没有这一栏，而数据层必须收得下它们。
   */
  gender?: Gender
  lookTags: string[]
  interestTags: string[]
}

export type ThemeForm = {
  /** 选中的主题词（来自 THEMES 的 label）。与自由输入二选一 */
  theme: string
  wish: string
}

export type CardForm = {
  anchors: CharacterAnchor[]
  /** 出图之后才有 */
  cardId?: string
  revision?: number
  referenceUrl?: string
  promptFragment?: string
  checklist?: string[]
  /** 这张卡是哪一版模型画的（复用旧卡时要如实说，不能都说成"你填的模型"） */
  modelId?: string
}

export type CreationState = {
  child: ChildForm
  theme: ThemeForm
  card: CardForm
}

/** 孩子 id：整轮稳定、不带时间戳后缀之外的语义。它只用来给资产分目录 */
export function makeChildId(): string {
  return `kid-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 「这一本做多少页」的四档（弹窗那一格）。
 *
 * ★ 产品定义的独读版是 **20 页**，而这里默认停在 8：演示要能缩小规模，
 *   而 20 页在真跑里是**半个多小时**（`illustrate.ts` 里那段实测下界：≈154 s/次 × 20）。
 *   默认值给一个"点一下就能看到完整过程"的规模，想认真做一本的人自己选 20。
 * ★ 校验的上界不在这里（`book-api.ts` 收 3–30），这里只是**给用户挑的那几个数**。
 *   两处是不同的东西：一个是"能接受什么"，一个是"摆出来让你挑什么"。
 */
export const PAGE_CHOICES = [5, 8, 12, 20] as const

export const DEFAULT_PAGES: number = PAGE_CHOICES[1]

export function initialState(): CreationState {
  return {
    child: {
      childId: makeChildId(),
      name: '',
      nameReading: '',
      ageBand: '4-6',
      lookTags: [],
      interestTags: [],
    },
    theme: { theme: '', wish: '' },
    card: { anchors: [...DEFAULT_ANCHORS] },
  }
}

/**
 * ★ 2026-10-16（工单 06）：**四步的顺序表（`STEPS`）与 `StepKey` 已经删掉**，
 *   `/create` 上那条四步流程整条走了。创作流现在只剩**运行视图**一屏，
 *   该问的三件事（他是谁 / 想讲什么 / 角色卡）都在 `/home` 那一屏上问过了。
 *
 *   ★ 这一段注释留着而不是删掉，因为它是**一次被推翻的推理**的记录：
 *   这里曾经写着「模型与密钥这一步已经搬走（工单 04），因为设置是'用之前'的事」——
 *   那条推理今天仍然成立，变的是它**下面**那四步也不再住在创作流里了。
 *   下次有人想"把创作流再拆成几步"（比如共读版要另外几步），该读到的是：
 *   拆步的理由从来不是"这样更清楚"，而是**每一步都是另一件事**。
 *   而原来那四步里有三步其实在回答同一个问题——"这本书是给谁做的"。
 */

/**
 * 「他是谁」这一格填全了没有。判据与请求体的校验**同源**（都来自引擎的领域类型）。
 *
 * ★ 它原来叫 `stepProblems(state, key)`，一把钥匙开三个门（child / theme / card）。
 *   工单 06 之后 `theme` 与 `card` 两扇门没有读者了（那两步不在创作流里），
 *   所以收窄成这一件事，参数也从整份 `CreationState` 换成它真正要看的那半份。
 *
 * ★ 之所以不能把它整个删掉：`/character/new`（新建小主角）与
 *   `/character/[childId]`（改基础信息）收的是**同一批必填项**——
 *   两份判据的那天起，两个入口会开始收不一样的孩子
 *   （`NewChild.tsx` 文件头第 5 条、`children-body.ts` 那条注释都指到这里）。
 */
export function childProblems(child: ChildForm): string[] {
  const problems: string[] = []
  if (child.name.trim() === '') problems.push('孩子的名字还没填')
  // 读音是必填：多音字读错是家长第一秒就能发现的错
  if (child.nameReading.trim() === '') problems.push('名字的读音还没确认')
  if (!AGE_BANDS.includes(child.ageBand)) problems.push('年龄档没选')
  // ★ 性别也必填（2026-10-16 第 23 刀）：它直接决定标准像画男孩还是女孩，
  //   而这一格只有两个选项、点一下就完事——"没选"会让模型退回按头发长短猜
  if (!child.gender) problems.push('性别还没选')
  return problems
}

/** 第 3 步的请求体。★ 2026-10-17 起**不再带 `env`**：密钥由站长分配，
 *  只从服务端的 `process.env` 来（ADR-0009，见 `lib/settings/server-env.ts`）。
 *  少一个形参不是省事——它是"用户不再碰密钥"这句话在类型上的形状。 */
export function toCardBody(state: CreationState) {
  return {
    childId: state.child.childId,
    name: state.child.name.trim(),
    ageBand: state.child.ageBand,
    childWord: childWordOf(state.child.lookTags, state.child.gender),
    anchors: state.card.anchors,
    // 换一版：把已有卡号带上，引擎会叠一个新 revision 而不是覆盖
    ...(state.card.cardId ? { cardId: state.card.cardId } : {}),
  }
}

type BookBody = {
  child: {
    childId: string
    name: string
    nameReading: string
    ageBand: AgeBand
    /**
     * ★ 与 `toBookBody` 里那一句一起补的（2026-10-16）：这一栏在类型上不写，
     *   传下去的东西就等于没传——`tsc` 会在读它的那一侧报"这个字段不存在"，
     *   而那条错误的正确修法是把类型补上，不是把断言删掉。
     */
    gender?: Gender
    lookTags: string[]
    interestTags: string[]
  }
  cardId: string
  theme: string
  wish?: string
  form: 'solo'
  pages?: number
  voiceId?: string
  status?: 'draft' | 'published'
  mode: 'live'
}

/** 一次生成的**运行参数**（弹窗与运行视图给的那几个数）。与表单分开是两个东西 */
export type RunOptions = {
  pages?: number
  /**
   * 用哪个音色朗读。**不传 = 这一本不配音**，不是"用默认的那个"
   * （引擎那句原话："默认音色是产品概念，不是引擎概念"）。
   * ★ 这一条曾经是整条缺席的，见 `book-api.ts` 里 `voiceId` 那段。
   */
  voiceId?: string
  /** 草稿还是成品。运行视图传 `'draft'`——「确定生成」才是把它翻成成品那一步 */
  status?: 'draft' | 'published'
}

/**
 * 跑一本书**需要的那几个字段**（不是整份 `CreationState`）。
 *
 * ★ 收窄成一个自己的类型，而不是继续收 `CreationState`：跑一本只要"他是谁 + 用哪张卡 +
 *   讲什么"，而 `CreationState` 还带着 `step`、`card.anchors`、`card.revision` 这些
 *   只有建卡那一屏才用得上的东西。收着它的话，调用方为了凑类型要编一份锚点数组出来
 *   （`/create` 的页面层就该什么都不编），而那份编出来的东西会被当成真的传下去。
 */
export type RunForm = {
  child: ChildForm
  cardId: string
  theme: ThemeForm
}

/**
 * 运行视图的请求体。
 *
 * ★ 形态这一周只做独读版（`form: 'solo'`），共读版整套交互在 W3。
 *   页数不在这里定死：产品定义是 20 页，但演示要能缩小规模，
 *   所以它由调用方给（弹窗那一格），入口在 `/home` 的弹窗上。
 * ★ 三个可选字段一律**有才传**（与 `wish` 同一条写法）：
 *   传一个空串进去，引擎那边"没填"与"填了个空的"就分不出来了。
 */
export function toBookBody(form: RunForm, options: RunOptions = {}): BookBody {
  const wish = form.theme.wish.trim()
  return {
    child: {
      childId: form.child.childId,
      name: form.child.name.trim(),
      nameReading: form.child.nameReading.trim(),
      ageBand: form.child.ageBand,
      /* ★ 性别**在这一条路上**（2026-10-16 补齐，两处一起改——原来这里写着
         "将来真要让故事那边也用上，要同时改两处：这一份，和 `parseCreateBody`
         里那个显式的 child 对象"，这一刀就是那一天）。
         ★ 原来那段话的理由是**错的**，值得原样记下来，因为它是同一类错的标准长相：
           "书的页面插画按**角色卡**画（卡里那七条锚点就是那张脸的判据），
            而性别唯一的消费方是标准像提示词里那个称呼。"
           ——机制说对了（页图确实按卡画），**结论错了**：实测那张卡的七条锚点是
           "脸圆润 / 眼圆黑 / 黑直短发 / 头身比 1:4 / 肤白皙 / 嘴微张 / 蓝灰鸭舌帽…"，
           **一个性别词都没有**。于是"按卡画"这一页的每一格，性别由模型自己猜：
           用户的原话是"我提供给你的是男孩子，怎么生成出来有男孩有女孩子"
           （8 页里 1/4/6 是男孩、2/3/5/7/8 是女孩）。
         ★ 所以"某个字段有没有读者"这句话要落到**下一层的材料**上，而不是停在
           "这件事走的是另一条路"。卡里没有的东西，就得有人补进那条路。 */
      ...(form.child.gender ? { gender: form.child.gender } : {}),
      lookTags: form.child.lookTags,
      interestTags: form.child.interestTags,
    },
    cardId: form.cardId,
    theme: form.theme.theme.trim() || wish,
    ...(wish !== '' ? { wish } : {}),
    form: 'solo',
    ...(options.pages !== undefined ? { pages: options.pages } : {}),
    ...(options.voiceId ? { voiceId: options.voiceId } : {}),
    ...(options.status ? { status: options.status } : {}),
    mode: 'live',
  }
}

/**
 * 形态词：**先看用户选的那一档性别**，没选才回头由外貌标签推；都推不出就用中性词，
 * **不猜**（猜错会让出一张画错性别的标准像）。
 *
 * ★ 实现搬去了 `engine/domain.ts`（2026-10-16，起因是"逐页 prompt 里没有性别词"那条报障：
 *   逐页 prompt 由引擎拼，而引擎不许 import 这一层）。这里只留一扇门，
 *   界面那几处（`fields.tsx` / `NewChild.tsx` / `photo-rules.ts`）不必改 import。
 * ★ 导出它（工单 03 第二刀）是因为"用他的照片新建"那一屏也要这一句：
 *   那一屏不在创作流里，但它同样要出标准像。在两处各写一遍的代价不是多几行，
 *   是**同一个人在两屏上被叫成不同的词**——而这个词决定模型画男孩还是女孩。
 */
export { childWordOf } from '@/lib/engine/domain.ts'
