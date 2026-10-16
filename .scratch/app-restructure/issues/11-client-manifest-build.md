# 11 · `pnpm build` 红：首页那个客户端组件没进 React Client Manifest

Status: **fixed（补丁已落地，等提交）** —— 见 §六、§七。
发现于：[02](02-reference-image-pipeline.md) 的验收第 7 条（"四条闸门 + `pnpm build`"）。
**与本单无关的那次改动无关**——下面"不是这些"那一节逐条排掉了。
硬约束：这条不许用"把组件挪个位置/加个空文件"的办法糊过去。**先找到触发条件再决定改什么。**

> **一句话结论**：`StorybookFlip` 在 client 编译里被 webpack 拼进了一个
> **模块 id 恰好是 `0`** 的 concatenated scope（正常现象），而 Next 写 manifest
> 时把"父 scope 的 id"当**真假值**用：`if (concatenatedModId)`。
> `0` 是假值 ⟹ 这一条被跳过 ⟹ manifest 里少一个 key ⟹ 预渲染时
> `registerClientReference` 找不到它，报 "Could not find the module"。
> **触发条件与组件内容、体积、位置都无关**，只与"webpack 那一次给它的 scope 分了哪个整数"有关。

## 一、症状

```
✓ Compiled successfully
Linting and checking validity of types ...
Collecting page data ...
Generating static pages (0/6)
Error occurred prerendering page "/".
Error: Could not find the module
  "E:\project\once-upon-me\src\components\book\StorybookFlip.tsx#default"
  in the React Client Manifest. This is probably a bug in the React Server Components bundler.
    digest: '139640082'
Export encountered an error on /page: /, exiting the build.
```

只在**静态预渲染** `/` 时炸；`Compiled successfully` 已经过了，所以不是语法/类型问题。

## 二、定位（证据，不是猜测）

1. 服务端 chunk 里确实生成了客户端引用，**id 是绝对路径**：
   `.next/server/app/page.js` 里有
   `registerClientReference(fn, "E:\\project\\once-upon-me\\src\\components\\book\\StorybookFlip.tsx", "default")`。
   这是 Next 的正常行为（`next-flight-loader/index.js`：`resourceKey = this.resourcePath`）。

2. 但 `.next/server/app/page_client-reference-manifest.js` 的 **`clientModules` 里没有这个 key**；
   同一个 commit 里 `BackToTop` / `HeroOrbit` / `HeroTypewriter` / `HighlightsReel` /
   `SceneBackdrop` **都在**。所以是"少了一条"，不是"全都没了"。

3. 反查 Next 的收集逻辑（`build/webpack/plugins/flight-client-entry-plugin.js`
   `collectComponentInfoFromServerEntryDependency`）：它从页面入口按依赖顺序遍历，
   `isClientComponentEntryModule(mod)` 为真才记进 `clientComponentImports`，
   而那个判据是 `getModuleBuildInfo(mod).rsc?.isClientRef`
   （`build/webpack/loaders/utils.js`），`isClientRef` 又来自源码里
   `/* __next_internal_client_entry_do_not_use__ … */` 这个 **SWC 注入的标记**
   （`build/analysis/get-page-static-info.js`）。
   遍历用一个 `visitedOfClientComponentsTraverse` 集合**按资源路径去重**，
   重复访问时只在"已经记过"的情况下补 import，否则直接 return。

4. **决定性实验**：把一个与 `StorybookFlip.tsx` **逐字节相同**的副本放进同一个目录
   （`src/components/book/ProbeFlip.tsx`，并在 `page.tsx` 里 import + 渲染），
   再 build。

   | 状态                     | `clientModules` 里 StorybookFlip |
   | ------------------------ | -------------------------------- |
   | 没有副本（连跑两次）     | **0 / 0**（稳定缺席）            |
   | 有逐字节副本（连跑三次） | **1 / 1 / 1**（稳定在场）        |

   ★ 一个**内容完全相同**的兄弟文件在不在，决定了原文件在不在 manifest 里。
   这排除了"内容里有什么东西让 SWC 不认 `'use client'`"这一类解释，
   指向 webpack 的模块编号 / 拼接（`concatenateModules`）顺序。

5. 另外单独试过：把 `ProbeFlip.tsx` 写成 6 行的最小客户端组件 → `ProbeFlip` 在场、
   `StorybookFlip` **仍然缺席**。所以不是"目录里必须有第二个文件"，
   而是"必须有第二个**同内容**的文件"——这个区别很重要，别把它简化成前者。

