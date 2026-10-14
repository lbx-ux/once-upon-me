/**
 * kid-names.ts —— 演示孩子的**名字**从哪儿来（以及它为什么可能没有）
 *
 * ★ 角色卡上没有名字。`CharacterCard` 有的是 childId、锚点、参考图与 provenance
 *   （见 `engine/domain.ts`），名字从来不在里面——所以这一屏要显示"小宇"而不是
 *   `xiaoyu`，必须另找一个出处，而不能编一个。
 *
 * 找到的出处是 `kids.json`：`scripts/make-demo-cards.mts` 生成演示卡时，
 * 把喂进去的名字/读音/常服一起写在**资产根**里（第 154 行，与 `cards/` 平级）。
 * 它是**演示数据的副产物**，不是产品的一层档案——运行时家长新建的卡没有这个名字，
 * 也没有这个文件。
 *
 * ★ 踩过的坑（2026-10-14 实测）：dev 的资产根是 `.out/web`，而演示卡当初是用默认的
 *   `--out=.out/cards` 生成的，后来只把 `cards/` 拷进了 `.out/web`——
 *   `kids.json` 没跟着走，于是这一屏全部退回 cardId。**拷演示资产要把这个文件一起拷**，
 *   或者干脆 `node scripts/make-demo-cards.mts --out=.out/web`（但那会真调用图像模型）。
 *
 * 所以这里的规矩是：
 *   1. 读得到就用（演示的两张卡会显示"小宇 · yǔ"，比拼音机器名像人话）；
 *   2. 读不到/半截 JSON/形状不对，一律回空表，界面退到 `childId`；
 *      ★ 不许退到"给孩子起个名"那种编造上
 *   3. 真正的一层档案（名字、读音、生日、照片、按建议重画）是工单 03 的活；
 *      它落地之后这个文件会被替换掉，而不是再长第二份真相。
 */

import { assetRoot } from './books-runtime.ts'
import { createFsStore } from './engine/providers/stores.ts'

export type KidName = { name: string; reading?: string; outfit?: string }

/** 资产根里那份演示名单的路径（与 make-demo-cards.mts 写的那一处对齐） */
const KIDS_FILE = 'kids.json'

type RawKid = { cardId?: unknown; name?: unknown; reading?: unknown; outfit?: unknown }

/**
 * 按 cardId 索引的名字表。读不到就是空表——**这不是错误**，
 * 一个字段都没有的新资产根是完全正常的状态。
 */
export async function loadKidNames(root: string = assetRoot()): Promise<Record<string, KidName>> {
  const store = await createFsStore(root)
  let raw: unknown
  try {
    raw = await store.readJson<unknown>(KIDS_FILE)
  } catch {
    // 内存版 store 的 readJson 对半截 JSON 是**抛**的（fs 版返回 null），
    // 两边行为不一样这件事 library.ts 已经踩过一次，这里两种都接住
    return {}
  }
  if (!Array.isArray(raw)) return {}

  const out: Record<string, KidName> = {}
  for (const item of raw as RawKid[]) {
    if (!item || typeof item !== 'object') continue
    const cardId = typeof item.cardId === 'string' ? item.cardId.trim() : ''
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    if (cardId === '' || name === '') continue
    out[cardId] = {
      name,
      ...(typeof item.reading === 'string' && item.reading.trim() !== ''
        ? { reading: item.reading.trim() }
        : {}),
      ...(typeof item.outfit === 'string' && item.outfit.trim() !== ''
        ? { outfit: item.outfit.trim() }
        : {}),
    }
  }
  return out
}
