/**
 * share/access.ts —— 一张分享票能干什么：换出主人那一片、并且只认这一本书
 *
 * 这一层是"验票"与"用票"之间的那道缝。三件事，顺序不能换：
 *
 *   1. 验签 + 验过期（`token.ts`，无状态）；
 *   2. 查出主人那一片、读签发记录（`store.ts`，有状态——收回要立刻生效）；
 *   3. 判路径：这张票只对 `books/<bookId>/` 之下的字节有效。
 *
 * 第 3 条是这一层唯一自己写的新判据，也是它存在的理由：`/api/assets` 原来
 * 只认"登录的人、他自己那一片"，加了分享之后会有第二条入口——同一条路由上
 * 多一个 `?share=`。**第二条入口必须比第一条窄**，否则"分享一本书"会变成
 * "把这一片资产公开出去"：书号是内容指纹，猜得出来，而这一片里还有别的书、
 * 角色卡与孩子的档案。所以这里卡的是前缀，不是"这本书存不存在"。
 *
 * 路径那一侧不用自己拆 `..`：`scopedStore` 的 `assertInsideScope` 已经挡了，
 * 而且它挡在**读**上（`/api/assets` 的路径是攻击者写的）。这一层只判前缀，
 * 两层各管一件事，不互相替代。
 */

import { createUserStore } from '../asset-scope.ts'
import type { AssetStore } from '../engine/providers/types.ts'
import { hashShareToken, verifyShareToken } from './token.ts'
import { isShareActive, readShare } from './store.ts'

export type ShareAccess = {
  userId: string
  bookId: string
  /** 记录上的过期时间（毫秒）。与票里的 `exp` 是同一个数，但以记录为准 */
  expiresAt: number
  /** 主人那一片。调用方拿它去 `resolveBook` / 读资产，不要再自己拼根路径 */
  store: AssetStore
  /** 票的哈希。收回 / 排障时用得到，不给客户端 */
  hash: string
}

/**
 * 一张票 → 它能读的那一样东西。任何一步不过都回 `null`——
 * 调用方一律回 404（不是 403），理由与阅读器那条一样：
 * "这张票存在、只是过期了"不该成为一件能被问出来的事。
 */
export async function resolveShareAccess(token: string, root: string): Promise<ShareAccess | null> {
  const claims = verifyShareToken(token)
  if (!claims) return null

  // 票里的 userId 已经过 `/^\d{1,20}$/`（`token.ts`），这里不会再抛
  const store = await createUserStore(root, claims.userId)
  const hash = hashShareToken(token)
  const record = await readShare(store, hash)

  // 没签发过（或早被清掉）、书号对不上、已收回、已过期——四件事同一出口
  if (!record) return null
  if (record.bookId !== claims.bookId) return null
  if (!isShareActive(record)) return null

  return {
    userId: claims.userId,
    bookId: claims.bookId,
    expiresAt: record.expiresAt,
    store,
    hash,
  }
}

/**
 * 这张票能读的那几种字节：**只有图与朗读**。
 *
 * ★ 为什么不是"`books/<id>/` 之下全部"（第一版就是这么写的，2026-10-29 复查时改掉）：
 *   那个目录里还有 `book.json`（每页的 `imagePrompt`、卡号、统计）与 `events.jsonl`
 *   （整轮生成的内部事件）。孩子读一本书不需要这两样，而拿到链接的人只要拼一下路径
 *   就能读到——**分享一本书不该等于公开它的制作底稿**。实测：改之前
 *   `/api/assets/books/<id>/book.json?share=<票>` 回 200。
 *
 * 白名单按扩展名，不按文件名：阅读器要的页图 / 封面 / 朗读是固定那几种后缀，
 *   而白名单漏掉的代价是"少一张图"（看得见），黑名单漏掉的代价是"多一份底稿"（看不见）。
 */
const SHAREABLE_ASSET = /\.(?:png|jpe?g|webp|mp3|m4a|wav)$/i

export function shareAllowsAsset(bookId: string, relative: string): boolean {
  // `..` 那一段 store 也会拒（`assertInsideScope`），但这一条是"第二条入口"自己的
  //   边界：它比那一条窄，就不该把一个明显要越界的路径交给下一层去判。
  //   两种分隔符都看——`%5c` 会被 Next 解码成 `\`（`asset-scope.ts` 那条注释同一条）。
  if (relative.split(/[\\/]/).includes('..')) return false
  if (!relative.startsWith(`books/${bookId}/`)) return false
  return SHAREABLE_ASSET.test(relative)
}

/* 站点的 origin：生成分享链接与 og 图都要一个绝对地址 */

function firstHeader(value: string | null | undefined): string | null {
  const first = (value ?? '').split(',')[0]?.trim()
  return first && first !== '' ? first : null
}

/** host 只收域名 / IPv4 / [IPv6] / 端口；别的一律不认（它会被拼进一个给用户看的链接） */
const HOST = /^[A-Za-z0-9.\-:[\]]{1,255}$/

/**
 * 这次的 origin。
 *
 * 先看 `SITE_ORIGIN`：线上写死成 `https://lbx99.xyz`，链接与服务实际从哪进来无关，
 *   也不信任何请求头。没配时才从 `x-forwarded-*` / `Host` 推——
 *   本机开发就是这一条（`http://localhost:3000`）。
 *
 * ★ 为什么不无条件信 `Host`：它是请求方写的。生成一条指向攻击者域名的分享链接
 *   并不泄露什么，但"发给家人的链接打开是别人的站"是一件用户会当真的事。
 *   生产 Nginx 会把 `Host` 固定成域名，所以推断那条路在线上也是对的；
 *   `SITE_ORIGIN` 只是把这件事从"依赖代理配置"变成"依赖我们自己的配置"。
 */
export function originFromHeaders(headers: Headers): string {
  const configured = process.env.SITE_ORIGIN?.trim()
  if (configured) {
    // 只取 origin（scheme + host + port）：配置里顺手带了路径或斜杠时，
    //   `https://x/y` + `/r/<票>` 会拼出一条打不开的链接。配错就回空串，
    //   让调用方退回相对路径（界面那边用 `window.location.origin` 补）
    try {
      return new URL(configured).origin
    } catch {
      return ''
    }
  }

  const proto = firstHeader(headers.get('x-forwarded-proto')) === 'https' ? 'https' : 'http'
  const host = firstHeader(headers.get('x-forwarded-host')) ?? firstHeader(headers.get('host'))
  if (!host || !HOST.test(host)) return ''
  return `${proto}://${host}`
}

/** 一张票 → 给家长看的那条完整链接 */
export function shareUrlOf(origin: string, token: string): string {
  return `${origin}/r/${token}`
}
