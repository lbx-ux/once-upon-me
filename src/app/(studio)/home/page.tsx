import CreateLanding from '@/components/studio/CreateLanding.tsx'
import { listCardItems } from '@/lib/cards-list.ts'
import { loadKidNames } from '@/lib/kid-names.ts'
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
 */

export const dynamic = 'force-dynamic'

export const metadata = { title: '创作 · 小主角' }

export default async function CreateHome() {
  const [cards, names] = await Promise.all([listCardItems(), loadKidNames()])
  return (
    <CreateLanding
      cards={cards.map((card) => {
        const kid = names[card.cardId]
        return {
          cardId: card.cardId,
          childId: card.childId,
          revision: card.revision,
          modelId: card.modelId,
          // ★ 名字读不到就退回 childId，不编一个（见 lib/kid-names.ts）
          ...(kid ? { label: kid.name } : {}),
          faceUrl: assetUrlOf(card.referencePath, 240),
        }
      })}
    />
  )
}
