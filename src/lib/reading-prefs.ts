/**
 * reading-prefs.ts —— 阅读偏好：独读版翻页这件事**交给谁**
 *
 * 用户 2026-10-17 要的那个设置项。两个答案：
 *
 * · `manual`（**默认**）—— 点一下「朗读」只念当前这一页，念完就停，页由人翻。
 *   这就是这一版之前**唯一**的行为，所以它是默认值：一个偏好项不该顺手改掉
 *   任何人的既有体验。
 * · `auto` —— 在阅读器里按一次「自动朗读」，之后一页页自己念、念完自己翻。
 *
 * ★ 三条不显然的约定，每条都对应一次会真发生的事：
 *
 * 1. **只有 `'auto'` 这一个字面量能打开自动**。
 *    存储里的东西不一定是自己写的：可能是上一版的格式、可能被人手动改过、
 *    也可能只剩半截。`parseTurnMode` 对一切不认识的值一律退回 `manual`——
 *    "看不懂就当没设置过"在这里是安全的方向（退回的是**不变**，
 *    而猜成 auto 会让一本书在半夜自己念起来）。
 *
 * 2. **它只活在这台设备的这个浏览器里**（`localStorage`），与阅读记录
 *    （`reading-log.ts`）同一性质：换机器、清缓存就回到默认。所以设置弹窗里
 *    **必须写明这一点**——不写明，它看起来就像账号数据。
 *    与 `xiaozhujue.reading.v1` 分开两个键、各用一个名字空间：
 *    一份是"读了多久"的记录，一份是"怎么读"的偏好，寿命与清空时机都不一样。
 *
 * 3. **纯的一层与碰盘的一层分开**（照 `reading-log.ts` 那条已经跑通的分法）：
 *    解析是纯函数、可测；只有 `load/save` 碰 `localStorage`，而且两边都接住异常。
 *    ★ 读不到就用默认、存不下就只在这次会话里生效——**不许**因为一个偏好读不出来
 *    就让阅读这件事本身出问题。
 */

/** 存储键。★ 与 `xiaozhujue.reading.v1`（阅读记录）分开：两件事，两个寿命 */
export const TURN_MODE_KEY = 'xiaozhujue.reader.turn'

/** 翻页由谁做。`manual` = 现状，也是默认 */
export type TurnMode = 'manual' | 'auto'

export const DEFAULT_TURN_MODE: TurnMode = 'manual'

/**
 * 存储里那串字 → 翻页方式。
 * ★ 认不出来的一律 `manual`（见文件头第 1 条）：宁可不生效，也不要猜出一个
 *   "书自己念起来"的结果。
 */
export function parseTurnMode(raw: string | null): TurnMode {
  return raw === 'auto' ? 'auto' : 'manual'
}

export function loadTurnMode(): TurnMode {
  if (typeof window === 'undefined') return DEFAULT_TURN_MODE
  try {
    return parseTurnMode(window.localStorage.getItem(TURN_MODE_KEY))
  } catch {
    // 隐私模式 / 禁用了存储：读不到就用默认，阅读本身照常
    return DEFAULT_TURN_MODE
  }
}

export function saveTurnMode(mode: TurnMode): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(TURN_MODE_KEY, mode)
  } catch {
    // 配额满或隐私模式：这一次会话里照样生效，只是下次打开要重选
  }
}
