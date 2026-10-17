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
 *
 * ★ 两档背景，一处定义（`BACKGROUNDS`，2026-10-15 第四轮加）：
 *   `--bg=cream`（默认）是相纸那档，与卡面的暖相纸同族；
 *   `--bg=white` 是纯白，措辞照抄 `docs/figure-art-prompts.md` §二，
 *   出来那张能直接喂给 `scripts/cutout.py` 抠成透明立绘。
 * ★ `--prompt-only=1` 只打印提示词、不读 env、不联网——把提示词拿出去手工出图
 *   （用户 2026-10-15 就是这么做的：他自己出图，我给他提示词）。
 * ★ `--images=<目录>` 则相反：**不调模型**，直接读目录里那两个文件
 *   （`xiaoyu.png` / `xiaoman.png`，也认 .jpg/.jpeg/.webp）当参考图。
 *   这是"人出图 → 装回卡里"的那半条路：参考图的名字是**内容指纹**（`ref.<digest>.png`），
 *   所以不能把文件拷进去就完事——必须走 `cardStore.create` 重算指纹与记录。
 *   不写这个开关的话，那天只能临时拼一段脚本，而临时脚本里的锚点会与这里慢慢分家。
 *
 * ★ 装手工图时**一个字节都不重编码**（2026-10-15 第五轮加的判断）。
 *   用户 2026-10-15 出的那两张 JPEG 里带着 **C2PA 清单**，实测里面写着
 *   `c2pa.created` / description「Created by Google Generative AI」、
 *   以及 `c2pa.edited` /「Applied imperceptible SynthID watermark」。
 *   重编码（补白边到方的、转 PNG、压质量）会让**那份签名失效**——卡上记着
 *   "哪个模型画的"，而图里那份能拿去核对的凭据被我们抹掉了，等于自己剪断自己的证据链。
 *   ★ 代价是参考图**不是方的**（实测 896×1200），所以**谁都不许裁它**：
 *     角色墙那一格用 `object-fit: contain`（见 `character-wall.css` 的 `.cw__art`）。
 *     按 1:1 中裁的话，实测每边切 152px——小满的脚切掉 79px、小宇的**头顶**切进去 69px，
 *     而提示词里只留了 8% 的余量。所以尺寸在这里量一遍并打出来，不靠"应该没事"。
 *
 * ★ 2026-10-17：它造出来的卡**还不算"随仓库发布"**——`--out` 现在该指向**归属那一层**
 *   （`--out=.out/web/u/1`：工单 16 之后资产根底下是 `u/<userId>/`）。
 *   要进 `public/demo/cards/`（那份才是"断网也在、对每个人都可见"的）得再跑一次
 *   `node scripts/export-demo-cards.mts --from=.out/web/u/1 --apply`。
 *   ★ 两步分开是刻意的：造卡要调模型（或要人出图），而**发布**是一次纯粹的文件搬动，
 *   后者随时可以重跑、也该在提交之前重跑一次，并且它自己会逐条自检
 *   （`latest` 指的那一版在不在、参考图名里的指纹与卡里记的对不对）。
 * ★ 卡已经存在时**叠一版**（`previous`），不覆盖也不新建第 1 版。
 *   两个理由，第二个是实测出来的：
 *   1. ADR-0007：旧版一个字节都不动，已经做出来的书仍然指着它们各自那一版
 *      （现在有 4 本书指着 `xiaoyu-r1`）；
 *   2. ★ 直接 `create` 同一张卡会写出**第二个 `r1.<指纹>.json`**，而
 *      `store.load()` 是按 `r1.` 前缀列目录取 `keys[0]`——两个文件时**取哪个由目录顺序决定**，
 *      `revisions()` 还会把两版都列出来。症状是"这一版到底是哪张图"答不上来。
 *
 * ```bash
 * node scripts/make-demo-cards.mts --prompt-only=1 --bg=white   # 只打印那两段提示词
 * node scripts/make-demo-cards.mts --out=.out/web --bg=white    # 真出图（要 IMAGE_API_KEY）
 * node scripts/make-demo-cards.mts --out=.out/web --bg=white --images=/path/to/pngs \
 *   --model='Google Generative AI（手工出图）'
 * ```
 */

