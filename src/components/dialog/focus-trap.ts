/**
 * focus-trap.ts —— 模态里的 Tab 该落在谁身上
 *
 * 这一层拆成"碰 DOM 的"与"纯的"两半，与 `lib/reading-path.ts` / `use-speech.ts`
 * 那条已经跑熟的分法一样：**决定**是纯函数（`wrapTabIndex`，node 里能测），
 * **找元素**是 DOM 查询（`focusablesIn`，只有浏览器能答）。
 *
 * 为什么 `aria-modal` 还不够：那一条是**说给读屏的**（"外面的东西别念"），
 * 它不是一个键盘约束。实测过的坏法很朴素——打开"设置"，连按四下 Tab，
 * 焦点就走到了遮罩后面的侧栏链接上；读屏仍然告诉用户"你在对话框里"，
 * 而那一句话已经从这一刻起不成立了。模态框的 Tab 必须自己绕回来。
 *
 * 三条取舍：
 *
 * 1. **只认能看见的。** `getClientRects().length === 0` 的元素（`display: none`、
 *    `visibility: hidden`、零尺寸）不算。不做这一步的坏法是"Tab 一下没反应"——
 *    焦点落到一个看不见的输入框上，而屏幕上什么都没有变。
 * 2. **`tabindex="-1"` 与 `disabled` 不算。** 前者是"程序能聚焦、键盘不该走到"
 *    （面板自己就是这一类，见 `Dialog` 的 `tabIndex={-1}`）；后者是浏览器的规矩。
 * 3. **不按序数猜，按 DOM 顺序。** 焦点顺序就是文档顺序；这个文件不做任何重排，
 *    重排是 `tabindex` 正数那套老做法的活，而它会把顺序变成两处真相。
 */

/** 能被 Tab 走到的那些元素。选择器本身只做粗筛，细的在 `focusablesIn` 里 */
const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button',
  'input',
  'select',
  'textarea',
  'iframe',
  '[contenteditable]',
  '[tabindex]',
].join(',')

/** `root` 里现在真能被 Tab 到的那一串，按文档顺序 */
export function focusablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    if (el.hasAttribute('disabled')) return false
    if (el.getAttribute('tabindex') === '-1') return false
    // 整个子树被读屏藏掉的东西，键盘也不该走进去（`.sr-only` 不在这一档：
    // 它是"看得见但只有一像素"，仍然算可见）
    if (el.closest('[aria-hidden="true"]')) return false
    return el.getClientRects().length > 0
  })
}

/**
 * 这一次 Tab / Shift+Tab，要不要**由我们**把焦点送到别处。
 *
 * `current` 是当前焦点在 `list` 里的下标；`-1` = 焦点不在列表里
 * （刚打开时在面板自己身上，或者跑到了遮罩上）。
 *
 * 返回下标 = "接住这一下，focus 到那个元素"；返回 `null` = "不是边界，浏览器自己走"。
 * 把"要不要接"与"focus 谁"放在同一个返回值里，是因为它们只有一个正确的组合——
 * 拆成两个函数就会出现"接住了但没送"的那一版。
 */
export function wrapTabIndex(count: number, current: number, shift: boolean): number | null {
  if (count <= 0) return null
  // 焦点在面板上（或在外面的哪个地方）：第一次 Tab 从头上走，Shift+Tab 从尾上走
  if (current < 0) return shift ? count - 1 : 0
  if (shift) return current === 0 ? count - 1 : null
  return current === count - 1 ? 0 : null
}
