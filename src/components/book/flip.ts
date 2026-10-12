/**
 * flip.ts —— 叶绕书脊的翻页几何（纯函数）
 *
 * 这个文件不碰 DOM、不碰 React，只做一件事：
 *   **把「已经翻过多少叶」这个连续量，翻译成每一叶的角度 / 层序 / 阴影强度。**
 *
 * 之所以单独拆出来：这一节的第一版只服务首页，W2 的阅读器要重写接口时，
 * 几何能整块搬走，不用推第二遍。所以在里面读不到任何页面、主题、图片路径。
 *
 * ---------------------------------------------------------------------------
 * 叶模型（★ 这里最容易被想错，先看这段）
 *
 *   **一张 3:2 的跨页图不是一个物理单位。** 真实书里：
 *
 *       第 k 个跨页 S_k  =  ( 第 k−1 叶的背面 ,  第 k 叶的正面 )
 *
 *   所以 N 个跨页需要 N+1 叶。演示书是 4 个跨页 → 5 叶：
 *
 *       叶  正面（翻过去之前在右页）   背面（翻过去之后在左页）
 *       L0  封面                      S1 左半
 *       L1  S1 右半                   S2 左半
 *       L2  S2 右半                   S3 左半
 *       L3  S3 右半                   S4 左半
 *       L4  S4 右半                   封底
 *
 *   半页**不要切成两个文件**：同一张跨页图挂两次，
 *   `background-size: 200% 100%` + `background-position: 100% 0`（右半）/ `0 0`（左半）。
 *   请求数直接减半（3:2 的图铺进 3:4 的页面正好是原比例，不拉伸也不裁）。
 *   这也是出图时那条「主体不许压在水平 46%–54%」约束的来源。
 *
 *   另一个推论：**合着的书只有一页宽。** q=0 时封面只占舞台的右半幅，左半幅是页面
 *   底色，不是书的一部分。所以舞台不能做成一张带投影的卡片 —— 影子要落到每一叶上。
 *
 * ---------------------------------------------------------------------------
 * 三个穿帮点，都在这个小函数里摁住：
 *
 *   1. 层序。未翻的叶按 i 递减（L0 在最上面，就是封面）；已翻的叶按 i 递增
 *      （后翻的压在先翻的上面）。**正在翻的那一叶必须顶到最高**，否则转过 90°
 *      会被下一页吃掉半截。两摞用互不相交的 z 区间，不依赖 DOM 顺序也对。
 *   2. 纸感靠阴影不靠卷曲：shade = sin(θ)，平放时 0、立起来时 1。
 *   3. 角度一律由 **qDisplay** 算，不用 qTarget —— 鼠标滚轮是离散格，
 *      不插值就是一顿一顿（插值在组件里，不在这里）。
 */

