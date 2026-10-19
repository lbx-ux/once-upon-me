# 05 · 工作台：底部标签栏 + 弹窗底部抽屉

Status: done

## 底部标签栏

`src/components/shell/AppShell.tsx` + `app-shell.css`：

- `≤640px`：`.shell` 变竖向；`.shell__side` 变 `position: fixed; bottom: 0; left: 0;
right: 0` + `padding-bottom: var(--safe-b)`；`.shell__main` 补一条等高的 `padding-bottom`；
- 品牌 `.shell__brand`、分组标签 `.shell__group-label`、折叠钮 `.shell__collapse`
  在这一档 `display: none`；
- `.shell__nav` 横排、等分、图标在上字在下；
- 账号与设置那两格在 `.shell__foot` 里，底部栏放不下 → **页头再渲染一组同样的入口**
  （`AppShell` 里渲染两次，媒体查询二选一）。`display: none` 的东西**不进辅助技术**，
  所以不会"同一样东西念两遍"。两处共用同一个 `setSettingsOpen`。
- 侧栏那条 GSAP 进场（`x: -18`）在手机上方向不对 → 那一档走 `y`。
- `.studio` 的内边距收窄（手机上 16px / 14px）。

## 弹窗

`dialog.css` 的 `≤640px` 档改回**底部抽屉**：`align-items: flex-end`、圆角只在上边、
`max-height: 88dvh`、`padding-bottom: var(--safe-b)`。
★ 文件头现在写着"原来贴底、后来改居中，因为主场是桌面" —— **要在同一处补一句为什么
手机上又贴回去**（"拇指够得到"那条理由只在窄屏成立，正是它当年说的那句）。

## 判据

- `chk-mobile.mjs` 判据 1（`/home` `/shelf` `/character` 那几行）+ 判据 5
  （底部标签栏里每个可点元素 ≥ 44×44）。

## Comments

- 2026-10-19 完成。侧栏在 ≤640px 收成**底部标签栏**（用户从三档里挑的），
  牌子 / 分组标签 / 折叠钮在这一档隐藏，"我是谁 + 设置"搬到顶栏 `.shell__bar`。
  两处各在对方的档里 `display: none`，所以辅助技术任何时刻只看得见一组。
- ★ 四处特异性坑，一处都没靠文件顺序取胜（都写成更高的选择器）：
  (0,2,0) 的 `.shell__nav .shell__link-label` 与 `.shell__bar .shell__link-label`
  盖掉上一档那串并列选择器的"藏标签"；(0,4,0) 的
  `.shell[data-collapsed='true'] .shell__nav .shell__link-label` 盖掉桌面的 `collapsed` 偏好。
  漏掉第②条的症状是"手机上底部栏没有字"——看起来像这一档漏写了，不像被别处压住。
- `.studio` 的上下内边距收回来（顶栏与底栏已经在管那两头）；
  管理页那张 8 列表格**保留横向滚**，只加一行"← 左右滑动看全表 →"。
  ★ **2026-10-19 后一句已被用户推翻并撤掉**（见工单 06 那一条注）。
- `dialog.css` 那一档（弹窗在手机上改回**底部抽屉**）也做了：`≤640px` 下
  `align-items: flex-end`、圆角只留上边（`18px 18px 0 0`）、`max-height: 88dvh`
  （不是 `88vh`：那个数会让抽屉比看得见的那块屏幕还高，底下"取消 / 开始创作"正好被裁掉）、
  `padding-bottom` 让开 `--safe-b`、关闭钮补到 44×44。文件头原来写着"主场是桌面所以居中"，
  同一次改了那句 —— 手机上它同样是主场，两档并存不是骑墙（各自对着自己那块屏幕成立）。
