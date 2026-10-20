/**
 * default-anchors.test.ts —— 「预填的那八条自己得是合法的」（工单 03 第二刀补的）
 *
 * 这个文件是一个真 bug 逼出来的，而那个 bug 的形状值得写下来：
 *
 *   `mark` 那一格原来写着「笑起来右脸颊有一个小酒窝」，而 `checkAnchors` 的
 *   页级词表里有「笑」——预填值当场被引擎判不合格。
 *   发现它靠的是给 `/character/new` 装了一道 `checkAnchors` 的闸（那一屏直接把它
 *   显示成"外貌锚点：特征记号含页级概念「笑」"，按钮点不动）。
 *
 *   在那之前，这条不合法是看不见的，而且代价很具体：
 *   `/create` 第 3 步的锚点表就是这份预填，家长不动这一格直接点生成 →
 *   `/api/cards` 先调图像接口（钱花了）→ 再 `cardStore.create` → `buildCard`
 *   抛 `card-invalid` → 卡没建成，界面上一句"角色卡不合格：特征记号含页级概念「笑」"。
 *   也就是说：每一次没改那一格的生成，都白花一次出图钱。
 *
 * 所以这里盯的不是"这份数组有七项"，而是那条更弱的、更容易被忽略的契约：
 * 摆在表单里的示范值，必须自己就能过引擎的校验。
 */

import { describe, expect, it } from 'vitest'

import { DEFAULT_ANCHORS } from './default-anchors.ts'
import { ANCHOR_SLOTS } from '../engine/domain.ts'
import { buildCard, checkAnchors, REQUIRED_SLOTS } from '../engine/character-card/card.ts'

describe('预填的锚点本身是合法的', () => {
  it('★ 过 `checkAnchors`——它要是不过，家长"不改直接生成"就是白花一次出图钱', () => {
    expect(checkAnchors(DEFAULT_ANCHORS)).toEqual([])
  })

  it('八格齐全（含空着的补充那一格），且顺序就是声明序（顺序进 prompt 与指纹，不能随手排）', () => {
    expect(DEFAULT_ANCHORS.map((anchor) => anchor.slot)).toEqual([...ANCHOR_SLOTS])
  })

  it('硬锚点那五条一条不缺（`REQUIRED_SLOTS` 是建卡的下限）', () => {
    const present = new Set(DEFAULT_ANCHORS.map((anchor) => anchor.slot))
    for (const slot of REQUIRED_SLOTS) expect(present.has(slot), `缺 ${slot}`).toBe(true)
  })

  it('把预填直接喂给 `buildCard` 不抛——这是上面那条判据的"实跑"版本', () => {
    expect(() =>
      buildCard({
        cardId: 'probe-sheet',
        childId: 'probe',
        anchors: DEFAULT_ANCHORS,
        style: { key: 'warm-handdrawn', promptFragment: '水彩', ratio: '1:1' },
        referencePath: 'cards/probe-sheet/ref.x.png',
        referenceBytes: 1,
        referenceMime: 'image/png',
        modelId: 'probe-model',
        promptVersion: 'test@v1',
        now: 0,
      }),
    ).not.toThrow()
  })
})