## 三、不是这些（都排过了，别重复走）

| 嫌疑                                   | 排除方式                                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 陈旧/被并行会话踩坏的 `.next`          | 换全新 `NEXT_DIST_DIR` 干净构建，同样红                                                                                   |
| `.next-build/cache` 里的旧模块号       | 删掉缓存重建，同样红                                                                                                      |
| 文件名大小写冲突（Windows）            | 全仓 `find \| sed 's\|.*/\|\|' \| sort \| uniq -d` 无同目录重名                                                           |
| BOM / 换行符 / 首行不是 `'use client'` | hexdump 前 8 字节：`27 75 73 65 20 63 6c 69`，与正常组件一致；CR 数量也不是分界                                           |
| `NODE_ENV` / 环境变量                  | 都是空的；`.env.local` 只有各家 key 与 `*_BASE_URL`                                                                       |
| 本单（02）改动的文件                   | 首页那棵图（`page.tsx` → `book/` `hero/` `highlights/` `scene/`）**一个文件都没被 02 碰过**；`git diff --stat` 里没有它们 |
| `@/*` 别名把路径变成绝对               | 同一个 manifest 里**连 `next/dist/client/app-dir/link.js` 都是绝对路径键**，且别的组件照样在场                            |

## 四、复现步骤

```bash
# 1. 现状（红）
pnpm build

# 2. 复制一份逐字节相同的副本
cp src/components/book/StorybookFlip.tsx src/components/book/ProbeFlip.tsx
#    在 src/app/page.tsx 里 import ProbeFlip 并渲染 <ProbeFlip />
# 3. 再 build：这次 prerender 会过（或至少这个模块不再缺席）
NEXT_DIST_DIR=.next-probe pnpm build
grep -o StorybookFlip .next-probe/server/app/page_client-reference-manifest.js | wc -l
# 4. 收拾干净（副本与 page.tsx 都要还原，tsconfig.json 会被 Next 自动改写，跑一次 prettier）
```

## 五、下一步（挑一个方向，别一次全上）

1. **把 `StorybookFlip.tsx` 缩小到能复现的最小体**：它是 26.9 KB、含一大段文档注释、
   一个顶层 `if (process.env.NODE_ENV !== 'production') { … }` 自检块、
   `const P_AT = (() => { … })()` 立即执行函数。顶层 IIFE / 顶层副作用是最可疑的两个。
2. 用 `next build --experimental-debug-memory-usage` 不解决问题，但
   **`next build` 加 webpack 的 `optimization.concatenateModules: false`** 能验证
   "是不是拼接导致的模块号错位"——**只是验证，不要留在配置里**（关掉它会显著加大产物）。
3. 去 Next 的仓库搜 `Could not find the module` + `Client Manifest` + Windows 的 issue，
   看 15.5.x 有没有已知问题（本次搜索没搜到可用的结果）。

★ **别做的**：为了让它变绿而给组件换个位置、加个空副本文件、或把 `/` 改成
`export const dynamic = 'force-dynamic'`。前两个是把触发器藏起来（下一个大组件还会踩），
第三个是拿掉静态预渲染换绿灯——那是产品行为变更，得单独说。

---

## 六、根因（2026-10-15，已实测到行）

### 6.1 结论

`clientModules` 是在 **client 编译**里写的
（`build/webpack/plugins/flight-manifest-plugin.js` `ClientReferenceManifestPlugin.createAsset`）。
它对每个 client entry 的直接子模块分两种走法（lines 343-363）：

```js
const clientEntryMod = compilation.moduleGraph.getResolvedModule(dependency)
const modId = compilation.chunkGraph.getModuleId(clientEntryMod)
if (modId !== null) {
  recordModule(modId, clientEntryMod) // ← 有 id：直接记
} else {
  // If this is a concatenation, register each child to the parent ID.
  if (connection.module?.constructor.name === 'ConcatenatedModule') {
    const concatenatedModId = compilation.chunkGraph.getModuleId(concatenatedMod)
    if (concatenatedModId) {
      // ★ 就是这一行
      recordModule(concatenatedModId, clientEntryMod)
    }
  }
}
```

