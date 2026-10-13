import { noNegZero, smoothstep } from './math'

/**
 * orbit.ts —— 环形轨道上**一张卡**的摆位，纯函数
 *
 * 这段数学原来内联在 `HeroOrbit.frame()` 的逐卡循环里（§5–§6 那一段）。
 * 搬出来不是因为要改它，是因为它现在有**两个消费者**，而它们必须在
 * 同一帧画出同一个环：
 *
 *   1. `HeroOrbit.frame()` —— 每帧调一次，写 inline style；
 *   2. `restInlineStyle()` —— 预渲染那一帧（phase 0、无鼠标 / 滚动 / 拖拽），
 *      在服务端渲染时就写进 `<figure>` 的 style 属性。
 *
 * 预渲染那一帧是这次流畅度修复的核心：原来 12 张卡在 CSS 里是 `opacity: 0`
 * （"JS 接管前不可见"），而预渲染 HTML 里**一个 inline style 都没有** ——
 * 首帧是一张空环，这一页的 LCP（就是这 12 张图）被 hydration 挡在门外，
 * JS 挂了也永远是一张空环。修法是把 t=0 那一帧**构建期就算出来**。
 *
 * ## t=0 时整个环是纯常量，除了半轴
 *
 * phase 0、sceneX/Y 0、fadeOut 1、lift 0 代进去，每张卡的角度
 * `a = 0 + i/n·TAU` 是常量 ⇒ 深度、scale、rot、blur、opacity、zIndex 全是常量，
 * **与视口无关**，构建期就能算。唯一不知道的是椭圆半轴 rx / ry —— 那是
 * 浏览器布局出来的数（`clientWidth × 0.56` / `clientHeight × 0.38`）。
 *
 * 所以静态帧的 x / y 存的是**系数**，交给 CSS 乘上 `--orbit-rx` / `--orbit-ry`
 * （那两个变量在 `hero-orbit.css` 的 `.hero` 上，cqw/cqh 认的就是同一个内容盒）。
 * 系数不另写一份公式 —— 用同一个 `placeCard` 取两次（`rx=1,ry=0` 与
 * `rx=0,ry=1`）解出来，见 `restInlineStyle`。x 对 rx、y 对 ry 都是线性的，
 * 这么解是**精确**的，只有浮点结合律上的 ulp 级差（<1e-12px）。
 *
 * ## 与 HeroOrbit 的契约
 *
 * `frame()` 里的 `phase` 时钟因此改成了**相对挂载时刻**（`ts - phaseBase`），
 * 不然第一帧 JS 会把环从静态帧的 0° 直接跳到「加载耗时 × 角速度」那个角度。
 * 这三件事是一组的：本文件、`frame()` 的 phaseBase、`hero-orbit.css` 的
 * 两个半轴变量 —— 改任何一个都要想到另外两个。
 */

/** 一张卡的完整摆位。单位：x/y/z px、rot deg、blur px，opacity 0–1。 */
export type OrbitPlacement = {
  x: number
  y: number
  z: number
  scale: number
  rot: number
  blur: number
  opacity: number
  zIndex: number
}

export type OrbitInputs = {
  /** 第几张卡（0 起），决定它在环上的起始角 `i/n · TAU` */
  i: number
  /** 环上一共几张，决定角距 */
  n: number
  /** 环当前转过的相位（rad）：自转 + 滚动 + 拖拽三者之和 */
  phase: number
  /** 椭圆横向半轴（px）。frame() 里由 .hero 的盒子算出；restInlineStyle 传 0/1 取系数 */
  rx: number
  /** 椭圆纵向半轴（px） */
  ry: number
  /** 鼠标视差的平滑量（-1..1），静止帧为 0 */
  sceneX: number
  sceneY: number
  /** 交接段淡出的乘数（1 = 照常表演） */
  fadeOut: number
  /** 前冲弹簧的当前值（0 = 还没被顶起来），由 frame() 逐帧平滑 */
  lift: number
}

const TAU = Math.PI * 2

/**
 * 一张卡的摆位。与 `HeroOrbit.frame()` 原来那段逐字相同 ——
 * 操作顺序都没动（`cos·rx·A·B + sceneX·C` 这种连乘的顺序影响浮点末位，
 * 搬的时候保序，等价性由 `orbit.test.ts` 里那份原样抄来的对照实现摁着）。
 */
