/**
 * GET /api/assets/<path...> —— 把资产根下的字节喂给浏览器（图与清单都走这里）
 *
 * 为什么需要它：生成的图落在资产根（`ASSET_ROOT`，缺省 `.out/web`），**不在 `public/`**。
 * 想让 `<img src>` 拿到，只有两条路：把它们拷进 `public/`（那就等于把运行期产物
 * 混进静态资源，且每次生成都要拷贝），或者开一个只读的出口——这条。
 *
 * 四条约定：
 *
 * 1. **路径越界由 store 拒**，这里不自己写字符串检查。「`../` 这种事不能靠信任」
 *    （`stores.ts` 的原话）已经在那层实现过一次，第二遍实现就是第二遍会漏的地方。
 * 2. **缓存头按内容指纹来**。我们的资产文件名里就带指纹（`ref.<指纹>.png`），
 *    所以可以放心让浏览器长期缓存；不带指纹的（`book.json`、`events.jsonl`）
 *    一律 `no-store`——那些会在同一路径上被改写。
 * 3. **只读，只认这几个前缀，而且只认你自己那一片**。`cards/`、`books/`、`assets/`
 *    是引擎与卡存储写的三处；别的一律 404，免得这个出口变成"整个磁盘的读接口"。
 *    ★ 2026-10-17（工单 16）补上后一半：这条路原来**不认人**——书号是"卡 + 主题指纹"
 *    推出来的，猜得出来，所以知道 id 就能拿到别人的整本 `book.json`（含每页 prompt）
 *    与朗读音频。现在它要求登录，并且读的是**请求者自己那一片**
 *    （`asset-scope.ts` 的 `createUserStore`）：别人的 id 在你自己那一片里
 *    根本不存在，于是 404——**不是"读了再判"，是那一片里没有这个键**。
 *    ★ 演示书与灵感书单不受影响：那两条走 `public/demo`、`public/booklist`，
 *    是静态文件，压根不经这条路。
 *    ★ 2026-10-17 当天稍后：**示例角色卡是例外，而且是有意的**。
 *    `createUserStore` 现在把 `public/demo/cards/` 垫在每个人那一片底下
 *    （`card-source.ts`），所以 `/api/assets/cards/xiaoman-r1/ref.<指纹>.jpg`
 *    对任何**已登录**的人都读得到。这是刻意的：示例卡不属于任何人，
 *    它是"先看看效果"的那两张，界面上本来就要给每个人看；而它的参考图还要被
 *    出图那一步当锁脸的输入用。★ 那条真正的隔离（**别人的**东西拿不到）
 *    一个字没变：别把这一条例外读成"这条路开始认公共内容了"——
 *    `books/` 与 `children/` 仍然是纯粹的自己那一片。
 *    ★ 代价一条，写在这里免得下次有人惊讶：示例卡的缩略图会缓存进**请求者**
 *    那一片（`u/<id>/thumbs/...`）。它是派生物、不是作品，管理页那一列按目录名数，
 *    不会把它算成人家的书或卡。
 * 4. **`?w=<档>` 要缩略图**（`lib/thumbs.ts` 那五个档）。缩出来的 WebP 落盘缓存，
 *    第二次就是纯读盘。★ 缩不动（图坏了、sharp 装不上）时**回原图**而不是 500：
 *    一个性能优化不该变成一次故障——这是这一层与"密钥没配"那类错误唯一的不同。
 */

import { createUserStore } from '@/lib/asset-scope.ts'
import { assetRoot } from '@/lib/books-runtime.ts'
import type { AssetStore } from '@/lib/engine/providers/types.ts'
import { requireCapability } from '@/lib/auth/session.ts'

import type { NextRequest } from 'next/server'
import { isResizableImage, renderThumb, thumbKeyOf, thumbWidthOf } from '@/lib/thumbs.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_PREFIXES = ['cards/', 'books/', 'assets/'] as const

/** 名字里带内容指纹的可以长缓存；别的（会被改写的清单与日志）一律不缓存 */
const FINGERPRINTED = /\.(?:[0-9a-f]{12})\.[a-z0-9]+$/i

