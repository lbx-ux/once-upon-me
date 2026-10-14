'use client'

/**
 * CreateLanding —— 工作台「创作」那一屏：一句话进去
 *
 * 版式照用户给的那张参考图：大标题（两边两笔手绘小装饰）→ 一行说明 →
 * 两颗胶囊（小主角 / 画风）→ 一张输入卡（下沿：提示语 + 灵感 + 提交）→ 三条建议。
 *
 * ★ 它**不自己造一套表单**：这一句话交给 `/create?wish=…&theme=…&card=…`，
 *   创作流里那四步（孩子 / 想讲什么 / 角色卡 / 生成）一步都不少。
 *   也就是说这一屏是**入口**，不是另一条生成路径——两条路径迟早会漂。
 *
 * 三处与参考图不同，都是刻意的：
 *   1. 提示语写"想讲什么故事"，不写参考图那句"描述要生成的画面"——
 *      这个产品生成的是**书**，不是图。说成画面会让人以为只出一张图。
 *   2. 画风那一格是**一个事实**，不是一个下拉：产品现在只有一档画风
 *      （`DEFAULT_STYLE_FRAGMENT`，建卡时写死 warm-handdrawn）。摆一个点开只有一项的
 *      选择器，是在教用户以为这里有得挑。
 *   3. 参考图里那颗"分享/导出"样的图标没做：这一屏没有可分享的东西（书还没生成）。
 *      一颗点了没反应的按钮不如没有。
 *
 * ★ 「小主角」那一格只列**已经存在的卡**，头像取 240 那一档（实测 10 KB）。
 *   上一版刻意不放头像，理由是"原图 2,772,224 字节，不该为一个 20px 的圆点拉两兆多"——
 *   那个判断没错，错的是当时没有缩略图这条路。现在有了（`lib/thumbs.ts`），判断跟着改。
 *   名字读不到时退回 childId（机器名），不编一个好听的说。
 */

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { nextExample, suggestions } from '@/lib/creation/example-wishes.ts'
import { DEFAULT_STYLE_LABEL } from '@/lib/prompts/character-sheet.ts'
import { THEMES } from '@/lib/themes.ts'

export type ChildOption = {
  cardId: string
  childId: string
  revision: number
  modelId: string
  /** 档案层读到的名字。★ 可选不是装饰性的省略：卡上本来没有名字这个字段 */
  label?: string
  /** 240 档的头像 URL */
  faceUrl: string
}