import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'

import sharp from 'sharp'

import { createTokenrhythmImage } from '../src/lib/engine/providers/tokenrhythm-image.ts'
import { createOpenAiVision } from '../src/lib/engine/providers/openai-vision.ts'
import { createFsStore } from '../src/lib/engine/providers/stores.ts'
import { createCardStore } from '../src/lib/engine/character-card/store.ts'
import { checklistOf, promptFragmentOf } from '../src/lib/engine/character-card/card.ts'
import { toDataUrl } from '../src/lib/engine/providers/http.ts'
import type { AgeBand, CharacterAnchor } from '../src/lib/engine/domain.ts'
import { buildChildRecord } from '../src/lib/engine/character-card/profile.ts'
import { arg, readEnv } from './env.mts'

type KidSpec = {
  cardId: string
  childId: string
  name: string
  reading: string
  ageBand: AgeBand
  anchors: CharacterAnchor[]
  outfit: string
}

const STYLE_FRAGMENT =
  '温暖手绘绘本插画：水彩铺色打底 + 细彩铅轮廓线收形，可见纸质纹理，高明度低饱和的粉彩色板，柔和的左上方统一光源，阴影无硬边'

/**
 * 背景那一段。两种口令，**一处定义**（第四轮加的）。
 *
 * ★ 为什么要两档：卡面把参考图裱在一张暖相纸里，`cream` 那一档与相纸同族，
 *   读起来是"一张照片贴在卡纸上"；而用户 2026-10-15 要的是**白底**——
 *   白底那张能直接喂给 `scripts/cutout.py` 抠成透明立绘（那个脚本的口径正是
 *   "背景要求出成纯白 #FFFFFF"，见 `docs/figure-art-prompts.md` §二）。
 * ★ 白底那一档的措辞**照抄** `docs/figure-art-prompts.md` §二 的 `【背景】` 段，
 *   一个字都没改：那一批 12 张立绘是同一支笔画出来的，两处各写一句
 *   "差不多是白底"的话，抠图脚本的容差就会开始对不上。
 * ★ 两档都**不**允许地面、投影、纹理：那些东西会跟着背景一起被留下或被抠掉一半。
 */
const BACKGROUNDS = {
  cream: [
    '背景是一层极淡的暖米色平涂，不放任何场景物件——这张图只负责"他是谁"。',
    '不要地面、不要投影、不要背景纹理（它是相纸的颜色，不是场景）。',
  ],
  white: [
    '纯白 #FFFFFF 单一平涂：无纹理、无地面、无投影、无接触阴影、无光晕、无外描边。',
    '人物边缘干净，方便后期抠图。',
  ],
} as const

type BackgroundKey = keyof typeof BACKGROUNDS

