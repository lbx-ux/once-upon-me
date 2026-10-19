/**
 * rotate-hint.ts —— 「把手机横过来」那层提示**还问不问**
 *
 * 2026-10-19 移动端适配加的。手机上竖屏读一本 3:2 的绘本时，一跨页只有 179px 半页宽、
 * 正文约 11 字一行（那两条数是量出来的，见 `docs/known-tradeoffs.md` 的「手机横屏阅读」）。
 * 横过来之后书按**视口高**铺满，是另一个量级。所以进阅读器时压一层提示，
 * 而**它必须能关掉**：不转手机的人本来就看得见竖屏那一版，遮罩挡着只会让人以为坏了。
 *
 * ★ 三条不显然的约定，每条都对着一次会真发生的事：
 *
 * 1. **只有 `'off'` 这一个字面量能关掉提示**，认不出来的一律 `ask`。
 *    存储里的东西不一定是自己写的（上一版的格式 / 被人手动改过 / 只剩半截）。
 *    退回的方向是**继续问**——猜成"关掉"的后果是有人**永远看不到**那个提示，
 *    而他不知道自己在找什么。与 `reading-prefs.ts` 那条"猜成 auto 会让书半夜自己念"
 *    同一条推理：退回**不变**，而不是退回另一个行为。
 *
 * 2. **它是「这台设备的这个人」，不是「这一本书」**。不用 `reading-path.ts` 那种
 *    一本书一个键的做法：那个人不想转手机这件事与他翻开的是哪一本无关，
 *    而按书存的话他每一本都要关一次。
 *
 * 3. **纯的一层与碰盘的一层分开**（照 `reading-log.ts` / `reading-prefs.ts` 那条
 *    已经跑通的分法）：解析是纯函数、可测（vitest 是 `environment: 'node'`，
 *    那里没有 `localStorage`）；只有 `load/save` 碰盘，两边都接住异常。
 *    ★ 读不到就继续问、存不下就只在这次会话里生效——**不许**因为一个偏好读不出来
 *    就让阅读这件事本身出问题。
 */

/**
 * 存储键。★ 与 `xiaozhujue.reader.turn`（翻页方式）、`xiaozhujue.reader.paper`（底图）、
 * `xiaozhujue.reader.path.*`（选了哪一支）同一个名字空间 —— 它是这一族的第五样东西，
 * 不是新开的一族。
 */
export const ROTATE_HINT_KEY = 'xiaozhujue.reader.rotate'

/** `ask` = 竖屏时提示（默认）；`off` = 不提示 */
export type RotateHintMode = 'ask' | 'off'

export const DEFAULT_ROTATE_HINT: RotateHintMode = 'ask'

/** 存储里那串字 → 还问不问。★ 认不出来一律 `ask`（见文件头第 1 条） */
export function parseRotateHint(raw: string | null): RotateHintMode {
  return raw === 'off' ? 'off' : 'ask'
}

export function loadRotateHint(): RotateHintMode {
  if (typeof window === 'undefined') return DEFAULT_ROTATE_HINT
  try {
    return parseRotateHint(window.localStorage.getItem(ROTATE_HINT_KEY))
  } catch {
    // 隐私模式 / 禁用了存储：读不到就继续问，阅读本身照常
    return DEFAULT_ROTATE_HINT
  }
}

export function saveRotateHint(mode: RotateHintMode): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(ROTATE_HINT_KEY, mode)
  } catch {
    // 配额满或隐私模式：这一次会话里照样生效，只是下次打开要再关一遍
  }
}
