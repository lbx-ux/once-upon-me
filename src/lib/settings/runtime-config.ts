/**
 * settings/runtime-config.ts —— 管理页能改的那份模型配置，**落在磁盘上**（2026-10-17）
 *
 * ★ 它解决的问题：原来换一个模型要 SSH 上去改 `.env.local` 再重启 Next。
 *   用户要的是「在管理端就能换模型 / 换接口地址 / 换 api-key」——
 *   那要求这份配置是**运行期可写的**，而 `.env.local` 不是
 *   （Next 只在启动时读它一次，进程里改不了）。
 *
 * ★ 为什么是文件而不是库（DB）：密钥只有 Next 这一侧用得到
 *   （ADR-0009：Java 根本不知道有没有配 TTS）。放进库就得让 Java 持有它、
 *   每请求再回传一次，等于把密钥扩散到第二个进程、还给每次生成加一跳。
 *   文件放在 Next 自己身边，谁用谁读。
 *
 * ★ **它里面是 API key，所以与 `.env.local` 同一个待遇**：
 *   只在本机/服务器上、被 gitignore（见 `.gitignore` 里那一行）、权限 0600。
 *   写入是"临时文件 + rename"（原子）：直接覆盖的话，写到一半断电会留下
 *   一个半个 JSON，而那个文件是**全站生成的配置来源**——半个文件等于全站坏掉。
 *
 * ★ 读**永不抛错**：文件没有、是空的、是坏 JSON——一律当"没有覆盖"，
 *   退回 `process.env`。理由：这是生成链路的必经之路，为一份手改坏的文件
 *   让全站 500 是把一个小事故升级成大事故。坏文件用 `console.error` 喊出来，
 *   但**按 mtime 去重**：它每个请求都会被读一次，不去重就是刷屏，
 *   而刷屏的日志与没有日志一样没用。
 */

import fs from 'node:fs'
import path from 'node:path'

/**
 * 覆盖文件的位置。
 *
 * ★ 默认写在**项目根**（`process.cwd()`，Next 就是从这里起的），
 *   而生产上应该把它挪出仓库：`MODEL_CONFIG_FILE=/etc/xiaozhujue/models.json`。
 *   给这个出口是必须的——服务器上 Next 那个目录是部署产物，
 *   某次重新部署把它擦掉，配置就跟着没了（而密钥不在仓库里，找不回来）。
 */
export function modelConfigFile(): string {
  const raw = process.env.MODEL_CONFIG_FILE?.trim()
  return raw && raw !== '' ? raw : path.join(process.cwd(), 'models.runtime.json')
}

/** 上一次喊过的坏文件（`mtimeMs`）。★ 见文件头那条"按 mtime 去重" */
let complainedAbout: number | null = null

/**
 * 读那份覆盖。**同步**的，而且必须同步：
 * `serverEnv()` 是同步函数，被十几个 route handler 直接调用
 * （`createProviders({ env: serverEnv() })` 这种写法到处都是）——
 * 为了这里改成 async，那十几处全要跟着改，而它们与这件事毫无关系。
 * 读一个几 KB 的文件在一次生成（几秒到几百秒）面前是噪声。
 */
export function readOverrides(): Record<string, string> {
  const file = modelConfigFile()
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (err) {
    // ★ 没有这个文件是**正常状态**（从没在管理页改过东西），不是错误
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return {}
    console.error(`[model-config] 读不了 ${file}：`, err)
    return {}
  }

  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('顶层不是一个对象')
    }
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      // ★ 只要字符串。数或 null 混进来一律丢掉——它们会让下游的 `.trim()` 当场抛
      if (typeof value === 'string') out[key] = value
    }
    return out
  } catch (err) {
    // ★ 坏了就说出来（不然症状是"管理页上明明改了却不生效"，而没人会想到
    //   是文件坏了），但同一个文件只喊一次
    let stamp: number | null = null
    try {
      stamp = fs.statSync(file).mtimeMs
    } catch {
      /* 拿不到 mtime 就用 null 当键，也就是每次都喊 */
    }
    if (complainedAbout !== stamp) {
      complainedAbout = stamp
      console.error(`[model-config] ${file} 不是合法的 JSON，本次忽略它（退回环境变量）：`, err)
    }
    return {}
  }
}

/**
 * 整份写掉（先写临时文件再 rename）。
 *
 * ★ 收进来的东西**已经被上层筛过**（只允许那十几个已知的键、值都 trim 过），
 *   这里只负责写。★ 空对象写出来是 `{}` 而不是删文件：文件在不在、
 *   内容是什么，比"文件不存在"更好排查，而且 `{}` 与"没有覆盖"语义相同。
 */
export async function writeOverrides(next: Record<string, string>): Promise<void> {
  const file = modelConfigFile()
  await fs.promises.mkdir(path.dirname(file), { recursive: true })

  // ★ 临时文件名带上 pid：两个请求同时写时，各写各的临时文件，
  //   最后 rename 的那一个胜出（不会互相写坏）
  const tmp = `${file}.${process.pid}.tmp`
  // ★ mode 0600：里面是明文 key。Windows 上这个位没有意义，POSIX 上有
  await fs.promises.writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  await fs.promises.rename(tmp, file)
}
