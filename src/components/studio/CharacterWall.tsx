import type { CSSProperties } from 'react'

import NewCharacterButton from '@/components/studio/NewCharacterButton.tsx'
import WallDelete from '@/components/studio/WallDelete.tsx'
import { assetUrlOf } from '@/lib/asset-url.ts'
import type { ChildWallItem } from '@/lib/children-list.ts'
import { dayKeyOf } from '@/lib/reading-log.ts'

/**
 * CharacterWall —— 工作台的「角色卡」那一屏：一墙贴着的角色卡
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
 *   3. **"还没出图"是一个正常状态，不是空**：刚建档的孩子就是这样，而**不拿一张示例图去顶**。
 *      相纸那一格里写"还没印出来"。
 *      ★ 2026-10-17 更新：示例孩子（小满 / 小宇）**不在这一条里了**——他们的卡
 *      随仓库发布了（`public/demo/cards/`，见 `lib/card-source.ts`），
 *      所以那两张现在有形象。变的不是这条判据，是**"有没有图"这个事实本身**：
 *      以前确实没有，所以照实说没有；现在有了，所以照实显示。
 *      "不拿一张图去顶"这条仍然管着所有**还没出图**的孩子（自己刚建的那个）。
 *
 * ★ 2026-10-15 第四轮：用户在这张卡的截图上**划掉了五处**，这一屏于是瘦了一圈。
 *   划掉的是：页头那句「每一页里那个他…」、卡上「角色卡 · 第 N 版 · N 条锚点」、
 *   读音（mǎn / yǔ）、「4-6 岁 · 水彩形象 · wan2.7-image 画的」那一行、
 *   以及那一栏「看剩下 N 条，以及这张卡凭什么算「同一个人」」。
 *   连它们带走的四个决定，逐个都有去处，不是"删了就算了"：
 *   - **版次**（第 N 版）→ 详情页的版本历史（那一屏本来就按倒序列出来了）；
 *   - **锚点数** → 卡面上就摆着三条（`VISIBLE_ANCHORS`），数得出来；
 *   - **六条锚点的全文与那句"画的与查的同源"** → 详情页的
 *     「这张卡凭什么算「同一个人」」那一格（同名的内容在那里有一份完整实现）；
 *   - **年龄与画风/模型** → 年龄在详情页的「改基础信息」里可读可改；
 *     画风是产品**唯一**那一档（`DEFAULT_STYLE_LABEL`），写在卡上等于印一句永远一样的话。
 *   ★ 唯一一处**没去处**的是 `.cw__photo`（「用过照片，已删除」）——当时留着，
 *     因为它是隐私那一条的可见凭据，不是说明文字。
 *     ★ 2026-10-16 第 23 刀它也没了（用户划掉了改版后的那句）：这一屏现在只剩
 *     「一张脸 + 一个名字 + 三条锚点」，与这条判断一致。
 *   ★ 卡片因此变成"一张脸 + 一个名字 + 三条锚点"，判断依据是**用户看这一屏要的是认人**，
 *     不是读档案。要读档案有详情页，那也是整张卡可点的去向。
 *
 * ★ 2026-10-15 第五轮：用户给了参考源码（`gitee.com/mao-yongyao/cards`，一张卡 +
 *   悬停展开）要"这样的效果"。这一屏于是变成**静止认人、悬停看他做过什么**：
 *   - 静止态只剩 脸 + 名字 + 三条锚点（连那两颗动作也**挪进悬停层**，用户点的）；
 *   - 悬停露出的是**两个真数字**——做过的书 N 本 · 最近一本哪天。★ 参考图上那两个
 *     数是编的点赞数；我们这里没有任何一个数不是从磁盘上数出来的
 *     （`children-list.ts` 的 `listWallItems`，第五轮新接的一条：卡号 → 书架）。
 *   ★ 三条**没有照搬**的地方，都是刻意的：
 *     ① 参考图那张卡是绝对居中、屏幕上只有一张，所以它"在流里长高"看不出来；
 *       我们是一面网格墙，真长高会让**下面整排跳**。所以卡在静止与悬停时
 *       **盒子一模一样大**，"长大了"那个观感由背后那张撑开的面板给（`::after`）；
 *     ② 参考图把画缩到 0.8 再把标题移上去补位；我们只缩到 0.9，因为卡本来就已经
 *       抬了 10px，缩得太狠会读成"图跑了"；
 *     ③ 参考图那颗按钮是 See More；我们的按钮指向详情页，而**整张卡也指向详情页**——
 *       留着它是因为它是这一层唯一的"主句"，不是因为它是唯一的出口。
 *
 * ★ 卡面上的动作是 `看这一版 / 看他的档案`（→ `/character/<childId>`），
 *   加上自建孩子才有的 `删掉他`（→ 详情页那一节，见下面那条）——
 *   ★ 第五轮起这两颗**住在悬停层里**（`character-wall.css` 的 `.cw__reveal`）。
 *   用户划掉的「用它做一本」**整颗删了**，删得掉的理由是查过之后成立的：
 *   首页 `/home` 那颗角色卡选择器走的就是同一个 `/create?card=`（`CreateLanding.tsx:171`），
 *   而没有形象的孩子，详情页里那条「去出一张形象」也还在——**它不是唯一的路**。
 *   ★ 而且**整张卡本身可点**（`.cw__open` 那层覆盖）——上一版有"抬起来"的悬停
 *     却没有点击目标，那个落差就是用户说"不像一张卡片"的实际所指。
 *   ★ 动作挪走之后，**名字本身成了链接**（静止就看得见、键盘 Tab 得到）。
 *     那不是顺手加的：悬停层静止时是 `visibility: hidden`，里面的东西
 *     **不进 Tab 序列也不进可见树**，所以名字是键盘与读屏的那条路——
 *     聚焦它 → `:focus-within` 把这一层打开 → 再 Tab 才够得到那两颗。
 *     悬停层是**加法**（鼠标的捷径），不是无障碍路径；这与 `.cw__open` 同一条理由。
 *
 * ★ 参考图里那支铅笔**仍然没有**，但理由换了：改档案（名字/读音/年龄/标签）
 *   这一轮做到了**详情页**上（`ChildDetail.tsx` 的「改基础信息」+ `PATCH /api/children/<id>`）。
 *   卡上不放铅笔，是因为一个 27px 的名字旁边摆一支笔，会让人以为改的是**卡**，
 *   而卡改的是锚点、走的是"提建议再画一版"那条完全不同的路。
 *
 * ★ 垃圾桶（2026-10-16 改）：它现在是**就地弹窗**，不再链去详情页。
 *   用户的原话："现在的删除是点击删除之后进入人物详细页才能删除，改一下，
 *   用户在卡片那点击删除之后，就直接出现一个弹窗，询问用户是否删除"。
 *   ★ 一屏之隔换来了同一件事只写一遍：确认框与凭据住在 `DeleteChildDialog.tsx`
 *   （`WallDelete.tsx` 只是那颗按钮 + 开关状态），而详情页底下那一节用的是
 *   **同一个组件**——"两份会说不同的数"这条担心是靠**先把它抽出来**解决的，
 *   不是靠"这次先拷一份"。
 *   ★ 示例角色的卡面上**仍然不渲染这一颗**（`source === 'demo'`）；
 *     服务端那侧对示例 id 一律 403 并说明理由，那才是守卫
 *     （★ 而 `DeleteChildDialog` 会把那句 403 的原话显示出来——
 *     本机覆盖过同 id 档案时这颗会露出来，点开也有一句解释，不是无声拒绝）。
 *
 * ★ `＋新建角色` 现在指 `/character/new` 了（工单 03 第二刀）。它以前指 `/create`，
 *   理由是"建卡本来就在创作流里，不新造第二条路"——**那个理由已经不成立**：
 *   建卡有两条路了（从零描述 / 用他的照片），而第二条要一次单独同意，
 *   塞进创作流的节奏里两边都做不好。创作流第 1 步仍然能新建，
 *   两处收的是同一份判据（`creation/state.ts` 的 `stepProblems`）。
 */

