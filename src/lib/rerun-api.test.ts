/**
 * rerun-api.test.ts —— 单页重做那次请求的契约（工单 08）
 *
 * 三条判据，每条都对应一种安静的坏法：
 *
 * 1. 空串不等于没写。`fixNote: ''` 要是被当成"一句空话"带下去，
 *    提示词里会多出一行「★ 这一版要改掉上一版的问题：」——一句什么都没说的指令，
 *    而模型会照它去改点什么。
 * 2. 空行要丢掉、删空要拦。多打一个换行不该被拦；一行都不剩要拦，
 *    否则引擎会拿一段空正文去要音频，而厂商那边要么报错要么回一段静音——
 *    两种都不会在界面上说清"这一页没有正文了"。
 * 3. 上界。`fixNote` 进的是提示词、`body` 是书里那一页的字，两者都没有别的把关处。
 * 4. 内容。`fixNote` 是唯一一格家长手输、直达出图提示词、两道文字闸都不经过的文本
 *    （2026-10-20 补的，见下面那一组）。
 */

import { describe, expect, it } from 'vitest'

import { MAX_BODY, MAX_FIX_NOTE, parseRerunBody } from './rerun-api.ts'

function ok(raw: Record<string, unknown>) {
  const parsed = parseRerunBody(raw)
  if (!parsed.ok) throw new Error(`本该通过，却报了：${parsed.problems.join('；')}`)
  return parsed.value
}

function problems(raw: unknown): string {
  const parsed = parseRerunBody(raw)
  if (parsed.ok) throw new Error('本该被拦住，却过了')
  return parsed.problems.join('；')
}

describe('kind', () => {
  it('image / audio 两个动词，其余一律拦下', () => {
    expect(ok({ kind: 'image' }).kind).toBe('image')
    expect(ok({ kind: 'audio' }).kind).toBe('audio')
    expect(problems({ kind: 'text' })).toContain('kind 只能是 image / audio')
    expect(problems({})).toContain('kind 只能是 image / audio')
  })
})

describe('fixNote（重画那句补充）', () => {
  it('★ 空串与全空格都按"没写"处理，那个字段根本不出现', () => {
    expect('fixNote' in ok({ kind: 'image', fixNote: '' })).toBe(false)
    expect('fixNote' in ok({ kind: 'image', fixNote: '   ' })).toBe(false)
  })

  it('写了就带上去，并且 trim 过', () => {
    expect(ok({ kind: 'image', fixNote: '  头发太长了  ' }).fixNote).toBe('头发太长了')
  })

  it('太长要拦：它进的是提示词，上界只有这一处', () => {
    expect(problems({ kind: 'image', fixNote: 'x'.repeat(MAX_FIX_NOTE + 1) })).toContain(
      '补充说明太长',
    )
  })

  it('不是文字就拦', () => {
    expect(problems({ kind: 'image', fixNote: 42 })).toContain('fixNote 要是一段文字')
  })

  /**
   * 内容闸（2026-10-20）。这一句是唯一一格家长手输、直达出图提示词、
   *   而两道文字闸都不经过的文本：它不写进故事（躲过 `reviewStory`），
   *   也不是开书时的表单（躲过 `reviewInput`）。补上之前，一条"画一个拿刀的人"
   *   在这条路上没有任何东西拦得住，唯一的事后拦截是那一档不可复现的画面审核。
   */
  it('★ 写着红线里的内容要拦下（这一格原来两道文字闸都不经过）', () => {
    expect(problems({ kind: 'image', fixNote: '刚打过架，旁边流着血' })).toContain('R-01')
  })

  it('拦人的那句话里带条款 id 与命中的词（判据 5 要"具体到哪一条"）', () => {
    const said = problems({ kind: 'image', fixNote: '角落里放一把刀，地上有一滩血' })
    expect(said).toContain('补充说明')
    expect(said).toContain('R-01')
    expect(said).toContain('「血」')
  })

  it('★ 说得清"改一下再来"——这是拒发，不是"我们替你重写"', () => {
    expect(problems({ kind: 'image', fixNote: '让他自杀' })).toContain('改一下再来')
  })

  it('正常的一句补充照旧过（闸不是在拦所有人）', () => {
    expect(ok({ kind: 'image', fixNote: '头发短一点，别戴帽子，笑得自然些' }).fixNote).toContain(
      '头发短一点',
    )
  })
})

describe('body（重配改过的正文）', () => {
  it('一句一段地过，并且每句 trim', () => {
    expect(ok({ kind: 'audio', body: [' 月亮升起来了。', '他睡着了。 '] }).body).toEqual([
      '月亮升起来了。',
      '他睡着了。',
    ])
  })

  it('★ 空行丢掉，不当成"写了空的一句"', () => {
    expect(ok({ kind: 'audio', body: ['第一句。', '   ', '第二句。'] }).body).toEqual([
      '第一句。',
      '第二句。',
    ])
  })

  it('★ 删空了要拦：引擎会拿空正文去要一段音频，而那是无声的失败', () => {
    expect(problems({ kind: 'audio', body: ['', '  '] })).toContain('不能是空的')
    expect(problems({ kind: 'audio', body: [] })).toContain('不能是空的')
  })

  it('不是字符串数组就拦', () => {
    expect(problems({ kind: 'audio', body: '一句话' })).toContain('字符串数组')
    expect(problems({ kind: 'audio', body: [1, 2] })).toContain('字符串数组')
  })

  it('太长要拦（它的一个身份是"一页绘本的字"）', () => {
    expect(problems({ kind: 'audio', body: ['字'.repeat(MAX_BODY + 1)] })).toContain('正文太长')
  })

  it('★ 不带 body 是合法的：那就是"照现在这段字重录一遍"', () => {
    expect('body' in ok({ kind: 'audio' })).toBe(false)
  })
})