export default function CreateLanding({ cards }: { cards: ChildOption[] }) {
  const router = useRouter()
  const [wish, setWish] = useState('')
  /** 跟着示例句走的那条主题。用户自己打字时它保留上一次的值（清空是丢信息） */
  const [theme, setTheme] = useState<string | null>(null)
  const [exampleAt, setExampleAt] = useState(0)
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const pickRef = useRef<HTMLDivElement>(null)

  const ready = wish.trim() !== ''
  const chosen = cards.find((card) => card.cardId === picked) ?? cards[0] ?? null
  const chipList = suggestions()

  // 弹出层：Esc 与点外面都收。与抽屉同一套习惯，不另发明一套
  useEffect(() => {
    if (!picking) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPicking(false)
    }
    const onDown = (event: MouseEvent): void => {
      if (!pickRef.current?.contains(event.target as Node)) setPicking(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [picking])

  const submit = (): void => {
    if (!ready) return
    const params = new URLSearchParams({ wish: wish.trim() })
    if (theme) params.set('theme', theme)
    if (chosen) params.set('card', chosen.cardId)
    router.push(`/create?${params.toString()}`)
  }

  const rollExample = (): void => {
    const item = nextExample(exampleAt)
    setExampleAt(exampleAt + 1)
    setWish(item.text)
    setTheme(item.theme)
  }

  const applyChip = (text: string, key: string): void => {
    setWish(text)
    setTheme(key)
  }

  return (
    <section className="cl">
      <h1 className="cl__title">
        {/* 两笔手绘装饰：纯装饰，读屏不念（aria-hidden）。静止模式下不飘 */}
        <svg className="cl__doodle cl__doodle--spark" viewBox="0 0 40 40" aria-hidden="true">
          <path d="M14 4c1.6 6.4 4.6 9.4 11 11-6.4 1.6-9.4 4.6-11 11-1.6-6.4-4.6-9.4-11-11 6.4-1.6 9.4-4.6 11-11Z" />
          <path d="M31 24c.7 2.8 2 4.1 4.8 4.8-2.8.7-4.1 2-4.8 4.8-.7-2.8-2-4.1-4.8-4.8 2.8-.7 4.1-2 4.8-4.8Z" />
        </svg>
        今天想讲一个什么样的故事？
        <svg className="cl__doodle cl__doodle--leaf" viewBox="0 0 44 44" aria-hidden="true">
          <path d="M6 34c2-14 12-24 32-27-2 17-12 26-26 27" />
          <path d="M12 33c6-8 13-14 22-19" />
        </svg>
      </h1>

      <p className="cl__sub">
        选好小主角，把想讲的那句话写下来就能开始。画风这一版只有{DEFAULT_STYLE_LABEL}一种，
        所有示例图都是它画的。
      </p>

      <div className="cl__pills">
        <div className="cl__pick" ref={pickRef}>
          {cards.length > 0 ? (
            <>
              <button
                type="button"
                className="cl__pill"
                onClick={() => setPicking((prev) => !prev)}
                aria-expanded={picking}
                aria-haspopup="listbox"
              >
                {/* 头像 240 档（实测 10 KB）。alt 留空：名字就在旁边，读屏不必再念一遍 */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="cl__pill-face" src={chosen.faceUrl} alt="" width={24} height={24} />
                <span className="cl__pill-text">{chosen.label ?? chosen.childId}</span>
                <span className="cl__pill-caret" aria-hidden="true">
                  ⌄
                </span>
              </button>
              {picking && (
                <ul className="cl__options" role="listbox">
                  {cards.map((card) => (
                    <li key={card.cardId}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={card.cardId === chosen?.cardId}
                        className="cl__option"
                        onClick={() => {
                          setPicked(card.cardId)
                          setPicking(false)
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          className="cl__pill-face"
                          src={card.faceUrl}
                          alt=""
                          width={24}
                          height={24}
                        />
                        <span className="cl__option-name">{card.label ?? card.childId}</span>
                        <span className="cl__option-meta">
                          第 {card.revision} 版 · {card.modelId} 画的
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <span className="cl__pill cl__pill--plain">
              <span className="cl__pill-dot" aria-hidden="true" />
              还没有小主角——进去第一步就是定他
            </span>
          )}
        </div>

        <span className="cl__pill cl__pill--plain" title="这一版只有一档画风，所以这里不是下拉">
          <span className="cl__swatch" aria-hidden="true" />
          {DEFAULT_STYLE_LABEL}
        </span>
      </div>

      <div className="cl__card">
        <label className="cl__field">
          <span className="cl__sr">想讲什么故事</span>
          <textarea
            className="cl__input"
            value={wish}
            rows={3}
            placeholder="例如：朵朵抱着月亮，轻轻走过屋顶"
            onChange={(event) => setWish(event.target.value)}
            onKeyDown={(event) => {
              // Ctrl/⌘+Enter 提交：写故事的人会用回车换行，不能抢走回车
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault()
                submit()
              }
            }}
          />
        </label>

        <div className="cl__bar">
          <p className="cl__hint">一句话就够，进去之后还能改，也可以不写、直接挑一个主题。</p>
          <div className="cl__actions">
            <button
              type="button"
              className="cl__dice"
              onClick={rollExample}
              aria-label="换一句灵感"
              title="换一句灵感（填进输入框，可以照改）"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="5" />
                <circle cx="8.5" cy="8.5" r="1.4" />
                <circle cx="15.5" cy="8.5" r="1.4" />
                <circle cx="12" cy="12" r="1.4" />
                <circle cx="8.5" cy="15.5" r="1.4" />
                <circle cx="15.5" cy="15.5" r="1.4" />
              </svg>
            </button>
            <button
              type="button"
              className="cl__go"
              onClick={submit}
              disabled={!ready}
              aria-label="开始创作"
              title={ready ? '开始创作' : '先写一句话'}
            >
              ↑
            </button>
          </div>
        </div>
      </div>

      <ul className="cl__chips">
        {chipList.map((item) => {
          const theme0 = THEMES.find((each) => each.key === item.theme)
          return (
            <li key={item.theme}>
              <button
                type="button"
                className="cl__chip"
                onClick={() => applyChip(item.text, item.theme)}
                data-active={theme === item.theme && wish === item.text ? 'true' : 'false'}
              >
                <span className="cl__chip-emoji" aria-hidden="true">
                  {theme0?.emoji ?? ''}
                </span>
                {item.text}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
