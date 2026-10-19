# 02 · 语料与索引：三份来源 → 一种 chunk

Status: done（2026-10-19 收工：96 条 chunk · 39.0 kB · 指纹 `adfab4685031`）
依赖：01
依据：[spec §三](spec.md)

## 这一张的产出

`src/lib/rag/corpus.ts`（装载与切块，纯函数）+ `scripts/build-rag-index.mts` +
`src/lib/rag/index.seed.json`（生成物，随仓库提交）。

## 三份语料，**归属不同所以落点不同**（这一条做错就是隐私事故）

| 来源     | 读哪儿                                                                                | owner        | 落点                        |
| -------- | ------------------------------------------------------------------------------------- | ------------ | --------------------------- |
| ① 种子   | `src/components/booklist/books/*.ts`（跨页正文）+ `docs/*-art-prompts.md`（提示词段） | `library`    | `index.seed.json`（进仓库） |
| ② 创作史 | `ASSET_ROOT/u/<userId>/books/<id>/story.json`（每一页）                               | `u/<userId>` | **不落索引**，检索时现场扫  |
| ③ 条款   | 工单 05 的 `review-corpus.ts`                                                         | `library`    | 代码即语料，不进这个索引    |

★ **① 是唯一进仓库的那一份。② 一个字节都不许进仓库**——
不是「最好别」，是判据：工单 03 的单测里要有一条「跨 owner 取不到」，
以及一条「`index.seed.json` 里不含任何 `u/` 开头的 owner」。

## 切块口径

- **一个跨页 / 一页 = 一个 chunk**（**不是滑窗**）。一页正文 1–3 句、几十字，
  天然是一个语义单元；滑窗在这个粒度上没有意义。这条写进 `corpus.ts` 文件头。
- `RagChunk` 的形状（元数据五项**固定**，它们是硬过滤的键，不是打分特征）：

  ```ts
  type RagChunk = {
    id: string // 稳定 id：'library/cloud#s3' / 'u/12/books/bk_x#p7'（指纹变了要变）
    kind: 'spread' | 'page' | 'prompt'
    owner: 'library' | `u/${string}`
    ageBand: AgeBand | '*'
    theme: ThemeKey | '*'
    form: BookForm | '*'
    text: string // 给模型看的那段字，**不含出处标识**
    source: string // 出处标识（书名 + 页码 / 文档名 + 段），给人看与进 provenance
  }
  ```

- `text` 里**不许出现出处标识**（书名、页码）：模型看见「来源：样书《…》第 3 跨页」
  写在正文旁边，会把它当可抄的语料的一部分。出处走 `source` 字段。
- 样书的 `ageBand` 该填什么：**去 `docs/booklist/README.md` 与本书的落点里找依据**，
  找不到就填 `'*'`（不确定就别编一个数——空值不等于默认值，这个项目在这条上付过学费）。

## 索引文件

- 形状：`{ corpusVersion, builtAt, chunks: RagChunk[] }`
- ★ **没有 `vectors` / `embedModel` 字段**（工单 01 已量：这把 key 上要不到嵌入）。
  原版留了它们并写着「工单 01 说『有』时才有值」——现在那句话有答案了，所以整两个字段删掉。
  留一个恒为空的 `vectors` 会被读成「有向量但没算」，那是个假的事实。
- `corpusVersion` = **内容指纹**，走 `src/lib/engine/digest.ts` 的规范化序列化
  （同一份语料必须得出同一个指纹；改一个字必须变）。同输入同指纹 = spec 判据 2。
- 文件头写一句生成物警告，照 `src/components/book/spreadTints.ts` 的先例：
  「改了源要重跑 `node scripts/build-rag-index.mts`」。

## 验收

- [x] `node scripts/build-rag-index.mts` 连跑两次，`corpusVersion` 一致（判据 2）——
      第二遍打印「语料没变，**文件没动**」（语料没变就不动文件，见 Comments 第 4 条）
- [x] 改样书里一个字，重跑，指纹变了（单测里用合成样本摁着；
      另外做了**证伪**：偷偷改索引里一个字、不动 `corpusVersion`，护栏那条用例当场红，其余 21 条照绿）
- [x] `corpus.test.ts`：96 个跨页 chunk 全在；元数据五项都在；`text` 不含书名与页码；
      `index.seed.json` 里零个 `u/` owner
- [x] 三条闸门过（`format:check` / `lint` / `typecheck` 全绿；`src/lib/rag/**` 已加进
      `tsconfig.engine.json` 的严格档与 `eslint.config.mjs` 的 PURE_ENGINE_FILES）
