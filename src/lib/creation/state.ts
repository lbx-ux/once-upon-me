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
import { AGE_BANDS, type AgeBand, type CharacterAnchor } from '@/lib/engine/domain.ts'
import { DEFAULT_ANCHORS } from './default-anchors.ts'

export type ChildForm = {
  /** 表单层生成一次，整轮稳定。中文名推不出 slug，所以不拿名字当 id */
  childId: string
  name: string
  /** 读音确认：多音字读错，家长第一秒就发现（产品定义 Step 1） */
  nameReading: string
  ageBand: AgeBand
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
  step: number
  child: ChildForm
  theme: ThemeForm
  card: CardForm
}

/** 孩子 id：整轮稳定、不带时间戳后缀之外的语义。它只用来给资产分目录 */
export function makeChildId(): string {
  return `kid-${Math.random().toString(36).slice(2, 8)}`
}

export function initialState(): CreationState {
  return {
    step: 1,
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

export type StepKey = 'child' | 'theme' | 'card' | 'generate'

/**
 * 四步的顺序。
 *
 * ★ **「模型与密钥」这一步已经搬走**（工单 04），不在创作流里了。原来它排在角色卡
 *   之前，理由是"出形象要真的调一次图像接口，而 key 是用户自己带的（ADR-0008）——
 *   先出形象再填 key，第一次点必然失败"。那个理由**现在不成立了**：key 在
 *   **设置抽屉**里填，而设置是"用之前"的事，顺序问题从根上消失。
 *
 *   ★ 这段注释留着而不是删掉，是因为它是"一次被推翻的推理"的记录：
 *   下次有人想"把设置再挪回流程里省一步"，该读到的就是它。
 */
export const STEPS: { key: StepKey; title: string; hint: string }[] = [
  { key: 'child', title: '孩子是谁', hint: '名字、读音、年龄，还有他喜欢什么' },
  { key: 'theme', title: '想讲什么', hint: '挑一个主题，或者自己写一句话' },
  { key: 'card', title: '角色卡', hint: '这几条决定每一页里他长什么样' },
  { key: 'generate', title: '生成', hint: '看着它一页一页画出来' },
]

/** 这一步能不能往下走。判据与请求体的校验**同源**（都来自引擎的领域类型） */
export function stepProblems(state: CreationState, key: StepKey): string[] {
  const problems: string[] = []
  if (key === 'child') {
    if (state.child.name.trim() === '') problems.push('孩子的名字还没填')
    // 读音是必填：多音字读错是家长第一秒就能发现的错
    if (state.child.nameReading.trim() === '') problems.push('名字的读音还没确认')
    if (!AGE_BANDS.includes(state.child.ageBand)) problems.push('年龄档没选')
  }
  if (key === 'theme') {
    if (state.theme.theme.trim() === '' && state.theme.wish.trim() === '') {
      problems.push('挑一个主题，或者自己写一句想讲什么')
    }
  }
  if (key === 'card') {
    if (!state.card.cardId) problems.push('还没选形象——出一张，或者用一张已有的卡')
  }
  return problems
}

/** 第 3 步的请求体。字段名与环境变量无关，映射发生在 `toEnv` 与这里 */
export function toCardBody(state: CreationState, env: Record<string, string | undefined>) {
  return {
    childId: state.child.childId,
    name: state.child.name.trim(),
    ageBand: state.child.ageBand,
    childWord: childWordOf(state.child.lookTags),
    anchors: state.card.anchors,
    env,
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
    lookTags: string[]
    interestTags: string[]
  }
  cardId: string
  theme: string
  wish?: string
  form: 'solo'
  pages?: number
  mode: 'live'
  env: Record<string, string | undefined>
}

/**
 * 第 5 步的请求体。
 *
 * ★ 形态这一周只做独读版（`form: 'solo'`），共读版整套交互在 W3。
 *   页数不在这里定死：产品定义是 20 页，但演示要能缩小规模，
 *   所以它由调用方给（`pagesOf`），入口在生成那一步的界面上。
 */
export function toBookBody(
  state: CreationState,
  env: Record<string, string | undefined>,
  pages: number,
): BookBody {
  const wish = state.theme.wish.trim()
  return {
    child: {
      childId: state.child.childId,
      name: state.child.name.trim(),
      nameReading: state.child.nameReading.trim(),
      ageBand: state.child.ageBand,
      lookTags: state.child.lookTags,
      interestTags: state.child.interestTags,
    },
    cardId: state.card.cardId ?? '',
    theme: state.theme.theme.trim() || wish,
    ...(wish !== '' ? { wish } : {}),
    form: 'solo',
    pages,
    mode: 'live',
    env,
  }
}

/** 形态词：由外貌标签推。推不出来就用中性词，**不猜**（猜错会让出一张画错性别的标准像） */
function childWordOf(lookTags: readonly string[]): string {
  const joined = lookTags.join('')
  if (/马尾|辫子|裙子/.test(joined)) return '小女孩'
  if (/短发|球衣/.test(joined)) return '小男孩'
  return '孩子'
}
