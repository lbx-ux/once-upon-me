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
  childProblems,
  childWordOf,
  initialState,
  makeChildId,
  toBookBody,
  toCardBody,
  type CreationState,
  type RunForm,
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

/**
 * 跑一本要的那几个字段（`RunForm`）。★ 它**不是** `CreationState`：
 * 跑一本只要"他是谁 + 用哪张卡 + 讲什么"，锚点/版次那些只有建卡那一屏才用得上
 * （见 `state.ts` 的 `RunForm` 那段）。
 */
function runOf(state: CreationState): RunForm {
  return {
    child: state.child,
    cardId: state.card.cardId ?? '',
    theme: state.theme,
  }
}

/**
 * ★ 这一组原来叫 `stepProblems`，一把钥匙开三个门（第 1/2/3 步）。
 *   工单 06 之后创作流只剩运行那一屏，主题与卡两步不在那里问了——
 *   于是它收窄成 `childProblems`，**参数也从整份 `CreationState` 换成那半份**。
 *   ★ 收敛掉的两条判据不是"不重要了"，是**没有读者了**：
 *     主题那一格现在由弹窗与 `/home` 的输入框保证非空，
 *     卡号那一格由页面层的重定向保证（`/create` 拿不到卡就回 `/home`）。
 *     留着一个没人调的分支，下一个人会以为界面上还有一处地方在用它拦人。
 */
describe('childProblems · 「他是谁」那几格', () => {
  it('空表单说清缺什么，而且是逐条说', () => {
    expect(childProblems(initialState().child)).toEqual([
      '孩子的名字还没填',
      '名字的读音还没确认',
      // ★ 第 23 刀加的这一条：年龄档有缺省值（`4-6`）而**性别没有**——
      //   两格看起来都是"芯片行"，但一个默认选中、一个默认不选（见下面那条）
      '性别还没选',
    ])
  })

  it('填了名字与读音就放行（年龄档有缺省值，不该在这里拦）', () => {
    const state = initialState()
    state.child.name = '小宇'
    state.child.nameReading = 'xiǎo yǔ'
    state.child.gender = 'boy'
    expect(childProblems(state.child)).toEqual([])
  })

  it('★ 只有空格的名字不算填了（trim 之后再判）', () => {
    const state = initialState()
    state.child.name = '   '
    state.child.nameReading = 'yǔ'
    state.child.gender = 'girl'
    expect(childProblems(state.child)).toEqual(['孩子的名字还没填'])
  })

  it('年龄档不在封闭表里就拦下来（表单里能选中的值，引擎必须也认）', () => {
    const state = initialState()
    state.child.name = '小宇'
    state.child.nameReading = 'yǔ'
    state.child.gender = 'boy'
    // 故意塞一个引擎不认识的值：这正是"表单抄了一份字面量"会产生的错
    state.child.ageBand = '12+' as CreationState['child']['ageBand']
    expect(childProblems(state.child)).toEqual(['年龄档没选'])
  })

  it('★ 性别默认**不预选**，而且不选就拦下来（第 23 刀）', () => {
    // 这一条与年龄档是**故意不一样**的：年龄四档里"4-6"是大多数，预选它是省事；
    // 性别两档是五五开，预选哪一个都会把一半的孩子画错，而"没选"看得出来
    // （两个芯片都不亮），"选错了"看不出来
    expect(initialState().child.gender).toBeUndefined()
    const state = initialState()
    state.child.name = '小宇'
    state.child.nameReading = 'yǔ'
    expect(childProblems(state.child)).toEqual(['性别还没选'])
  })
})

describe('toCardBody · 第 3 步的请求体', () => {
  it('该过去的字段一个不少：childId、名字、年龄档、形态词、锚点', () => {
    // ★ 状态只造**一次**：`filled()` 每次都生成新的随机 childId，
    //   两边各调一次就是拿两个不同的孩子在对（第一版就这么错过）
    const state = filled()
    const body = toCardBody(state)
    expect(body).toMatchObject({
      childId: state.child.childId,
      name: '小宇',
      ageBand: '4-6',
      childWord: '小男孩',
    })
    // ★ 2026-10-17 起这里**没有 `env`**：密钥由站长分配，只从服务端的 `process.env` 来
    //   （ADR-0009）。原来这一条断的是"env 原样过去了"，现在断的是"它根本不在请求体里"——
    //   判据反过来，而它防的事情没变：**用户在设置里填的密钥不许跟着请求走**
    expect('env' in body).toBe(false)
    expect(body.anchors).toHaveLength(state.card.anchors.length)
  })

  it('名字 trim 之后再发（多一个空格是两个不同的人名，模型那边不认）', () => {
    const state = filled()
    state.child.name = '  小宇  '
    expect(toCardBody(state).name).toBe('小宇')
  })

  it('★ 没有卡号时不带 cardId：发了它，服务端会去找一张不存在的卡（404）', () => {
    const state = filled()
    state.card = { ...state.card, cardId: undefined }
    expect('cardId' in toCardBody(state)).toBe(false)
  })

  it('★ 有卡号就带上：这是"换一版"叠 revision 而不是新建一张卡的唯一依据', () => {
    expect(toCardBody(filled()).cardId).toBe('xiaoyu-r1')
  })

  it('锚点是原样过去的（引擎才是它们的权威，这里不许悄悄补默认值）', () => {
    const state = filled()
    state.card.anchors = [{ slot: 'bone', value: '圆脸' }]
    expect(toCardBody(state).anchors).toEqual([{ slot: 'bone', value: '圆脸' }])
  })
})

