import CreateLanding, { type ChildOption } from '@/components/studio/CreateLanding.tsx'
import { userSliceRoot } from '@/lib/asset-scope.ts'
import { currentUserId } from '@/lib/auth/session.ts'
import { assetRoot } from '@/lib/books-runtime.ts'
import { listCardItems } from '@/lib/cards-list.ts'
import { listDemoCardPicker, type CardPickList } from '@/lib/children-list.ts'
import { listChildren } from '@/lib/children-source.ts'
import { assetUrlOf } from '@/lib/asset-url.ts'

/**
 * /home —— 工作台的「创作」那一屏
 *
 * 服务端这一层做三件取数：有哪些卡、它们叫什么、以及给每张卡配一个**头像档**。
 *
 * ★ 头像为什么现在敢放了：`?w=240` 那一档实测 **10 KB**（原图是 2,772,224 字节的
 *   1440×1440 PNG，差 270 倍）。之前那一版刻意不放头像是因为只能拿原图，
 *   首页第一屏为一个小圆点拉两兆多——那个判断没错，缺的是缩略图这条路。
 *   现在有了，所以判断跟着改（见 `lib/thumbs.ts`）。
 *
 * 这一屏不取"我已经做过什么"那份数据——那是「书架」的事。
 *
 * ★ 2026-10-16：名字的**出处换了**，从 `loadKidNames()`（读 `kids.json`）换成
 *   `listChildren()`（读档案那一层）。
 *   起因是用户看着选择器问的一句话："这个怎么是个编号，而不是用户自定义的名字"——
 *   那一格上写着 `kid-yl957g`，而他给这个孩子起的名字是「小乐」。
 *   根因：`kids.json` 是 `scripts/make-demo-cards.mts` 生成演示卡时的**副产物**，
 *   里面只有那两张演示卡；家长在应用里新建的孩子**永远不在里面**，
 *   于是每一张"自己的卡"都退回 childId。而档案那一层（`children-source.ts` +
 *   `engine/character-card/profile.ts`）本来就有名字，`/character` 那一屏早就读它了。
 *   `lib/kid-names.ts` 的文件头写着"谁把 `/home` 换过去，就把这个文件删掉"——
 *   这次就是兑现它，那个文件连同它的测试一并删了。
 * ★ 对上用的是 **childId**，不是 cardId：档案那一层的键是**孩子**，
 *   一张卡只是他的某一版（`xiaoman-r1`、`xiaoman-r2`…），拿卡号去查档案是查不到的。
 *   换过来之后演示的两张也照旧有名字：`public/demo/children/` 里有他们的档案。
 * ★ 两个来源合起来的那条纪律（自己的在前、示例在后）住在 `listChildren()` 里，
 *   这里不重复排序——这一层只管把卡摆好。
 * ★ 名字读不到**仍然退回 childId，不编一个**。这条纪律没变，变的只是出处。
 * ★ 2026-10-18：**访客那一支不再是空表**。角色墙在那一次改动之后已经看得见
 *   两张示例卡了，而同一个人的这一屏还写着「还没有小主角 · 先去建一个」——
 *   两屏对**同一件事实**给了两种说法，其中一种是假的（用户点名的就是这一处）。
 *   访客拿到的就是角色墙上那两张（`listDemoCardPicker`，只读 `public/demo/`，
 *   图走静态地址）；他按下「开始创作」照旧被那道登录闸拦住（`submit()` 第一句），
 *   所以"给他一张能选的卡"不会让任何写动作漏出去。
 *   代价（头像是 768 那一张，不是 240 档）写在 `listDemoCardPicker` 的注释里。
 *   ★ 而**地址这一件事本身也是两支不同的**：登录那一支拼 `/api/assets/…?w=240`，
 *   访客那一支只能用 `public/` 下那张静态图（`/api/assets` 对匿名 401）。
 *   所以两支交上来的不只是卡，还有"这张卡的地址怎么来"（`CardPickList.faceOf`）
 *   ——第一版把这一段写在页面里、只传卡，症状是访客那颗圆点指着一个 401 的地址：
 *   页面 200、名字也在，只有图空着（e2e 里"那个地址真的出图吗"那条当场照出来了）。
 */

export const dynamic = 'force-dynamic'

export const metadata = { title: '创作 · 小主角' }

/** 那颗药丸要的那一份（卡 + 名字表 + 地址怎么来）——形状住在取数层，两支共用 */
async function ownCardPicker(root: string): Promise<CardPickList> {
  const [cards, children] = await Promise.all([listCardItems(root), listChildren(root)])
  return {
    cards,
    nameOf: new Map(children.map((item) => [item.profile.childId, item.profile.name])),
    // ★ 240 档这个数**只在这里**出现一次：它是这一屏的消费者（24px 的圆点）定的，
    //   而档位本身是一张封闭表、权威在服务端（`lib/thumbs.ts`）。
    //   ★ 访客那一支交上来的不是这个函数——见 `CardPickList.faceOf` 上那段：
    //   拿 `assetUrlOf` 去拼示例卡的地址，访客那头是 401（页面照旧 200，只是图空着），
    //   2026-10-18 第一次写就是这么错的，e2e 那条"图真的画出来了吗"当场照出来。
    faceOf: (card) => assetUrlOf(card.referencePath, 240),
  }
}

export default async function CreateHome() {
  const userId = await currentUserId()
  const root = assetRoot()
  const { cards, nameOf, faceOf } = userId
    ? await ownCardPicker(userSliceRoot(root, userId))
    : await listDemoCardPicker()
  // ★ 投影只写一遍（`CardListItem` → `ChildOption`）：两条支路各写一遍，
  //   迟早会有一边忘了带名字，而症状是药丸上写着一个 `kid-yl957g`。
  //   两支的差别只在 `faceOf` 那一个函数上。
  const picks: ChildOption[] = cards.map((card) => {
    const name = nameOf.get(card.childId)
    return {
      cardId: card.cardId,
      childId: card.childId,
      revision: card.revision,
      modelId: card.modelId,
      // ★ 名字读不到就退回 childId，不编一个（见上面那段：出处是档案那一层）
      ...(name ? { label: name } : {}),
      faceUrl: faceOf(card),
    }
  })
  return <CreateLanding cards={picks} />
}
