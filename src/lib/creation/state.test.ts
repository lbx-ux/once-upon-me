/**
 * state.test.ts —— 表单契约与"表单 → 请求体"的两次转换（工单 09 的第 2、6 件事）
 *
 * 为什么它值得测试先行（工单 09 §二原话）：这两个转换函数是**表单与引擎之间唯一的一处**，
 * 漏一个字段的症状不是报错，而是"用了默认模型 / 用了缺省页数"——**安静得可怕**。
 * 所以这一组用例全都是"某个字段有没有真的过去"，不是"函数返回了对象"。
 *
 * ★ 三条判据都是**成对**写的（该过的过、不该过的不过）：
 *   只验"能过"的用例，把校验整个删掉也会绿。
 */

import { describe, expect, it } from 'vitest'

import {
  childWordOf,
  initialState,
  makeChildId,
  stepProblems,
  toBookBody,
  toCardBody,
  type CreationState,
} from './state.ts'

/** 一份"刚够走完全程"的状态：每一步都能过 */
function filled(): CreationState {
  const state = initialState()
  return {
    ...state,
    child: {
      ...state.child,
      name: '小宇',
      nameReading: 'xiǎo yǔ',
      ageBand: '4-6',
      lookTags: ['短发'],
      interestTags: ['恐龙'],
    },
    theme: { theme: '勇气', wish: '' },
    card: { ...state.card, cardId: 'xiaoyu-r1', revision: 1, referenceUrl: '/x.png' },
  }
}

const ENV = { LLM_API_KEY: 'k', LLM_MODEL: 'm' }

describe('stepProblems · 每一步的必填项', () => {
  it('空表单在第 1 步说清缺什么，而且是逐条说', () => {
    const problems = stepProblems(initialState(), 'child')
    expect(problems).toEqual(['孩子的名字还没填', '名字的读音还没确认'])
  })

  it('填了名字与读音就放行（年龄档有缺省值，不该在这里拦）', () => {
    const state = initialState()
    state.child.name = '小宇'
    state.child.nameReading = 'xiǎo yǔ'
    expect(stepProblems(state, 'child')).toEqual([])
  })

  it('★ 只有空格的名字不算填了（trim 之后再判）', () => {
    const state = initialState()
    state.child.name = '   '
    state.child.nameReading = 'yǔ'
    expect(stepProblems(state, 'child')).toEqual(['孩子的名字还没填'])
  })

  it('年龄档不在封闭表里就拦下来（表单里能选中的值，引擎必须也认）', () => {
    const state = initialState()
    state.child.name = '小宇'
    state.child.nameReading = 'yǔ'
    // 故意塞一个引擎不认识的值：这正是"表单抄了一份字面量"会产生的错
    state.child.ageBand = '12+' as CreationState['child']['ageBand']
    expect(stepProblems(state, 'child')).toEqual(['年龄档没选'])
  })

  it('第 2 步：主题与自由输入二选一，两个都空才拦', () => {
    const state = initialState()
    expect(stepProblems(state, 'theme')).toEqual(['挑一个主题，或者自己写一句想讲什么'])
    state.theme.theme = '勇气'
    expect(stepProblems(state, 'theme')).toEqual([])
    state.theme.theme = ''
    state.theme.wish = '第一次离开家也不怕'
    expect(stepProblems(state, 'theme')).toEqual([])
  })

  it('★ 第 3 步：只有图、没有卡号不算过（卡号是后面每一步的把手）', () => {
    const state = filled()
    state.card = { ...state.card, cardId: undefined }
    expect(stepProblems(state, 'card')).toHaveLength(1)
    expect(stepProblems(filled(), 'card')).toEqual([])
  })

  it('第 4 步没有前置判据（能不能跑由设置与卡决定，不在这里重复一遍）', () => {
    expect(stepProblems(initialState(), 'generate')).toEqual([])
  })
})

