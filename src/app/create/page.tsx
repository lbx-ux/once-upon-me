import { redirect } from 'next/navigation'

import GenerationRun from '@/components/creation/GenerationRun.tsx'
import type { RunPlan } from '@/components/creation/GenerationRun.tsx'
import ResumeLastRun from '@/components/creation/ResumeLastRun.tsx'
import { listChildPicker } from '@/lib/children-list.ts'
import { assetRoot } from '@/lib/books-runtime.ts'
import { createFsStore, isDraft, manifestPathOf, type Book } from '@/lib/engine/index.ts'
import { DEFAULT_PAGES } from '@/lib/creation/state.ts'
import { THEMES } from '@/lib/themes.ts'

/**
 * /create —— **运行视图**（工单 05/06）
 *
 * 这一屏从"创作流的第一步"变成了"这一轮生成的唯一一屏"：
 * 四步表单（孩子是谁 / 想讲什么 / 角色卡 / 生成）已经整条删掉，
 * 该问的那三件事在 `/home` 那一屏上问过了（`CreateLanding` + 那个弹窗）。
 *
 * 两个入口，两条完全不同的路：
 *
 * | URL                                        | 做什么                                   |
 * | ------------------------------------------ | ---------------------------------------- |
 * | `?wish=&theme=&card=&pages=&voice=`         | 开跑一本新的                              |
 * | `?book=<bookId>`                            | 接着做一份草稿（重放过程，不重跑、不重花） |
 *
 * ★ **参数不全就回 `/home`**，不在这一屏摆一个"还没开始"的空态：
 *   这一屏没有"这一轮"就无事可做，而"写一句话"这件事只有一个地方能写
 *   （`CreateLanding` 那张纸）。摆一个空表单在这里，就是从第二天起开始漂的第二条路径。
 *
 * ★ 取数全在**服务端**（与 `/home`、`/shelf` 同一条做法）：孩子那份档案要按卡号反查
 *   （`listChildPicker`），草稿要读盘。放在客户端 fetch 的话，运行视图会先空一帧再跑，
 *   而"空一帧"在这一屏意味着**先显示一圈转、再开始生成**。
 */

export const dynamic = 'force-dynamic'

export const metadata = { title: '开始创作 · 小主角' }

/**
 * 页数的上下界，**只做校验**。
 * ★ 上界 30 / 下界 3 与 `book-api.ts` 那条校验是同一对数（那边是权威，这里是"地址栏
 *   被人手改成 999 时不至于把请求发出去"）。★ 缺省值不在这里另写一个 8：
 *   它从 `state.ts` 的 `DEFAULT_PAGES` 来——那一个是弹窗摆给用户挑的那个默认。
 */
const MIN_PAGES = 3
const MAX_PAGES = 30

function str(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

export default async function CreatePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams

  /* ── 接着做一份草稿 ──────────────────────────────────────────────────── */

  const bookId = str(params['book'])
  if (bookId !== '') {
    const store = await createFsStore(assetRoot())
    let book: Book | null
    try {
      book = await store.readJson<Book>(manifestPathOf(bookId))
    } catch {
      book = null
    }
    // 读不到就当它不在了（另一台机器删过、或半截 JSON）：回 /home，不编一个空壳出来
    if (!book) redirect('/home')
    return (
      <GenerationRun
        resume={{
          bookId,
          // ★ 配音开没开**看 `voiceId`，不看 `narrations` 空不空**：
          //   后者为空有"不做"与"没做成"两种成因（见 `Book.voiceId`）
          voiceOn: book.voiceId !== undefined,
          published: !isDraft(book),
          // 重配要用它：改过正文之后那一页原来那份录音还能推出来音色，
          // 但**当初就没配上的那几页**没有前一份可推——而重配正是为它们准备的
          ...(book.voiceId ? { voiceId: book.voiceId } : {}),
        }}
      />
    )
  }

  /* ── 开跑一本新的 ────────────────────────────────────────────────────── */

  const wish = str(params['wish'])
  const cardId = str(params['card'])

  /* 什么都没带（书签、手打地址、从别处点进来）：先试着找回"刚才那一本"。
     ★ 这一步必须在**客户端**做——书号在 `sessionStorage` 里，服务端读不到。
       找不到时它自己回 `/home`（不在这里 `redirect`，那样就把上一条路堵死了）。 */
  if (wish === '' && cardId === '') return <ResumeLastRun />

  // 卡反查孩子。★ 卡上带着 childId，所以"哪张卡"与"谁"是同一件事的两种指法
  //   （`CreateFlow` 当年那段 `?card=` 反查就是这一条，搬过来而已）
  const children = await listChildPicker()
  const owner = children.find((item) => item.card?.cardId === cardId)
  // 找不到那个孩子/那张卡（或只带了一半参数）：回 /home。
  // 那一屏会在"还没有小主角"时把人送去建一个，比在这里说一句"卡不存在"更有用。
  // ★ 这一条是**服务端**的重定向，与上面那条不一样：这里没有"刚才那一本"可找——
  //   用户明确带着一句话进来了，只是缺一张卡
  if (!owner || !owner.card) redirect('/home')

  const themeKey = str(params['theme'])
  const themeLabel = THEMES.find((item) => item.key === themeKey)?.label ?? ''
  const pagesRaw = Number(str(params['pages']))
  const pages =
    Number.isInteger(pagesRaw) && pagesRaw >= MIN_PAGES && pagesRaw <= MAX_PAGES
      ? pagesRaw
      : DEFAULT_PAGES
  // `voice=off` 是"这一本不配音"的显式表示；有值就是音色 id。
  // ★ 两个都要能表达：不传（老书签）与传 off（用户关掉了那个开关）不是一回事，
  //   但**都落到"不配音"**，所以这里合成一个判断就够了
  const voiceRaw = str(params['voice'])
  const voiceId = voiceRaw === '' || voiceRaw === 'off' ? undefined : voiceRaw

  const plan: RunPlan = {
    form: {
      child: {
        childId: owner.childId,
        name: owner.name,
        nameReading: owner.nameReading,
        ageBand: owner.ageBand,
        /* ★ 性别要跟着过去（2026-10-16）。它从 `listChildPicker` 那道窄投影来，
           而这一整条是**逐页 prompt 里那个称呼**的唯一来源：卡上的七条锚点里
           没有性别词，`childWordOf(lookTags)` 也就推不出来——用户在 `/home` 上
           选的那一档，就是这里丢掉的那一档（"我提供给你的是男孩子，怎么生成出来
           有男孩有女孩子"）。有才带：老档案与示例孩子都没有这一栏。 */
        ...(owner.gender ? { gender: owner.gender } : {}),
        lookTags: [...owner.lookTags],
        interestTags: [...owner.interestTags],
      },
      cardId: owner.card.cardId,
      // ★ 与创作流当年那段 `wishFrom` 同一条：挑了主题模板就带上主题名，
      //   那句话仍然是主输入（`toBookBody` 里 `theme || wish` 的顺序就是这件事）
      theme: { theme: themeLabel, wish },
    },
    pages,
    ...(voiceId ? { voiceId } : {}),
  }
  return <GenerationRun plan={plan} />
}