function contentTypeOf(name: string): string {
  const ext = name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : ''
  return ext === 'png'
    ? 'image/png'
    : ext === 'webp'
      ? 'image/webp'
      : ext === 'jpg' || ext === 'jpeg'
        ? 'image/jpeg'
        : ext === 'json'
          ? 'application/json; charset=utf-8'
          : ext === 'jsonl' || ext === 'txt'
            ? 'text/plain; charset=utf-8'
            : // ★ 音频这一档是补的：漏了它，朗读音频会以
              // `application/octet-stream` 发出去，浏览器认不认全靠猜。
              // 顺带记一条同源的教训：百炼回的 content-type 是 `audio/mpeg`
              // （不含 "mp3" 三个字符），`stores.ts` 的 extensionOf 在那里踩过一次。
              ext === 'mp3'
              ? 'audio/mpeg'
              : ext === 'm4a'
                ? 'audio/mp4'
                : ext === 'wav'
                  ? 'audio/wav'
                  : 'application/octet-stream'
}

function byteResponse(bytes: Uint8Array, contentType: string, cacheable: boolean): Response {
  return new Response(
    // 交出 ArrayBuffer 而不是 Uint8Array 视图：BodyInit 收 ArrayBuffer，
    // 而 Uint8Array<ArrayBufferLike> 在新版 TS 的 lib 里不再被接受
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    {
      headers: {
        'Content-Type': contentType,
        // ★ 这条出口**不支持 Range**（要支持得自己切 206 与 Content-Range）。
        //   对朗读音频是可以接受的：一页一百来 KB，从头播完就够，
        //   拖动进度条那种"任意位置起播"才需要 Range。
        //   图片与清单是整数取的，本来也不需要。
        'Cache-Control': cacheable ? 'public, max-age=31536000, immutable' : 'no-store',
      },
    },
  )
}

/** 越界与不存在对外是同一件事，所以这里只区分"读到"与"读不到" */
async function readOrNull(store: AssetStore, relative: string): Promise<Uint8Array | null> {
  try {
    return await store.read(relative)
  } catch {
    return null
  }
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  // ★ 只要"登录了"（不要求任何能力）：看不见的书也不该看得见图。
  //   匿名 → 401。★ 未登录时界面上那些 `<img>` 会是一张碎图，但未登录的人
  //   本来也没有书可看（书架是空的），所以那不是一个"小明忽然看不见图"的故障。
  const guard = await requireCapability(req, [])
  if (!guard.ok) return guard.response

  const { path } = await ctx.params
  const relative = path.map((segment) => decodeURIComponent(segment)).join('/')

  if (!ALLOWED_PREFIXES.some((prefix) => relative.startsWith(prefix))) {
    return new Response('不认识的资产前缀', { status: 404 })
  }

  const store = await createUserStore(assetRoot(), guard.session.userId)
  const name = relative.split('/').pop() ?? ''
  const cacheable = FINGERPRINTED.test(name)

  const width = thumbWidthOf(new URL(req.url).searchParams.get('w'))
  if (width !== null && isResizableImage(relative)) {
    const key = thumbKeyOf(relative, width)
    const cached = await readOrNull(store, key)
    if (cached) return byteResponse(cached, 'image/webp', cacheable)

    const original = await readOrNull(store, relative)
    if (!original) return new Response('资产不存在', { status: 404 })
    try {
      const thumb = await renderThumb(original, width)
      // 写盘是尽力而为：缓存写不进去（只读挂载、磁盘满）也不该让这张图出不来
      await store.put({ path: key, bytes: thumb, mime: 'image/webp' }).catch(() => undefined)
      return byteResponse(thumb, 'image/webp', cacheable)
    } catch {
      // ★ 回原图。宁可慢一次，不给界面留一个碎图标
    }
  }

  const bytes = await readOrNull(store, relative)
  if (!bytes) return new Response('资产不存在', { status: 404 })
  return byteResponse(bytes, contentTypeOf(name), cacheable)
}
