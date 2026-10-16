# 11 · `/create` 站到首页那片天上（背景）

Status: done
依赖：[05](05-run-view.md)（运行视图）
上游：2026-10-16 用户「这个背景页弄成主页的那个蓝色背景把」（附 `/create` 截图，灰底）

## 一、那层灰是哪来的

不是谁画上去的，是 `body` 的 `--bg: #f7f7f8` 露出来的。工作台那四屏从 2026-10-15
起共用了首页第一幕那片天（`(studio)/layout.tsx` 的 `AppShell` 里那层 `StudioBackdrop`），
而 `/create` **不在那一组**——它刻意没有侧栏（运行视图要整幅宽），于是它一直留在旧底色上。

## 二、为什么不是"把 /create 挪进 `(studio)` 组"

那一组的布局给的是**侧栏**。搬迁会顺手把侧栏带进来，而这一屏要的是整幅宽：
用户从 `/home` 走进来的那一刻，屏幕上该只剩这一本书在做。背景层与外壳是两件事，
这里只接前者——`app/create/layout.tsx` 渲染 `<div className="sb-host"><StudioBackdrop
/>{children}</div>`。挂**布局**而不是塞进 `page.tsx`：这一屏有两条入口
（开跑一本 / 接着做草稿），层挂在布局上两条路都盖得到。

## 三、`.sb-host` 与 `.gr` 的两条都不是装饰

`.sb` 是 `position: absolute; inset: 0`，它需要**一块定位好的地**（`inset: 0` 才有得铺）
与**至少一屏高**（文档比它高时不露出 body 的灰）。`.sb-host` 就是这块地：
`position: relative`（兼着层序）+ `min-height: 100vh/100dvh` + 底色 `--paper`。

★ 层序那条是踩过坑的：`.sb` 是定位元素，而 `static` 的孩子按绘制顺序排在它**之前**
（`app-shell.css` 的 `.shell__side` 上那段记的就是它——用户实测时整条侧栏被天空盖住，
只剩带 `position: relative` 的当前项露出来）。所以 `.gr` 也补了 `position: relative`；
同为定位元素之后，层序回到"按 DOM 顺序"，`.sb` 在前。

## 四、铺了天，就有几行字要搬家（AA）

天空带上有量过的规矩（`studio-backdrop.css` 文件头的十带表）：
**压在天上的字只允许 `--ink` 与 `--ink-on-sky`**；`--ink-muted` 在前四段是 3.97–4.17:1。
所以这一屏**不在纸里的字**（标题下那句、进度条上面那句、那一排提醒、每格底下那两颗）
一律 `--ink-on-sky`；纸里的字一个没动（`.dk__note` / `.dk__done-sub` 仍在 `--surface` 卡里，
`--ink-soft` 4.67 / `--ink-muted` 5.33 是量过的）。`--ink-on-sky` 在纸上是 8.30:1，
所以滚出天空带之后这些字也不会变得读不清。

`--danger`（`.gr__error`）**没动**：表里量过 6.19:1，过线。

## 五、验收

```bash
node .out/chk-sky-create.mjs http://127.0.0.1:3321 <bookId>
```

真帧截图与几何读数（1440×900，`/create?book=<真书>`）：

```
.sb      (0, 0) 1440×900   底色 --paper       ← 天空带以下就是它，没有 body 的灰
.sb__sky (0, 0) 1440×1008  --sky 合成 scene-1  ← 与首页第一幕同一张图、同一档偏置
.gr      position: relative                   ← 内容压在天上，不是被天盖住
视口拉到 2600（内容 1073 < 一屏）：hostH 2600，hostCoversViewport ✓
截图 .out/sky-create-run.png：顶上一片蓝天带，阶段轨那张白卡与标题都在它上面

纵坐标 → 段位 → 颜色（那一屏自己的行，十带表对读）：
  .gr__title  y=181 段2  --ink 13.34:1 ✓（没动）
  .gr__sub    y=241 段3  --ink-on-sky 6.92:1 ✓（从 --ink-muted 4.15 搬过来）
  .dk__hint   y=287 段3  同上 ✓
  .dk__stage  与 .dk__hint 同一槽位（y≈287 ⇒ 段3）→ 同搬
  .dk__act    按画框几何推：宽屏一格 220px ⇒ 段6（4.55 刚过线）；窄屏 112px ⇒ 段5（4.43 破线）→ 同搬
  .gr__composer-inner  --surface 白卡（在纸里，不用搬）
```

★ 两处诚实说明：

1. `.dk__act` 的段位是**推的**，不是量的——要量它得真跑一本让"重画/重配"出现。
   而"纵坐标随内容长短走"正是要按规矩搬、不能按位置挑的原因。
2. 运行中那一态（`.dk__stage` 亮着）没有单独截图：stub 清单画不出 `stageLine`，
   要它得真花一轮。量的是同一槽位（287px 那一格）。
