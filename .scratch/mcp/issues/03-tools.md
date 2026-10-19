# 03 · 七条工具（四条写、三条读）

Status: done（2026-10-19 收工：21 条测试 · 七条工具都能跑）
依赖：[02](02-protocol.md)（要它的 `ToolSpec` 形状）
依据：[spec §五](spec.md)

## 要做的事

- [ ] 新建 `src/lib/mcp/tools.ts` + `tools.test.ts`。
      每条 = `{spec, run(args, ctx)}`，`ctx = {store, owner, mode}`。
- [ ] 七条：

  | 工具              | 干什么                                               | 复用谁                                                 |
  | ----------------- | ---------------------------------------------------- | ------------------------------------------------------ |
  | `list_children`   | 这个账号下的孩子                                     | `createProfileStore`                                   |
  | `character_card`  | 锚点 + 风格段 + **出图时真正会用的角色段与核对清单** | `createCardStore` + `promptFragmentOf` / `checklistOf` |
  | `list_books`      | 书架摘要                                             | `listBooks(store, noCovers)`                           |
  | `read_book`       | 正文全文（含选择点与画面描述）                       | `readStory`                                            |
  | `book_status`     | 最后 N 条**人话** + 分类计数                         | `createFsEventLog` + **`describeEvent`**               |
  | `plan_book`       | 编故事（同步）                                       | `planBook`                                             |
  | `illustrate_book` | 出图（**异步**，立刻返回）                           | `illustrateBook`                                       |

- [ ] ★ `book_status` 用 `describeEvent`，**不许自己拼一句话**。
      `events.ts` 那句「放在引擎侧而不是 UI 侧：MCP 返回与日志也要同一句话，
      不能各翻一遍」就是为它写的——这一条是那个承诺的兑现处，
      自己拼一份的话那句注释当天就变成假的。
- [ ] ★ `character_card` 回「画师会拿到的那一段」而不只是八条锚点：
      模型要写画面描述，它得知道画师拿到什么。
- [ ] 每个工具的 `description` 写清**代价**：`plan_book` 一次文本调用、
      `illustrate_book` 一页出图（实测 ≈154 s 与 0.20 元/张）。
      工具描述是模型唯一读得到的说明书，省掉代价就是让它替你花钱。
- [ ] `illustrate_book` 立刻返回 `{bookId, started:true, hint}`；
      `book.json` 已经在就**拒画**（与网页那条 409 `book-exists` 同一条）。

## 验收

- [ ] `tools.test.ts` 覆盖四类边界：
      **空态**（没孩子 / 没书 / 没卡时回「没有」而不是空数组了事）、
      **负例**（不存在的 `bookId` → `isError` + 人话；非法 `form` / 超长 `theme` 被挡住）、
      **参数形状**（缺必填 / 多给一个字段）、
      **`ctx` 的 mode**（`stub` 档不许打网络）
- [ ] 每一条的 `spec.inputSchema` 是合法 JSON Schema，且 `run` 对它的必填项真的做了校验
      （写了 schema 不校验 = 那张表是装饰）
- [ ] 文件头写清：这七条**为什么是这七条**（哪些是计划表草图里的、
      哪三条是补的、补的理由）

## 不做

- ✗ 不返回图片内容块（`read_book` 只回文本，见 [spec §七](spec.md)）
- ✗ 不做删除类工具（`delete_book` / `delete_child`）——一个 AI 助手不该有那个手

## Comments

**2026-10-19 · 收工记录**

`src/lib/mcp/tools.ts` + `tools.test.ts` **21 条全绿**（`pnpm test` 总数 1266）。

### ★ 一处架构调整：`children` 改成注入，不传路径

原来 `ToolContext` 收的是 `sliceRoot`（一个路径），因为 `/api/children` 那条路走的是
`listChildItems(root, urlFor)`——而那个函数**内部自己建 fs store**（`card-source.ts`
的文件头解释过为什么那一层绕不过路径）。

问题是：绑成路径之后这一层就**再也测不动了**（内存 store 喂不进去），
而这一层恰好是"模型会读到的每一句话"的产地——它必须能被测。

改成 `children: () => Promise<ChildListItem[]>` 之后：
· 生产侧照旧传 `listChildItems(sliceRoot, p => p)`（**同一处实现**，没有第二份取数）；
· 测试侧喂一个手搭的数组，内存 store 就能跑完 21 条。
**路径留在入口，函数进这一层。**

### ★ 抓到的一个真 bug：事件顺序

第一版 `forward` 每条事件各起一条 promise 链：

```ts
void log.append(bookId, event).then(() => notify(event)) // ✗ 每条各自为政
```

两条 `append` 的完成顺序由磁盘决定，于是**报上去的顺序会乱**。实测跑出来的现场是：

```
progress 1 正在翻以前写过的故事…
progress 2 翻到了 3 段可以照着写的
progress 4 故事编好了：《小宇的云》，5 页，1 个选择点     ← 先到了
progress 3 正在编故事…                                   ← 后到了
```

改成**一本书一条链**（`chains: Map<string, Promise<void>>`），与 `/api/books` 那条
「顺序就是发射顺序」同一个写法。

★ 顺着这条又发现第二处：`plan_book` 返回前**没有 `await` 那条链**，
于是收尾那句话抢在自己的事件前面写出去，而客户端那一侧工具调用已经结束了——
尾巴上的通知直接丢。路由那两条也是先 `await chain` 再发收尾帧的。
加了 `await settle(bookId)`。

### 另一处小 bug

`list_children` 会长出「4-6 岁 岁」——`AGE_BAND_LABELS` 里已经带"岁"了
（`'4-6': '4-6 岁'`、`'8+': '8 岁以上'`），我在后面又补了一个。

### 判据

| 判据                                     | 读数                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| 七条工具的名字与草图对得上               | ✅ 草图四条 + 补的三条读的                                                 |
| 写了 schema 就真的校验                   | ✅ 缺必填 → `isError` + 一句人话                                           |
| **只读的四条不碰供应商**                 | ✅ 给一个"一调就炸"的 providers，四条照样过                                |
| 空态说得清"没有"                         | ✅ 没孩子 / 没书 / 没形象 / 没跑过，四种                                   |
| 负例给的是能照着改的话                   | ✅ 列出现有的 childId / 合法 form / 页数边界                               |
| `book_status` 的人话来自 `describeEvent` | ✅ 逐条断言与 `describeEvent` 相等                                         |
| `plan_book` 真的写盘                     | ✅ 判据落在 `store.list('books/')` 上，不看返回的那段话                    |
| `illustrate_book` 立刻返回               | ✅ 返回时 `book.json` **还不在**（这一条就是"立刻返回"与"等它画完"的判别） |
