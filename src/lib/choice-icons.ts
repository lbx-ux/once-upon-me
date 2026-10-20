/**
 * choice-icons.ts —— 选择点图标：`iconKey` → 地址，只有这一处
 *
 * 与 `components/highlights/highlights.ts` 的 `artPath()` 同一个形状，
 * 理由也是同一条：`iconKey` 有两个来源（模型写进故事表、家长在闸门那屏改），
 * 而"哪几个 key 盘上有图"这件事只能有一个判据——`engine/domain.ts` 的 `CHOICE_ICONS`。
 *
 * 没有图不是错误，是一件常态：`hasChoiceIcon` 说"这一个有图"，
 *   没有图的时候调用方拿 `null`，界面上露出 `emoji` 那一档（`ChoiceOption.emoji`）。
 *   所以这个函数不抛、也不回一个指向 404 的地址——回一个 404 的地址
 *   会让 `<img>` 静静地什么都不画，而那与"本来就没有图"在屏幕上分不出来。
 *
 * 落盘位置沿用 `ChoiceOption.iconKey` 注释里那句话：`choice-{key}.webp`。
 *   首页第二屏那两枚（`choice-dino` / `choice-ship`）就是这个命名，所以
 *   `CHOICE_ICONS` 里前两个落地第一天就有图，其余按 ticket 02 出。
 *
 * ★ 2026-10-18：这一行原来是 `@/lib/engine/domain.ts`（别名），而这一条链
 *   （`book-source.ts` → 这里）是 `scripts/export-demo-book.mts` 要走的——
 *   node 直接跑 `.mts` 时不认 tsconfig 的 `paths`，症状是
 *   `Cannot find package '@/lib'`，整个导出演示书的路当场断掉（工单 08 实测撞到）。
 *   `src/lib/**` 里对着引擎叶子模块一律用**相对路径**（`story-problems.ts`、
 *   `story-shape.ts` 都是这么写的），别名留给 `src/components/**`。
 */
import { hasChoiceIcon } from './engine/domain.ts'

/** 图标所在的静态目录。与 `public/book/` 下那两枚同处——它们是同一个批次的东西 */
const CHOICE_ICON_DIR = '/book'

/**
 * 这个 key 的图标地址；盘上没有就 `null`（调用方据此决定露 emoji）。
 *
 * 参数收 `string` 而不是 `ChoiceIcon`：值是模型写的，它可以是词表之外的任何东西
 *   （`'dinosaur-back'`、`'恐龙背'`）。见 `hasChoiceIcon` 那段注释。
 */
export function iconUrlOf(key: string | undefined): string | null {
  if (key === undefined || key.trim() === '') return null
  const trimmed = key.trim()
  if (!hasChoiceIcon(trimmed)) return null
  return `${CHOICE_ICON_DIR}/choice-${trimmed}.webp`
}
