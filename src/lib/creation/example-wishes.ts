/**
 * example-wishes.ts —— 工作台「创作」那一屏给的几句**示例愿望**
 *
 * ★ 这一份表里的句子是为人写的样例，不是从任何数据里算出来的数——
 *   界面上它们出现在输入框的占位、灵感按钮与三张建议卡里，
 *   点一下就是把这句话填进输入框，用户可以照改。
 *   （与"统计卡上那个没出处的 6"不同类：那是一条主张，这是一句可改的输入。）
 *
 * 每条都带一个 `theme`，而且是 `THEME_KEYS` 里真实存在的键：
 * 点建议卡进创作流时一起带上 `?theme=`，第 2 步的主题档就同步选中了。
 * ★ 不带一个不存在的键（哪怕只差一个字）——`initialThemeKey` 找不到就不选，
 *   那会让"点了月亮那句、结果主题不是月亮"变成一条静默的错。
 */

import { THEME_KEYS, type ThemeKey } from '../themes.ts'

export type ExampleWish = { theme: ThemeKey; text: string }

/**
 * 十二个主题各配一句。句子按"孩子 + 一个具体动作 + 一个可见的东西"写，
 * 这是这个故事生成器真正吃得下的形状（一句"快乐"规划不出分镜）。
 */
export const EXAMPLE_WISHES: readonly ExampleWish[] = [
  { theme: 'dino', text: '小恐龙第一次离开家，走进会下雨的森林' },
  { theme: 'paint', text: '她把天空涂成了绿色，结果真的飞起来了' },
  { theme: 'rocket', text: '用纸箱做的一枚火箭，数到三就出发' },
  { theme: 'bird', text: '一只学不会飞的小鸟，决定先学会走路' },
  { theme: 'star', text: '他和爸爸爬上屋顶，数哪一颗是星星' },
  { theme: 'moon', text: '朵朵抱着月亮，轻轻走过屋顶' },
  { theme: 'whale', text: '海边捡到的一根鲸鱼胡须，其实是一扇门' },
  { theme: 'castle', text: '沙堡造了又塌，这次他叫上了所有人' },
  { theme: 'cloud', text: '那朵云一会儿像狗，一会儿像一碗面' },
  { theme: 'flower', text: '窗台那颗种子发芽了，他每天跟它说一句话' },
  { theme: 'turtle', text: '慢吞吞的小乌龟，赶去看最后一班月亮' },
  { theme: 'balloon', text: '坐着气球飞上天空的午后，他分了一个气球给风' },
] as const

/** 三张建议卡用哪几条。★ 手动挑，不按"取前三条"：前三条是恐龙/画画/火箭，
 *  连在一起看像同一类；这三句一静一动一睡前，能看出这一屏能做三种故事 */
export const SUGGESTION_THEMES: readonly ThemeKey[] = ['moon', 'turtle', 'balloon']

export function suggestions(): ExampleWish[] {
  return SUGGESTION_THEMES.map((theme) => ofTheme(theme)).filter(
    (item): item is ExampleWish => item !== null,
  )
}

export function ofTheme(theme: ThemeKey): ExampleWish | null {
  return EXAMPLE_WISHES.find((item) => item.theme === theme) ?? null
}

/** 灵感按钮：给一个索引，回一条。循环而不是随机，是因为随机会连着给同一条 */
export function nextExample(index: number): ExampleWish {
  const i = ((index % EXAMPLE_WISHES.length) + EXAMPLE_WISHES.length) % EXAMPLE_WISHES.length
  return EXAMPLE_WISHES[i] as ExampleWish
}

/** 表本身要与主题表同构：新增主题忘了配例句时，测试会红（见 example-wishes.test.ts） */
export function missingThemes(): ThemeKey[] {
  const covered = new Set(EXAMPLE_WISHES.map((item) => item.theme))
  return THEME_KEYS.filter((key) => !covered.has(key))
}
