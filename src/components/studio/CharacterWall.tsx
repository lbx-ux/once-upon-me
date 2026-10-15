import NextLink from 'next/link'
import type { CSSProperties } from 'react'

import { AGE_BAND_LABELS, ANCHOR_LABELS } from '@/lib/engine/domain.ts'
import { assetUrlOf } from '@/lib/asset-url.ts'
import { DEFAULT_STYLE_LABEL } from '@/lib/prompts/character-sheet.ts'
import type { ChildListItem } from '@/lib/children-list.ts'

/**
 * CharacterWall —— 工作台的「小主角」那一屏：一墙贴着的角色卡
 *
 * ★ 工单 03 把这一屏的数据源换了：以前是"卡 + 另一份演示名单（`kids.json`）"，
 *   现在是**档案（他是谁）+ 卡（他长什么样）**两条真实的线，在
 *   `lib/children-list.ts` 里对起来。三个变化值得单独说，因为它们都是"以前编不出来"的东西：
 *
 *   1. **年龄档能显示了。** 以前这一屏刻意不放年龄（参考图上那句"5 岁"），
 *      理由是卡上根本没有年龄——**编一个就是给不存在的数据源背书**。
 *      现在年龄在档案里，是家长自己填的，所以它能显示，而且显示的是他填的那一档。
 *   2. **"他常穿"那行删了。** 它以前来自 `kids.json` 的 `outfit`，而卡上
 *      本来就有一条 `wardrobe` 锚点（就是三个标签里的一个）——同一件事印两遍，
 *      还是两个不同的字符串。现在只留锚点那份。
 *   3. **"还没出图"是一个正常状态，不是空**：示例孩子与刚建档的孩子都是这样。
 *      相纸那一格里写"还没印出来"，而**不拿一张示例图去顶**。
 *
 * ★ 卡面上的动作现在有两个，都是真的能走通的：
 *   `看这一版 / 提建议`（→ `/character/<childId>`，工单 03 新做的）与
 *   `用它做一本`（→ `/create?card=`，早已实测）。参考图里那支铅笔**仍然没有**：
 *   改档案（名字/读音/年龄）的那一屏还没做，画一支点不动的铅笔就是假装。
 *
 * ★ `＋新建角色` 现在指 `/character/new` 了（工单 03 第二刀）。它以前指 `/create`，
 *   理由是"建卡本来就在创作流里，不新造第二条路"——**那个理由已经不成立**：
 *   建卡有两条路了（从零描述 / 用他的照片），而第二条要一次单独同意，
 *   塞进创作流的节奏里两边都做不好。创作流第 1 步仍然能新建，
 *   两处收的是同一份判据（`creation/state.ts` 的 `stepProblems`）。
 *
 * ★ 参考图右上角那颗垃圾桶**仍然没做**。`deleteChild` 这一版补上了测试
 *   （`store.test.ts`），但"删除"这件事要走的路由 + 二次确认 + 报数还没接出来。
 *   拿一个家长点下去就不可撤销的动作，不能只靠"引擎里有这个方法"就上。
 */

export type CharacterWallProps = {
  items: ChildListItem[]
}

/** 卡面上摆几条锚点。★ 三条：再多这一张卡就从"档案"变成"表格"了 */
const VISIBLE_ANCHORS = 3

