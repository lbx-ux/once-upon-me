/**
 * reader-paper.test.ts —— 阅读器底图那份表：**纯的那半**，加上"表与盘对不对得上"
 *
 * ★ 不测 `load/save`：vitest 是 `environment: 'node'`（理由写在 `vitest.config.ts`），
 *   这里没有 `localStorage`。丢进这个文件的断言只该管两件事：
 *
 *   1. **认不出来的值退到哪一边** —— 那是"用户打开一本书，看到的是不是他认识的那一屏"。
 *   2. **表与盘是不是同一个事实** —— 与 `booklist.test.ts` 的「桌面那张色表」同源：
 *      底图是一份**生成物**（`scripts/make-reader-paper.mts` 出图、`--apply` 落盘），
 *      而生成物的坏法是**静默**的：表里写了 `mist` 而盘上没有那个文件，
 *      界面上不会报错，只是那一档铺出来是一片空的。那条断言把"记得跑脚本"
 *      变成机器的事。
 */

import { describe, expect, it } from 'vitest'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import {
  DEFAULT_READER_PAPER,
  READER_PAPERS,
  findReaderPaper,
  parseReaderPaper,
} from './reader-paper.ts'

describe('parseReaderPaper · 认不出来的值退到哪一边', () => {
  it('表里有的键原样读回来', () => {
    for (const paper of READER_PAPERS) {
      expect(parseReaderPaper(paper.key).key).toBe(paper.key)
    }
  })

  it('★ 没设置过 = 默认档', () => {
    expect(parseReaderPaper(null).key).toBe(DEFAULT_READER_PAPER.key)
  })

  it('★ 一切不认识的值都退到默认，不是"猜一个"', () => {
    // 存储里的东西不一定是自己写的：上一版的格式、手改过的、上一批图里的某一档
    for (const junk of ['', 'Paper', 'PAPER', 'dots', 'none', '纯色', '{"key":"wood"}', 'wood ']) {
      expect(parseReaderPaper(junk).key).toBe(DEFAULT_READER_PAPER.key)
    }
  })

  it('findReaderPaper 认不出来时是 undefined（要退到默认是调用方的事）', () => {
    expect(findReaderPaper('wood')?.label).toBe('木桌')
    expect(findReaderPaper('nope')).toBeUndefined()
    expect(findReaderPaper(null)).toBeUndefined()
  })
})

describe('那份表自己的形状', () => {
  it('键不重复，且默认那一档排在第一个、纯色排在最后', () => {
    const keys = READER_PAPERS.map((paper) => paper.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys[0]).toBe(DEFAULT_READER_PAPER.key)
    expect(keys[keys.length - 1]).toBe('plain')
  })

  it('每一档要么图与缩略图都有、要么都没有（半档会画出一个空框）', () => {
    for (const paper of READER_PAPERS) {
      expect(Boolean(paper.url), paper.key).toBe(Boolean(paper.thumb))
      expect(paper.label.trim().length, paper.key).toBeGreaterThan(0)
    }
    expect(findReaderPaper('plain')?.url).toBeNull()
  })
})

/** `public/` 下真正躺着的底图（相对站点 URL）。`readdirSync` 在 node 环境是允许的 */
const root = join(process.cwd(), 'public', 'reader-papers')
const onDisk = (suffix: string): string[] =>
  readdirSync(root)
    .filter((file) => file.endsWith(suffix))
    .map((file) => `/reader-papers/${file}`)

describe('表与盘是同一个事实', () => {
  it('表里每一档的图与缩略图都在盘上', () => {
    for (const paper of READER_PAPERS) {
      if (!paper.url) continue
      expect(
        onDisk('.webp').filter((u) => !u.endsWith('.thumb.webp')),
        paper.key,
      ).toContain(paper.url)
      expect(onDisk('.thumb.webp'), paper.key).toContain(paper.thumb)
    }
  })

  it('盘上没有表里没有的图（删了一档、文件还留着）', () => {
    const known = new Set(
      READER_PAPERS.flatMap((paper) => [paper.url, paper.thumb]).filter(Boolean) as string[],
    )
    const stale = [...onDisk('.webp')].filter((url) => !known.has(url))
    expect(stale).toEqual([])
  })
})
