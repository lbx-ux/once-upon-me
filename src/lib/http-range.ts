/**
 * http-range.ts —— 一条 `Range: bytes=…` 的解析
 *
 * ★ 为什么会有这个文件（2026-10-18，用户："这个播放有bug啊，我点开是0秒，
 *   但是其他是有音频的"）。`/api/assets` 在那天之前有三件事凑在一起：
 *
 * 1. **不回 `Content-Length`**（Next 给 ArrayBuffer 体会走 `Transfer-Encoding: chunked`）
 *    —— 浏览器连这一页的音频有多大都不知道；
 * 2. **不支持 `Range`**（那条出口原来的注释还写着"对朗读音频是可以接受的"）；
 * 3. 于是 `<audio>` 那个原生播放器**打开时 `duration` 是 `NaN`**（一个字节都没开始拉，
 *    `preload="none"`）→ 屏幕上就是用户看到的 `0:00`；按播放、整条读完才知道时长；
 *    而 `seekable` 恒为 0 —— 进度条拖不动。
 *
 * 实测读数（无头 Chrome + CDP，`.out/probe-audio.mjs`；复现命令与逐条读数记在
 * `.scratch/w3-shared-reading/issues/09-audio-range.md`）：
 * 打开 `{"duration":"NaN","readyState":0}`、一条 mp3 请求都没有；按下播放之后
 * `{"duration":"7.152","readyState":4,"seekable":"0"}` —— 时长一直要到**整条流读完**
 * 才出现，而拖不动这件事从来没好过。修完之后打开的那一刻就是
 * `{"duration":"7.176","readyState":4,"seekable":"7.176"}`。
 *
 * ★ 为什么 mp3 特别吃这一口：一条 mp3 的总时长只有两个来源——写在头里的
 *   Xing/Info 表（有则秒出），或者把整条流走到底数帧。而资产根里那 16 个 TTS 产物
 *   **一个有 Xing 头的都没有**（`.out/mp3-dur.py` 逐帧读出来的）。
 *   所以"这一页有 7.2 秒"这件事，浏览器只能靠**自己去读末尾**得到——
 *   读末尾用的正是 `Range: bytes=-N`。不支持 Range 就永远读不到。
 */

/** 一段字节，**闭区间**（`end` 那一个字节算在内——`Content-Range` 与 `Content-Length`
 *  的分界就在这儿，差一会变成"最后一个字节播不出来"） */
export type ByteRange = { start: number; end: number }

/**
 * `Range` 头 + 资源大小 → 要发的那一段；`null` = 照 200 发整份；`'unsatisfiable'` = 416。
 *
 * ★ 三种结果分开，是因为**它们该有不同的回应**（RFC 9110 §14.2、§15.5.17）：
 *
 * | 输入 | 结果 | 为什么 |
 * | --- | --- | --- |
 * | 不是 `bytes=`、认不出来、多段（`bytes=0-1,4-5`）、`last < first` | `null` | 语法/语义不成立的 `Range` **忽略它**、回整份。这是规范允许的，而"猜一个范围"会把一个坏请求变成一个坏响应 |
 * | 语法对，但整段落在文件之外（`bytes=99999-`） | `'unsatisfiable'` | 416 + `Content-Range: bytes *\/size`，让浏览器知道它要不到 |
 *
 * ★ 多段（multipart/byteranges）当 `null`：这里没有消费者，而按多段切要多发一层
 *   分隔符与每段的头。浏览器取音频末尾时发的都是单段。
 */
export function parseRange(
  header: string | null,
  size: number,
): ByteRange | 'unsatisfiable' | null {
  if (header === null) return null
  const text = header.trim()
  if (!text.toLowerCase().startsWith('bytes=')) return null

  const spec = text.slice('bytes='.length).trim()
  if (spec.includes(',')) return null
  const match = /^(\d*)-(\d*)$/.exec(spec)
  if (match === null) return null
  const [, rawStart = '', rawEnd = ''] = match
  if (rawStart === '' && rawEnd === '') return null
  // 空资源上任何一段都要不到（也要防下面 `size - 1` 变成 -1）
  if (size === 0) return 'unsatisfiable'

  if (rawStart === '') {
    // 后缀式：`bytes=-500` 是"最后 500 字节"。`bytes=-0` 要的是 0 字节，等于要不到
    const want = Number(rawEnd)
    if (want === 0) return 'unsatisfiable'
    return { start: Math.max(0, size - want), end: size - 1 }
  }

  const start = Number(rawStart)
  if (start >= size) return 'unsatisfiable'
  if (rawEnd === '') return { start, end: size - 1 }

  const end = Number(rawEnd)
  // 语义不成立（末尾在开头之前）当"忽略"，不是 416——上表那一条
  if (end < start) return null
  return { start, end: Math.min(end, size - 1) }
}
