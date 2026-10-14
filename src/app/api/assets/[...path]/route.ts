/**
 * GET /api/assets/<path...> —— 把资产根下的字节喂给浏览器（图与清单都走这里）
 *
 * 为什么需要它：生成的图落在资产根（`ASSET_ROOT`，缺省 `.out/web`），**不在 `public/`**。
 * 想让 `<img src>` 拿到，只有两条路：把它们拷进 `public/`（那就等于把运行期产物
 * 混进静态资源，且每次生成都要拷贝），或者开一个只读的出口——这条。
 *
 * 三条约定：
 *
 * 1. **路径越界由 store 拒**，这里不自己写字符串检查。「`../` 这种事不能靠信任」
 *    （`stores.ts` 的原话）已经在那层实现过一次，第二遍实现就是第二遍会漏的地方。
 * 2. **缓存头按内容指纹来**。我们的资产文件名里就带指纹（`ref.<指纹>.png`），
 *    所以可以放心让浏览器长期缓存；不带指纹的（`book.json`、`events.jsonl`）
 *    一律 `no-store`——那些会在同一路径上被改写。
 * 3. **只读，且只认这几个前缀**。`cards/`、`books/`、`assets/` 是引擎与卡存储写的三处；
 *    别的一律 404，免得这个出口变成"整个磁盘的读接口"。
 */

import { createFsStore } from '@/lib/engine/index.ts'
import { assetRoot } from '@/lib/books-runtime.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_PREFIXES = ['cards/', 'books/', 'assets/'] as const

/** 名字里带内容指纹的可以长缓存；别的（会被改写的清单与日志）一律不缓存 */
const FINGERPRINTED = /\.(?:[0-9a-f]{12})\.[a-z0-9]+$/i

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await ctx.params
  const relative = path.map((segment) => decodeURIComponent(segment)).join('/')

  if (!ALLOWED_PREFIXES.some((prefix) => relative.startsWith(prefix))) {
    return new Response('不认识的资产前缀', { status: 404 })
  }

  const store = await createFsStore(assetRoot())
  let bytes: Uint8Array | null
  try {
    bytes = await store.read(relative)
  } catch {
    // store 的越界拒绝也走这里：越界与不存在对外是同一件事
    return new Response('资产路径不合法', { status: 400 })
  }
  if (!bytes) return new Response('资产不存在', { status: 404 })

  const name = relative.split('/').pop() ?? ''
  const ext = name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : ''
  const contentType =
    ext === 'png'
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
        'Cache-Control': FINGERPRINTED.test(name)
          ? 'public, max-age=31536000, immutable'
          : 'no-store',
      },
    },
  )
}