export default function CharacterWall({ items }: CharacterWallProps) {
  return (
    <section className="cw">
      <header className="cw__head">
        <div>
          <h1 className="cw__title">小主角</h1>
          <p className="cw__sub">每一页里那个他，都由这张卡上的几条锚点决定。</p>
        </div>
        <NextLink className="cw__new" href="/character/new">
          <span className="cw__new-plus" aria-hidden="true">
            ＋
          </span>
          新建角色
        </NextLink>
      </header>

      {items.length === 0 ? (
        <div className="cw__empty">
          <p>还没有小主角。先说孩子是谁，再出一张形象——两样都在新建那一屏上。</p>
          <NextLink className="cw__cta" href="/character/new">
            去新建一个
          </NextLink>
        </div>
      ) : (
        <ul className="cw__wall">
          {items.map((item, index) => {
            const { profile, card, source } = item
            const shown = card?.anchors.slice(0, VISIBLE_ANCHORS) ?? []
            const rest = (card?.anchors.length ?? 0) - shown.length
            return (
              <li
                key={profile.childId}
                className="cw__slot"
                // 入场错开的节拍写在 style 上：它是**这一张**的位置属性，
                // 不是一条样式规则，用 nth-child 写会把它锁死在"前 6 张"
                style={{ '--cw-i': index } as CSSProperties}
              >
                <article className="cw__card">
                  <span className="cw__tape" aria-hidden="true" />
                  <p className="cw__eyebrow">
                    {card ? `角色卡 · 第 ${card.revision} 版` : '还没有形象'}
                    {rest > 0 ? ` · ${card?.anchors.length} 条锚点` : ''}
                  </p>

                  {/* 相纸那一层：白边 + 虚线内框，图压在框里。
                      ★ 走原生 <img>：图在资产根里、经 /api/assets 出来，
                      next/image 要另配 loader，而它是 README §五「刻意未做」那一条。
                      ★ 取 768 那一档而不是原图：卡面显示 372 CSS px，两倍屏要 744；
                      原图是 2.7 MB 的 1440 PNG，两张贴满墙就是 5.6 MB（实测）。
                      缩略档由 /api/assets 现缩并落盘缓存，见 lib/thumbs.ts */}
                  <div className="cw__mat">
                    {card ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        className="cw__art"
                        src={assetUrlOf(card.referencePath, 768)}
                        alt={`${profile.name} 的形象`}
                        width={768}
                        height={768}
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <p className="cw__mat-empty">
                        形象还没印出来
                        <span>说一句想要的样子，就能出一张</span>
                      </p>
                    )}
                  </div>

                  <h2 className="cw__name">
                    {profile.name}
                    {profile.nameReading ? (
                      <span className="cw__reading">{profile.nameReading}</span>
                    ) : null}
                    {/* ★ "示例"两个字标在**来源**上（档案是从 public/demo 读到的），
                        不是档案里的一个字段——字段会说谎，来源不会。
                        而且这里不许出现"你的孩子"这类指代：它不是谁的孩子，
                        它是一张用来"先看看效果"的示例（用户 10/13 定的口径）。 */}
                    {source === 'demo' ? <span className="cw__demo">示例</span> : null}
                  </h2>
                  <p className="cw__meta">
                    {AGE_BAND_LABELS[profile.ageBand]}
                    {card ? ` · ${DEFAULT_STYLE_LABEL}形象 · ${card.modelId} 画的` : ''}
                  </p>

                  {card?.photoDeleted ? <p className="cw__photo">用过照片，已删除</p> : null}

                  {shown.length > 0 ? (
                    <ul className="cw__tags">
                      {shown.map((anchor) => (
                        <li key={anchor.slot} className="cw__tag">
                          {anchor.value}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {card ? (
                    <>
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
                    </>
                  ) : null}

                  <div className="cw__actions">
                    {card ? (
                      <a className="cw__use cw__use--ghost" href={`/character/${profile.childId}`}>
                        看这一版
                      </a>
                    ) : null}
                    {/* ★ 两类孩子走两个**都已经存在**的参数，不新造一个：
                        有形象的走 `?card=`（`/create` 真的会预置第 3 步，早已实测）；
                        没形象的只能去 `/create` 从头填——创作流现在**还不收** `?child=`，
                        写一个没人读的参数就是一个点下去没反应的按钮。
                        让 `/create` 收下 `?child=` 属于"第 1 步改成选角色"那一刀。 */}
                    <a
                      className="cw__use"
                      href={card ? `/create?card=${encodeURIComponent(card.cardId)}` : '/create'}
                    >
                      {card ? '用它做一本' : '去出形象'}
                    </a>
                  </div>
                </article>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
