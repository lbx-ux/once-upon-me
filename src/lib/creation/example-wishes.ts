/**
 * example-wishes.ts —— 主题墙那 12 格各自的那一句
 *
 * 这一份表里的句子是为人写的样例，不是从任何数据里算出来的数——
 *   界面上它们只出现在一处：主题墙的 12 张封面卡（`CreateLanding` 的 `.cl__wall`）。
 *   点一下就是把这句话填进输入框，用户可以照改。
 *   （与"统计卡上那个没出处的 6"不同类：那是一条主张，这是一句可改的输入。）
 *
 * 2026-10-18：「换一句」那颗骰子不再读这里（用户："现在这个随机选取并不是真正的
 *   随机，只是按顺序从下面 12 个主题里面选取"）。骰子改读一个 72 条的独立池子
 *   （`inspirations.ts`），池子里每条可以带主题、也可以不带。
 *   拆开的理由不是"表太大了"，是这两份表回答的是两个问题：
 *     这里回答"恐龙那一格点下去填哪句"（一问一答，而且图是配着这句话出的，
 *     所以它必须稳定、必须 12 个主题一个不缺）；池子回答"随便给我一句没见过的"。
 *   于是 `nextExample` 整条删掉了：它唯一的读者是骰子，而骰子现在是发牌
 *     （`drawInspiration`）。留一个没人读的函数，下一个改池子的人会漏改它。
 *
 * 每条都带一个 `theme`，而且是 `THEME_KEYS` 里真实存在的键：
 * 点主题卡进创作流时一起带上 `?theme=`，第 2 步的主题档就同步选中了。
 * 不带一个不存在的键（哪怕只差一个字）——`initialThemeKey` 找不到就不选，
 *   那会让"点了月亮那句、结果主题不是月亮"变成一条静默的错。
 */

import { THEME_KEYS, type ThemeKey } from '../themes.ts'

export type ExampleWish = { theme: ThemeKey; text: string }

/**
 * 十二个主题各配一句。句子按"孩子 + 一个具体动作 + 一个可见的东西"写，
 * 这是这个故事生成器真正吃得下的形状（一句"快乐"规划不出分镜）。
 *
 * 12 条全部出现在界面上：主题墙一格一条。
 *   原来这里还有一份"取三条做建议卡"的 `SUGGESTION_THEMES`——主题墙落地后它没有
 *   消费者了，整条删掉（留一份没人读的表，下一个改句子的人会漏改它）。
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

/** 主题墙那一格用哪一句：只按 `theme` 查，12 条全部有归属 */
export function ofTheme(theme: ThemeKey): ExampleWish | null {
  return EXAMPLE_WISHES.find((item) => item.theme === theme) ?? null
}

/** 表本身要与主题表同构：新增主题忘了配例句时，测试会红（见 example-wishes.test.ts） */
export function missingThemes(): ThemeKey[] {
  const covered = new Set(EXAMPLE_WISHES.map((item) => item.theme))
  return THEME_KEYS.filter((key) => !covered.has(key))
}
