# 09 · 「重配这一页」那个播放器打开是 0:00（资产出口不支持 `Range`）

Status: **done**（2026-10-18）
依赖：08（两个弹窗是那一单做的）

## 用户报的

> 「这个播放有bug啊，我点开是0秒，但是其他是有音频的」

截图是《黑夜里的光》第 2 页那一格点开的「重配第 2 页」：上面那个原生播放器
显示 `0:00`、进度条是空的，而这一页**确实有录音**（盘上 `page-2-a1.mp3`，143,611 字节）。

## 量到的三件事（每一件都是跑出来的，不是看代码推的）

### ① 那条出口回的是 `Transfer-Encoding: chunked`，而且不认 `Range`

```bash
TOKEN=$(node .out/mint.mjs 1 probe)   # 自己签一张票，只在这台机器上用几分钟
curl -s -D - -o /dev/null -H "Cookie: xzj_session=$TOKEN" \
  'http://127.0.0.1:3000/api/assets/books/<bookId>/page-2-a1.mp3'
curl -s -D - -o /dev/null -H "Cookie: xzj_session=$TOKEN" -H 'Range: bytes=-2048' <同上>
```

修之前两条都是 `200 OK` + `Transfer-Encoding: chunked`：**没有 `Content-Length`**，
`Range` 被整份丢掉（回的是一整个文件，不是 206）。

### ② 这些 mp3 一个 Xing/Info 头都没有

```bash
python -I .out/mp3-dur.py .out/web/u/1/books/<bookId>
```

逐帧读完那 16 个 TTS 产物（13 页正文 + 提示句 + 两个选项）：**一个 Xing 头都没有**
（`表` 那一列全是 `None`）。★ 这一条是关键——一条 mp3 的总时长只有两个来源：
头里那张表，或者**把流走到底数帧**。没有表，浏览器就只剩"读末尾"这一条路，
而读末尾用的正是 `Range: bytes=-N`。

### ③ 浏览器那边就是 `duration = NaN`

```bash
node .out/probe-audio.mjs http://127.0.0.1:3347 <bookId>
```

无头 Chrome + CDP，点开「重配」把那个 `<audio>` 的真实状态读出来。

|        | 打开的那一刻                                                              | 按下播放、等整条读完                       |
| ------ | ------------------------------------------------------------------------- | ------------------------------------------ |
| 修之前 | `duration=NaN, readyState=0`，**一条 mp3 请求都没有**（`preload="none"`） | `duration=7.152, readyState=4, seekable=0` |
| 修之后 | `duration=7.176, readyState=4, seekable=7.176`，请求是一条 `206`          | 同左（`seekable=7.176`，拖得动）           |

★ 修之前 `seekable` 是 **0**：那个进度条**从来没拖动过**。
出口那条注释原来写着「对朗读音频是可以接受的：一页一百来 KB，从头播完就够」——
那是一句**没量过的推测**，量过之后它是错的。

## 改了什么

| 文件                                        | 改动                                                                                                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/http-range.ts`（新）               | `parseRange(header, size)`：单段三种写法（`a-b` / `a-` / `-n`）、越界 → `'unsatisfiable'`、认不出/多段/`last < first` → `null`（忽略，回整份）。8 条单测在 `http-range.test.ts` |
| `src/app/api/assets/[...path]/route.ts`     | `byteResponse` 收 `Range` 头：回 `Content-Length` + `Accept-Ranges: bytes`，要哪段给哪段（`206` + `Content-Range`），要不到给 `416` + `bytes */size`                            |
| `src/components/creation/RevoiceDialog.tsx` | `preload="none"` → `preload="metadata"`：这一屏的理由就是"先听得见"，打开的那一刻就该知道这一页有多长                                                                           |

★ **阅读器那两个 `<audio>` 一个字没动**（仍然是 `preload="none"`）：那边是一本 20 页
两三兆，而且它们只吃 `onEnded`、从来不读 `duration`——不是同一件事。

## 怎么复现（三条命令）

```bash
node scripts/dev-preview.mjs --dist=.next-audio --port=3347
```

```bash
node .out/probe-audio.mjs http://127.0.0.1:3347 kid-rnp95e-sheet-047840e24574
```

```bash
curl -s -D - -o /dev/null -H "Cookie: xzj_session=$(node .out/mint.mjs 1 probe)" -H 'Range: bytes=-2048' \
  'http://127.0.0.1:3347/api/assets/books/kid-rnp95e-sheet-047840e24574/page-2-a1.mp3'
```

第三条现在应该回 `206` + `Content-Range: bytes 141563-143610/143611`；
修之前回 `200` 整份。★ 那两段字节与文件逐字节比过（`cmp` 过：前 1000 与末尾 2048 都一致）。

## 没做的（写在这里，免得下次当成漏了）

- **音频的缓存头仍是 `no-store`**。`page-2-a1.mp3` 不含内容指纹，而重配**会**写新名字
  （`page-2-a2.mp3`，`narrate.test.ts` 钉着这条），所以理论上 immutable 那条能给它。
  但改缓存策略与这次这个 bug 是两件事，别混着改。
- **服务端没有"先给时长"这条路**。打开弹窗仍然要拉这一页的音频（实测那条 `Range: bytes=0-`
  就是整份 143,611 字节）。要再省，路是让元数据先到，不是在客户端猜。