被拼进 scope 的子模块自己没有 id（`getModuleId` 返回 `null`），
所以走 fallback、用**父 scope 的 id**——这是对的：client chunk 里那个 id
确实指向装着这个组件代码的 scope。问题只在于 `if (concatenatedModId)`
**把 `0` 当成"没有 id"**。上一行的兄弟判断写的是 `modId !== null`（作者知道 0 是合法值），
这一行漏了。

`0` 确实是合法 id，不是哨兵值：`ChunkGraph.getModuleId` 就是
`this._getChunkGraphModule(mod).id`，而 `ChunkGraphModule` 的 `id` 初值是 `null`。

### 6.2 实测数据（本 worktree，`NEXT_MANIFEST_DBG=1` 下抓的）

给 fallback 分支加了三行日志，`/` 那个 client entry 的全部子模块：

| 子模块                             | 自己的 id | 父 scope 的 id | 结果                |
| ---------------------------------- | --------- | -------------- | ------------------- |
| `next/dist/client/app-dir/link.js` | 7090      | —              | 在 manifest         |
| `BackToTop.tsx`                    | 6310      | —              | 在 manifest         |
| `HeroTypewriter.tsx`               | 2131      | —              | 在 manifest         |
| `HeroOrbit.tsx`                    | `null`    | 6468           | 在 manifest         |
| `HighlightsReel.tsx`               | `null`    | 4084           | 在 manifest         |
| `SceneBackdrop.tsx`                | `null`    | 9575           | 在 manifest         |
| **`StorybookFlip.tsx`**            | `null`    | **0**          | **缺席 → 预渲染炸** |

改前/改后 manifest 的 `clientModules` 条数：**33 → 34**；
补上来的那条是

```json
"…\\src\\components\\book\\StorybookFlip.tsx": { "id": 0, "name": "*", "chunks": [...], "async": false }
```

——`id: 0` 就是它该有的值，改完之后 build 全绿、页面照常渲染（见 §七.2）。

### 6.3 那个 `0` 是怎么来的（为什么"副本"能改变结局）

webpack 生产模式默认 `optimization.moduleIds: 'deterministic'`
（`WebpackOptionsApply`：`production → "deterministic"`），
对应 `DeterministicModuleIdsPlugin`（无参 → `maxLength || 3`）：

- id 空间从 `10**3` 起步，`idSpace < 模块数*20 + 已用 id 数` 时 **×10 长一档**。
  本项目 client 编译落在 **`10**4`**（实测：用下面的脚本按空间 10⁴ 能逐字对上 id）。
- 每个模块的 id = `fnv1a32(模块全名 + salt) % idSpace`；**撞了就把 salt 加一重算**，
  直到第一次碰到空位。
- 模块全名 = `makePathsRelative(context, module.identifier())`（`module 60874`）。

按这个算法重算这四个 scope（脚本见 §八）：

| 组件                | id    | 第几次 salt 才碰到空位 |
| ------------------- | ----- | ---------------------- |
| `HeroOrbit`         | 6468  | salt 0（一次就中）     |
| `HighlightsReel`    | 4084  | salt 0                 |
| `SceneBackdrop`     | 9575  | salt 3216              |
| **`StorybookFlip`** | **0** | **salt 11392**         |

★ 也就是说：**id 空间此时已经相当满**，盐链要撞几千次才碰到一个空位，
而 `StorybookFlip` 撞到的那个空位正好是 **`0`**。

这就解释了 §二.4 那条"反直觉"的实测：改动模块**集合**（多一个逐字节副本）
就会移动每个人的盐链，于是"谁拿到 0"换人——
**一个内容完全相同的兄弟文件在不在，决定了原文件在不在 manifest 里**。
它也解释了为什么连跑两次稳定复现（同样的模块集合 ⟹ 同样的确定性分配）。

★ **所以这个雷与 `StorybookFlip` 本身无关**：任何一个被 webpack 拼成 scope 的
客户端组件，只要分到 `0` 就会被静默丢掉，而且只在预渲染那一刻才炸。
把它挪个位置/改个名只是把雷挪到下一个大组件脚下。

## 七、修法（已落地，等提交）

### 7.1 改哪一行

不在 `src/` 里改——**缺陷在 Next**，所以按依赖补丁走（`pnpm patch`）：

