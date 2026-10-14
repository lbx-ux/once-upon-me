import type { CSSProperties } from 'react'

import { ANCHOR_LABELS } from '@/lib/engine/domain.ts'
import { DEFAULT_STYLE_LABEL } from '@/lib/prompts/character-sheet.ts'
import type { CardListItem } from '@/lib/cards-list.ts'
import type { KidName } from '@/lib/kid-names.ts'

/**
 * CharacterWall —— 工作台的「小主角」那一屏：一墙贴着的角色卡
 *
 * ★ 这一屏**只列已经存在的东西**，不新造第二条建角色的路：
 *   建角色在创作流里（第 1 步说孩子是谁、第 3 步出形象），这里给的是
 *   "我有几个、长什么样、每一版是谁画的"。在那之前摆一个进不去的
 *   "编辑档案"就是假装——所以卡片上那颗动作是**用它做一本**（真的能走通），
 *   而不是参考图里那支铅笔。
 *
 * ★ 参考图右上角那颗垃圾桶**没做**。删除孩子的凭据要走 `deleteChild`，
 *   那条路现在**零测试、零调用方**（只有引擎里一个方法）；
 *   拿一个没保障的删除去接一个家长的"删掉我孩子的样子"，是这一版不能签的。
 *   补测试 + 路由 + 二次确认是工单 03 的第一件事，做好了它会长在这儿。
 *
 * ★ 卡上每一个字都有出处：
 *   名字与常服来自 `kids.json`（演示生成器的副产物，读不到就退回 childId，见 lib/kid-names.ts）；
 *   标签是卡上的锚点原值；"水彩"来自 `DEFAULT_STYLE_LABEL`；
 *   模型与版次是 provenance。**没有年龄**——卡上没有，所以不显示
 *   （参考图那句"5 岁"在这里做不出来，编一个就是给一个不存在的数据源背书）。
 */

export type CharacterWallProps = {
  cards: CardListItem[]
  names: Record<string, KidName>
}

/** 卡面上摆几条锚点。★ 三条：再多这一张卡就从"档案"变成"表格"了 */
const VISIBLE_ANCHORS = 3

export default function CharacterWall({ cards, names }: CharacterWallProps) {
  return (
    <section className="cw">
      <header className="cw__head">
        <div>
          <h1 className="cw__title">小主角</h1>
          <p className="cw__sub">每一页里那个他，都由这张卡上的几条锚点决定。</p>
        </div>
        <a className="cw__new" href="/create">
          <span className="cw__new-plus" aria-hidden="true">
            ＋
          </span>
          新建角色卡
        </a>
      </header>

      {cards.length === 0 ? (
        <div className="cw__empty">
          <p>还没有角色。角色是在做书的时候生成的：先说孩子是谁，再出一张形象。</p>
          <a className="cw__cta" href="/create">
            去创作
          </a>
        </div>
      ) : (
        <ul className="cw__wall">
          {cards.map((card, index) => {
            const kid = names[card.cardId]
            const shown = card.anchors.slice(0, VISIBLE_ANCHORS)
            const rest = card.anchors.length - shown.length
            return (
              <li
                key={card.cardId}
                className="cw__slot"
                // 入场错开的节拍写在 style 上：它是**这一张**的位置属性，
                // 不是一条样式规则，用 nth-child 写会把它锁死在"前 6 张"
                style={{ '--cw-i': index } as CSSProperties}
              >
                <article className="cw__card">
                  <span className="cw__tape" aria-hidden="true" />
                  <p className="cw__eyebrow">
                    角色卡 · 第 {card.revision} 版
                    {rest > 0 ? ` · ${card.anchors.length} 条锚点` : ''}
                  </p>

                  {/* 相纸那一层：白边 + 虚线内框，图压在框里。
                      ★ 走原生 <img>：图在资产根里、经 /api/assets 出来，
                      next/image 要另配 loader，而它是 README §五「刻意未做」那一条 */}
                  <div className="cw__mat">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      className="cw__art"
                      src={card.referenceUrl}
                      alt={`${kid?.name ?? card.cardId} 的形象`}
                      width={512}
                      height={512}
                      loading="lazy"
                      decoding="async"
                    />
                  </div>

                  <h2 className="cw__name">
                    {kid?.name ?? card.cardId}
                    {kid?.reading ? <span className="cw__reading">{kid.reading}</span> : null}
                  </h2>
                  <p className="cw__meta">
                    {DEFAULT_STYLE_LABEL}形象 · {card.modelId} 画的
                  </p>

                  {kid?.outfit ? <p className="cw__worn">他常穿：{kid.outfit}</p> : null}
                  {card.photoDeleted ? <p className="cw__photo">用过照片，已删除</p> : null}

                  <ul className="cw__tags">
                    {shown.map((anchor) => (
                      <li key={anchor.slot} className="cw__tag">
                        {anchor.value}
                      </li>
                    ))}
                  </ul>

                  <hr className="cw__rule" />

                  <details className="cw__detail">
                    <summary>
                      {rest > 0
                        ? `看剩下 ${rest} 条，以及这张卡凭什么算「同一个人」`
                        : '这张卡凭什么算「同一个人」'}
                    </summary>
                    <dl className="cw__anchors">
                      {card.anchors.map((anchor) => (
                        <div key={anchor.slot} className="cw__anchor">
                          <dt>{ANCHOR_LABELS[anchor.slot]}</dt>
                          <dd>{anchor.value}</dd>
                        </div>
                      ))}
                    </dl>
                    {/* 画的与查的同源（ADR-0007）：这句是这张卡存在的理由，值得写在卡上 */}
                    <p className="cw__why">
                      画每一页时按这几条画，核对每一页时按同一批查——所以「这一页还是不是他」
                      有答案，而不是只有感觉。
                    </p>
                  </details>

                  <a className="cw__use" href={`/create?card=${encodeURIComponent(card.cardId)}`}>
                    用它做一本
                  </a>
                </article>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
