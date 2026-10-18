import { redirect } from 'next/navigation'

import GenerationRun from '@/components/creation/GenerationRun.tsx'
import type { RunPlan } from '@/components/creation/GenerationRun.tsx'
import ResumeLastRun from '@/components/creation/ResumeLastRun.tsx'
import { listChildPicker } from '@/lib/children-list.ts'
import { assetRoot } from '@/lib/books-runtime.ts'
import { createUserStore, userSliceRoot } from '@/lib/asset-scope.ts'
import { currentUserId } from '@/lib/auth/session.ts'
import {
  isDraft,
  manifestPathOf,
  BOOK_FORMS,
  type Book,
  type BookForm,
} from '@/lib/engine/index.ts'
import { readStory } from '@/lib/story-draft.ts'
import { DEFAULT_PAGES } from '@/lib/creation/state.ts'
import { THEMES } from '@/lib/themes.ts'

/**
 * /create —— **运行视图**（工单 05/06）
 *
 * 这一屏从"创作流的第一步"变成了"这一轮生成的唯一一屏"：
 * 四步表单（孩子是谁 / 想讲什么 / 角色卡 / 生成）已经整条删掉，
 * 该问的那三件事在 `/home` 那一屏上问过了（`CreateLanding` + 那个弹窗）。
 *
 * 三个入口，三条不同的路：
 *
 * | URL                                        | 盘上有什么  | 做什么 |
 * | ------------------------------------------ | ----------- | ------ |
 * | `?wish=&theme=&card=&form=&pages=&voice=`  | ——          | 开跑一本新的（**只跑①编故事**，然后停在闸门那一屏） |
 * | `?book=<bookId>`                           | `story.json` | 进**闸门那一屏**接着改故事（还没开始画） |
 * | `?book=<bookId>`                           | `book.json`  | 重放这一轮的过程（画过的那一本，不重跑、不重花） |
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

  /**
   * ★ 2026-10-17（工单 16）：这一屏**必须先知道是谁**——"接着做"的那一份草稿、
   *   反查的那张卡，都在某一个人的那一片里。没有登录就没有"我的草稿"这回事，
   *   所以直接回 `/home`（那一屏会把人送去登录）。
   *   不在这里编一个空壳出来：这一屏的每一支都要读盘，而读盘要有一个主人。
   */
  const userId = await currentUserId()
  if (!userId) redirect('/home')
  const root = assetRoot()

  /* ── 接着做一份草稿 ──────────────────────────────────────────────────── */

  const bookId = str(params['book'])
  if (bookId !== '') {
    const store = await createUserStore(root, userId)
    let book: Book | null
    try {
      book = await store.readJson<Book>(manifestPathOf(bookId))
    } catch {
      book = null
    }
    if (book) {
      return (
        <GenerationRun
          resume={{
            bookId,
            // ★ 配音开没开**看 `voiceId`，不看 `narrations` 空不空**：
            //   后者为空有"不做"与"没做成"两种成因（见 `Book.voiceId`）
            voiceOn: book.voiceId !== undefined,
            published: !isDraft(book),
            bookForm: book.form,
            // 重配要用它：改过正文之后那一页原来那份录音还能推出来音色，
            // 但**当初就没配上的那几页**没有前一份可推——而重配正是为它们准备的
            ...(book.voiceId ? { voiceId: book.voiceId } : {}),
          }}
        />
      )
    }

    /**
     * 没有清单、但有故事草稿 = **故事写好了、还没开始画**（故事闸门，2026-10-17）。
     * 这一支直接进闸门那一屏：故事在盘上（家长改过的字也在），接着改就是。
     *
     * ★ 顺序是**先找清单、再找故事**：两样都在时（画完的那一本，`story.json` 还留在
     *   原地）**清单才是"这一本是什么"**——故事草稿只是它曾经的样子，而书已经画出来了。
     * ★ 两样都没有就回 `/home`：与原来"读不到清单就回 /home"同一条（不编一个空壳出来）。
     */
    const draft = await readStory(store, bookId)
    if (!draft) redirect('/home')
    return (
      <GenerationRun
        resume={{
          bookId,
          voiceOn: draft.input.voiceId !== undefined,
          bookForm: draft.input.form,
          // 只有故事、一页没画，当然还没装订
          published: false,
          ...(draft.input.voiceId ? { voiceId: draft.input.voiceId } : {}),
          // ★ 只把 `doc` 递过去（家长要改的就是它）。`input` / `planMs` / `provenance`
          //   在这一屏上没有要动的地方（与 `GET /story` 同一条口径）
          story: draft.doc,
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
  const children = await listChildPicker(userSliceRoot(root, userId))
  const owner = children.find((item) => item.card?.cardId === cardId)
  // 找不到那个孩子/那张卡（或只带了一半参数）：回 /home。
  // 那一屏会在"还没有小主角"时把人送去建一个，比在这里说一句"卡不存在"更有用。
  // ★ 这一条是**服务端**的重定向，与上面那条不一样：这里没有"刚才那一本"可找——
  //   用户明确带着一句话进来了，只是缺一张卡
  if (!owner || !owner.card) redirect('/home')

  const themeKey = str(params['theme'])
  const themeLabel = THEMES.find((item) => item.key === themeKey)?.label ?? ''
  /**
   * 形态（GLOSSARY「形态」）。它从 `/home` 那个弹窗的第一问来（`CreateLanding` 的
   * `startRun` 把 `form=` 挂到地址上）。
   * ★ **认不出的取值退回独读版**，不是报错、更不是 500：地址栏被人手改成
   *   `form=banana` 时这一屏该做的是照常跑一本独读版（与"存储里认不出来的值一律
   *   退回默认"同一条）。校验落回 `BOOK_FORMS`——那**一份**清单是形态的判据
   *   （`book-api.ts` 那边是权威，这里是"地址被手改时不至于把请求发出去"）。
   */
  const formRaw = str(params['form'])
  const bookForm: BookForm = BOOK_FORMS.find((item) => item === formRaw) ?? 'solo'
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
    /**
     * 形态：从地址那一份来（上面 `bookForm`）。
     * ★ 它必须显式写在 `plan` 上，不能在运行视图里写死：闸门那一屏要拿它跑
     *   `buildTree` 校验家长改过的故事，而"独读版不许有选择点"这条在共读版上是反的
     *   （见 `RunPlan.bookForm`）。
     */
    bookForm,
    pages,
    ...(voiceId ? { voiceId } : {}),
  }
  return <GenerationRun plan={plan} />
}
