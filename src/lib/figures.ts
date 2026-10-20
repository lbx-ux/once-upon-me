/**
 * figures.ts —— 输入框上方那 12 个「站着的小主角」的封闭表
 *
 * 形状与 `lib/themes.ts` / `lib/voices/state.ts` 的 `DEFAULT_VOICES` 同一条：
 * 一张写死的表 + 一个取路径的函数，别处不许自己拼 `/figures/`。
 *
 * key 直接复用主题的 key，不另发明一套编号：这 12 个人本来就是
 *   `public/art/{key}.webp` 那 12 张封面里的孩子走出来（提示词与出图记录见
 *   `docs/figure-art-prompts.md`）。两套 key 迟早会对不上，而对不上的表现是
 *   首页站着一个和下面封面无关的小孩——正是这一屏要证的反面。
 *   于是这里连 `FigureKey` 这个别名都不留：一个和 `ThemeKey` 一模一样的东西，
 *   多一个名字只多一处能写错的地方。
 *
 * 立绘只跟着主题走（2026-10-15 按用户要求定）：点哪张封面就站哪个孩子，
 *   没挑主题时站 `DEFAULT_FIGURE`。曾经还有"手动换人、手动值覆盖主题"那一套，
 *   连 `FigureProvider` / `figure-pref` / `FigurePicker` 一起删了；所以这个文件里
 *   没有存储、没有校验函数、没有可选项列表——那三样都是为那套覆盖机制长的，
 *   机制没了，它们各自就成了没有读者的代码（与 `make-webp.py` 里 `chip-icon`
 *   那一档被删掉是同一条纪律）。
 *
 * 页面元素里没有名字：显示的是主题名（「恐龙」「鲸鱼」）。给 12 个人物起名是一个
 *   内容动作，要单独一单；不先编一个，理由与 `/home` 那颗胶囊同一条——名字读不到就
 *   退回机器名，不编一个好听的说（出处见 `lib/children-source.ts`）。
 *
 * 这批图是 UI 装饰，不进引擎：不在 `lib/engine/` 里出现、不进清单与指纹
 *   （ADR-0007 那条"画的与查的同源"讲的是角色卡参考图，不是这 12 张），
 *   也不往 `/create` 的 URL 上挂参数——它改的是这一屏站着谁，不改生成出来的书。
 */

import { THEME_KEYS, type ThemeKey } from '@/lib/themes.ts'

/**
 * 没挑主题时站着的那一个。
 * 取 `THEME_KEYS[0]`（`dino`）而不是另指一个：这张表的顺序与主题墙的排列顺序
 * 是同一条（见 `themes.ts` 文件头），第一个就是左上角那张，看得见。
 */
export const DEFAULT_FIGURE: ThemeKey = THEME_KEYS[0]

/** 立绘资源。★ 静态 `public/`，不走 `/api/assets?w=`（那条通路读不到查询串，见 docs/known-tradeoffs.md） */
export function figurePath(key: ThemeKey): string {
  return `/figures/${key}.webp`
}
