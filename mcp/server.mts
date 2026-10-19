/**
 * server.mts —— 小主角的 MCP server（stdio 传输）
 *
 * ★★ **这是本机操作员的工具，不是公网接口。** 身份来自 `--user=<userId>`，
 *    没有登录、没有鉴权——它按那一行的 userId 去读 `<ASSET_ROOT>/u/<userId>/`
 *    这一片资产。**不要**把它挂到任何能被别人连上的地方。
 *
 * ★★ **它是薄壳，一行业务逻辑都不许有。**
 *    原因是闸门：`.mts` **不进 `pnpm typecheck`**（`tsconfig.json` 的 include
 *    只写到 `.ts`，实测 `.mts` 不在其中——`scripts/` 一直如此）。
 *    所以协议在 `src/lib/mcp/protocol.ts`、工具在 `src/lib/mcp/tools.ts`，
 *    那两个文件既过 typecheck 又跑 vitest。这里只做三件事：
 *    读命令行、拼上下文、把 stdin 的行喂给 `dispatch` 再把结果写回 stdout。
 *
 * ★ `stdout 只许走协议消息`。诊断一律 `process.stderr`——往 stdout 多写一个字，
 *   客户端那一侧的 JSON-RPC 就断在半句话上，而症状是"服务器没反应"。
 *
 * 三种模式（与 `scripts/engine-run.mts` 同名同义）：
 *
 * | 模式 | 供应商 | 花不花钱 | 干什么用 |
 * | --- | --- | --- | --- |
 * | `stub` | 仓库里的固定替身（`src/lib/stub-fixture.ts`） | 不花 | 零成本把整条路走一遍；判据 2 的对照臂 |
 * | `offline` | 录好的 manifest（`--manifest=`） | 不花 | ADR-0003 的演示路径：断网也能出一本 |
 * | `live` | `.env.local` / 管理页配的模型 | **花** | 真用 |
 *
 * ```bash
 * node mcp/server.mts --user=1 --mode=stub
 * node mcp/server.mts --user=1 --mode=live --asset-root=.out/web
 * ```
 *
 * 注册到客户端见 `mcp/README.md`。
 */

import { resolve } from 'node:path'

import { arg, readEnv } from '../scripts/env.mts'
import { createUserStore, userSliceRoot } from '../src/lib/asset-scope.ts'
import { assetRoot } from '../src/lib/books-runtime.ts'
import { listChildItems } from '../src/lib/children-list.ts'
import { createProviders, loadManifest } from '../src/lib/engine/index.ts'
import { createReplayImage, createReplayText } from '../src/lib/engine/providers/replay.ts'
import type { ProviderBundle } from '../src/lib/engine/providers/types.ts'
import { createFsEventLog } from '../src/lib/event-log.ts'
import { dispatch, INITIAL_SESSION, type Session } from '../src/lib/mcp/protocol.ts'
import { createToolRuntime } from '../src/lib/mcp/tools.ts'
import { serverEnv } from '../src/lib/settings/server-env.ts'
import {
  ensureStubCard,
  ensureStubChild,
  loadStubPlanJson,
  stubProviders,
} from '../src/lib/stub-fixture.ts'

/** 诊断。★ 只走 stderr，理由见文件头 */
function note(message: string): void {
  process.stderr.write(`[xiaozhujue-mcp] ${message}\n`)
}

function die(message: string): never {
  note(message)
  process.exit(2)
}

