import CreateLanding from '@/components/studio/CreateLanding.tsx'
import { listCardItems } from '@/lib/cards-list.ts'

/**
 * /home —— 工作台的「创作」那一屏
 *
 * 服务端这一层只做一件事：把已有的角色卡读出来，给「小主角」那一格当选项。
 * ★ 只传**文字**（卡号、childId、第几版、谁画的），不传参考图地址：
 *   那张参考图实测是 2,772,224 字节的 PNG（1440×1440，`/api/assets` 原样给，
 *   没有缩略图那条路）。首页第一屏为了一个 20px 的圆点拉两兆多，
 *   是拿家长等的秒数换一个好看。等有了缩略图再放头像，见工单 05 的 Comments。
 *
 * 这一屏不取"我已经做过什么"那份数据——那是「书架」的事（上一版两件事揉一屏，
 * 结果哪件都不突出）。
 */

export const dynamic = 'force-dynamic'

export const metadata = { title: '创作 · 小主角' }

export default async function CreateHome() {
  const cards = await listCardItems()
  return (
    <CreateLanding
      cards={cards.map((card) => ({
        cardId: card.cardId,
        childId: card.childId,
        revision: card.revision,
        modelId: card.modelId,
      }))}
    />
  )
}
