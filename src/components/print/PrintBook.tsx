/**
 * PrintBook —— 一本书摊成几张纸（2026-10-29）
 *
 * 纯展示：进来的是 `printSheetsOf()` 算好的那串纸，这一层只管每张纸长什么样。
 * 版式会错的那一半（顺序、缺图占不占纸、两条支怎么标）在 `lib/print-sheets.ts` 里，
 * 那里有用例钉着；这一层改坏的只有"看起来不对"，不是"印少了一页"。
 *
 * 封面还有一处分叉，也只在这里开个开关：**有封面图出两栏（图占右栏、书名占左栏），
 * 没图出居中书名页**——就是那个 `data-art`。两栏的算法（53% = 210mm × 0.75）写在
 * `print-book.css` 的 `.print-sheet--cover[data-art]` 上面，这里一个尺寸都不写。
 *
 * 三条判断
 *
 * 1. **一张纸正好一页 A4 横向，尺寸写在 CSS 里（297mm × 210mm），不在这里内联。**
 *    屏幕上的预览与打印出来的那一张必须是同一个盒子——两处各写一遍尺寸，
 *    迟早会变成"屏幕上看着刚好、打印时下一页的第一行被切掉"。
 * 2. **图 `object-fit: cover`：满版，铺到纸的四条边。**
 *    ★ 2026-10-30 第四版。纸的边距收成 0 之后，`contain` 会在上下各留 23px 纸色
 *    （1123 × 794 的纸上图只有 1123 × 748）——用户圈出来的就是那道边。
 *    换成 `cover` 要裁掉左右各 34px（约 9mm、2.9%）：3:2 的页图摊在 1.414 的 A4 上，
 *    差的这 6% 必须落在某一边，落在画的两侧好过留在纸上。
 *    （方图会被裁掉上下各 7.5%——演示书那几张 1440×1440 是旧版生成尺寸的遗留，
 *     账记在 `print-book.css` 与 docs/known-tradeoffs.md，不为一本样书加一套换算法。）
 * 3. **缺那一页的图时，纸上照实说"没有生成出来"。**
 *    留一张空白页等于假装这一页本来就没有图（`print-sheets.ts` 文件头第 3 条）。
 * 4. **用原生 `<img>`，不用 `next/image`。** 这一屏的判据是"纸上的像素就是盘上那一份"
 *    （预览即成品），而 `next/image` 会在中间再缩一次、再换一种压缩——
 *    打印出来的清晰度就不再由 `thumbs.ts` 那一档说了算。全站不迁 `next/image`
 *    的理由见评分报告 §4.3，这里是同一条的第二个落点。
 */

import type { PrintSheet } from '@/lib/print-sheets.ts'

export default function PrintBook({ sheets }: { sheets: readonly PrintSheet[] }) {
  return (
    <div className="print-book">
      {sheets.map((sheet, index) =>
        sheet.kind === 'cover' ? (
          <section
            className="print-sheet print-sheet--cover"
            key="cover"
            aria-label="封面"
            /* 有图才有两栏（图在右、书名在左）；没图的书出居中的书名页 */
            data-art={sheet.imageUrl ? '' : undefined}
          >
            {sheet.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="print-sheet__cover-art" src={sheet.imageUrl} alt="" />
            ) : null}
            <div className="print-sheet__cover-front">
              <h1 className="print-sheet__title">{sheet.title}</h1>
              <p className="print-sheet__brand">小主角 · Once Upon Me</p>
            </div>
          </section>
        ) : (
          <section
            className="print-sheet"
            key={sheet.nodeId}
            data-branch={sheet.branch ?? undefined}
            aria-label={`第 ${index} 页`}
          >
            <div className="print-sheet__art">
              {sheet.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="print-sheet__image" src={sheet.imageUrl} alt="" />
              ) : (
                /* 缺图兜底：一句人话，不是一张碎图标（与界面上那条同一条纪律）。
                   页号写在这里，因为印出来的书没有别的办法指出是哪一页缺了 */
                <p className="print-sheet__absent">
                  这一页的图没有生成出来（第 {sheet.pageNo} 页）。
                </p>
              )}
            </div>

            {/* 正文叠在左下角（与屏幕上那本同一处、同一层纸色渐变）——
                位置的理由写在 `print-book.css` 的 `.print-sheet__text` 上面 */}
            <div className="print-sheet__text">
              {sheet.branchLabel ? (
                <p className="print-sheet__mark">如果孩子选了「{sheet.branchLabel}」</p>
              ) : null}

              {sheet.body.map((line, lineIndex) => (
                <p key={lineIndex}>{line}</p>
              ))}

              {sheet.choice ? (
                <div className="print-sheet__choice">
                  <p className="print-sheet__prompt">{sheet.choice.prompt}</p>
                  <ul className="print-sheet__options">
                    {sheet.choice.options.map((option) => (
                      <li key={option.label}>
                        <span className="print-sheet__emoji" aria-hidden="true">
                          {option.emoji}
                        </span>
                        {option.label}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <span className="print-sheet__no">{index}</span>
            </div>
          </section>
        ),
      )}
    </div>
  )
}
