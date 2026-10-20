/**
 * photo-form.ts —— multipart 表单 → `PhotoCardRequest`（形状转换，不含判据）
 *
 * 它为什么不在 `route.ts` 里：Next 给 Route Handler 生成的类型只允许那个模块导出
 *   `GET`/`POST`/`dynamic` 这些标准字段，多导一个函数 `pnpm typecheck` 就红
 *   （我第一次把解析写在路由里就撞上了，报错的话很长，总之是"这不是一个路由该导出的东西"）。
 *   而更要紧的是：这一层是能被测试的——"consent 缺字段算不算同意"
 *   这一条不该靠读代码确认。
 *
 * 判据一条都不在这里：名字空不空、照片大不大在 `photo-rules.ts`。
 *   这一层顺手判一条，两处判据就会开始漂，而漂的那一条恰好是"没勾同意也能传"。
 */

import { AGE_BANDS, type AnchorSlot, type CharacterAnchor } from './engine/domain.ts'
import type { PhotoCardRequest } from './photo-rules.ts'

/**
 * multipart → `PhotoCardRequest`。
 *
 * `consent` 只认字面量 `'true'`。写成 `'on'`、`'1'`、缺字段都算没同意：
 *   这个默认值搞反的代价是别人的孩子，而"浏览器默认把复选框序列化成 on"
 *   正是最容易搞反的那种细节。
 */
export async function parsePhotoForm(form: FormData): Promise<PhotoCardRequest> {
  const text = (key: string): string => {
    const value = form.get(key)
    return typeof value === 'string' ? value.trim() : ''
  }

  const file = form.get('photo')
  const photo = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array()

  return {
    childId: text('childId'),
    name: text('name'),
    ageBand: text('ageBand'),
    childWord: text('childWord') || '孩子',
    anchors: anchorsFrom(text('anchors')),
    photo,
    consent: text('consent') === 'true',
  }
}

/**
 * 锚点那一段是 multipart 里的一个 JSON 字符串字段。
 *
 * ★ 它坏了不让整条请求失败：解析不出来就当没有锚点，
 *   然后 `photoProblems` 会报"外貌锚点：缺骨相"那几条人话——
 *   比"JSON 解析失败"对家长有用得多，而那正是同一条判据顺手就覆盖到的。
 *   （这一格不是宽松处理输入：坏输入照样得到一条明确的拒绝，只是拒绝的话是人话。）
 */
export function anchorsFrom(raw: string): CharacterAnchor[] {
  if (raw === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: CharacterAnchor[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const source = item as Record<string, unknown>
    const slot = typeof source['slot'] === 'string' ? source['slot'] : ''
    const value = typeof source['value'] === 'string' ? source['value'].trim() : ''
    if (value === '') continue
    out.push({ slot: slot as AnchorSlot, value })
  }
  return out
}

/** 年龄档的合法值（界面与路由都从这里取，不各自抄一遍字面量） */
export const AGE_BAND_VALUES = AGE_BANDS
