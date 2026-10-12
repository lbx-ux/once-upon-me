import HeroOrbit from '@/components/hero/HeroOrbit'
import HeroTypewriter, { type TypewriterLine } from '@/components/hero/HeroTypewriter'
import { THEMES, artPath } from '@/lib/themes'

/**
 * 首页 —— 12 张绘本封面的 3D 环形轨道
 *
 * 结构由 HeroOrbit 组件自己渲染（.hero-experience > .hero > 背景 + 轨道 + 文案层），
 * 这里只负责两件事：
 *   1. 把 THEMES 映射成轨道条目，图片走 public/art/{key}.webp
 *   2. 中心文案 —— 三层
 *
 * ★ 三层的顺序是有约束的：hero-orbit.css 用 `.hero__copy > *:nth-child(2..4)`
 *   写死了入场动画的延迟（§5）。层级或顺序一变，动画节奏就得跟着改。
 *
 * 主张句与副句已合并成一行轮流打字（HeroTypewriter），省出一整行竖向空间。
 * min-width 兜底见 globals.css 的 .home-hero。
 */

/** 12 张封面 → 轨道条目 */
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
    <HeroOrbit items={orbitItems} className="home-hero">
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
        {/* TODO: 创作流程做出来后换成指向 /create 的 Link */}
        <button className="btn" type="button">
          开始创作 →
        </button>
        {/* TODO: 阅读器做出来后换成指向成品示例的 Link */}
        <button className="btn btn--ghost" type="button">
          看一本成品
        </button>
      </div>
    </HeroOrbit>
  )
}
