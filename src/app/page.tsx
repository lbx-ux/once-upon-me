import Link from 'next/link'

import StorybookFlip from '@/components/book/StorybookFlip'
import BackToTop from '@/components/BackToTop'
import HeroOrbit from '@/components/hero/HeroOrbit'
import HeroTypewriter, { type TypewriterLine } from '@/components/hero/HeroTypewriter'
import HighlightsReel from '@/components/highlights/HighlightsReel'
import SceneBackdrop from '@/components/scene/SceneBackdrop'
import IcpNotice from '@/components/site/IcpNotice.tsx'
import StartCreating from '@/components/hero/StartCreating'
import { readDemoBookAudio } from '@/lib/demo-book-audio'
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
 * 三层的顺序是有约束的：hero-orbit.css 用 `.hero__copy > *:nth-child(2..4)`
 *   写死了入场动画的延迟与离场错峰（§5）。层级或顺序一变，动画节奏就得跟着改。
 *
 * 主张句与副句已合并成一行轮流打字（HeroTypewriter），省出一整行竖向空间。
 *
 * 2026-10-18：这一页从纯静态变成要读一次盘 —— 第二屏那本书的朗读在不在，
 *   只有服务端知道（`lib/demo-book-audio.ts` 问 `public/book/`，判据与书单那 12 本
 *   同一条）。读盘不是动态 API，构建期问一次就够，这一页仍然是静态产物。
 *   它决定的只有一件事：朗读控件出不出现（5 段全在才出，判据 ①）。
 *
 * 2026-10-19 手机那一档是两节，不是三节
 *
 * 用户在这一天先说了「直接给上面的 12 个主题删了，还有第二屏的示例绘本，
 * 这个也不要了，删了，就留第一屏的标题和第三部分的亮点」，看到落地之后补了一句：
 * 「我只让你删的是移动段的，没让你删 web 端的首页啊，web 端的首页和以前一样」。
 *
 * 两句合起来才是口径：手机两节（标题 → 亮点），web 三节（环 → 书 → 亮点）。
 * 所以这一页的 DOM 与 2026-10-18 那一版逐字相同，两节的形态统统由 CSS 决定：
 *   · 环在手机那一档 `display: none` —— `hero-orbit.css` §6；
 *   · 这本书在手机那一档 `display: none` —— `storybook-flip.css` §8；
 *   · 手机上顶替环的那条横向卡带（`ThemeStrip`）没有回来：它是手机专属的形态，
 *     而手机这一档现在连主题都不演了。
 * 手机那一档不白下带宽是有账的（12 张封面是 `<img>`、书页是 CSS 背景，
 *   规则不一样），两条注释分别在 `HeroOrbit.tsx` 与 `storybook-flip.css` §8。
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

export default async function HomePage() {
  /* 第二屏那本书的朗读在不在盘上。★ 它是服务端的事（要 readdir），
     所以在这一层问完再递下去；翻页组件那头收到的是算好的 URL 列表。 */
  const bookAudio = await readDemoBookAudio()

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

          朗读（`bookAudio`）2026-10-18 接上：5 段都在盘上时，这一节左下角那颗
          "▶ 朗读"才真的响得起来 —— 取舍见 README §五，逐字稿见
          docs/demo-narration-script.md。

          ★ 手机那一档（≤640）这一节整节不出现，见 storybook-flip.css §8。

          区间、叠入量与叶模型见 components/book/storybook-flip.css 顶部。
          -------------------------------------------------------------------- */}
      <StorybookFlip audio={bookAudio} />

      {/* --------------------------------------------------------------------
          第三屏：项目亮点。

          前两屏让人**相信这个产品存在**（12 个不同的孩子 + 一本翻开的书），
          这一屏回答的是下一个问题：凭什么做得出来。五条，全部来自 README
          已定稿的设计 —— 卡上只讲机制与做法，不写排期。

          视觉上是首屏那个环的压平版（同样的近大远小、后排糊、陶土色只点两处）。
          GSAP 只用在这一屏，前两屏的滚动驱动仍是 useScrollDriver，理由见
          components/highlights/HighlightsReel.tsx 文件头与 docs/known-tradeoffs.md。
          ★ 手机那一档这一屏换成**竖排五张全宽卡**（`highlights-reel.css` §11），
            于是它也是手机上首页的第二节、也就是最后一节。
          -------------------------------------------------------------------- */}
      <HighlightsReel />

      {/* 全页浮层：三屏加起来约 6 屏滚动量，滚到底想回头看第一屏不该一路往上拽。
          （手机上两节短得多，"滚过首屏才出现"这条门槛仍然成立。） */}
      <BackToTop />

      {/* 备案号（2026-10-28）：法规要求站内展示并链到工信部备案系统。
          ★ 位置在 `BackToTop` 之后、也就是整个文档的最末：它是"网站底部"，
            而 `BackToTop` 是浮层（`position: fixed`），不受文档流影响。
          ★ 它是这一页**唯一**一处会改变文档总高的新增块（约 60px），而第三屏用
            `enter-exit` 量程、最后一节的量程会被 `docScrollHeight` 夹一道
            （`useScrollDriver.ts` 的 `enterExitSpan`）。所以这一笔上线前量过：
            文档总高与亮点那一节的真实量程，改前改后的差写在
            `docs/known-tradeoffs.md`「手机横屏」那一节之后的新条目里。 */}
      <IcpNotice className="icp--home" />
    </>
  )
}
