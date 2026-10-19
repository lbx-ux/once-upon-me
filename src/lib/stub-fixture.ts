/**
 * stub-fixture.ts —— 固定替身：**不花一分钱、不碰网络**地跑完一本书
 *
 * 它是「架构验收」那一档的全部原料（`node scripts/engine-run.mts --mode=stub`），
 * 2026-10-19 从 `scripts/engine-run.mts` 里抽出来，因为 MCP 那一侧要**同一份**：
 * 判据是「走 MCP 那条路与 `engine-run --mode=stub` 是同一本书、同一串事件」
 * （`.scratch/mcp/spec.md` 判据 2）。不抽的话，那条判据比的是两百行重复代码里
 * 两份"恰好一样"的东西，而不是同一条代码路径——**判据当天就失去意义**。
 *
 * ★★ **它不是引擎的一部分。** 引擎那边一个字都不认它：
 *   `createProviders` 走的是 `env` 那一套，这里的东西只在脚本与 MCP server 的
 *   `--mode=stub` 里出现。放在 `src/lib/` 而不是 `src/lib/engine/` 就是为了这件事
 *   ——引擎目录里躺着"替身供应商"，下一个人会以为生产有可能走到它。
 *
 * 三件产物，都必须是**可复现**的：
 *
 * 1. **故事表**：`scripts/fixtures/demo-plan.json`（随仓库提交，不与模型交互）
 * 2. **成图**：`public/book/spread-*.webp`（演示绘本那 5 张，按顺序轮流发）
 * 3. **角色卡**：由 `public/book/cover.webp` 与一组写死的锚点造出来 —— 与
 *    `docs/demo-book-art-prompts.md` 里那份描述**逐条对应**，所以这本书画出来的
 *    与首页第二屏那本是同一个孩子。
 *
 * ★ 时间也是参数（`now`）。`engine-run` 传一个固定值，于是同一份输入两次跑出来
 *   的 `book.json` 去掉时间字段之后**逐字节相同**——那是判据 2 能成立的前提。
 */

import { readFile } from 'node:fs/promises'

import { digest } from './engine/digest.ts'
import { createCardStore } from './engine/index.ts'
import { createProfileStore } from './engine/index.ts'
import type { BookForm, CharacterCard, ChildProfile } from './engine/index.ts'
import type { ImageGenerator, TextGenerator } from './engine/providers/types.ts'

/** 固定替身演的那个孩子。★ 与 `engine-run` 原来的写死值逐字相同（不能顺手改） */
export const STUB_CHILD: ChildProfile = {
  childId: 'xiaolu',
  name: '小宇',
  nameReading: 'yǔ',
  ageBand: '4-6',
  lookTags: ['圆脸', '短发'],
  interestTags: ['云', '恐龙', '船'],
}

/** 卡号与版号。★ 它们进 `bookIdOf`，所以改了它 = 换了书号 = 判据 2 的对照臂对不上 */
export const STUB_CARD_ID = 'xiaolu-r1'

/**
 * 锚点按 `docs/demo-book-art-prompts.md` 的既定描述写死。
 * ★ 六条（不是五条）：`validateCard` 只要求五条硬锚点，而这本书的参考图是演示绘本的
 *   封面，它的画面里**有衣服**——所以 wardrobe 一并写下来，让"画师会拿到的那一段"
 *   与那五张成图对得上。
 */
const STUB_ANCHORS = [
  { slot: 'bone', value: '圆脸、颊部饱满、下颌线软' },
  { slot: 'eyes', value: '深棕圆眼、眼距略宽、睫毛短' },
  { slot: 'hair', value: '黑发偏软，左上方永远翘着一撮' },
  { slot: 'build', value: '头身比约 1:4，四肢圆润' },
  { slot: 'skin', value: '暖黄偏深的肤色，膝盖总有晒黑的印' },
  { slot: 'wardrobe', value: '芥黄短袖 + 深蓝短裤 + 一双红雨鞋' },
] as const

/** 演示绘本那 5 张成图。替身按顺序轮流发，所以同一页在两次跑里拿到的是同一张 */
const DEMO_IMAGES = [
  'public/book/spread-1.webp',
  'public/book/spread-2.webp',
  'public/book/spread-3.webp',
  'public/book/spread-4a.webp',
  'public/book/spread-4b.webp',
] as const

