import Link from 'next/link'
import { listCardItems } from '@/lib/cards-list.ts'
import { ANCHOR_LABELS } from '@/lib/engine/domain.ts'

/**
 * /character —— 小主角（工作台的第三格）
 *
 * ★ 这一屏**只列已经存在的东西**，不新造第二条建角色的路：
 *   建角色在创作流里（第 1 步 + 角色卡那一步），这里给的是"我有几个、长什么样、
 *   每一版是谁画的"。工单 03 会把它变成角色的家（照片上传、按建议重画），
 *   在那之前摆一个进不去的"新建角色"按钮就是假装。
 *
 * ★ 名字不在这里显示——**角色卡上没有名字**。`CharacterCard` 有 childId、锚点、
 *   参考图与 provenance，名字在孩子的档案里（那是 03 要建的那一层）。
 *   所以这里显示 childId 与锚点，不编一个名字出来。
 */

export const dynamic = 'force-dynamic'

export const metadata = { title: '小主角 · 小主角' }

export default async function CharacterPage() {
  // 取数与 `/api/cards`、工作台「小主角」选择器同一份实现（lib/cards-list.ts）。
  //   这一屏要的是「哪一条对应哪个部位」，所以留 anchors（带 slot），
  //   不用 checklist —— 后者回的是**已经拼给人读的句子**，部位信息在拼接时就没了
  const cards = await listCardItems()
  const rows = cards.map((card) => ({
    ...card,
    anchorLines: card.anchors.map((anchor) => `${ANCHOR_LABELS[anchor.slot]}：${anchor.value}`),
  }))

  return (
    <section className="ch">
      <header className="ch__head">
        <div>
          <h1 className="ch__title">小主角</h1>
          <p className="ch__sub">每一页里那个他，是由一张角色卡决定的——这几条锚点就是它的依据。</p>
        </div>
        <Link className="ch__new" href="/home">
          去做一本
        </Link>
      </header>

      {rows.length === 0 ? (
        <div className="ch__empty">
          <p>还没有角色。角色是在做书的时候生成的：先说孩子是谁，再出一张形象。</p>
          <Link className="ch__cta" href="/home">
            去创作
          </Link>
        </div>
      ) : (
        <ul className="ch__grid">
          {rows.map((row) => (
            <li key={row.cardId}>
              <article className="ch__card">
                {/* 参考图是这张卡的全部依据所在：画的与查的同源（ADR-0007）。
                    alt 给的是能确定的事实，不编名字。
                    ★ 走原生 <img>：图不在 public/ 里，是资产根里的文件、经 /api/assets
                    只读出口给出来，next/image 要另配 loader；而它是 README §五
                    里「刻意未做」那一条，与 CreateFlow 里那两处同一个处理 */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="ch__art"
                  src={row.referenceUrl}
                  alt={`${row.cardId} 第 ${row.revision} 版的形象`}
                  width={220}
                  height={220}
                  loading="lazy"
                />
                <h2 className="ch__name">{row.childId}</h2>
                <p className="ch__meta">
                  <span>{row.cardId}</span>
                  <span>第 {row.revision} 版</span>
                  <span>{row.anchorLines.length} 条锚点</span>
                </p>
                <p className="ch__model">这张卡是 {row.modelId} 画的</p>
                {row.photoDeleted && <p className="ch__photo">用过照片，已删除</p>}
                <details className="ch__anchors">
                  <summary>看这几条是什么</summary>
                  <ul>
                    {row.anchorLines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </details>
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
