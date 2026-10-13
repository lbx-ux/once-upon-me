/**
 * make-demo-cards.mts —— 两张"不存在的小孩"角色卡
 *
 * 为什么是合成的（用户 10/13 定的）：演示与答辩现场不需要任何真孩子的照片，
 * #5「AI 安全可控」那一章就能干净地说"我们从未处理过未成年人图像"。
 * 与 §8.4 已定的"克隆团队成员自己的声音、不拿真实儿童素材"是同一个口径。
 *
 * 提示词模板出自 `gpt-image-2-style-library` 的 **character-design-sheet**
 * （角色设定表 / 一致性参考）：它的 guidance 正是"定义身份锚点、服装、比例、版式，
 * 保持脸/发型/服装一致"，而它的两条 pitfall 被直接写进了下面的约束——
 * 单姿势（画面拥挤就减少动作数量）、不写风格不写构图（构图段独立成块）。
 *
 * ★ 一条方法上的讲究：**锚点先写进 prompt，再由同一批锚点去核对**。
 *   这样"卡里说的"与"图上有的"是同一件事，卡才是可信的资产而不是事后编的说明书。
 *   核对由视觉模型逐条做，结果打印出来——不通过就重画，不靠人眼扫一眼说"挺像"。
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { createTokenrhythmImage } from '../src/lib/engine/providers/tokenrhythm-image.ts'
import { createOpenAiVision } from '../src/lib/engine/providers/openai-vision.ts'
import { createFsStore } from '../src/lib/engine/providers/stores.ts'
import { createCardStore } from '../src/lib/engine/character-card/store.ts'
import { checklistOf, promptFragmentOf } from '../src/lib/engine/character-card/card.ts'
import { toDataUrl } from '../src/lib/engine/providers/http.ts'
import type { CharacterAnchor } from '../src/lib/engine/domain.ts'
import { arg, readEnv } from './env.mts'

type KidSpec = {
  cardId: string
  childId: string
  name: string
  reading: string
  anchors: CharacterAnchor[]
  outfit: string
}

const STYLE_FRAGMENT =
  '温暖手绘绘本插画：水彩铺色打底 + 细彩铅轮廓线收形，可见纸质纹理，高明度低饱和的粉彩色板，柔和的左上方统一光源，阴影无硬边'

const KIDS: KidSpec[] = [
  {
    cardId: 'xiaoyu-r1',
    childId: 'xiaoyu',
    name: '小宇',
    reading: 'yǔ',
    outfit: '芥黄色短袖 T 恤 + 深蓝色短裤 + 一双红色雨鞋',
    anchors: [
      { slot: 'bone', value: '圆脸、颊部饱满、下颌线软' },
      { slot: 'eyes', value: '深棕色圆眼、眼距略宽、睫毛短' },
      { slot: 'hair', value: '黑发偏软，左上方永远翘着一撮' },
      { slot: 'build', value: '头身比约 1:4，四肢圆润' },
      { slot: 'skin', value: '暖黄偏深的肤色，膝盖有晒黑的印' },
      { slot: 'wardrobe', value: '芥黄短袖 + 深蓝短裤 + 红雨鞋' },
    ],
  },
  {
    cardId: 'xiaoman-r1',
    childId: 'xiaoman',
    name: '小满',
    reading: 'mǎn',
    outfit: '藕荷色无袖连衣裙 + 白短袜 + 蓝布鞋',
    anchors: [
      { slot: 'bone', value: '方中带圆的脸、下巴短、颊部有两团肉' },
      { slot: 'eyes', value: '黑亮杏眼、眼尾微微上挑、单层眼皮' },
      { slot: 'hair', value: '齐耳短发、右侧别一枚黄色小鸭发卡' },
      { slot: 'build', value: '头身比约 1:4.5，肩窄、手脚小' },
      { slot: 'skin', value: '白净偏粉的肤色，鼻尖略深' },
      { slot: 'wardrobe', value: '藕荷色连衣裙 + 白短袜 + 蓝布鞋' },
    ],
  },
]

function referencePrompt(kid: KidSpec): string {
  return [
    `画一张儿童绘本的**角色标准像**：${kid.name}，东亚面孔，4 岁${kid.childId === 'xiaoman' ? '小女孩' : '小男孩'}。`,
    '',
    '【身份锚点——每一条都必须画出来，它们是后续所有页的核对依据】',
    ...kid.anchors.map((a, i) => `${i + 1}. ${a.value}`),
    '',
    '【构图】竖构图居中，单人，站姿正面略偏 15 度，双手自然垂放，全身入画（头顶与脚底各留约 8% 空间）。',
    '背景是一层极淡的暖米色平涂，不放任何场景物件——这张图只负责"他是谁"。',
    '视线看向画外，表情平和带一点好奇，不做夸张表情。',
    '',
    `【服装】${kid.outfit}。`,
    '',
    `【风格】${STYLE_FRAGMENT}`,
    '',
    '【文字】画面内不出现任何文字、字母、数字、签名、水印。',
    '',
    '【约束】不要第二张脸；不要多余的手指（每只手 5 指为限）；不要成人的身材比例套在孩子身上；',
    '不要写实照片质感；不要深色压抑的背景；不要多格分镜、拼贴、画框、样机、阴影底板。',
  ].join('\n')
}

async function main(): Promise<void> {
  const env = await readEnv()
  const apiKey = env['IMAGE_API_KEY'] ?? ''
  if (!apiKey) throw new Error('IMAGE_API_KEY 未配置')
  const baseUrl = env['IMAGE_BASE_URL'] ?? 'https://tokenrhythm.studio/v1'
  const model = arg('model', env['IMAGE_MODEL'] ?? 'wan2.7-image')
  const out = resolve(arg('out', '.out/cards'))
  process.stdout.write(`出图：${KIDS.length} 张 · 模型 ${model}\n\n`)

  await mkdir(out, { recursive: true })
  const store = await createFsStore(out)
  const cardStore = createCardStore(store)
  const image = createTokenrhythmImage({ baseUrl, apiKey, timeoutMs: 180_000 }, model)
  const vision = env['VISION_MODEL']
    ? createOpenAiVision(
        { baseUrl: env['VISION_BASE_URL'] ?? baseUrl, apiKey: env['VISION_API_KEY'] ?? apiKey },
        env['VISION_MODEL'],
      )
    : null

  for (const kid of KIDS) {
    const response = await image.generate({ prompt: referencePrompt(kid), size: '1440x1440' })
    const { card } = await cardStore.create({
      cardId: kid.cardId,
      childId: kid.childId,
      anchors: kid.anchors,
      style: { key: 'warm-handdrawn', promptFragment: STYLE_FRAGMENT, ratio: '1:1' },
      referenceBytes: response.bytes,
      referenceMime: response.mime,
      modelId: response.modelId,
      promptVersion: 'character-card@v1',
      now: Date.now(),
    })
    process.stdout.write(
      `${kid.name}（${kid.cardId}）参考图 ${card.reference.path}  指纹 ${card.reference.digest}\n`,
    )

    if (vision) {
      // 自核对：把标准像同时当"标准"与"待审页"喂给比对模型。
      // 这不是测一致性，是测**锚点真的画出来没有**——同一张图自己跟自己当然一致，
      // 所以 missed 里出现的每一条都是"prompt 说了但图上没有"。
      const url = toDataUrl(response.bytes, response.mime)
      const checked = await vision.compare({
        referenceDataUrl: url,
        pageDataUrl: url,
        checklist: checklistOf(card),
      })
      process.stdout.write(
        `  锚点核对（${vision.modelId}）：score=${checked.score ?? 'n/a'} 没画出来的=${checked.missed.join('/') || '无'}\n` +
          `  ${checked.reason ?? ''}\n`,
      )
    } else {
      process.stdout.write('  未配置 VISION_MODEL，锚点核对跳过（不假装通过）\n')
    }
    process.stdout.write(`  派生的角色段：${promptFragmentOf(card)}\n\n`)
  }

  await writeFile(join(out, 'kids.json'), JSON.stringify(KIDS, null, 2), 'utf8')
  process.stdout.write(`定义与卡都在 ${out}\n`)
}

main().catch((err: unknown) => {
  process.stderr.write(`
失败：${err instanceof Error ? err.message : String(err)}
`)
  process.exitCode = 1
})
