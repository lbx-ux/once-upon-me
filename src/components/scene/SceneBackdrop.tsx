'use client'

import { useRef } from 'react'

import { setTickVar, useScrollTick } from '@/lib/useScrollTick'

/**
 * SceneBackdrop —— 三幕场景背景（方案三）
 *
 * 三屏各一张 16:9 场景图，叠成三层 `position: fixed`，靠**长交叉溶解**连起来：
 * 视口中心走到哪一幕，那一幕就最实。读起来是"镜头摇过一片风景"，
 * 不是"背景换了一张壁纸"。三幕是清晨天光 → 午后草坡（一本书落在草地上翻开）
 * → 夜晚台灯下的书桌，正好对上产品自己那条轴「场景决定形态」：
 * 白天陪玩（共读版）与睡前（独读版）。
 *
 * 三个决定，每个都对应一次实测：
 *
 * 1. **权重按「幕中心距视口中心的距离」算，不按总滚动进度。**
 *    总进度是个纯数字，它不知道第一屏有多高；加一节内容、书多翻一页，
 *    溶解的时间点就全漂了。而「某一幕的中心离屏幕中心还有多远」是自解释的：
 *    看到第二幕的书居中，第二幕就正好是全实的一帧。
 *    ★ 半宽**必须由实测的幕间距推出来，不能拍常数**：早先在原型上拍 0.75，
 *    实测相邻幕中心相距 **1.92 与 2.29 视口高**，都大于 2×0.75，
 *    于是两条权重带**从不交叠** —— 所谓"交叉溶解"一次都没发生过，
 *    走到中点时三层全为 0，被下面那个"最近者胜"的兜底接住，变成硬切。
 *    这不是调参问题，是模型与页面尺度不匹配。现在改成每次重新量幕间距。
 *
 * 2. **三层权重归一化到和为 1。**
 *    不归一化的话，两幕交接处三层加起来不到 1，会漏出页面底色（`--bg`），
 *    视觉上就是"闪了一下"。归一化之后任何滚动位置都有一个完整合成；
 *    并且当只有一幕在范围内时，归一化自动把它变成全实。
 *
 * 3. **纸色罩层写在每一层自己的 `::after` 里，跟着那层一起淡。**
 *    罩层不能是全局一层：第三幕是夜戏，需要"上浓下清"的雾（见 scene-backdrop.css），
 *    前两幕只要薄薄一层。写在层内，切换时罩层与图一起溶解，
 *    不会出现"图换了、雾还是上一层的那一层"。
 *
 * 素材与量法在原型目录那份文档里：`E:/ui/出图提示词.md` §四（提示词）与 §五（逐张验收）；
 * 那份文档**没有进这个仓库**，所以 CSS 注释里把用到的数就地写全了。
 * 已知取舍见 README §五。
 */
const ANCHORS = ['.hero-experience', '.storybook', '.hl'] as const

export default function SceneBackdrop() {
  const rootRef = useRef<HTMLDivElement>(null)

  useScrollTick((vh, reduced) => {
    const root = rootRef.current
    if (!root) return

    const sections = ANCHORS.map((sel) => document.querySelector(sel))
    if (sections.some((el) => !el)) return

    // 每一幕的中心距视口中心多少个视口高（负 = 已经滚过它了）
    const gaps = sections.map((el) => {
      const r = (el as Element).getBoundingClientRect()
      return (r.top + r.height / 2 - vh / 2) / vh
    })

    /** 离得最近的那一幕全实，其余全透明 —— 位置仍然是对的 */
    const nearest = () => {
      let best = 0
      for (let i = 1; i < gaps.length; i++) {
        if (Math.abs(gaps[i]!) < Math.abs(gaps[best]!)) best = i
      }
      return gaps.map((_, i) => (i === best ? 1 : 0))
    }

    let w: number[]
    if (reduced) {
      // reduced 下的**静止终态**：不是"不反应"，而是这一刻本来就该是某一幕
      w = nearest()
    } else {
      /* 权重 = 1 - |d| / spread。相邻两幕要真的重叠才谈得上"溶解"：
         两幕中心间距 G ⇒ 只有 spread > G/2 时两条带才交叠。
         取最宽的那一对（spread = G_max/2 + 0.5 ⇒ 那一对正好溶解一屏，
         更近的那一对会略宽 = G_max - G_i + 1）。间距随页面内容变，所以每次重量。 */
      const gap = Math.max(Math.abs(gaps[1]! - gaps[0]!), Math.abs(gaps[2]! - gaps[1]!))
      const spread = Math.max(gap / 2 + 0.5, 0.6)
      w = gaps.map((d) => Math.max(0, 1 - Math.abs(d) / spread))
      const sum = w.reduce((a, b) => a + b, 0)
      w = sum < 1e-6 ? nearest() : w.map((v) => v / sum)
    }

    w.forEach((v, i) => setTickVar(root, `--scene-${i + 1}`, v))
  })

  return (
    <div className="scene-backdrop" ref={rootRef} aria-hidden="true">
      <div className="scene-backdrop__layer" data-scene="1" />
      <div className="scene-backdrop__layer" data-scene="2" />
      <div className="scene-backdrop__layer" data-scene="3" />
    </div>
  )
}
