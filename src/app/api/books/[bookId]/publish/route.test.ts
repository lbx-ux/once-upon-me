/**
 * /api/books/[bookId]/publish 的那道安全闸（2026-10-22）
 *
 * 起因是用户那句「既然已经出现了预警中的词汇，为什么还有生成出来」。
 * 画面审核判了 `flag` 的页当时只在**客户端**挡住：运行视图那颗「确定生成」按灰了，
 * 而书架那颗「制作为绘本」打的是同一个接口，什么都不查——于是那条路能把一本
 * 画面有问题的书直接发出去。
 *
 * 这一组钉三件事：
 *
 * | 钉什么 | 怎么证伪 |
 * | --- | --- |
 * | 标了页的草稿 → 409，话里带页码 | 把闸摘了，这一条立刻绿错 |
 * | 干净的书照常发布 | 闸写宽了（比如用 `needsHumanReview`）会把常态的"没核对"也拦住 |
 * | 已发布的仍幂等、不被新闸拦住 | 顺序写反（闸放在 `published` 之前）就会红 |
 *
 * 脚手架与 `route-leases.test.ts` 同源：真签名票 + 只回 `/api/auth/me` 的假后端 +
 * 临时资产根。这一条路由不碰模型，所以不需要假厂商。
 */

import { createHmac } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { POST as publish } from './route.ts'
import { createUserStore } from '@/lib/asset-scope.ts'
import { manifestPathOf, type Book } from '@/lib/engine/index.ts'

const USER_ID = '1'
const BOOK_ID = 'bk_publish_flagged'
const JWT_SECRET = 'publish-route-secret-not-a-real-one-0123456789abcdef'

function mintSession(userId: string): string {
  const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  const header = b64({ alg: 'HS256', typ: 'JWT' })
  const payload = b64({
    sub: userId,
    acc: `u${userId}`,
    role: 'USER',
    scope: 'session',
    exp: Math.floor(Date.now() / 1000) + 3600,
  })
  const signature = createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url')
  return `${header}.${payload}.${signature}`
}

async function startFakeBackend(): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/api/auth/me')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          userId: USER_ID,
          account: `u${USER_ID}`,
          phone: null,
          nickname: '发布闸测试',
          role: 'USER',
          createdAt: '2026-10-22T00:00:00Z',
          allowed: true,
        }),
      )
      return
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ code: 'not-found', message: `假后端没有这条路：${req.url}` }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return { server, url: `http://127.0.0.1:${port}` }
}

let root = ''
let backend: { server: Server; url: string }
const savedEnv: Record<string, string | undefined> = {}
const TOUCHED = ['APP_JWT_SECRET', 'BACKEND_URL', 'ASSET_ROOT', 'MODEL_CONFIG_FILE']

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'publish-gate-'))
  backend = await startFakeBackend()
  for (const key of TOUCHED) savedEnv[key] = process.env[key]
  process.env['APP_JWT_SECRET'] = JWT_SECRET
  process.env['BACKEND_URL'] = backend.url
  process.env['ASSET_ROOT'] = root
  process.env['MODEL_CONFIG_FILE'] = join(root, 'no-such-model-config.json')
})

afterEach(async () => {
  await new Promise<void>((resolve) => backend.server.close(() => resolve()))
  await rm(root, { recursive: true, force: true })
  for (const key of TOUCHED) {
    const previous = savedEnv[key]
    if (previous === undefined) delete process.env[key]
    else process.env[key] = previous
  }
})

/** 一页图。只有发布闸读的那两位是真的，其余照 `Illustration` 的形状给最小可用的 */
function illustration(pageNo: number, verdict?: 'pass' | 'flag' | 'unavailable'): unknown {
  return {
    pageNo,
    attempt: 1,
    asset: { path: `pages/${pageNo}.webp`, digest: 'd', bytes: 1, mime: 'image/webp' },
    provenance: { modelId: 'm', promptVersion: 'image-page@v14', cardRevision: 1, generatedAt: 0 },
    ...(verdict === undefined ? {} : { pictureReview: { verdict, problems: [] } }),
    needsHumanReview: verdict !== 'pass',
  }
}

async function seedBook(status: 'draft' | 'published', illustrations: unknown[]): Promise<void> {
  const store = await createUserStore(root, USER_ID)
  await store.putJson({
    path: manifestPathOf(BOOK_ID),
    value: { bookId: BOOK_ID, status, illustrations } as unknown as Book,
  })
}

async function post(): Promise<Response> {
  const request = new NextRequest(`http://localhost:3311/api/books/${BOOK_ID}/publish`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `xzj_session=${mintSession(USER_ID)}`,
    },
    body: JSON.stringify({}),
  })
  return publish(request, { params: Promise.resolve({ bookId: BOOK_ID }) })
}

describe('画面审核标了页的草稿：服务端挡住发布', () => {
  it('★ 409，话里带页码（客户端那颗按钮不是判据）', async () => {
    await seedBook('draft', [
      illustration(1, 'pass'),
      illustration(2, 'flag'),
      illustration(4, 'flag'),
    ])
    const res = await post()
    expect(res.status).toBe(409)
    const body = (await res.json()) as { code?: string; message?: string }
    expect(body.code).toBe('pages-flagged')
    expect(body.message).toContain('第 2、4 页')
  })

  it('★ 干净的书照常发布（"没核对成"不是 flag，不许把它也拦住）', async () => {
    await seedBook('draft', [illustration(1, 'pass'), illustration(2, 'unavailable')])
    const res = await post()
    expect(res.status).toBe(200)
    expect((await res.json()) as unknown).toMatchObject({ status: 'published' })
  })

  it('★ 已经发过的仍然幂等：新闸不把一本早就出去的书变成红字', async () => {
    await seedBook('published', [illustration(1, 'flag')])
    const res = await post()
    expect(res.status).toBe(200)
    expect((await res.json()) as unknown).toMatchObject({ status: 'published' })
  })
})
