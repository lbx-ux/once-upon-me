# 07 · 轮播要能用鼠标横向拖

Status: done
Spec: ../spec.md
创建：2026-10-13（用户："这个轮播图应该可以把鼠标左右滑动，现在这个功能还没有实现"）

## 之前能翻的三条路里没有"抓"

点邻居卡、键盘 ← →、自动播 —— 都验过。缺的是最直觉的那条：**按住横向拖**。

## 实现要点（三条不太显然的规矩）

1. **每帧的量不进 React。** `--hl-drag` 直接写在 `.hl__reel` 上（那一层的 transform
   原本没人认领，加进文件头那张归属表），React 只留一个 `dragging` 布尔用来停自动播。
2. **`dragSteps`（纯函数，进 `lib/reel.ts`）**：往左拖 = 前进，用 `round` 不用 `floor`
   —— 拖过半格用户已经表达意图，卡在中间不上不下是最坏结果。
   上限夹在 `floor(count/2)`：环上绕两圈落回同一处，只会让人误判。
3. **松手那一帧，"归零拖拽量"与"去掉 `data-dragging`"必须在同一个任务里写完。**
   分开写浏览器会先把拖拽量瞬间抹掉、再让卡片补剩下的路 —— 看着像弹一下。
   这也是 `data-dragging` 走 DOM 直写而不是 React state 的原因：state 要到 commit 才掉。

顺带：这是**环**，所以不需要直线轮播那套端头橡皮筋；`touch-action: pan-y` 把纵向留给
页面滚动；`user-select: none` 只挂在 `[data-dragging]` 上（平时正文应该还能选中复制）；
`<img draggable={false}>`，否则浏览器原生的"拖图片"会把横向手势接走，用户看到的是
图片被拽起来、轮播一动不动。

## 步长不自己算

`--hl-step` 是 CSS 里 `calc(卡宽 + clamp(缝))`。JS 再抄一遍这个公式，就是两个手写的数
开始各自漂移 —— 本项目为这类耦合付过学费（首屏交接那三个数、选择点窗口与 P_Q）。
所以放了一根**探针**：`.hl__step-probe { width: var(--hl-step) }`，
没有 transform、没有过渡，任何时候读 `offsetWidth` 都是准的。

实测：1440 下探针 = **564px**；同一时刻五张卡的 rect 中心读出来是
`0 / 13 / 24 / -24 / -13`（后台文档里过渡冻结，量不到真值）。
**这正是不能用 rect 反推步长、要用探针的活证据。**

## 一个 handler 顺序 bug，是测试逼出来的

第一版把 `setPointerCapture` 写在 `reel.dataset.dragging = 'true'` **前面**。
合成 PointerEvent 打过去之后，`data-dragging` 没出现、`--hl-drag` 却照常更新 ——
查 console 才看见：

```
Uncaught NotFoundError: Failed to execute 'setPointerCapture' on 'Element':
No active pointer with the given id is found.
```

`setPointerCapture` 抛了，整段 handler 当场中断，而 `dragRef` 已经建好了。
真实用户手上有 active pointer 所以撞不到，但**顺序本身是错的**：
一旦抓取失败（指针在 down 与 handler 之间就抬起，同一类race），
画面会停在"能拖、但过渡没关、拖起来黏糊糊"的怪状态，比直接坏还难查。

改了两处：

- **先写视觉状态，再抓指针**，抓取包在 try/catch 里（理由写在注释里，不是万能兜底）；
- `onPointerDown` 开头先 heal 一次未收尾的旧拖拽 —— 漏掉 `pointerup` 的话
  `dragging` 会永远挂着（自动播被无限期停住、拖拽量停在半路），
  这比在 window 上挂一套监听再管一遍生命周期便宜。

## 验收

- [x] `pnpm test` **67 条**（新增 `dragSteps` 5 条：方向、过半才认、两格、半圈上限、
      量不到步长时不翻）
- [x] 浏览器实测 1440×900，步长 564px：
      拖 −226px（0.40 格）→ **不翻**；拖 −564px → 前进 1；拖 +1128px → 后退 2；
      四种情形每次 `data-dragging` 按下即 true、抬手即 false、`--hl-drag` 归零
- [x] 浏览器实测"拖完补一个 click"不会翻两下（第 2 → 拖到第 2 → 假 click 仍是第 2），
      而 3px 以内的按下+点击**仍然正常翻页**（点击路径没被误伤）
- [x] `.hl__reel` computed：`cursor: grab`、`translate: 0px`、
      `transition-property: translate`、`touch-action: pan-y`
- [ ] **1:1 跟手与松手补间的观感** —— 后台文档里 CSS transition 时间线不走，
      量不到"平滑"本身。要前台拖一下
- [ ] **真实指针下的 setPointerCapture** —— 合成事件没有 active pointer，
      这条路径本轮只被"它抛了会怎样"验到，没被"它成功了"验到