export type CharacterWallProps = {
  items: ChildWallItem[]
}

/** 卡面上摆几条锚点。★ 三条：再多这一张卡就从"档案"变成"表格"了 */
const VISIBLE_ANCHORS = 3

/**
 * 「最近一本」那一天。★ **不另写一个日期格式化器**：`dayKeyOf` 已经是这个仓库
 * 对"哪一天"的既有答案（`lib/reading-log.ts`，书架那一屏也这么显示），
 * 而且它的注释写着为什么不用 `toISOString()`——那是 UTC，晚上做的书会被算到第二天。
 */
function lastBookLabel(at: number | null): string {
  return at === null ? '' : dayKeyOf(new Date(at))
}

export default function CharacterWall({ items }: CharacterWallProps) {
  return (
    <section className="cw">
      <header className="cw__head">
        <div>
          {/* ★ 这一屏的名字跟着侧栏走（用户 2026-10-15 提的）：入口叫「角色卡」，
              因为这一屏列的是**卡**。左上角那颗品牌字仍然是「小主角」——
              那是产品名，不是这一屏的名字。 */}
          <h1 className="cw__title">角色卡</h1>
        </div>
        {/* ★ 这一颗现在是客户端组件（`NewCharacterButton`）：没登录时它要先弹一个
            「请先登录」，而 `<Link>` 拦不住自己那一下导航。整面墙仍然是服务端组件。 */}
        <NewCharacterButton />
      </header>

      {items.length === 0 ? (
        <div className="cw__empty">
          <p>还没有小主角。先说孩子是谁，再出一张形象——两样都在新建那一屏上。</p>
          <NewCharacterButton className="cw__cta">去新建一个</NewCharacterButton>
        </div>
      ) : (
        <ul className="cw__wall">
          {items.map((item, index) => {
            const { profile, card, source, books } = item
            const shown = card?.anchors.slice(0, VISIBLE_ANCHORS) ?? []
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

                  {/* `.cw__show` = 参考图的 `.show-wrapper`：悬停时**整块**上移一点，
                      给下面腾出位置。它只管位移，不管显隐 */}
                  <div className="cw__show">
                    {/* 相纸那一层：白边 + 虚线内框，图压在框里。
                        ★ 走原生 <img>：图在资产根里、经 /api/assets 出来，
                        next/image 要另配 loader，而它是 README §五「刻意未做」那一条。
                        ★ 取 768 那一档而不是原图：卡面显示 372 CSS px，两倍屏要 744。
                        原图那两档都实测过——照片做出来的卡是 **2.7 MB 的 1440² PNG**，
                        示例卡（10-16 手工出图那两张，896×1200）是 **327 / 349 KB 的 JPEG**。
                        768 档落在 73–76 KB，所以这一屏无论遇上哪一档都不会去拉原图。
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

                    {/* ★ 名字是**链接**（第五轮）。理由不是"顺手让它可点"：
                        悬停层静止时 `visibility: hidden`，里面的动作既不可聚焦
                        也不在可见树里，所以**名字是键盘与读屏那唯一的一条路**——
                        聚焦它 → `:focus-within` 打开悬停层 → 再 Tab 才够得到那两颗。 */}
                    <h2 className="cw__name">
                      <a className="cw__name-link" href={`/character/${profile.childId}`}>
                        {profile.name}
                      </a>
                      {/* ★ "示例"两个字标在**来源**上（档案是从 public/demo 读到的），
                          不是档案里的一个字段——字段会说谎，来源不会。
                          而且这里不许出现"你的孩子"这类指代：它不是谁的孩子，
                          它是一张用来"先看看效果"的示例（用户 10/13 定的口径）。 */}
                      {source === 'demo' ? <span className="cw__demo">示例</span> : null}
                    </h2>

                    {/* ★ 2026-10-16 第 23 刀：这一行**整块删了**。
                       它是「用过照片，已删除」（第 22 刀改成「照照片画的，原图没留」，
                       用户还是划掉："照照片画的，原图没留这句话不要"）。
                       ★ 于是那句隐私话在界面上**没有落点**了——第 22 刀把 `NewChild`
                       结果页那段"原图从来没有被存下来"删掉时，我把它搬到了这里；
                       现在这一行也没了。**判据一个字没动**（`photoDeleted` 照旧在
                       `cards-list.ts` 里算、照旧传进来，只是不再显示）。
                       要再放回去，先想清楚放哪儿——别再用"刚好这张卡上有这一行"来决定。 */}

                    {/* ── 同一格里叠着的两层：三条锚点 与 悬停才露出来的那一层 ────
                        ★ 两层共用**一个网格格**（见 `.cw__fold`），所以这一格的高度
                          自动是两者的较大值：静止时标签在上面、露出层藏着，
                          悬停时标签淡出、露出层淡入——**交叉溶解在同一处**，
                          而且卡的高度在静止与悬停时**一模一样**（不会顶到下一排）。
                        ★ 这也是为什么它俩不是"前者占位、后者绝对定位"：
                          绝对定位要靠手算的偏移量才能不压到名字，而偏移量随卡宽变；
                          交给网格，"有没有地方"是**算出来的**，不是估的。 */}
                    <div className="cw__fold">
                      {shown.length > 0 ? (
                        <ul className="cw__tags">
                          {shown.map((anchor) => (
                            <li key={anchor.slot} className="cw__tag">
                              {anchor.value}
                            </li>
                          ))}
                        </ul>
                      ) : null}

                      {/* 两个数是从磁盘上数出来的（`listWallItems`）。**没有一个是编的**：
                          参考图那张卡上写的是 13k / 14k 的点赞数，那种数这个产品永远不会有。 */}
                      <div className="cw__reveal">
                        <p className="cw__stats">
                          {books.count > 0 ? (
                            <>
                              <span className="cw__stat">
                                <span className="cw__stat-num">{books.count}</span> 本书
                              </span>
                              <span className="cw__stat-sep" aria-hidden="true" />
                              <span className="cw__stat">
                                最近 {lastBookLabel(books.lastCreatedAt)}
                              </span>
                            </>
                          ) : (
                            /* ★ 0 本如实说"还没做过书"，不显示一个 0：一个 0 在这里
                               读起来像"数据没读出来"，而这一句是**事实**，不是缺省值 */
                            <span className="cw__stat cw__stat--none">还没做过书</span>
                          )}
                        </p>

                        <div className="cw__reveal-actions">
                          {/* ★ 两类孩子都给了这一颗：没有形象的孩子也有详情页
                              （那里写着"这个孩子还没有形象" + 一条去出形象的出口）。
                              原来只在有卡时渲染，于是"整卡可点"对那一类孩子是**点进一个空位**。
                              ★ 第五轮从卡面挪进这一层，并且**从 ghost 改成填色**：
                              它是这一层唯一的"主句"（参考图那颗 See More 也是填色的）。
                              原来那半句"实心按钮压在整张可点的卡上会让人以为别处不能点"
                              在这里不成立——它们本来就指向同一处。 */}
                          <a className="cw__use" href={`/character/${profile.childId}`}>
                            查看详情
                          </a>
                          {/* ★ 这里原来还有一颗「用它做一本」（→ `/create?card=`），
                              2026-10-15 第四轮**按用户划掉的记号删掉了**。
                              删得掉的理由是查过之后成立的：**它不是唯一的那条路**——
                              首页 `/home` 那颗角色卡选择器选完人就 `params.set('card', …)`
                              （`CreateLanding.tsx:171`），走的正是同一个 `/create?card=`；
                              而没有形象的孩子，详情页里那条「去出一张形象」也还在。 */}
                          {/* 删除的入口（2026-10-16 起**就地弹窗**，见文件头那一条）。
                            ★ 只有这一颗是客户端组件：整面墙还是服务端组件，
                              于是墙上其他一切都不为这个动作多付一字节的 JS。
                            ★ 示例角色的卡面上**不渲染这一颗**（用户提的正是"系统提供的不给删除"）。
                              但这是显示层的取舍，不是守卫：服务端 `refuse()` 对示例 id 一律 403，
                              并说明"他的档案在 public/demo/ 里，硬删会让下一次列目录他回来但没有形象"。
                              `source` 与那个守卫不完全等价（本机可能覆盖过同 id 的档案），
                              那种情形这颗会露出来、点开被拒绝并**显示服务端那句原话**——
                              比在卡上再编一个判断可靠。 */}
                          {source === 'demo' ? null : (
                            <WallDelete childId={profile.childId} name={profile.name} />
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 整卡可点的那层覆盖（`character-wall.css` 的 `.cw__open`）。
                      ★ `aria-hidden` + `tabIndex=-1` 是**故意的**：无障碍路径是上面那颗
                        有名字的链接，这一颗只是鼠标的捷径。两个都能 Tab 到同一处的话，
                        键盘用户在这张卡上要按两次 Tab 才跳得过去。
                      ★ 它必须排在悬停层**之前**：它靠 `z-index: 1` 压在卡面上，
                        而悬停层那两颗是 `z-index: 2` 抬在它上面的 */}
                  <a
                    className="cw__open"
                    href={`/character/${profile.childId}`}
                    aria-hidden
                    tabIndex={-1}
                  />
                </article>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