async function main(): Promise<void> {
  // ★ `.env.local` 要自己读进来：`serverEnv()` 只认 `process.env` 与管理页那份
  //   `models.runtime.json`（ADR-0009），而裸 node 进程不会自动加载 `.env.local`。
  //   复用 `scripts/env.mts` 那一份读法，不另写一个（两份读法迟早会漂）。
  Object.assign(process.env, await readEnv())

  const mode = arg('mode', 'live')
  if (mode !== 'live' && mode !== 'offline' && mode !== 'stub') {
    die(`--mode 只接受 live / offline / stub，收到「${mode}」`)
  }
  const userId = arg('user').trim()
  if (userId === '') {
    die(
      '缺 --user=<userId>。这是本机操作员的工具：它按那一行的 userId 去读' +
        ' `<ASSET_ROOT>/u/<userId>/` 那一片资产，没有登录可以替你回答"你是谁"。',
    )
  }

  const root = resolve(arg('asset-root') || assetRoot())
  const sliceRoot = userSliceRoot(root, userId)
  const store = await createUserStore(root, userId)
  const log = await createFsEventLog(sliceRoot)

  let providers: () => Promise<ProviderBundle>
  if (mode === 'stub') {
    // ★ 替身那一档要把孩子与卡**先摆好**：看不见孩子的演示等于没走这条路
    const now = Date.now()
    await ensureStubChild(store, { now })
    const card = await ensureStubCard(store, { now })
    const planJson = await loadStubPlanJson()
    const stub = stubProviders(planJson)
    providers = async () => ({
      mode: 'offline',
      text: stub.text,
      image: stub.image,
      vision: null,
      voice: null,
      store,
    })
    note(`stub：孩子 ${card.childId}，卡 ${card.cardId}（参考图锁的是演示绘本封面）`)
  } else if (mode === 'offline') {
    const manifestPath = arg('manifest')
    if (manifestPath === '') die('--mode=offline 需要 --manifest=PATH（live 那一轮录下来的那份）')
    // ★ 请求指纹是照 `--form` / `--pages` 算的，所以回放要照抄录制时的参数
    //   （`engine-run.mts` 文件头那条纪律）。trace 不对会当场 miss 并报错，那是对的。
    const manifest = await loadManifest(store, resolve(manifestPath))
    providers = async () => ({
      mode: 'offline',
      text: createReplayText(store, manifest),
      image: createReplayImage(store, manifest),
      vision: null,
      voice: null,
      store,
    })
    note(`offline：manifest=${resolve(manifestPath)}`)
  } else {
    providers = async () =>
      createProviders({ env: serverEnv(), mode: 'live', assetRoot: root, store })
  }

  const runtime = createToolRuntime({
    // ★ 与 `/api/children` 是**同一处实现**（`children-list.ts`）。
    //   这一层拿的是"这一片的根"，与路由那边传 `userSliceRoot(...)` 是同一个值。
    children: () => listChildItems(sliceRoot, (path) => path),
    userId,
    store,
    log,
    mode,
    providers,
  })

  note(`起来了一档：user=${userId} · mode=${mode} · 资产根=${sliceRoot}`)

  let session: Session = INITIAL_SESSION
  /**
   * 串成一条链再派发。`dispatch` 是 async（`tools/call` 会 await 工具），
   * 不串的话两条消息会**交错**：后到的那条的响应可能先写出去，
   * 而客户端是按 `id` 配对的——错配之后整条会话开始漂，现场离成因很远。
   */
  let queue: Promise<void> = Promise.resolve()

  const handle = (line: string): void => {
    queue = queue
      .then(() => dispatch(line, session, runtime, (out) => process.stdout.write(`${out}\n`)))
      .then((outcome) => {
        session = outcome.session
        for (const message of outcome.notes) note(message)
      })
      .catch((err: unknown) => {
        // ★ dispatch 自己已经把"能变成协议错误"的都变成了协议错误；
        //   走到这里的是我们这边的 bug。**不能让它把进程带走**——
        //   一次未捕获的 rejection 会让整条会话静默死掉（客户端只看到"没反应"）。
        note(
          `派发这一行时抛出（这是我们的 bug）：${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
        )
      })
  }

  let buffer = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk
    // ★ 一行一条消息，但**不许假定一次 `data` 就是一条**：分包是常态
    for (let index = buffer.indexOf('\n'); index >= 0; index = buffer.indexOf('\n')) {
      const line = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      handle(line)
    }
  })
  process.stdin.on('end', () => {
    if (buffer.trim() !== '') handle(buffer)
    // 把队列里剩下的派发完再退，否则最后一条响应会丢
    void queue.then(() => process.exit(0))
  })
  process.stdin.resume()
}

main().catch((err: unknown) => {
  note(`启动失败：${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 1
})
