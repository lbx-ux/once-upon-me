import Link from 'next/link'

import StorybookFlip from '@/components/book/StorybookFlip'
import BackToTop from '@/components/BackToTop'
import HeroOrbit from '@/components/hero/HeroOrbit'
import HeroTypewriter, { type TypewriterLine } from '@/components/hero/HeroTypewriter'
import HighlightsReel from '@/components/highlights/HighlightsReel'
import SceneBackdrop from '@/components/scene/SceneBackdrop'
import StartCreating from '@/components/hero/StartCreating'
import { THEMES, artPath } from '@/lib/themes'

/**
 * 首页 —— 12 张绘本封面的 3D 环形轨道 + 第二屏的滚动翻页绘本 + 第三屏的项目亮点
 *
 * 结构由组件自己渲染，这里只负责组装：
 *   0. <SceneBackdrop /> —— 全页背景：三幕场景靠长交叉溶解连起来（清晨天光 /
 *      午后草坡 / 夜晚台灯下的书桌），随滚动换幕
 *   1. 首屏：把 THEMES 映射成轨道条目，封面走 public/art/{key}.webp（静帧）
 *   2. 中心文案 —— 三层
 *   3. 第二屏 —— <StorybookFlip />：一本一页页翻开的书，中途能替孩子做一次选择
 *   4. 第三屏 —— <HighlightsReel />：五条亮点，回答"凭什么做得出来"
 *   5. <BackToTop /> —— 全页浮层，滚过首屏才出现的"回到页首"
 *
 * ★ 三层的顺序是有约束的：hero-orbit.css 用 `.hero__copy > *:nth-child(2..4)`
 *   写死了入场动画的延迟与离场错峰（§5）。层级或顺序一变，动画节奏就得跟着改。
 *
 * 主张句与副句已合并成一行轮流打字（HeroTypewriter），省出一整行竖向空间。
 * min-width 兜底见 globals.css 的 .home-hero。
 */

/**
 * 12 张封面 → 轨道条目
 *
 * 只有静帧。这一屏曾经是 12 段 4 秒短片（`preload="none"`、只有转到前排的至多 4 张才播、
 * 首屏实际拉流约 1 MB），换回静帧的理由与实测见 README §五「首屏卡片是静帧不是短片」。
 */
const orbitItems = THEMES.map((theme) => ({
  src: artPath(theme.key),
  alt: theme.label,
}))

/**
 * 轮流打的两句。加粗的词不是修辞，是三个可验证的产品机制：
 * 以他开头 / 以他为主角 / 你的声音
 *
 * 必须是模块级常量 —— 数组身份每帧变一次的话，HeroTypewriter 的 effect 会不停
 * 重建计时器，永远打不完一句。
 */
const HERO_LINES: TypewriterLine[] = [
  {
    runs: [{ text: '每个孩子的故事，都值得' }, { text: '以他开头', strong: true }],
  },
  {
    runs: [
      { text: '说出孩子的名字和爱好，得到一本' },
      { text: '以他为主角', strong: true },
      { text: '、用' },
      { text: '你的声音', strong: true },
      { text: '朗读的定制绘本' },
    ],
    holdMs: 3600, // 这句长一倍，停留也给久一点
  },
]

export default function HomePage() {
  return (
    <>
      {/* --------------------------------------------------------------------
          页面级背景：三幕场景 + 长交叉溶解（方案三）。

          放在最前 = 层序在最下（三节各自是 z-index 0 或 1，见各节 CSS）；
          背景层自己写 z-index: 0，靠 DOM 顺序让三节压在它上面。
          它是满屏 fixed，所以首屏必须把底色让出来 —— 见下面 HeroOrbit 的
          backdrop="none" 与 hero-orbit.css 那一条。

          权重怎么算、为什么按"幕中心距视口中心"算而不是按总进度，
          见 components/scene/SceneBackdrop.tsx 文件头三条。
          -------------------------------------------------------------------- */}
      <SceneBackdrop />

      <HeroOrbit items={orbitItems} className="home-hero" backdrop="none">
        <h1 className="hero__brand">
          <span className="hero__brand-cn">
            {/* 装饰性图形：旁边的「小主角」三个字已经是名字，屏读不该再念第二遍，所以 alt 留空。
                暂用原生 <img>，与 HeroOrbit 一致 —— next/image 的迁移按 README 的未做清单统一做。 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="mark" src="/brand/mark.webp" alt="" width={560} height={560} />
            小主角
          </span>
          <span className="sep" aria-hidden="true">
            ·
          </span>
          <span className="serif">Once Upon Me</span>
        </h1>

        <HeroTypewriter lines={HERO_LINES} />

        <div className="hero__cta">
          {/* ★ 这两个按钮从 W1 起就是死的（`<button>` 没有 handler，两条 TODO 都过期了），
              用户报的"点开始创作进不去"就是这里。现在接上：创作流与阅读器都建好了。
              主页 `/home` 做出来后，第一个要改指 `/home`（见 .scratch/app-restructure/issues/06）。 */}
          {/* ★「开始创作」现在是一颗客户端组件（`components/hero/StartCreating.tsx`）：
              它除了指路，还负责**退场**与那一次跨页接力（环上那 12 张 → 主页的主题墙），
              理由与五条判断写在那个文件头上。渲染出来仍然是一颗真 `<Link href="/home">`。
              「看一本成品」不用接力：书单那 12 张封面与首屏这个环没有任何几何对应。 */}
          <StartCreating />
          {/* ★ 2026-10-17 改指 `/booklist`（用户的口径：这一颗通向**灵感书单**那一页）。
              原来指 `/reader/xiaoyu-r1-4fe055c5723b`——`public/demo/books/` 里那本预生成
              演示书（ADR-0003），它还在、也还能读，只是不再由这一颗带路：
              书单那 12 本本身就是"成品"的橱窗，进去哪一本都能整本翻，比只给一本更能说明
              "做出来长什么样"。入口在 `(studio)` 里，未登录也照样打得开（那组的 layout
              不设闸，只有侧栏底部那格会显示「请登录」）。 */}
          <Link className="btn btn--ghost" href="/booklist">
            看一本成品
          </Link>
        </div>
      </HeroOrbit>

      {/* --------------------------------------------------------------------
          第二屏：滚动翻页绘本。

          首屏回答"能做什么"（12 个不同的孩子），这一节回答产品真正的承诺 ——
          「每一页都是同一个他」。论点不靠文字说，靠翻给人看：
          同一本《小宇的云》四个跨页，中途停下来让孩子选一次往哪朵云去。

          区间、叠入量与叶模型见 components/book/storybook-flip.css 顶部。
          -------------------------------------------------------------------- */}
      <StorybookFlip />

      {/* --------------------------------------------------------------------
          第三屏：项目亮点。

          前两屏让人**相信这个产品存在**（12 个不同的孩子 + 一本翻开的书），
          这一屏回答的是下一个问题：凭什么做得出来。五条，全部来自 README
          已定稿的设计与周计划 —— 卡上只讲机制与做法，排期留在 README 的进度表里。

          视觉上是首屏那个环的压平版（同样的近大远小、后排糊、陶土色只点两处）。
          GSAP 只用在这一屏，前两屏的滚动驱动仍是 useScrollDriver，理由见
          components/highlights/HighlightsReel.tsx 文件头与 README §五。
          -------------------------------------------------------------------- */}
      <HighlightsReel />

      {/* 全页浮层：三屏加起来约 6 屏滚动量，滚到底想回头看第一屏不该一路往上拽。 */}
      <BackToTop />
    </>
  )
}
