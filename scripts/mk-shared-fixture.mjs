/**
 * mk-shared-fixture.mjs —— 造**共读版**的演示书，用来在浏览器里验阅读器（工单 04）
 *
 * ```bash
 * node scripts/mk-shared-fixture.mjs            # 造《两条路》
 * node scripts/mk-shared-fixture.mjs --missing  # 再造一本：第 5 页的图**没出成**
 * node scripts/mk-shared-fixture.mjs --clean    # 两本一起拆（跑完验收就拆掉）
 * ```
 *
 * 两本各验一件事：
 *
 * | 书                    | 验什么                                                        |
 * | --------------------- | ------------------------------------------------------------- |
 * | `xzj-shared-verify`   | 阅读顺序 = 那条路（a 支的图与音走 b 支时一次都不许被请求）      |
 * | `xzj-shared-missing`  | 缺图那一页仍走兜底纸，而且**连那次请求都不发**（`Book.errors`） |
 *
 * ★ 造出来的是**验证用的夹具**，不是生成的书：六页的图与音是从别处**复用**的
 *   （首页那几个跨页的 webp、演示书那三段 mp3），所以它证明得了"阅读顺序走的是那条路"，
 *   证明不了"共读版的图长什么样"。真书的出图是 ticket 08 的事。
 *
 * ★ 形状刻意取在边界上：选择点在第 3 页，a 支只有第 4 页一页就收尾，
 *   b 支经第 5 页到第 6 页（比 a 支多一页 = `tree.ts` 允许的上差）。
 *   两支的页号因此**交错**：平铺顺序 1,2,3,4,5,6，走 b 支的人见不到第 4 页——
 *   于是"a 支的图与音频有没有被请求"在 network 面板里是一件看得见的事。
 *
 * ★ `--missing` 造的**不是另一个形状**，是同一本书 + 一条 `errors`：`illustrations` 里
 *   第 5 页那一项**还在**（出图时申报了、没出成），但盘上没有那个文件。
 *   于是两条判据都成立：兜底纸要出来，而且 `page-5.webp` **一次都不许被请求**
 *   （模型说它缺，阅读器就不该去取一张死图——这是"缺图 ≠ 未核对"那条警告的机械版）。
 *
 * ★ **产物不进仓库**（`.gitignore` 里有一条专为它们写的）：手工拼出来的书躺在
 *   `public/demo/books/` 下，读仓库的人分不出它是生成的还是手写的，而它会随
 *   部署一起上线成"演示书"。跑完 `chk-shared-reader.mjs` 就 `--clean`。
 */
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const MISSING = args.includes('--missing')
const BOOK_ID = MISSING ? 'xzj-shared-missing' : 'xzj-shared-verify'
/** 缺图那一页：取 b 支第 4 屏 = 资产第 5 页（两个号不一样，正是这一页的看点之一） */
const MISSING_PAGE = 5
const outArg = args.find((arg) => arg.startsWith('--out='))
const OUT = outArg ? outArg.slice('--out='.length) : join(ROOT, 'public/demo/books', BOOK_ID)

if (args.includes('--clean')) {
  await rm(join(ROOT, 'public/demo/books/xzj-shared-verify'), { recursive: true, force: true })
  await rm(join(ROOT, 'public/demo/books/xzj-shared-missing'), { recursive: true, force: true })
  console.log('拆掉了两本共读夹具')
  process.exit(0)
}

/** 六页的图：首页那几个跨页（同一批水彩，尺寸 3:2 也一样）。取六个不同的文件 */
const IMAGES = ['cover', 'spread-1', 'spread-2', 'spread-3', 'spread-4a', 'spread-4b']
/** 六页的音：演示书那三段轮着用，但**各自落成不同的文件**——
 *  共用一份的话，"a 支那段音频有没有被请求"就分不出来了（同一个 URL 两处都在用） */
const AUDIO = ['page-1-a1', 'page-2-a1', 'page-3-a1', 'page-1-a1', 'page-2-a1', 'page-3-a1']
const DEMO = join(ROOT, 'public/demo/books/xiaoyu-r1-4fe055c5723b')

const BODY = {
  1: ['小宇把纸船放进水里。', '船顺着水流，一直漂到云的边上。'],
  2: ['云上有一条分岔的小路。', '风从两条路的尽头各吹来一点声音。'],
  3: ['前面有两条路。', '一条像恐龙的背，一条像小船的肚子。'],
  4: ['恐龙那条路会翻过一道很高的山脊。', '小宇爬上去，看见了很远的地方。'],
  5: ['小船那条路贴着水面走。', '一路都是水鸟的叫声。'],
  6: ['小宇把船停在岸边，天已经暗了。', '他记下了这两条路的样子。'],
}

