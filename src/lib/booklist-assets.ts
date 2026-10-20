/**
 * booklist-assets.ts —— 灵感书单这 12 本的资产在不在盘上（服务端读一次盘）
 *
 * 图与音频是分批到达的：今天可能只有恐龙的封面，明天多两张跨页。所以界面
 * 不能"以为"它们在，必须问盘。判据只有一条：文件在不在 `public/booklist/{key}/`。
 *
 * 与 `book-source.ts` 读演示书那段是同一条规矩：`readdir(...).catch(() => [])`
 *   ——读不到目录就是"都没有"，不是回一张碎图。缺图那一页由阅读器画一张
 *   写着"画还没到位"的纸（CLAUDE.md「不糊弄」）。
 *
 * 为什么放在 `lib/` 而不是 `components/booklist/`：它碰 `node:fs`，是服务端的东西。
 *   `components/booklist/` 那一摞是内容与界面，客户端的阅读器也要 import 它们，
 *   把 `node:fs` 混进去就是往客户端包里塞一台文件系统。
 *
 * 这一层不猜：
 *   · 封面在不在 → `cover.webp` 在不在；
 *   · 第 n 个跨页有没有画 → `p{n}.webp` 在不在；
 *   · 第 n 个跨页有没有朗读 → `p{n}.m4a` 或 `p{n}.mp3` 在不在
 *     （`AUDIO_EXTS` 的次序，`.m4a` 优先；2026-10-15 从"只认 m4a"放开，理由见那里）。
 * 图与音频同目录同序号，所以"第 3 张图的音频"永远是 `p3.*`——
 * 这一条是物理事实，不靠映射表（`booklist.ts` 文件头那段）。
 */

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import {
  AUDIO_EXTS,
  BOOKLIST,
  SPREADS_PER_BOOK,
  artPath,
  audioPath,
  coverPath,
  type BooklistBook,
} from '@/components/booklist/booklist.ts'
import type { ThemeKey } from '@/lib/themes.ts'

/** 一本样书的资产落点。`null` = 这个文件还不在盘上（不是"我们忘了配"） */
export type BooklistAssets = {
  cover: string | null
  /** 8 项，下标 0 = 第 1 个跨页 */
  art: (string | null)[]
  /** 8 项，与 `art` 同名同序 */
  audio: (string | null)[]
}

/** `public/booklist/` 这一层的绝对路径。`public/` 是 Next 直接发字节的地方，不落资产根 */
function bookDir(key: ThemeKey): string {
  return join(process.cwd(), 'public', 'booklist', key)
}

/**
 * 这一本目录里有哪些文件（只问一次，图与音频共用这一次读盘）。
 * 目录不存在 = 空集合，不是错误：一本还没出图的样书就是这个样子。
 */
async function filesOf(key: ThemeKey): Promise<ReadonlySet<string>> {
  const names = await readdir(bookDir(key)).catch(() => [] as string[])
  return new Set(names)
}

export async function readBooklistAssets(key: ThemeKey): Promise<BooklistAssets> {
  const files = await filesOf(key)
  const pages = Array.from({ length: SPREADS_PER_BOOK }, (_, i) => i + 1)
  return {
    cover: files.has('cover.webp') ? coverPath(key) : null,
    art: pages.map((n) => (files.has(`p${n}.webp`) ? artPath(key, n) : null)),
    audio: pages.map((n) => {
      const ext = AUDIO_EXTS.find((candidate) => files.has(`p${n}.${candidate}`))
      return ext ? audioPath(key, n, ext) : null
    }),
  }
}

/** 书单墙上一格要看的三件事：封面、页数、整本有没有朗读 */
export type BooklistEntry = {
  book: BooklistBook
  coverUrl: string | null
  /** 有几个跨页已经有画（"12 张里到了 5 张"要如实说） */
  artReady: number
  /** 8 段朗读全在才算"有朗读"。与阅读器那条判据同一个数（`ReaderBook.tsx` 判据 ①） */
  narrated: boolean
}

export async function listBooklist(): Promise<BooklistEntry[]> {
  return Promise.all(
    BOOKLIST.map(async (book) => {
      const assets = await readBooklistAssets(book.key)
      const ready = assets.art.filter((url) => url !== null).length
      return {
        book,
        coverUrl: assets.cover,
        artReady: ready,
        narrated: assets.audio.every((url) => url !== null),
      }
    }),
  )
}
