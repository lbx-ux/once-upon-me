/**
 * avatars.test.ts —— 那一个默认头像
 *
 * 这一组里最要紧的一条仍然是文件真的在。判据不是"常量指向了一个看着对的路径"——
 *   路径写对而盘上没有那个文件的话，`<img>` 会 404，而它 `alt=""`，
 *   于是什么都不画（正是这个仓库那条"不留碎图标"的兜底在做它的事）：
 *   侧栏那一格与个人主页那一格会一起变成一个安静的空洞，没有任何东西报错。
 *   所以这条测试读盘，不是读常量。
 *
 * 2026-10-17 整段重写。原来那五条断言的全是六个 SVG（六个 id、`aria-label`、
 *   写死的令牌色值、`/avatars/<id>.svg` 的拼法），那五条对着一个位图常量
 *   一条都不成立——留着就是一份永远测不到东西的测试（比删掉更坏：它红得没有意义，
 *   绿得也没有意义）。现在盯的是"换了图之后最容易悄悄坏掉的那两件事"：
 *   盘上有它、它真的是一张 256×256 的位图。
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { DEFAULT_AVATAR } from './avatars.ts'

const PUBLIC = join(process.cwd(), 'public')
const FILE = join(PUBLIC, DEFAULT_AVATAR.replace(/^\//, ''))

describe('那个默认头像', () => {
  it('★ 盘上真的有它（404 的话侧栏与个人主页会一起变成安静的空洞）', () => {
    expect(existsSync(FILE), `${FILE} 不在`).toBe(true)
  })

  /**
   * 判据取"只有真做了才会不一样"的那一个：读文件头那 12 个字节。
   *   `RIFF....WEBP` 是 webp 的容器签名——写错扩展名（把 png 改名成 .webp）、
   *   或者落了一个 0 字节的文件，都会在这里红，而在浏览器里那两种坏法
   *   长得一模一样（都是一块空白，且不报错）。
   */
  it('★ 它真的是一张 webp（不是改了名的 png、不是空文件）', () => {
    const head = readFileSync(FILE).subarray(0, 12)
    expect(head.subarray(0, 4).toString('ascii'), '不是 RIFF 容器').toBe('RIFF')
    expect(head.subarray(8, 12).toString('ascii'), 'RIFF 里装的不是 WEBP').toBe('WEBP')
  })

  /**
   * 256×256 是 `scripts/make-default-avatar.mts` 的 `FINAL` 写下来的那一档：
   *   最大显示 64px（`.pf__avatar`），2x 有余量，再大是白付字节。
   *   这条同时挡住"有人把 1024 的原图直接塞进 public/"——那会让**这张原图
   *   永远留在公开仓库的历史里**（`.out/` 是 gitignored 的，`public/` 不是）。
   *
   * 尺寸从 VP8/VP8L/VP8X 三种块头里读，逐字节解出来而不是调 `sharp`：
   *   测试跑在 vitest 里，为一条断言拉一个原生依赖进来不划算（它是脚本的依赖，
   *   不是应用的）。三种布局都认，是因为 sharp 落 webp 时用哪一种取决于图的内容。
   */
  it('★ 它是 256×256（不是 1024 的原图直接进了 public/）', () => {
    const bytes = readFileSync(FILE)
    const size = webpSizeOf(bytes)
    expect(size, '读不出尺寸——它可能不是一份完整的 webp').not.toBeNull()
    expect(size).toEqual({ width: 256, height: 256 })
  })

  it('给的是**站内绝对路径**，不拼域名、不拼 base', () => {
    // 绝不写成 `new URL(path, base)`：本机在一个 fake-IP 代理后面，拼地址会拼到代理那儿
    expect(DEFAULT_AVATAR.startsWith('/')).toBe(true)
    expect(DEFAULT_AVATAR).not.toContain('://')
  })
})

/**
 * webp 的三种容器布局，尺寸各自写在哪儿。
 *
 * - VP8X（扩展格式，带 alpha / 动画 / 元数据时用它）：画布尺寸是
 *   紧跟在 `VP8X` 之后的两个 24 位小端整数，各减一。
 * - VP8L（无损）：签名 `0x2f` 之后 4 个字节里塞着 14 位宽 + 14 位高，各减一。
 * - VP8（有损）：`VP8 ` 之后跳过 3 字节的帧标签与 3 字节同步码，
 *   再两个 16 位小端整数，各取低 14 位。
 *
 * 读不出就回 `null`（让上面那条断言自己去红），不抛错：抛在这里的话，
 *   报出来的是"解析器炸了"，而真正要说的是"这个文件不是一张能用的 webp"。
 */
function webpSizeOf(bytes: Buffer): { width: number; height: number } | null {
  // `RIFF` + 文件长度(4) + `WEBP` + 第一个块的标签(4) = 16 起才是块内容
  const tag = bytes.subarray(12, 16).toString('ascii')
  if (tag === 'VP8X') {
    return {
      width: (bytes.readUIntLE(24, 3) & 0xffffff) + 1,
      height: (bytes.readUIntLE(27, 3) & 0xffffff) + 1,
    }
  }
  if (tag === 'VP8L') {
    const bits = bytes.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  if (tag === 'VP8 ') {
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    }
  }
  return null
}
