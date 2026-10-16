import CreateLanding from '@/components/studio/CreateLanding.tsx'
import { listCardItems } from '@/lib/cards-list.ts'
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
 */

export const dynamic = 'force-dynamic'

export const metadata = { title: '创作 · 小主角' }

export default async function CreateHome() {
  const [cards, children] = await Promise.all([listCardItems(), listChildren()])
  const nameOf = new Map(children.map((item) => [item.profile.childId, item.profile.name]))
  return (
    <CreateLanding
      cards={cards.map((card) => {
        const name = nameOf.get(card.childId)
        return {
          cardId: card.cardId,
          childId: card.childId,
          revision: card.revision,
          modelId: card.modelId,
          // ★ 名字读不到就退回 childId，不编一个（见上面那段：出处是档案那一层）
          ...(name ? { label: name } : {}),
          faceUrl: assetUrlOf(card.referencePath, 240),
        }
      })}
    />
  )
}