describe('toBookBody · 运行视图的请求体', () => {
  it('孩子那份是**整份**过去的（读音要进 profile，配音时用于多音字）', () => {
    const state = filled()
    const body = toBookBody(runOf(state), { pages: 5 })
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
    const body = toBookBody(runOf(filled()), { pages: 5 })
    expect(body.theme).toBe('勇气')
    expect('wish' in body).toBe(false)
  })

  it('★ 自己写了一句：那句话既是 theme 也是 wish（服务端两条路都要能读）', () => {
    const state = filled()
    state.theme = { theme: '', wish: '第一次离开家也不怕' }
    const body = toBookBody(runOf(state), { pages: 5 })
    expect(body.theme).toBe('第一次离开家也不怕')
    expect(body.wish).toBe('第一次离开家也不怕')
  })

  it('页数由调用方给（产品定义是 20，演示要能缩小规模）', () => {
    expect(toBookBody(runOf(filled()), { pages: 20 }).pages).toBe(20)
    expect(toBookBody(runOf(filled()), { pages: 3 }).pages).toBe(3)
  })

  it('★ 没有卡号时发空串而不是 undefined：服务端那句话是"还没有选形象"，不是"字段缺失"', () => {
    const state = filled()
    state.card = { ...state.card, cardId: undefined }
    expect(toBookBody(runOf(state), { pages: 5 }).cardId).toBe('')
  })

  it('★ 不传 voiceId 时**这个字段根本不出现**（不是空串）', () => {
    // 引擎那边"没填"与"填了个空的"是两件事：前者如实说"这本书没有朗读"，
    // 后者会带着一个空音色去调 TTS。所以三个可选字段一律有才传
    expect('voiceId' in toBookBody(runOf(filled()), { pages: 5 })).toBe(false)
    expect(toBookBody(runOf(filled()), { pages: 5, voiceId: 'longjielidou_v3.6' }).voiceId).toBe(
      'longjielidou_v3.6',
    )
  })

  it('★ 运行视图发的是 draft：成品要等「确定生成」那一下', () => {
    expect(toBookBody(runOf(filled()), { pages: 5, status: 'draft' }).status).toBe('draft')
    // 不传就不写这个字段——缺省 = 成品（见 `Book.status` 的迁移决定）
    expect('status' in toBookBody(runOf(filled()), { pages: 5 })).toBe(false)
  })

  /**
   * ★ 性别这一格（2026-10-16）。
   *
   * 这条钉的不是"表单多一个字段"，而是那句报障的**上游**：
   * 「我提供给你的是男孩子，怎么生成出来有男孩有女孩子」。
   * 实测那张卡的七条锚点是「脸圆润 / 眼圆黑 / 黑直短发 / 头身比 1:4 / …」，
   * **一个性别词都没有**，所以"按角色卡画"这条路本身说不出性别——
   * 它必须由这一格补进去，而这一格原来根本没往请求体里送。
   * 少送它，逐页 prompt 里就没有称呼，模型只能按头发长短猜。
   */
  it('★ 选了性别就跟着进请求体（不送它，逐页 prompt 里就没有那个称呼）', () => {
    const state = filled()
    state.child.gender = 'boy'
    expect(toBookBody(runOf(state), { pages: 5 }).child.gender).toBe('boy')
  })

  it('★ 没选就**不写这一栏**——不是空串，也不是 undefined', () => {
    expect('gender' in toBookBody(runOf(filled()), { pages: 5 }).child).toBe(false)
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

  it('★ 选了性别就**以它为准**，标签推不出东西也照样说得出称呼（第 23 刀）', () => {
    // 这就是这一刀要解决的那件事：标签的编辑控件在同一天被删掉了，
    // 于是 `childWordOf(['戴眼镜'])` 只能回中性的"孩子"——而称呼是提示词里
    // **唯一**决定模型画男孩还是女孩的那个词
    expect(childWordOf(['戴眼镜'], 'girl')).toBe('小女孩')
    expect(childWordOf(['戴眼镜'], 'boy')).toBe('小男孩')
    // ★ 性别优先于标签：标签说"扎马尾"、人说是男孩，听人的
    //   （标签是模型读照片猜的，性别是家长自己点的）
    expect(childWordOf(['扎马尾', '连衣裙'], 'boy')).toBe('小男孩')
    // 没选（老档案 / 创作流那一屏）就还按老路推——这一条不许因为新功能而变
    expect(childWordOf(['扎马尾', '连衣裙'])).toBe('小女孩')
  })
})
