/**
 * last-run.ts —— 「刚才那一本」的指针（浏览器本地，只有书号）
 *
 * ★ 它解决的是**刷新之后接着看**这一件小事：生成中的那一屏一旦被刷新，
 *   那条 SSE 就断了，而 URL 上没有书号——因为书号是跑到最后一条 `book-ready`
 *   才知道的。所以必须在知道它的那一刻记一笔。
 *
 * ★ 记的**只有书号**：没有 key、没有孩子的名字、没有那句话。
 *   原 `CreateFlow` 里连页数一起记过，而页数是服务端清单里的事实
 *   （`book.json` 的 `tree.nodes.length`），客户端存一份就有两份会漂的真相。
 *
 * ★ **它不是找回草稿的唯一一条路，也不该被当成那条路。**
 *   `sessionStorage` 换台机器、开个新窗口、清了数据就没了——所以真正的入口是
 *   书架上那一排草稿（工单 03）。这一条只是"同一个标签页里少点两下"。
 *   哪天要把它升级成"跨会话续做"，该改的是**服务端记一个"最近在做"**，
 *   不是把这个 key 搬到 `localStorage` 上（那会变成一个没有主人的第二份状态）。
 */

export const LAST_RUN_KEY = 'once-upon-me:last-run'

/** 记住这一轮的书号。写失败（隐私模式、配额）不报错：它只是一条便利 */
export function rememberLastRun(bookId: string): void {
  try {
    sessionStorage.setItem(LAST_RUN_KEY, JSON.stringify({ bookId }))
  } catch {
    /* 没有第二份真相要维护，所以也没有第二份要清理 */
  }
}

/** 读回那一轮的书号。没有、或读不成 JSON → null（不猜） */
export function readLastRun(): string | null {
  try {
    const saved = sessionStorage.getItem(LAST_RUN_KEY)
    if (!saved) return null
    const parsed = JSON.parse(saved) as { bookId?: unknown }
    return typeof parsed.bookId === 'string' && parsed.bookId !== '' ? parsed.bookId : null
  } catch {
    return null
  }
}