const KIDS: KidSpec[] = [
  {
    cardId: 'xiaoyu-r1',
    childId: 'xiaoyu',
    name: '小宇',
    reading: 'yǔ',
    ageBand: '4-6',
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
    ageBand: '4-6',
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

function referencePrompt(kid: KidSpec, bg: BackgroundKey): string {
  return [
    `画一张儿童绘本的**角色标准像**：${kid.name}，东亚面孔，4 岁${kid.childId === 'xiaoman' ? '小女孩' : '小男孩'}。`,
    '',
    '【身份锚点——每一条都必须画出来，它们是后续所有页的核对依据】',
    ...kid.anchors.map((a, i) => `${i + 1}. ${a.value}`),
    '',
    '【构图】竖构图居中，单人，站姿正面略偏 15 度，双手自然垂放，全身入画（头顶与脚底各留约 8% 空间）。',
    ...BACKGROUNDS[bg],
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

/**
 * 从目录里读一张**手工出**的参考图。
 *
 * ★ 文件名只按 `childId` 找，后缀认那几个常见的：`xiaoyu.png` / `xiaoman.jpg`…
 *   不猜"最新的那张"——猜错了的症状是"卡上还是旧图"，而那是要翻半天的那种错。
 * ★ 找不到就**当场报错并列出目录里有什么**，不退回去调模型（那会花一次钱，
 *   而且用户不会知道自己的图根本没被用上）。
 * ★ **字节原样返回，一个像素都不动**（理由见文件头那条 C2PA）。尺寸只量、只打，
 *   用来判断"这一张能不能安全地放进 1:1 的框里"——量出来的数进日志，不进图片。
 */
async function readImage(
  dir: string,
  childId: string,
): Promise<{ bytes: Buffer; mime: string; width: number; height: number }> {
  const MIMES: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
  }
  const names = await readdir(resolve(dir))
  const hit = names.find(
    (name) =>
      MIMES[extname(name).toLowerCase()] &&
      name.slice(0, name.length - extname(name).length) === childId,
  )
  if (!hit) {
    throw new Error(
      `--images=${resolve(dir)} 里没有 ${childId}.png/.jpg/.jpeg/.webp。\n  目录里有：${names.join('、') || '（空）'}`,
    )
  }
  const mime = MIMES[extname(hit).toLowerCase()] as string
  const bytes = await readFile(join(resolve(dir), hit))
  const meta = await sharp(bytes).metadata()
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  process.stdout.write(
    `  ${hit}：${width}×${height} ${meta.format ?? '?'} ${bytes.length} 字节` +
      (width === height
        ? '（方的，框里放得下）\n'
        : `（**不是方的**，比例 ${(width / height).toFixed(3)}——` +
          '所以那一格必须 contain 不能 cover，中裁会切掉头或脚）\n'),
  )
  return { bytes, mime, width, height }
}

/**
 * `public/demo/children/<childId>.json` 在不在。
 *
 * ★ 判据是"文件在不在"，不是"读出来像不像一份档案"：这里要回答的是
 *   "这个 id 属不属于仓库内容"（与 `isDemoChildId` 同一个判据），
 *   而一份坏掉的示例档案**照样**会让 `children-source` 把它当作 demo 那一份的占位——
 *   拿运行期副本盖上去仍然是错的。
 */
async function hasDemoProfile(demoDir: string, childId: string): Promise<boolean> {
  try {
    await access(join(demoDir, `${childId}.json`))
    return true
  } catch {
    return false
  }
}

async function main(): Promise<void> {
  const bg = arg('bg', 'cream') as BackgroundKey
  if (!(bg in BACKGROUNDS)) {
    throw new Error(`--bg 只认 ${Object.keys(BACKGROUNDS).join(' / ')}，收到「${bg}」`)
  }

  // ★ 只打印提示词就停。放在读 env 之前是**故意的**：这一条不需要任何密钥，
  //   所以"把提示词拿出去让人手工出图"这件事，谁都能跑、断网也能跑。
  //   打印出来的是**这个脚本自己那一份**，不是另抄一遍的文本——
  //   抄一遍的那份会在有人改了锚点或风格之后悄悄不一样。
  if (arg('prompt-only', '') === '1') {
    process.stdout.write(
      `提示词（--bg=${bg}）· 模型 ${arg('model', 'wan2.7-image')} · 出图尺寸建议 1440x1440\n`,
    )
    for (const kid of KIDS) {
      process.stdout.write(
        `\n${'='.repeat(72)}\n${kid.name}（${kid.cardId}）\n${'='.repeat(72)}\n\n` +
          `${referencePrompt(kid, bg)}\n`,
      )
    }
    return
  }

  const env = await readEnv()
  const apiKey = env['IMAGE_API_KEY'] ?? ''
  const imagesDir = arg('images', '')
  // ★ `--images` 那条路**不需要密钥**：图是人出的，这个脚本只负责把它装回卡里
  if (!apiKey && imagesDir === '')
    throw new Error('IMAGE_API_KEY 未配置（或者用 --images=<目录> 装手工出的图）')
  const baseUrl = env['IMAGE_BASE_URL'] ?? 'https://tokenrhythm.studio/v1'
  /**
   * ★ `--images` 那条路的 `--model` **没有默认值**（默认是"不知道"）。
   *   以前这里回落到 `wan2.7-image`，于是装一张别人用别的工具出的图，
   *   卡上会被记成 `wan2.7-image（手工出图）`——**那是编的**。
   *   脚本没有任何办法知道那张图是谁画的，所以它只能说"不知道"，除非调用者告诉它。
   *   （本次装的那两张，C2PA 里那句是「Created by Google Generative AI」。）
   */
  const model = arg(
    'model',
    imagesDir === '' ? (env['IMAGE_MODEL'] ?? 'wan2.7-image') : '外部手工出图（未记录工具）',
  )
  const out = resolve(arg('out', '.out/cards'))
  /**
   * ★ 背景档写进 `promptVersion`。provenance 那句话是"这张图是哪份提示词出来的"，
   *   而白底那一份与相纸那一份**不是同一份提示词**——共用 `character-card@v1`
   *   会导致答辩时"这张图和那张图的提示词一样吗"答不上来（与 `character-revise`
   *   当初另起版本号是同一条理由）。★ 别把版本号改写成"当前那个"：它是历史。
   */
  const promptVersion = `character-card@v1${bg === 'white' ? '+bg-white' : ''}`
  process.stdout.write(
    imagesDir === ''
      ? `出图：${KIDS.length} 张 · 模型 ${model} · 背景 ${bg}\n\n`
      : `装图：${KIDS.length} 张 · 从 ${resolve(imagesDir)} · 背景 ${bg}（不调模型）\n\n`,
  )

  await mkdir(out, { recursive: true })
  const store = await createFsStore(out)
  const cardStore = createCardStore(store)
  const image =
    imagesDir === '' ? createTokenrhythmImage({ baseUrl, apiKey, timeoutMs: 180_000 }, model) : null
  const vision = env['VISION_MODEL']
    ? createOpenAiVision(
        {
          baseUrl: env['VISION_BASE_URL'] ?? baseUrl,
          apiKey: env['VISION_API_KEY'] ?? apiKey,
        },
        env['VISION_MODEL'],
      )
    : null

  for (const kid of KIDS) {
    const made = image
      ? await image.generate({ prompt: referencePrompt(kid, bg), size: '1440x1440' })
      : await readImage(imagesDir, kid.childId)
    const referenceBytes = made.bytes
    const referenceMime = made.mime
    // ★ 已经有卡就**叠一版**，不覆盖也不新建（理由见文件头：ADR-0007 + 第二个 r1 的坑）
    const previous = await cardStore.load(kid.cardId)
    const { card } = await cardStore.create({
      cardId: kid.cardId,
      childId: kid.childId,
      anchors: kid.anchors,
      style: { key: 'warm-handdrawn', promptFragment: STYLE_FRAGMENT, ratio: '1:1' },
      referenceBytes,
      referenceMime,
      ...(previous ? { previous } : {}),
      modelId: image ? made.modelId : `${model}（手工出图）`,
      promptVersion,
      now: Date.now(),
    })
    process.stdout.write(
      `${kid.name}（${kid.cardId}）参考图 ${card.reference.path}  指纹 ${card.reference.digest}\n` +
        (previous
          ? `  ★ 这张卡已经有第 ${previous.revision} 版 ⇒ 叠成**第 ${card.revision} 版**（旧版一个字节都没动）\n`
          : `  这是第 ${card.revision} 版（原来没有这张卡）\n`),
    )

    if (vision) {
      // 自核对：把标准像同时当"标准"与"待审页"喂给比对模型。
      // 这不是测一致性，是测**锚点真的画出来没有**——同一张图自己跟自己当然一致，
      // 所以 missed 里出现的每一条都是"prompt 说了但图上没有"。
      const url = toDataUrl(referenceBytes, referenceMime)
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

  /* ★ 2026-10-16：这里原来还写一份 `kids.json`（`{cardId, childId, name, reading,
     outfit, anchors}`），**删了**——它的唯一读者是 `lib/kid-names.ts`，而那个文件
     连同它的测试已经删掉了：`/home` 的名字改成读**档案那一层**（`children-source.ts`），
     演示名单不再需要第二份真相。
     ★ 那些字段没有丢，它们本来就在这个文件上面的 `KIDS` 里；`outfit` 与 `anchors`
     今天没有任何读者（`anchors` 的活口是卡本体的 `promptFragment`）。
     哪天真要它们，从 `KIDS` 里再生成，而不是留一个没人读的产物占着资产根——
     上一版 `docs/` 与工单里那些"`kids.json` 没跟着拷"的教训，正是它作为
     **隐式依赖**留下的学费。
     ★ 下面那份 `children/` 还照写不误：**它才是现在被读的那一份**。 */

  /* 档案（工单 03）。它是演示数据的副产物，不是产品的一层运行时档案。
     ★ 记着一条已经踩过的坑：dev 的资产根是 `.out/web`，
       而演示数据是用默认的 `--out=.out/cards` 生成的——只拷 `cards/` 过去的话，
       `children/` 得跟着走，否则界面退回 childId（`/home` 的名字就是从读这儿来的）。
       干脆 `--out=.out/web` 重跑一次（但那会真调用图像模型）。

     ★ 但**示例档案已经有了就别写第二份**（2026-10-15 第五轮加的）。
       这一条不是洁癖，是会改变界面语义的：`children-source.ts` 写着
       "同 childId 时运行期那条赢"，于是在 `.out/web/children/` 下放一份
       与 `public/demo/children/` 同名的档案，这两个孩子就从 `demo` 变成 `runtime`——
       卡上的「示例」两个字会消失，而**「删掉他」会冒出来**（那一颗按 `source` 判），
       点下去服务端还会以 `demo-child` 403 拒绝（守卫按 `isDemoChildId` 判，判的是
       "这个 id 在示例里存在"）。一句话：**别拿运行期副本去盖仓库内容**。 */
  const createdAt = 1791849600000 // 2026-10-13T00:00:00Z，写死：这个文件不该每次重跑都变
  await mkdir(join(out, 'children'), { recursive: true })
  const demoDir = join(process.cwd(), 'public', 'demo', 'children')
  for (const kid of KIDS) {
    if (await hasDemoProfile(demoDir, kid.childId)) {
      process.stdout.write(
        `  ${kid.name}（${kid.childId}）：public/demo/children/ 里已经有他的示例档案 ⇒ ` +
          '**不写**运行期那一份（写了他就不是"示例"，卡上会冒出「删掉他」）\n',
      )
      continue
    }
    const profile = buildChildRecord({
      childId: kid.childId,
      name: kid.name,
      nameReading: kid.reading,
      ageBand: kid.ageBand,
      lookTags: [],
      interestTags: [],
      createdAt,
    })
    await writeFile(
      join(out, 'children', `${kid.childId}.json`),
      `${JSON.stringify(profile, null, 2)}\n`,
      'utf8',
    )
  }
  process.stdout.write(`定义、卡与档案都在 ${out}\n`)
}

main().catch((err: unknown) => {
  process.stderr.write(`
失败：${err instanceof Error ? err.message : String(err)}
`)
  process.exitCode = 1
})