/** 固定剧本（一张合法的共读版故事表）。读的是随仓库提交的那一份，不与模型交互 */
export async function loadStubPlanJson(): Promise<string> {
  return readFile('scripts/fixtures/demo-plan.json', 'utf8')
}

/**
 * 两个假供应商。
 *
 * ★ `stream()` 也实现了，而且报 `streamed: false`：**录下来的本来就是一整段**，
 *   把它演成打字机是 ADR-0003 明令禁止的那种假（`TextDelta.streamed` 的注释）。
 *   stub 这一档跑的是脚本与验收，不走流式；实现它只是为了让形状与真适配器一致。
 */
export function stubProviders(planJson: string): {
  text: TextGenerator
  image: ImageGenerator
} {
  let imageCursor = 0
  const text: TextGenerator = {
    id: 'stub-text',
    modelId: 'stub-plan@v1',
    async complete() {
      return { text: planJson, modelId: 'stub-plan@v1' }
    },
    async stream(_req, _budget, onDelta) {
      const response = { text: planJson, modelId: 'stub-plan@v1' }
      onDelta({ text: planJson, streamed: false })
      return response
    },
  }
  const image: ImageGenerator = {
    id: 'stub-image',
    modelId: 'pregenerated-demo-art',
    supportedRatios: ['1:1'],
    supportsReference: false,
    async generate() {
      const path = DEMO_IMAGES[imageCursor % DEMO_IMAGES.length] as string
      imageCursor += 1
      return {
        bytes: new Uint8Array(await readFile(path)),
        mime: 'image/webp',
        modelId: 'pregenerated-demo-art',
        costCny: 0,
      }
    },
  }
  return { text, image }
}

/** 这一档只演得动共读版——《小宇的云》那份固定剧本就是共读版 */
export function stubFormIsSupported(form: BookForm): boolean {
  return form === 'shared'
}

/**
 * 把这一档要的角色卡**确保存在**（已经有一张就不重造）。
 *
 * ★ 幂等是必须的：MCP server 每次启动都会调它，而卡是**内容寻址**的
 *   （`ref.<指纹>.webp`），重复造只会多写一份一模一样的字节，
 *   但会多一个 `r2` —— 而 `r2` 会让"同一本书"这个判据当场失效（版号进不出来，
 *   但 `character_card` 会显示第 2 版）。
 */
export async function ensureStubCard(
  store: Parameters<typeof createCardStore>[0],
  options: { modelId?: string; now: number },
): Promise<CharacterCard> {
  const cards = createCardStore(store)
  const existing = await cards.load(STUB_CARD_ID, 1)
  if (existing) return existing

  const referenceBytes = new Uint8Array(await readFile('public/book/cover.webp'))
  const built = await cards.create({
    cardId: STUB_CARD_ID,
    childId: STUB_CHILD.childId,
    anchors: [...STUB_ANCHORS],
    style: {
      key: 'warm-handdrawn',
      promptFragment: '温暖手绘水彩绘本插画，柔和侧向暖光，纸张纹理可见',
      ratio: '3:2',
    },
    referenceBytes,
    referenceMime: 'image/webp',
    modelId: options.modelId ?? 'character-card@stub',
    promptVersion: 'character-card@v1',
    now: options.now,
  })
  return built.card
}

/**
 * 把这一档要的孩子档案确保存在。MCP 那边 `list_children` 要看得见他——
 * 这一档的意义正是"零成本地把整条路走一遍"，看不见孩子的演示等于没走。
 */
export async function ensureStubChild(
  store: Parameters<typeof createProfileStore>[0],
  options: { now: number },
): Promise<void> {
  const profiles = createProfileStore(store)
  if (await profiles.load(STUB_CHILD.childId)) return
  await profiles.save({ ...STUB_CHILD, createdAt: options.now })
}

/** 参考图的内容指纹。★ 与 `ensureStubCard` 同源，用来在验收里回报"锁的是哪张脸" */
export async function stubReferenceDigest(): Promise<string> {
  return digest(new Uint8Array(await readFile('public/book/cover.webp')))
}