const CHOICE = {
  prompt: '你想走哪一条？',
  options: [
    { iconKey: 'dino', emoji: '🦕', label: '恐龙的背', spoken: '我想走恐龙那条路' },
    // 第二个 key **不在词表里**：界面上该露出 emoji 兜底，而不是一张碎图
    { iconKey: 'not-in-the-list', emoji: '🛶', label: '小船的肚子', spoken: '我想走小船那条路' },
  ],
}

const demo = JSON.parse(await readFile(join(DEMO, 'book.json'), 'utf8'))
/** 演示书里那一条的**壳**（尺寸、mime、voice 那些字段），只借它的形状，路径下面自己写 */
const shellIllustration = demo.illustrations[0]
const shellNarration = demo.narrations[0]

function node(pageNo, next, choice) {
  return {
    nodeId: `n${pageNo}`,
    pageNo,
    scene: '验证夹具',
    body: BODY[pageNo],
    imagePrompt: '验证夹具',
    mood: 'wonder',
    ...(choice ? { choice } : {}),
    next,
    pathFromRoot:
      pageNo <= 3
        ? Array.from({ length: pageNo }, (_, i) => `n${i + 1}`)
        : ['n1', 'n2', 'n3', `n${pageNo}`],
  }
}

const nodes = [
  node(1, ['n2']),
  node(2, ['n3']),
  node(3, ['n4', 'n5'], CHOICE),
  node(4, []),
  node(5, ['n6']),
  node(6, []),
]

await mkdir(OUT, { recursive: true })

const illustrations = []
const narrations = []
for (const [index, pageNo] of [1, 2, 3, 4, 5, 6].entries()) {
  const image = `${IMAGES[index]}.webp`
  // ★ 缺图那一页**不落文件**，但下面照旧申报一项：申报了没出成 = `Book.errors`，
  //   而没有文件 = 阅读器要是真去取就会 404（两条判据因此都能看见）
  if (!(MISSING && pageNo === MISSING_PAGE)) {
    await copyFile(join(ROOT, 'public/book', image), join(OUT, `page-${pageNo}.webp`))
  }
  illustrations.push({
    ...shellIllustration,
    pageNo,
    asset: {
      ...shellIllustration.asset,
      path: `books/${BOOK_ID}/page-${pageNo}.webp`,
      mime: 'image/webp',
    },
  })

  const audio = `${AUDIO[index]}.mp3`
  await copyFile(join(DEMO, audio), join(OUT, `page-${pageNo}.mp3`))
  narrations.push({
    ...shellNarration,
    pageNo,
    asset: { ...shellNarration.asset, path: `books/${BOOK_ID}/page-${pageNo}.mp3` },
  })
}

// 选择点那三段（工单 03）：提问 + 两个选项各一段，`part` 缺省是正文
for (const [part, file] of [
  ['prompt', 'ask'],
  ['option-a', 'opt-a'],
  ['option-b', 'opt-b'],
]) {
  await copyFile(join(DEMO, 'page-1-a1.mp3'), join(OUT, `${file}.mp3`))
  narrations.push({
    ...shellNarration,
    pageNo: 3,
    part,
    asset: { ...shellNarration.asset, path: `books/${BOOK_ID}/${file}.mp3` },
  })
}

const book = {
  ...demo,
  bookId: BOOK_ID,
  cardId: 'verify-fixture',
  form: 'shared',
  tree: {
    form: 'shared',
    title: MISSING ? '《验证：两条路（缺一页图）》' : '《验证：两条路》',
    rootId: 'n1',
    nodes,
  },
  illustrations,
  narrations,
  errors: MISSING ? [{ pageNo: MISSING_PAGE, message: '验证夹具：这一页的图没出成' }] : [],
  createdAt: 0,
}

await writeFile(join(OUT, 'book.json'), JSON.stringify(book, null, 2), 'utf8')
console.log(`写了一本共读夹具：${join(OUT, 'book.json')}`)
console.log(`  ${nodes.length} 页 / 1 个选择点；a 支 4 页、b 支 5 页`)
if (MISSING) {
  console.log(
    `  ★ 第 ${MISSING_PAGE} 页：` + '`illustrations` 里申报了、盘上没有文件、`errors` 里记了一条',
  )
} else {
  console.log('  跑完 chk-shared-reader.mjs 记得 --clean')
}
