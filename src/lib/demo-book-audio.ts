/**
 * demo-book-audio.ts —— 首页第二屏那本演示绘本的朗读在不在盘上（服务端读一次盘）
 *
 * 与 `booklist-assets.ts` 是同一条规矩的第二次落地：界面不能"以为"音频在，
 * 必须问盘。判据只有一条 —— 文件在不在 `public/book/`。
 * `readdir(...).catch(() => [])`：读不到目录就是"都没有"，不是回一张碎图。
 *
 * 名字是从图推出来的，没有第二张表
 *
 * 第 k 个跨页的图是 `/book/spread-k.webp`，那它的朗读就是 `spread-k.m4a`
 * （或 `.mp3`）—— 同目录、同序号、只差扩展名。这一条在书单那 12 本上已经用过
 * 一次（`booklist.ts` 的 `audioPath`：「与图同名，只差扩展名」），所以 4a / 4b
 * 那两支不用另写映射：图叫什么，音频就叫什么。
 *
 * ★ 写映射表的代价不是多打几个字，是它一定会过期：换一张图、改一次分支，
 *   表不会跟着动，症状是"这一页明明录了、界面却说没有"（`docs/demo-narration-script.md`
 *   §五 那行"命名"写的也是这件事）。
 *
 * 为什么在 `lib/` 而不是 `components/book/`：它碰 `node:fs`，是服务端的东西。
 *   `components/book/demoBook.ts` 那一份是内容，客户端的翻页组件要 import 它；
 *   把 `node:fs` 混进去就是往客户端包里塞一台文件系统（与 `booklist-assets.ts` 同）。
 *
 * 闸门：`complete` 把两支都算进去
 *
 * ★ 判据 ①（工单 08 §一）是"只要有一屏没有朗读，控件就不出现"。在这一节里它必须
 *   按"整本"算，不能按当前这一支算：只录了 4a、没录 4b 的书，孩子按下
 *   「去帆船云里」之后会当场哑掉而控件还在 —— README §五 拆掉上一条播放条的理由
 *   正是这个（一个只对一部分能响的控件，证的是反面）。
 *   所以 `complete` 定在文件名这一层：5 个基名全在才算数。
 *
 * 缺的那几段在开发期会在服务端终端里说一句。这不是装饰：加音频的人要的信号是
 *   "按钮怎么没出来"，而不是去翻盘上为什么少了一个字母。
 */

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { allSpreads, type BranchKey } from '@/components/book/demoBook.ts'
import { AUDIO_EXTS } from '@/components/booklist/booklist.ts'

/** 这一本的所有资产（图与音频）落在 `public/book/` —— Next 直接发字节的地方 */
const BOOK_DIR = 'book'

/** 同上，浏览器那一头的地址前缀（`/book/spread-1.m4a`） */
const BOOK_URL = '/book'

/**
 * 5 个基名：三个固定跨页 + 两支分支各一个。
 *
 * 由 `allSpreads` 推出来，不手写：手写的话，改一次分支或换一次图，
 * 这里就会安静地少一段（而症状是"录了 5 段，界面说缺一段"）。
 * a 与 b 的前三个是同一份，所以先去重 —— 缺哪一段要报得出名字，不能报两遍。
 */
const AUDIO_BASES: readonly string[] = [
  ...new Set([...allSpreads('a'), ...allSpreads('b')].map((spread) => baseNameOf(spread.image))),
]

export type DemoBookAudio = {
  /** 每个分支各 4 项（下标 0 = 第 1 个跨页）。`null` = 这一页没有朗读 */
  url: Record<BranchKey, (string | null)[]>
  /** 5 段全在（含 4a/4b 两支）—— 少一段就整本不给控件，见文件头 */
  complete: boolean
}

/** `/book/spread-4a.webp` → `spread-4a`。★ 只认最后一个点，目录里那一段不碰 */
function baseNameOf(imagePath: string): string {
  return (imagePath.split('/').pop() ?? imagePath).replace(/\.[^.]+$/, '')
}

/**
 * 一个基名的朗读在哪。`null` = 这个文件还不在盘上（不是"我们忘了配"）。
 *
 * 问盘顺序就是 `AUDIO_EXTS` 的次序（`.m4a` 优先，规格那一档是 AAC）。
 * 借的是书单那一份常量，不在这里再写一遍：两边认的是同一件事
 *   （"朗读认这两个容器"），写成两份就会漂成两套格式的开端。
 */
function audioUrlOf(base: string, files: ReadonlySet<string>): string | null {
  const ext = AUDIO_EXTS.find((candidate) => files.has(`${base}.${candidate}`))
  return ext ? `${BOOK_URL}/${base}.${ext}` : null
}

async function filesOf(): Promise<ReadonlySet<string>> {
  const names = await readdir(join(process.cwd(), 'public', BOOK_DIR)).catch(() => [] as string[])
  return new Set(names)
}

/** 每次进程只念一遍。少了它，dev 下每渲染一帧就在终端里刷一行 */
let warned = false

function warnMissing(missing: readonly string[]): void {
  if (warned || missing.length === 0) return
  warned = true
  console.warn(
    `[demo-book-audio] 首页演示绘本《小宇的云》还缺 ${missing.length} 段朗读：` +
      `${missing.map((base) => `${base}.m4a`).join('、')} —— ` +
      '按「要么录满、要么先不做」，朗读控件整块不出现（docs/demo-narration-script.md §六）',
  )
}

/**
 * 首页那一节要的两样东西一次问完：每个分支四条 URL，以及整本齐了没有。
 *
 * 按分支给，是因为第 4 个跨页有两张图（恐龙云 / 帆船云），孩子选哪一朵，
 * 这一页念的就是哪一段 —— 与画面、与按钮的左右同一条口径（`demoBook.ts` BRANCHES）。
 */
export async function readDemoBookAudio(): Promise<DemoBookAudio> {
  const files = await filesOf()
  const missing = AUDIO_BASES.filter((base) => audioUrlOf(base, files) === null)
  warnMissing(missing)
  return {
    url: {
      a: allSpreads('a').map((spread) => audioUrlOf(baseNameOf(spread.image), files)),
      b: allSpreads('b').map((spread) => audioUrlOf(baseNameOf(spread.image), files)),
    },
    complete: missing.length === 0,
  }
}