describe('toCardBody · 第 3 步的请求体', () => {
  it('该过去的字段一个不少：childId、名字、年龄档、形态词、锚点、env', () => {
    // ★ 状态只造**一次**：`filled()` 每次都生成新的随机 childId，
    //   两边各调一次就是拿两个不同的孩子在对（第一版就这么错过）
    const state = filled()
    const body = toCardBody(state, ENV)
    expect(body).toMatchObject({
      childId: state.child.childId,
      name: '小宇',
      ageBand: '4-6',
      childWord: '小男孩',
      env: ENV,
    })
    expect(body.anchors).toHaveLength(state.card.anchors.length)
  })

  it('名字 trim 之后再发（多一个空格是两个不同的人名，模型那边不认）', () => {
    const state = filled()
    state.child.name = '  小宇  '
    expect(toCardBody(state, ENV).name).toBe('小宇')
  })

  it('★ 没有卡号时不带 cardId：发了它，服务端会去找一张不存在的卡（404）', () => {
    const state = filled()
    state.card = { ...state.card, cardId: undefined }
    expect('cardId' in toCardBody(state, ENV)).toBe(false)
  })

  it('★ 有卡号就带上：这是"换一版"叠 revision 而不是新建一张卡的唯一依据', () => {
    expect(toCardBody(filled(), ENV).cardId).toBe('xiaoyu-r1')
  })

  it('锚点是原样过去的（引擎才是它们的权威，这里不许悄悄补默认值）', () => {
    const state = filled()
    state.card.anchors = [{ slot: 'bone', value: '圆脸' }]
    expect(toCardBody(state, ENV).anchors).toEqual([{ slot: 'bone', value: '圆脸' }])
  })
})

describe('toBookBody · 第 5 步的请求体', () => {
  it('孩子那份是**整份**过去的（读音要进 profile，配音时用于多音字）', () => {
    const state = filled()
    const body = toBookBody(state, ENV, 5)
    expect(body.child).toEqual({
      childId: state.child.childId,
      name: '小宇',
      nameReading: 'xiǎo yǔ',
      ageBand: '4-6',
      lookTags: ['短发'],
      interestTags: ['恐龙'],
    })
    expect(body.form).toBe('solo')
    expect(body.mode).toBe('live')
    expect(body.pages).toBe(5)
  })

  it('★ 只选了主题、没写那句话：theme 用主题名，wish 干脆不出现', () => {
    const body = toBookBody(filled(), ENV, 5)
    expect(body.theme).toBe('勇气')
    expect('wish' in body).toBe(false)
  })

  it('★ 自己写了一句：那句话既是 theme 也是 wish（服务端两条路都要能读）', () => {
    const state = filled()
    state.theme = { theme: '', wish: '第一次离开家也不怕' }
    const body = toBookBody(state, ENV, 5)
    expect(body.theme).toBe('第一次离开家也不怕')
    expect(body.wish).toBe('第一次离开家也不怕')
  })

  it('页数由调用方给（产品定义是 20，演示要能缩小规模）', () => {
    expect(toBookBody(filled(), ENV, 20).pages).toBe(20)
    expect(toBookBody(filled(), ENV, 3).pages).toBe(3)
  })

  it('★ 没有卡号时发空串而不是 undefined：服务端那句话是"还没有选形象"，不是"字段缺失"', () => {
    const state = filled()
    state.card = { ...state.card, cardId: undefined }
    expect(toBookBody(state, ENV, 5).cardId).toBe('')
  })
})

describe('小零件', () => {
  it('childId 是随机的 kid- 前缀串（两台机器上的"第一个孩子"不许撞同一个目录）', () => {
    const ids = new Set(Array.from({ length: 20 }, () => makeChildId()))
    expect(ids.size).toBe(20)
    for (const id of ids) expect(id).toMatch(/^kid-[a-z0-9]{6}$/)
  })

  it('形态词由外貌标签推，推不出来就用中性词（猜错会画错性别）', () => {
    expect(childWordOf(['扎马尾', '连衣裙'])).toBe('小女孩')
    expect(childWordOf(['短发'])).toBe('小男孩')
    expect(childWordOf(['戴眼镜'])).toBe('孩子')
    expect(childWordOf([])).toBe('孩子')
  })
})