| 文件                                                              | 改动                                                                                          |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [patches/next@15.5.27.patch](../../../patches/next@15.5.27.patch) | `if (concatenatedModId)` → `if (concatenatedModId !== null)`                                  |
| [pnpm-workspace.yaml](../../../pnpm-workspace.yaml)               | `patchedDependencies: next@15.5.27: patches/…`（pnpm 12 收在这个文件里，不在 `package.json`） |
| `pnpm-lock.yaml`                                                  | `patch_hash=8ca8d32d…`（`pnpm install --frozen-lockfile` 可复现）                             |

`!== null` 是照抄上面一行兄弟判断的写法（`ChunkGraphModule.id` 初值就是 `null`，
不会是 `undefined`）。**没有**动 `next.config`，没有关 `concatenateModules`，
没有改模块 id 策略——那两种都会让产物变大，而且是把触发器藏起来。

### 7.2 验证矩阵

| 状态                                    | `pnpm build` | manifest 里 StorybookFlip | 条数 |
| --------------------------------------- | ------------ | ------------------------- | ---- |
| 原样（本次 worktree 复现，连跑 3 次）   | ✗ 预渲染炸   | 无                        | 33   |
| 只改这一行                              | ✓ 6/6 页静态 | `{"id":0,…}`              | 34   |
| 改完 + 删掉 `.next` 重新干净构建        | ✓ 6/6 页静态 | 有                        | 34   |
| 改完 + `pnpm install --frozen-lockfile` | 补丁仍在     | 有                        | 34   |

另外把产物真跑起来看了一眼（`pnpm start --port 3999`）：`GET /` = **200 / 29653 B**，
HTML 里有 `storybook__book`、`book-choice__ask`、`aria-label="滚动翻页绘本…"`。

四条闸门 + build：

```
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test   # 26 files / 272 tests
pnpm build                                                      # ✓ Generating static pages (6/6)
```

### 7.3 还欠两件事

1. **上游**：这行 `if (concatenatedModId)` 是 Next 的 bug（webpack 路径）。
   本仓库只见到 webpack 这一条路径有这段代码（`rspack-flight-client-entry-plugin.js`
   里没有 `ConcatenatedModule` 相关分支）。值得给 vercel/next.js 提个 issue/PR：
   判据应是 `!== null`。**本项目不依赖上游节奏**，所以先本地打补丁。
2. **升级 next 时**：补丁的 key 绑死了 `next@15.5.27`。一旦升版本，
   pnpm 会提示 patch 未应用（`ERR_PNPM_PATCH_NOT_APPLIED`），那时**要么把这一行补回新版本，
   要么确认上游已修**——别让补丁悄悄消失。

## 八、测量方法（可复现）

两个脚本留在 `.scratch/app-restructure/` 里，不参与构建：

- [manifest-keys.mjs](../manifest-keys.mjs) —— 把某个
  `page_client-reference-manifest.js` 的 `clientModules` 键打出来，
  一眼看出"少了哪一条"（改前 33 / 改后 34）：
  ```bash
  node .scratch/app-restructure/manifest-keys.mjs .next/server/app/page_client-reference-manifest.js
  ```
- [why-zero.mjs](../why-zero.mjs) —— 按 webpack 的
  `fnv1a32(makePathsRelative(ctx, identifier) + salt) % 10000` 重算 id，
  验证"谁分到 0、撞了几次盐"（§6.3 那张表就是它跑出来的）：

  ```bash
  node .scratch/app-restructure/why-zero.mjs /tmp/manifest-dbg.log
  ```

  它读的日志是这样来的：在 `flight-manifest-plugin.js` 的 fallback 分支里插一行
  （临时改 `node_modules`，**不要提交**）：

  ```js
  if (process.env.NEXT_MANIFEST_DBG === '1' && entryName === 'app/page') {
    console.error(
      '[F] child=' +
        clientEntryMod.resource +
        ' | concatId=' +
        concatenatedModId +
        '\n     IDENT=' +
        concatenatedMod.identifier() +
        '\n     REL=.',
    )
  }
  ```

  然后 `NEXT_MANIFEST_DBG=1 NEXT_DIST_DIR=.next-dbg pnpm build 2>&1 | tee /tmp/manifest-dbg.log`。
  **跑完记得删掉 `.next-dbg*`，并把 `tsconfig.json` 还回去**
  （`next build` 会把每个 `NEXT_DIST_DIR` 塞进 `include`，prettier 只修格式、不会删行）。