- [x] 归零核对：**索引 96 条 · 39.0 kB**（进技术文档）

## 不做

- ✗ 不引分词器（jieba 之类）：工单 03 的 bigram-BM25 零依赖
- ✗ 不为 ② 建持久索引（spec §三的纪律：几十本 × 20 页，现场扫是毫秒级）
- ✗ 不把 ③ 条款混进这份索引（它是规则，每次全用）
- ✗ **本轮不做 `kind: 'prompt'`**（`docs/*-art-prompts.md` 的画面提示词段）：
  出图那条本轮不接，所以这一类 chunk 今天没有消费者。推迟的经过写进了
  `corpus.ts` 的文件头与 spec §三，**接出图那条时再加**——那时候它有明确的用途。

## Comments

**2026-10-19 · 收工记录**

产出：`src/lib/rag/corpus.ts`（切块 + 指纹 + 索引解析）· `src/lib/rag/corpus.test.ts`（22 条）·
`scripts/build-rag-index.mts` · `src/lib/rag/index.seed.json`。

实测数：**12 本样书 → 96 条 chunk · 39.0 kB · 指纹 `adfab4685031`**，
每本正好 8 跨页、12 个主题一个不缺。护栏：`--mode=stub` 离线跑完一本书仍然 exit 0（判据 1）。

四条当时判过的事，写下来免得下一个读的人重新推一遍：

1. **`ageBand` 填 `4-6` 有出处，不是猜的。** 12 本样书的 `hero` **每一本**都写着「约 5 岁」
   （实测：`grep -h "hero:" src/components/booklist/books/*.ts | grep -o "约 [0-9]* 岁" | sort | uniq -c`
   → `12 约 5 岁`）。所以那一段读的是 `hero` 里的岁数，**不是写死一个常量**——
   将来某本样书改成别的年龄，它会跟着走。
2. **样书的 `form` 填 `'*'`（对两种形态都开放），这不是"没记"。** 样书本身是线性的
   （8 跨页、一个选择点都没有），但它在这里的作用是「同一个年龄档下写完了的句子长什么样」，
   与形态无关。标成 `solo` 的后果很具体：共读版那一半请求按 `form` 过滤之后**一条都取不到**，
   于是半个产品的检索是哑的。形态约束真正要管的是避重那一侧（拿独读版的落点去避共读版的重复是错的），
   那条落在 ② 的 chunk 上——它自己有准确的形态。
3. **`corpus.ts` 只声明样书的"结构形状"，不 import `components/booklist/booklist.ts`。**
   因为 `src/lib/rag/**` 与引擎同档，`eslint.config.mjs` 那条禁 `@/components/**` 罩着它。
   切块由脚本把真对象递进来（结构对得上就行，`BooklistBook` 天然满足）。
4. **语料没变就不动索引文件**（`builtAt` 因此的含义是"这一版内容的定稿时间"，
   不是"我最后一次跑脚本的时间"）。不这么做，每次重跑都会让那个 JSON 多一行时间戳 diff——
   没有信息、只有噪音。要强制重写加 `--force`。

三笔踩到的坑，也记下来：

- ★ **`scripts/build-rag-index.mts` import 的那条链上，只许有 `import type` 的别名导入。**
  `booklist.ts` 里有 `import type { ThemeKey } from '@/lib/themes.ts'`，而 node 直跑 .mts
  **不认 tsconfig 的 `@/` 别名**——它今天能跑通只因为那是类型导入，会被类型剥离擦掉。
  谁加了运行期的 `@/…` 导入，这个脚本会以 `ERR_MODULE_NOT_FOUND` 挂掉（写进了脚本文件头）。
- ★ **`fail(...)` 当语句用不会收窄类型。** `parseRagIndex` 里 `if (!Array.isArray(raw)) fail(...)`
  之后 `raw` 仍是 `unknown`——TS 不认「箭头函数赋值给 const」这种写法的 never 收窄。
  改成 `return fail(...)` 与显式参数标注（`: unknown, : number`）就过了。
  这是本项目**第一次让 `.mts` 脚本进严格档之外的目录**、也是 `src/lib/rag` 第一天进
  `noUncheckedIndexedAccess`，四处报错全在这一处。
- **`.prettierignore` 加了 `src/lib/rag/index.seed.json`**：它与 `public/demo/books` 同一条理由——
  那是**脚本写出来的字节**，让 Prettier 接管之后"生成脚本刚吐出来的那份"与"仓库里那份"
  就不再是同一个文件，而那直接撞上 `corpus.test.ts` 的指纹自洽护栏。
