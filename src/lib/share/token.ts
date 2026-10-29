/**
 * share/token.ts —— 分享链接的那张票：怎么签、怎么验、为什么只存哈希
 *
 * 一条分享链接长这样：`https://<站>/r/v1.<payload>.<sig>`。
 * `payload` 是 base64url 的 JSON（`b` 书号、`u` 主人、`e` 过期秒、`n` 随机数），
 * `sig` 是 `HMAC-SHA256(secret, "v1.<payload>")`。**无状态**：验票不需要查库。
 *
 * 四条判断，每条对应一个会真发生的坏法
 *
 * 1. **密钥从 `APP_JWT_SECRET` 派生，不复用那一把。**
 *    直接拿会话密钥签分享票，等于同一把钥匙开两把锁：哪天有人把分享票塞进
 *    `xzj_session` cookie，`verifyToken` 会先看 `alg` 与三段格式——格式不同，
 *    今天挡得住；但"两种票共用一把钥匙"这件事本身就不该靠格式差异兜。
 *    派生一次（`HMAC(key, "xiaozhujue.share.v1")`）就把两件事分开了，
 *    而且两个方向都不会互相验过。`SHARE_SECRET` 可以单独覆盖（换站或轮换时用）。
 *
 * 2. **只认 `v1` 与 base64url 的字符集。**
 *    `Buffer.from(x, 'base64url')` 对非法字符是**宽容**的（它跳过），
 *    于是"改一个字节"未必让签名对不上——它可能根本没进解码。
 *    所以解码前先过一道 `/^[A-Za-z0-9_-]+$/`，并且限制整票长度。
 *
 * 3. **过期时间进签名。** 改 `e` 会让签名失效，不需要服务端再记一份。
 *    但过期仍然要在**声明与记录**两处都判：声明管"这张票本身过期了"，
 *    记录管"主人收回了"。两件事分开，是因为收回要能立刻生效——
 *    而签名是无状态的，它只说得清"这张票是我签的"，说不清"我现在还认不认"。
 *
 * 4. **哈希是 sha256 全文。** 库（磁盘上那份记录）只存 `sha256(token)`，
 *    不存票原文：一份存了原文的记录，等于把"谁拿着这条链接"写进了磁盘，
 *    而这条链接本身就是一把钥匙。哈希只用来把"验过的票"对到"签发过的那一条"。
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

import { isBookId } from '../engine/index.ts'

export const SHARE_TOKEN_VERSION = 'v1'

/** 整票上限。真实长度约 150 字符；给一个宽裕但明确的上界，别让解码吃一整段正文 */
const MAX_TOKEN_LENGTH = 512
/** base64url 的字符集。见文件头第 2 条：先过这一道，再解码 */
const B64URL = /^[A-Za-z0-9_-]+$/
/** 用户 id 的形状（与 Java 的 `users.id` 一致：正整数）。不合法就当场拒，不落到路径拼接 */
const USER_ID = /^\d{1,20}$/

export type ShareClaims = {
  bookId: string
  userId: string
  /** 过期时间（毫秒）。票里存的是秒，出这一层时换成毫秒，免得每个读者自己乘 1000 */
  expiresAt: number
  nonce: string
}

type Payload = { b: string; u: string; e: number; n: string }

/**
 * 分享票的密钥。
 *
 * 优先 `SHARE_SECRET`（轮换或独立部署时用）；没有就从 `APP_JWT_SECRET` 派生。
 * 两个都没有 → `null`：调用方必须把它当成"这一侧没配好"（500），
 * 不能当成"这个人没权限"（403）——那会让人一直去重新登录。
 */
export function shareSecret(): Buffer | null {
  const own = process.env.SHARE_SECRET?.trim()
  if (own) return Buffer.from(own, 'utf8')

  const base = process.env.APP_JWT_SECRET?.trim()
  if (!base) return null
  // 派生而不是直接用：见文件头第 1 条。`share.v1` 进密钥，换版本就换一把钥匙
  return createHmac('sha256', base).update('xiaozhujue.share.v1').digest()
}

function signWith(secret: Buffer, signed: string): Buffer {
  return createHmac('sha256', secret).update(signed).digest()
}

/** 一张票的哈希（存盘用）。★ 只存它，不存票原文 */
export function hashShareToken(token: string): string {
  return createHmac('sha256', 'xiaozhujue.share.hash').update(token).digest('hex')
}

export type SignedShare = { token: string; hash: string; expiresAt: number; nonce: string }

/**
 * 签一张票。
 *
 * 参数不合法就抛——这里的三个入参都来自服务端自己（登录态里的 userId、
 * 路由里的 bookId、我们算出来的过期时间），不是用户输入；能到这里就说明
 * 前面漏了一道闸，抛出来比签一张坏票好。
 */
export function signShareToken(input: {
  userId: string
  bookId: string
  /** 毫秒时间戳。必须比现在晚，但不在这里限制"最多多少天"——那是路由的职责 */
  expiresAt: number
}): SignedShare {
  const secret = shareSecret()
  if (!secret) throw new Error('服务端没配 APP_JWT_SECRET / SHARE_SECRET，签不了分享票')
  if (!USER_ID.test(input.userId)) throw new Error(`用户 id 不合法：${input.userId}`)
  if (!isBookId(input.bookId)) throw new Error(`书号不合法：${input.bookId}`)
  if (!Number.isFinite(input.expiresAt) || input.expiresAt <= Date.now()) {
    throw new Error('分享票的过期时间必须晚于现在')
  }

  const nonce = randomBytes(9).toString('base64url')
  const payload: Payload = {
    b: input.bookId,
    u: input.userId,
    e: Math.floor(input.expiresAt / 1000),
    n: nonce,
  }
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const signed = `${SHARE_TOKEN_VERSION}.${body}`
  const sig = signWith(secret, signed).toString('base64url')
  const token = `${signed}.${sig}`

  return {
    token,
    hash: hashShareToken(token),
    expiresAt: payload.e * 1000,
    nonce,
  }
}

/**
 * 验一张票。验不过一律 `null`，不抛——调用方只需要一个二值答案，
 * 而"这张票为什么不行"不能回给拿票的人（过期与伪造要看起来一样）。
 *
 * ★ 验签通过之后**还要查记录**（`share/store.ts` 的 `readShare`）：
 *   这一层只说"是我签的、没过期"，说不清"主人收回了没有"。
 */
export function verifyShareToken(token: string): ShareClaims | null {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH)
    return null

  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [version, body, signature] = parts as [string, string, string]
  if (version !== SHARE_TOKEN_VERSION) return null
  // ★ 见文件头第 2 条：宽容解码会把"改了一个字节"变成"照样通过"
  if (!B64URL.test(body) || !B64URL.test(signature)) return null

  const secret = shareSecret()
  if (!secret) return null

  const expected = signWith(secret, `${version}.${body}`)
  let actual: Buffer
  try {
    actual = Buffer.from(signature, 'base64url')
  } catch {
    return null
  }
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null

  let payload: Payload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Payload
  } catch {
    return null
  }
  if (
    !payload ||
    typeof payload.b !== 'string' ||
    typeof payload.u !== 'string' ||
    typeof payload.e !== 'number' ||
    typeof payload.n !== 'string'
  ) {
    return null
  }
  if (!isBookId(payload.b) || !USER_ID.test(payload.u)) return null
  if (!Number.isFinite(payload.e) || payload.e * 1000 <= Date.now()) return null

  return { bookId: payload.b, userId: payload.u, expiresAt: payload.e * 1000, nonce: payload.n }
}