export type LeafState = {
  /** 0 → 0°，-180 → 完全翻到左边。翻页方向固定，不允许正角度 */
  angle: number
  zIndex: number
  /** 纸面阴影强度 0→1，= sin(|angle|)。组件拿它去调那层 linear-gradient 的 opacity */
  shade: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** 正在翻的那一叶的层序，必须高于两摞的任何一叶 */
const TURNING_Z = 10

/**
 * @param q         已经翻过多少叶的连续量，夹到 [0, leafCount]
 *                  q ∈ (i, i+1) ⟺ 第 i 叶正在翻
 * @param leafCount 叶数 = 跨页数 + 1
 */
export function flipState(q: number, leafCount: number): LeafState[] {
  const t = clamp(q, 0, leafCount)
  const states: LeafState[] = new Array(leafCount)

  for (let i = 0; i < leafCount; i++) {
    const local = t - i // <0 未翻；>1 已翻；0..1 正在翻
    let angle: number
    let zIndex: number

    if (local <= 0) {
      angle = 0
      // 右摞：L0 压在最上面（合着时看到的就是封面）
      zIndex = leafCount - i
    } else if (local >= 1) {
      angle = -180
      // 左摞：后翻的压在先翻的上面。整摞抬到右摞之上 —— 两摞在 z 上不重叠，
      // 结果就与 DOM 书写顺序无关了。
      zIndex = leafCount + 1 + i
    } else {
      angle = -180 * local
      zIndex = leafCount * 2 + TURNING_Z
    }

    states[i] = {
      angle,
      zIndex,
      // 两个端点直接归零：sin(180°) 在浮点下是 1.2e-16 而不是 0，
      // 留着它，"平放时不该有阴影"这条不变量就永远检不了。
      shade: angle === 0 || angle === -180 ? 0 : Math.sin((Math.abs(angle) * Math.PI) / 180),
    }
  }

  return states
}

/** 某一叶的两面各占哪半幅 —— 组件直接用，省得再推一遍映射 */
export type HalfPage = { leaf: number; face: 'front' | 'back'; side: 'left' | 'right' }

/**
 * 把「第几个跨页」翻译成「哪两叶的哪一面」。
 * spread k（k ≥ 1）的左半在 L(k−1) 的背面，右半在 L(k) 的正面。
 */
export function spreadHalves(spread: number): [HalfPage, HalfPage] {
  return [
    { leaf: spread - 1, face: 'back', side: 'left' },
    { leaf: spread, face: 'front', side: 'right' },
  ]
}

/* ---------------------------------------------------------------------------
 * 自检：四种边界各来一遍。只在开发期跑（见文件末尾），生产构建里是死代码。
 *
 * 上一轮定过一条规矩：几何这种东西不能靠"看着对"。翻页最典型的三个穿帮
 * （整数进度时两叶同时立着、正在翻的那叶被吃掉、shade 在端点不为 0）
 * 都是这里能摁住的。
 * ------------------------------------------------------------------------- */
export function flipStateSelfTest(): string[] {
  const fails: string[] = []
  const N = 5
  const check = (ok: boolean, msg: string) => {
    if (!ok) fails.push(msg)
  }

  // ① q = 0：合着，全部平放，全部在右摞
  const at0 = flipState(0, N)
  check(
    at0.every((s) => s.angle === 0 && s.shade === 0),
    'q=0 时应当全部平放、无阴影',
  )
  check(new Set(at0.map((s) => s.zIndex)).size === N, 'q=0 时层序应当互不相同')
  check(at0[0].zIndex > at0[N - 1].zIndex, 'q=0 时 L0（封面）应当在最上面')

  // ② q = N：全部翻完，全在左摞
  const atEnd = flipState(N, N)
  check(
    atEnd.every((s) => s.angle === -180 && s.shade === 0),
    'q=N 时应当全部翻到左边、无阴影',
  )
  check(atEnd[N - 1].zIndex > atEnd[0].zIndex, 'q=N 时最后翻的那叶应当在最上面')

  // ③ q 取整数：不该有任何一叶停在中间（这是"两叶同时立着"那个穿帮）
  for (let k = 1; k < N; k++) {
    const mid = flipState(k, N)
    const turned = mid.filter((s) => s.angle === -180).length
    check(turned === k, `q=${k} 时应当恰好有 ${k} 叶翻完，实际 ${turned}`)
    check(
      mid.every((s) => s.angle === 0 || s.angle === -180),
      `q=${k} 是整数，不该有叶停在半途`,
    )
  }

  // ④ q = k + 0.5：第 k 叶立在正中，阴影最重，且层序压过所有叶
  for (let k = 0; k < N; k++) {
    const s = flipState(k + 0.5, N)
    const turning = s[k]
    check(Math.abs(turning.angle + 90) < 1e-9, `q=${k}.5 时第 ${k} 叶应当在 90°`)
    check(Math.abs(turning.shade - 1) < 1e-9, `q=${k}.5 时第 ${k} 叶阴影应当最重`)
    check(
      s.every((o, i) => i === k || o.zIndex < turning.zIndex),
      `q=${k}.5 时正在翻的第 ${k} 叶层序必须最高`,
    )
  }

  // ⑤ 单调：角度随 q 只减不增，且不越界
  let prev = 0
  for (let t = 0; t <= N; t += 0.05) {
    const s = flipState(t, N)
    check(
      s.every((o) => o.angle <= 0 && o.angle >= -180),
      `q=${t.toFixed(2)} 角度越界`,
    )
    const sum = s.reduce((a, o) => a + o.angle, 0)
    check(sum <= prev + 1e-9, `q=${t.toFixed(2)} 处总角度回升了`)
    prev = sum
  }

  return fails
}

if (process.env.NODE_ENV !== 'production') {
  const fails = flipStateSelfTest()
  if (fails.length) console.error('[flip.ts] 几何自检未通过：\n  ' + fails.join('\n  '))
}
