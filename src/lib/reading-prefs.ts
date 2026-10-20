/**
 * reading-prefs.ts —— 阅读偏好：翻页这件事**交给谁**
 *
 * 用户 2026-10-17 要的那个设置项。两个答案：
 *
 * · `manual`（**默认**）—— 点一下「朗读」只念当前这一页，念完就停，页由人翻。
 *   这就是这一版之前**唯一**的行为，所以它是默认值：一个偏好项不该顺手改掉
 *   任何人的既有体验。
 * · `auto` —— 在阅读器里按一次「自动朗读」，之后一页页自己念、念完自己翻。
 *
 * ★ 2026-10-20：这条偏好**落两个键、两档各一份**。
 *   独读版（睡前自己听）与共读版（白天陪玩、中间要孩子选一支）是两种用法，
 *   一条偏好顺手改掉另一档不是我们要的——所以设置弹窗里是**两节**，
 *   这里就是两个键。自动那一条在两档里的走法也不同（共读版会在选择点上停下来、
 *   把选项念给孩子听，见 `components/reader/use-narration.ts`）。
 *   ★ **不把老的 `xiaozhujue.reader.turn` 改名成 `.solo`**：改名的代价是所有已经
 *     选过自动朗读的人被静默退回默认，而收益只是键名好看。老键继续管独读版。
 *   ★ `parseTurnMode` **两档共用一份**：认哪个字面量是同一个判断，复制一份出来
 *     就会出现"同一个人在两种形态里被判成不同答案"这种没人查得出来的坏法。
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

/** 独读版那一档的存储键。★ 老名字里没有 `solo`：它比"两种形态"早一天存在 */
export const TURN_MODE_KEY = 'xiaozhujue.reader.turn'

/**
 * 共读版那一档的存储键（2026-10-20）。
 * ★ 与上面那个**是两件事**：两档可以各选各的（设置弹窗里也是两节）。
 */
export const SHARED_TURN_MODE_KEY = 'xiaozhujue.reader.turn.shared'

/** 翻页由谁做。`manual` = 现状，也是默认 */
export type TurnMode = 'manual' | 'auto'

export const DEFAULT_TURN_MODE: TurnMode = 'manual'

/**
 * 存储里那串字 → 翻页方式。**两档共用这一份**（见文件头那条）。
 * ★ 认不出来的一律 `manual`（见文件头第 1 条）：宁可不生效，也不要猜出一个
 *   "书自己念起来"的结果。
 */
export function parseTurnMode(raw: string | null): TurnMode {
  return raw === 'auto' ? 'auto' : 'manual'
}

/** 按某个键读一次。★ 读不到（没存过、隐私模式、存储被禁）一律默认值 */
function loadMode(key: string): TurnMode {
  if (typeof window === 'undefined') return DEFAULT_TURN_MODE
  try {
    return parseTurnMode(window.localStorage.getItem(key))
  } catch {
    // 隐私模式 / 禁用了存储：读不到就用默认，阅读本身照常
    return DEFAULT_TURN_MODE
  }
}

/** 按某个键写一次。★ 写不下就只在这次会话里生效，绝不抛出去 */
function saveMode(key: string, mode: TurnMode): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, mode)
  } catch {
    // 配额满或隐私模式：这一次会话里照样生效，只是下次打开要重选
  }
}

/** 独读版那一档（`/reader/<bookId>` 与灵感书单那本样书） */
export function loadTurnMode(): TurnMode {
  return loadMode(TURN_MODE_KEY)
}

export function saveTurnMode(mode: TurnMode): void {
  saveMode(TURN_MODE_KEY, mode)
}

/** 共读版那一档（`form === 'shared'` 的那本书，同一个阅读器） */
export function loadSharedTurnMode(): TurnMode {
  return loadMode(SHARED_TURN_MODE_KEY)
}

export function saveSharedTurnMode(mode: TurnMode): void {
  saveMode(SHARED_TURN_MODE_KEY, mode)
}
