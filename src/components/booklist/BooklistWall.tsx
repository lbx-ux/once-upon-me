/**
 * BooklistWall —— 「灵感书单」那一屏：12 个主题，12 本样书
 *
 * 这一屏要回答的问题只有一个
 *
 * 首页环上那 12 个主题，点进去现在是"挑个主题去创作"——那是入口。
 * 这一屏补的是出口长什么样：同样是那 12 个主题，每个主题都有一本已经写好的
 * 完整绘本，翻开就能读、就有配音稿。生成整本那条流水线还在做的时候，
 * 这是唯一能让人真的看见成品的地方（评审尤其）。
 *
 * 所以这一屏不是内容库：那 12 本不是挑给谁家孩子的，它们是人写的样书。
 *   这句话挂在这一屏唯一一行说明里，也挂在每张卡点进去之后的阅读器上。
 *   一个把"展示样品"和"你孩子的书"混在一处的入口，两条路都会被读错。
 *
 * 三条实现上的讲究
 *
 * 1. 它是服务端组件，因为"哪些图到了"这件事只有服务端知道（`lib/booklist-assets.ts`
 *    问盘）。卡上因此能如实写"画还在画 · 5/8"，而不是永远显示一张假装存在的封面。
 * 2. 封面缺席时不做空框：一张 `--card-paper` 的纸 + 主题 emoji。
 *    这正是 `THEMES[].emoji` 这个字段还留着的用途。书架上那本没有封面的书
 *    走的是同一条兜底，但用的是中性的 📖 而不是主题 emoji——书里没有主题字段
 *    （`Book` 上没有，书号里的指纹也推不回来），拿一个猜的主题图标比拿一个通用
 *    图标更糟：它会看起来像知道这是哪一本。
 * 3. 不加 `loading="lazy"`：12 张封面就是这一屏的内容本身，且第一行就落在首屏里
 *    （书架主题墙那次实测：对首屏内的图用 lazy，12 张里 11 张不加载）。
 */

import Link from 'next/link'

import { SPREADS_PER_BOOK, PAPER_PAGES_PER_BOOK } from '@/components/booklist/booklist.ts'
import type { BooklistEntry } from '@/lib/booklist-assets.ts'
import { THEMES } from '@/lib/themes.ts'

const THEME_BY_KEY = new Map(THEMES.map((theme) => [theme.key, theme]))

export type BooklistWallProps = {
  entries: BooklistEntry[]
}

export default function BooklistWall({ entries }: BooklistWallProps) {
  return (
    <section className="blw">
      <header className="blw__head">
        <h1 className="blw__title">灵感书单</h1>
        {/* ★ 一句话说清"这是什么书"。它压在天空带上，所以用 --ink-on-sky，
            与 `.shelf__sub` / `.vc__sub` 同一条规矩（`scripts/check-scrim.mts` 钉着）。
            （原来举的例子是「创作」那一屏的 `.cl__sub`，它 2026-10-15 撤了——
            这里换成本屏的同伴，免得下一个照着找的人扑空。） */}
        {/* ★ 这一段里**不许换行**：JSX 把文本中间的换行折成一个空格，而中文句子
            中间多出一个空格是看得见的（旧句「翻开就能读。 这 12 本」就是这么来的）。
            现在这一句短、prettier 不会折它；留着 `prettier-ignore` 是为了下一次
            有人把它改长时，这道闸还在。 */}
        {/* prettier-ignore */}
        <p className="blw__sub">先翻翻这 12 本<b>样书</b>，再去为孩子做一本专属的。</p>
      </header>

      <ul className="blw__grid">
        {entries.map(({ book, coverUrl, artReady, narrated }) => {
          const theme = THEME_BY_KEY.get(book.key)
          const complete = artReady === SPREADS_PER_BOOK
          return (
            <li key={book.key}>
              <Link className="blw__card" href={`/booklist/${book.key}`}>
                <span
                  className="blw__art"
                  style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : undefined}
                  data-ready={coverUrl ? 'true' : undefined}
                >
                  {/* 封面还没到位：一张纸 + 主题 emoji。不留空框、不留裂图 */}
                  {!coverUrl && (
                    <span className="blw__glyph" aria-hidden="true">
                      {theme?.emoji ?? '📖'}
                    </span>
                  )}
                </span>

                <span className="blw__body">
                  <span className="blw__book">{book.title}</span>
                  <span className="blw__blurb">{book.blurb}</span>
                  <span className="blw__meta">
                    <span className="blw__theme">{theme?.label ?? book.key}</span>
                    <span className="blw__pages">{PAPER_PAGES_PER_BOOK} 页</span>
                    {/* ★ "有朗读"只在整本 8 段都在时才写 —— 与阅读器那条判据同一个数。
                        没有的**不写"无朗读"**：一本还没有录音的样书不需要一直道歉 */}
                    {narrated && <span className="blw__audio">有朗读</span>}
                  </span>
                  {/* 画没齐时如实写一行。它在卡片底部，出完一本少一行 */}
                  {!complete && (
                    <span className="blw__todo">
                      画还在画 · {artReady}/{SPREADS_PER_BOOK}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
