# 06 · 进场时间线

Status: done（代码与终态契约完成；★ **动效本身未在任何前台标签页里验过**，见下）
依赖：03

## 一、★ CSS 持终态，GSAP 只做 `from()`

首屏付过的学费（README §五「首屏的第一帧不靠 JS」）：预渲染 HTML 里 12 张卡一个 inline
style 都没有，而 CSS 写着 `opacity: 0`——两条合起来首帧是一张空环，而那张空环就是 LCP。
所以这里**倒过来写**：默认状态就是画完的样子，GSAP 只负责"从哪儿来"。

于是禁 JS / hydration 之前 / `prefers-reduced-motion` 三种情形下，用户看到的都是完整的一页。
**静止终态不需要单独写，它就是默认态。**

## 二、不引 ScrollTrigger

工作台这几屏基本不滚动，而 README §五 记着一条闸门失效：GSAP 把插件类声明成**全局**，
忘了 `import { ScrollTrigger } from 'gsap/ScrollTrigger'` 时 `tsc` 与 `eslint` 全绿，
只有浏览器会抛 `ReferenceError`。不引插件，这条坑就不存在。

两笔手绘装饰的"被画出来"用 `strokeDashoffset`（长度按 `getTotalLength()` 现量），
不引 DrawSVG。

## 三、交错间隔不是常数

12 项各 35ms 就是 385ms，最后一项会在整页已经就位之后才慢吞吞出现
（首页轮播那条"6.5s 像页面卡住了"是同一类）。`staggerFor(count)`：
≤ 8 项按 35ms，再多按预算（0.28s）反推，总时长封顶。

`useEnterTimeline.test.ts` 只测**纯部分**（node 环境，没有 jsdom）：
交错上限与单调性、起点时间非递减（顺序即层级）、选择器互不重复、
整场收在 1.2s 内、位移不超过 24px。

★ **不测 `useEnterTimeline` 本身**：为它拉一套 jsdom，换来的是一句"动画确实动过"——
而 jsdom 里过了的动画在真机上照样可能是坏的（它不渲染、不合成、不算帧）。

## 四、★ 实测到的最狠情形

预览面板被隐藏时 `requestAnimationFrame` **一次都不跑**（README 记过的
"后台文档 0 次 rAF、`visibilityState` 却报 `visible`"那条；这次 `preview_eval` 里
数 rAF 的脚本直接把 30s 超时耗尽了），此时每一处进场目标都停在：

```
.cl__title   opacity 1  transform none
.cl__card    opacity 1  transform none
.cl__wall li ×2  opacity 1  transform none
```

**一页完整的内容，而不是一页半成品。** 这是"CSS 持终态"这条契约能拿到的最强证据。
GSAP 只留下 `translate: none; rotate: none; scale: none;` 三个归一化声明，无害。

## Comments

- ★ **动效本身没有验证，这条要写在明处。** 面板隐藏时 rAF 与 CSS transition 都不推进，
  判据（数 rAF）数不出来——所以这一单的 "done" 指的是**代码与终态契约**，
  不是"看过它动"。要验它必须在一个前台标签页里看。
- `prefers-reduced-motion: reduce` 那一支同理：本轮没有可用的模拟手段
  （可用工具里只有配色方案的模拟，没有减少动效）。但它**不必单独验**：
  那一支什么都不播，而默认态就是终态——上面那段实测正是"什么都不播时页面长什么样"，
  逐字节就是减少动效下的页面。
- 第一次跑测试红了一条，是**断言写错了**不是代码错了：单调性从 n=1 起算，
  而 `staggerFor(1)` 返回 0 是刻意的"没什么可交错"。改成从 n=2 起算，
  并把这次误判写进了注释——红了先看断言讲的是什么。