export function placeCard(inp: OrbitInputs): OrbitPlacement {
  const { i, n, phase, rx, ry, sceneX, sceneY, fadeOut, lift } = inp
  const a = phase + (i / n) * TAU
  const d = (Math.sin(a) + 1) / 2

  // X：椭圆横向 × 近大远小补偿 + 按深度加权的视差
  const x =
    Math.cos(a) * rx * (0.82 + 0.18 * d) * (1.2 + 0.06 * smoothstep(0.72, 0.96, d)) +
    sceneX * (18 + 22 * d)

  // Y：椭圆纵向 + 后排上抬（避免被中心文案压住）；前排把弧线压平一点，
  // 让最前面那张稳稳落在视线下方
  let y = Math.sin(a) * ry * 0.89 + sceneY * (10 + 12 * d) - 16 * Math.pow(1 - d, 1.7)
  const frontY = 0.89 * ry + 22 * sceneY
  y += (frontY - y) * smoothstep(0.68, 0.9, d)

  // Z：真实深度，浏览器据此做遮挡排序（容器是 preserve-3d）
  const z = (d - 0.5) * 360

  const scale = 0.58 + 0.58 * d + lift
  const rot = 5.2 * Math.sin(1.6 * a + 0.8 * i) * Math.pow(1 - d, 0.72)
  const blur = d < 0.5 ? 5.2 * Math.pow(0.5 - d, 1.3) : 0
  const opacity = (d >= 0.5 ? 1 : 0.28 + (d / 0.5) * 0.72) * fadeOut

  return { x, y, z, scale, rot, blur, opacity, zIndex: Math.round(10 + 80 * d) }
}

/**
 * 模糊半径 → filter 字符串。**量化到 0.25px**，这是性能参数不是审美参数：
 * 自转每帧让 blur 变约 0.02px，不量化的话任意时刻约 6 张卡每帧都要
 * 重新栅格化一次；量化后一张卡的半径约每 12 帧才变一档，最大偏差 0.125px
 * （blur 值本身 2–5px，肉眼无感）。`> 0.08` 是量化前就有的阈值，留着当兜底
 * （步长要是哪天改小，它还管用）。
 *
 * ★ 注意 `none` 与 `blur(0px)` 不是一回事：零值滤镜照样给元素开一层渲染面。
 * 没有模糊就写 none，别写 0。
 */
export function blurFilter(blur: number): string {
  const q = Math.round(blur / 0.25) * 0.25
  return q > 0.08 ? `blur(${q.toFixed(2)}px)` : 'none'
}

/** 静止帧的输入：phase 0、无鼠标 / 滚动 / 拖拽、满不透明度、弹簧未起 */
const REST: Omit<OrbitInputs, 'i' | 'n' | 'rx' | 'ry'> = {
  phase: 0,
  sceneX: 0,
  sceneY: 0,
  fadeOut: 1,
  lift: 0,
}

/**
 * 写进 `calc()` 的数：**系数 6 位、常数项 3 位**。
 *
 * 位数不是随手取的，它是静态帧的精度预算：系数 6 位 × 半轴上限 1420px
 * ⇒ 误差 ≤0.0007px；常数项 3 位 ⇒ ≤0.0005px。合起来静态帧与 JS 第一帧
 * 的差远小于一个物理像素，而字符串不至于把 HTML 撑肥。
 *
 * 顺带吃掉 `-0.000000` 这种**负零字符串**：`cos(3π/2)` 在浮点里是 −1.8e-16，
 * 格式化出来就是一个负号加一串零。它进 `calc()` 无害，但读起来像出了错。
 */
function fixed(v: number, digits: number): string {
  const s = noNegZero(v).toFixed(digits)
  return Number(s) === 0 ? (0).toFixed(digits) : s
}

/**
 * 预渲染那一帧某张卡的内联样式 —— 挂到 `<figure style={…}>` 上。
 *
 * x / y 里的视口相关部分不在这时展开：transform 里写
 * `calc(系数 * var(--orbit-rx))`，半轴由 CSS 在布局时解析（见 hero-orbit.css）。
 * 字符串的位数见 `fixed()` —— 那是精度预算，静态帧与 JS 第一帧就靠它对齐。
 */
export function restInlineStyle(
  i: number,
  n: number,
): {
  transform: string
  filter: string
  opacity: string
  zIndex: number
} {
  // 系数与常数项：同一函数取两次解出来，不重写第二份数学。
  // x 只吃 rx（sceneX 项在静止帧是 0）；y = ky·ry + py。
  const kx = placeCard({ i, n, ...REST, rx: 1, ry: 0 }).x
  const py = placeCard({ i, n, ...REST, rx: 0, ry: 0 }).y
  const ky = placeCard({ i, n, ...REST, rx: 0, ry: 1 }).y - py

  // z/scale/rot/blur/opacity/zIndex 与半轴无关，取一次就有
  const at = placeCard({ i, n, ...REST, rx: 1, ry: 1 })

  const yOp = py < 0 ? `- ${fixed(Math.abs(py), 3)}` : `+ ${fixed(py, 3)}`
  return {
    transform:
      `translate3d(calc(${fixed(kx, 6)} * var(--orbit-rx)), ` +
      `calc(${fixed(ky, 6)} * var(--orbit-ry) ${yOp}px), ` +
      `${at.z.toFixed(2)}px) translate(-50%, -50%) ` +
      `rotate(${fixed(at.rot, 2)}deg) scale(${at.scale.toFixed(4)})`,
    filter: blurFilter(at.blur),
    opacity: at.opacity.toFixed(4),
    zIndex: at.zIndex,
  }
}
