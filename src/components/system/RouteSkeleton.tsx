/**
 * RouteSkeleton —— 路由段在等数据时画的那张"内容形状"（2026-10-30）
 *
 * 它接的是 2026-10-20 拆掉的那张纸的班，不是把那张纸加回来：
 * 那张纸盖在内容区上、写着「正在打开这一屏… 慢的时候要等上一两秒」，用户当场不要；
 * 而同一条记录里也留了另一半——「真要给它一个招待，该做的是骨架屏那一类'内容形状'」。
 * 这一份就是那个形状：没有字、没有转圈、只占位。
 *
 * 四条实现上的取舍：
 *
 * 1. `aria-hidden="true"`：它不提供任何信息。屏幕上有「正在打开」这件事，已经由
 *    被点那一格的转圈说过了（`useLinkStatus` + `sr-only`），同一个状态说两遍是噪音。
 * 2. **晚 120ms 淡入**：快导航（实测 45–62ms）根本看不到它——与侧栏那颗转圈的
 *    `PENDING_SHOW_AFTER_MS` 是同一个数、同一个理由（快的报信反而是闪烁）。
 *    这一条写在 `route-skeleton.css` 里，因为它是"什么时候出现"，是样式的事。
 * 3. 不写 `use client`：纯标记，服务端渲染，零 JS。
 * 4. 只画"标题 + 两行 + 一格一格"，不画具体某一屏的版面：两个使用方是
 *    `(studio)` 整组与 `/create`，而骨架的职责是"这里马上有东西"，
 *    不是提前把版面画错一遍再换掉。
 */

export type RouteSkeletonProps = {
  /** 下面那一排方块画几格。缺省 6（工作台那几屏的列表/墙大多是两行三列） */
  tiles?: number
}

export default function RouteSkeleton({ tiles = 6 }: RouteSkeletonProps) {
  return (
    <div className="skel" aria-hidden="true">
      <span className="skel__title" />
      <span className="skel__line" />
      <span className="skel__line skel__line--short" />
      <div className="skel__tiles">
        {Array.from({ length: tiles }, (_, i) => (
          <span key={i} className="skel__tile" />
        ))}
      </div>
    </div>
  )
}
