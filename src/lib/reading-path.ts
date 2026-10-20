/**
 * reading-path.ts —— 这一本书，孩子上次选了哪一支（工单 07）
 *
 * 共读版有一棵带岔路的树，而 `StoryNode.pathFromRoot` 是静态的那一半：
 * "从根到这一页要经过谁"。孩子这一次选了哪一支是运行时状态——书里没有它，
 * 也不该有它。这个模块就是那一份状态的家。
 *
 * 四条不显然的约定，每条都对应一个真会发生的事
 *
 * 1. 只存"选了哪一支"，不存整条路径。 路径由树推得出来（`reader-model.ts` 的
 *    `storyPath`），存两份就是两个真相——而它们漂移的那天，孩子看到的是"按着 B
 *    却走进 A 支"，书上没有任何东西提示这件事。
 * 2. ★ 不进 `book.json`。 产物是引擎写的：`AssetRef.digest` 与"这本书是什么"
 *    的所有判据都建立在"清单不会被读的行为改写"之上。翻一页就改一次清单，
 *    还会让"这本书是从服务器同步下来的"这件事失去意义（那条路上没有读者）。
 *    而且它是这台设备的这个浏览器里的东西，与阅读记录同性质（规则见
 *    `reading-log.ts` 文件头第 2 条）：换机器、清缓存就回到"没选过"。
 * 3. 认不出来的一律退回"没选过"（`parsePick`）。存储里的值不一定是自己写的：
 *    可能是上一版的格式、可能被人手动改过、也可能只剩半截。退回"没选过"在这里是
 *    安全的方向：孩子会照常看到那个岔口、重新选一次——而不是被一个看不懂的值
 *    带到某一支上去（那才是"孩子没选，书自己替他选了"）。
 * 4. **存的是 `''` / `'a'` / `'b'` 三个字面量之一**（`''` = 没选过，与
 *    `schemas/story.ts` 里 `via` 的缺省拼法一致）。不是 JSON、不是布尔：
 *    这一层要回答的问题是"走了哪一边"，而两个字母就是它的全部答案。
 *    读的时候 `''` 与"这个键根本不在"是同一件事（都是没选过）——它们都退到 `null`。
 *
 * 纯的一层与碰盘的一层分开
 *
 * 照 `reading-log.ts` / `reading-prefs.ts` 那条已经跑通的分法：解析是纯函数、可测
 * （vitest 是 `environment: 'node'`，那里没有 `localStorage`）；只有 `load/save`
 * 碰 `localStorage`，而且两边都接住异常——读不到就当没选过、存不下就只在这一次
 * 会话里生效。不许因为一个记忆读不出来就让阅读这件事本身出问题。
 */

/** 存储键的前缀。★ 与 `xiaozhujue.reading.v1`（记录）、`xiaozhujue.reader.turn`（偏好）
 *  同一个名字空间——它是这一族的第四样东西，不是新开的一族
 */
export const READING_PATH_PREFIX = 'xiaozhujue.reader.path.'

/**
 * 一本书一个键：同一台设备上，两本书的选择互不影响。
 * ★ 键里带书号而不是"一个全局的 lastPick"：全局键的症状是"打开 B 书时按着 A 书的选择"
 *   ——而两本书的岔路内容完全不同，那个错看起来像"书的记忆串了"，很难指认到这一层。
 */
export function readingPathKeyOf(bookId: string): string {
  return `${READING_PATH_PREFIX}${bookId}`
}

/** 走的是哪一边。★ 与 `components/reader/reader-model.ts` 的 `Pick` 差一个 null：
 *  那个是界面上的 state（`null` = 还没选），这个是"存过什么"的答案。
 */
export type PickedBranch = 'a' | 'b'

/**
 * 存储里那串字 → 选了哪一支（`null` = 没选过）。
 * 只有 `'a'` 与 `'b'` 两个字面量作数，其余（`''`、`'c'`、`'A'`、半截 JSON、
 *   `null`）一律 `null`——理由见文件头第 3 条。
 */
export function parsePick(raw: string | null): PickedBranch | null {
  return raw === 'a' || raw === 'b' ? raw : null
}

/** 这一本书上次选了哪一支。没选过、读不到、存的东西坏了 —— 都是 `null` */
export function loadPick(bookId: string): PickedBranch | null {
  if (typeof window === 'undefined') return null
  try {
    return parsePick(window.localStorage.getItem(readingPathKeyOf(bookId)))
  } catch {
    // 隐私模式 / 禁用了存储：读不到就当没选过，书照常能读（只是那个岔口要重选一次）
    return null
  }
}

/**
 * 记住了：走了这一边。
 * 丢的动作永远是覆盖（改选就是覆盖），没有"清除"这一个动作——
 *   界面上没有"我把上次的选择忘掉"这件事，而多一个没人调的 `clearPick` 就是
 *   给下一个人一个"也许该用它"的假线索（`reader-model.ts` 的 `pressedOf` 那条是同一个教训）。
 */
export function savePick(bookId: string, branch: PickedBranch): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(readingPathKeyOf(bookId), branch)
  } catch {
    // 配额满或隐私模式：这一次会话里照样按选的那一支读，只是下次打开要重选
  }
}
