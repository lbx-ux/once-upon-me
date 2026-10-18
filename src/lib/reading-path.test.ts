/**
 * reading-path.test.ts —— 路径记忆里**纯的那半**：存储里那串字怎么读
 *
 * ★ 不测 `load/save`：vitest 是 `environment: 'node'`（理由写在 vitest.config.ts，
 *   "浏览器事实用 preview 实测"），这里没有 `localStorage`。
 *   真销毁之后按下态还在不在，是 `scripts/chk-path-memory.mjs` 在无头 Chrome 里量的。
 *
 * 丢进这个文件的断言只该管一件事——**认不出来的值会退到哪一边**。
 * 那条判据在这里格外要紧：退错了不是"少一个偏好"，是**孩子没选、书替他选了**
 * （他被带到某一支上，而屏幕上没有任何东西说明这件事）。
 */

import { describe, expect, it } from 'vitest'

import { READING_PATH_PREFIX, parsePick, readingPathKeyOf } from './reading-path.ts'

describe('parsePick · 认不出来的值退到哪一边', () => {
  it('只有 a 与 b 两个字面量作数', () => {
    expect(parsePick('a')).toBe('a')
    expect(parsePick('b')).toBe('b')
  })

  it('★ 没存过（null）与存的空串都退到"没选过"', () => {
    // `''` 是"没选过"的存储拼法（`schemas/story.ts` 里 `via` 的缺省就是它），
    // 而"这个键根本不在"与它是同一件事
    expect(parsePick(null)).toBeNull()
    expect(parsePick('')).toBeNull()
  })

  it('★ 一切不认识的值都退到"没选过"，不是"猜一个"', () => {
    // 存储里的东西不一定是自己写的：上一版的格式、手改过的、只剩半截的
    for (const junk of [
      'c',
      'A',
      'B',
      'a ',
      ' a',
      'ab',
      'true',
      '1',
      '{"via":"a"}',
      '{"via":"a"',
      '"a"',
      'undefined',
      'null',
    ]) {
      expect(parsePick(junk)).toBeNull()
    }
  })
})

describe('readingPathKeyOf · 一本书一个键', () => {
  it('★ 两本书的键不相等（同一个键的症状是"打开 B 书时按着 A 书的选择"）', () => {
    expect(readingPathKeyOf('book-a')).not.toBe(readingPathKeyOf('book-b'))
    expect(readingPathKeyOf('xzj-shared-verify')).toBe(`${READING_PATH_PREFIX}xzj-shared-verify`)
  })

  it('★ 它落在 `xiaozhujue.reader.` 这一族里（与偏好、阅读记录同一个名字空间）', () => {
    // 这条钉的是一个**取舍**，不是拼写：第四样东西没有新开一族，
    // 所以"清阅读记录"与"清这份记忆"在人的心里是同一件事
    expect(READING_PATH_PREFIX.startsWith('xiaozhujue.reader.')).toBe(true)
  })
})
