/**
 * stores.ts —— AssetStore 的两个实现：内存与磁盘
 *
 * 两个实现不是"一个真的一个测试用的"：内存版同时是测试替身与
 * 单元测试里唯一的存储，磁盘版是 node 脚本与 Route Handler 用的。
 * 有了这一对，`pnpm test` 不碰文件系统也不碰网络，51+ 条测试跑在毫秒级。
 *
 * 两个实现共用 `put` 的语义：由 store 计算内容指纹并回填 AssetRef。
 *   让调用方自己算指纹，就会有第三处、第四处各算一遍且算法漂移的一天；
 *   指纹是资产的身份证，只能有一个发证的地方。
 */

import { digest } from '../digest.ts'
import type { AssetRef } from '../domain.ts'
import { EngineError } from '../errors.ts'
import type { AssetStore, PutEntry } from './types.ts'

export function createMemoryStore(): AssetStore & { all(): string[] } {
  const files = new Map<string, Uint8Array>()
  const mimeOf = new Map<string, string>()

  return {
    id: 'memory',
    async put(entry: PutEntry): Promise<AssetRef> {
      files.set(entry.path, entry.bytes)
      mimeOf.set(entry.path, entry.mime)
      return refOf(entry, digest(entry.bytes))
    },
    async putJson(jsonEntry: { path: string; value: unknown }): Promise<AssetRef> {
      const bytes = new TextEncoder().encode(JSON.stringify(jsonEntry.value, null, 2))
      return this.put({ path: jsonEntry.path, bytes, mime: 'application/json' })
    },
    async read(path: string): Promise<Uint8Array | null> {
      return files.get(path) ?? null
    },
    async readJson<T>(path: string): Promise<T | null> {
      const bytes = files.get(path)
      if (!bytes) return null
      return JSON.parse(new TextDecoder().decode(bytes)) as T
    },
    async exists(path: string): Promise<boolean> {
      return files.has(path)
    },
    async list(prefix: string): Promise<string[]> {
      return [...files.keys()].filter((key) => key.startsWith(prefix)).sort()
    },
    async deletePrefix(prefix: string): Promise<number> {
      let removed = 0
      for (const key of [...files.keys()]) {
        if (key.startsWith(prefix)) {
          files.delete(key)
          mimeOf.delete(key)
          removed += 1
        }
      }
      return removed
    },
    /** 测试辅助：不看前缀的全部路径 */ all(): string[] {
      return [...files.keys()].sort()
    },
  }
}

/**
 * 磁盘版。
 *
 * 用 `node:fs/promises` 而不是 `fs`：动态 import 让本文件在 edge 运行时
 *   也不会因为静态依赖而炸（Next 的 Route Handler 默认 node 运行时，
 *   但"引擎能被 node 脚本直接跑"这条约束要求依赖方向是 engine → node，
 *   而不是 engine → 某个具体运行时）。
 *
 * `root` 之下的路径由 store 自己拼接并拒绝越界：
 * 资产路径来自 manifest（可能是别人提交的），`../../` 这种事不能靠信任。
 */
export async function createFsStore(root: string): Promise<AssetStore> {
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const base = path.resolve(root)

  const resolve = (rel: string): string => {
    const target = path.resolve(base, rel)
    const nested = target === base || target.startsWith(base + path.sep)
    if (!nested) {
      throw new EngineError('asset-write-failed', `资产路径越界：${rel} 不在 ${base} 之下`)
    }
    return target
  }

  const store: AssetStore = {
    id: `fs(${base})`,
    async put(entry: PutEntry): Promise<AssetRef> {
      const target = resolve(entry.path)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, entry.bytes)
      return refOf(entry, digest(entry.bytes))
    },
    async putJson(jsonEntry: { path: string; value: unknown }): Promise<AssetRef> {
      const bytes = new TextEncoder().encode(JSON.stringify(jsonEntry.value, null, 2))
      return store.put({ path: jsonEntry.path, bytes, mime: 'application/json' })
    },
    async read(rel: string): Promise<Uint8Array | null> {
      try {
        return new Uint8Array(await fs.readFile(resolve(rel)))
      } catch {
        return null
      }
    },
    async readJson<T>(rel: string): Promise<T | null> {
      const bytes = await this.read(rel)
      if (!bytes) return null
      try {
        return JSON.parse(new TextDecoder().decode(bytes)) as T
      } catch {
        return null
      }
    },
    async exists(rel: string): Promise<boolean> {
      try {
        await fs.access(resolve(rel))
        return true
      } catch {
        return false
      }
    },
    async list(prefix: string): Promise<string[]> {
      // 从根往下走、收集相对路径、再按前缀筛。
      // 不去猜"前缀里哪一段是目录"：跨平台分隔符与前缀命中半个文件名的情况
      // 一掺和进来，省下的那点遍历就变成了查不完的 bug。资产量级是几十到几百个文件。
      const out: string[] = []
      const walk = async (dir: string, rel: string): Promise<void> => {
        let entries: { name: string; isDirectory(): boolean }[]
        try {
          entries = await fs.readdir(dir, { withFileTypes: true })
        } catch {
          return
        }
        for (const item of entries) {
          const childRel = rel ? `${rel}/${item.name}` : item.name
          if (item.isDirectory()) await walk(path.join(dir, item.name), childRel)
          else out.push(childRel)
        }
      }
      await walk(base, '')
      return out.filter((key) => key.startsWith(prefix)).sort()
    },
    async deletePrefix(prefix: string): Promise<number> {
      const target = resolve(prefix)
      let removed = 0

      // 前缀可能落在一个文件上，而不是目录——`profileStore.delete` 就是这样调的
      //   （`children/<childId>.json`）。这一行是 2026-10-15 补的，症状很具体：
      //   walk 里的 `readdir(文件)` 抛 ENOENT 被吞掉 → 回 0，而下面的
      //   `rm(target, {recursive:true})` 照样把那个文件删了。
      //   于是"删了 1 条"报成"删了 0 条"，而内存版对同一个输入回 1（它是键前缀匹配）。
      //   两个实现不一致的代价不是"哪个对"：这张契约的全部意义就是报数
      //   （`AssetStore.deletePrefix` 的注释：删除凭据要列明各删了多少条），
      //   一个会把 1 报成 0 的实现让那张凭据变成假的。发现它靠的是
      //   `scripts/e2e-delete-child.mts`：预演说 5 条、真删说 4 条，差的那一条是档案。
      const info = await fs.stat(target).catch(() => null)
      if (info?.isFile()) {
        await fs.rm(target, { force: true })
        return 1
      }

      const walk = async (dir: string): Promise<void> => {
        let entries: { name: string; isDirectory(): boolean }[]
        try {
          entries = await fs.readdir(dir, { withFileTypes: true })
        } catch {
          return
        }
        for (const item of entries) {
          const child = path.join(dir, item.name)
          if (item.isDirectory()) await walk(child)
          else {
            await fs.rm(child, { force: true })
            removed += 1
          }
        }
      }
      await walk(target)
      try {
        await fs.rm(target, { recursive: true, force: true })
      } catch {
        /* 前缀本来就不存在：删除 0 条是合法结果，不是错误 */
      }
      return removed
    },
  }
  return store
}

/**
 * mime → 扩展名。资产文件名要能被 `<img src>` / `<audio src>` 与浏览器直接认，
 * 靠猜扩展名会炸。
 *
 * `audio/mpeg` → `.mp3` 这一条是补的，而且是被实测抓出来的：
 *   百炼的语音接口回的 content-type 就是 `audio/mpeg`，而它不含 "mp3" 这三个字符，
 *   于是音频资产落成了 `page-1-a1.bin`（2026-10-14，`.out/tts-int.mts` 第一次跑）。
 *   所以顺序很重要：`mpeg` 要先于任何宽泛判断，且不能笼统地写
 *   `includes('mpeg')` —— 那会把 `video/mpeg` 也叫成 mp3。
 */
export function extensionOf(mime: string): string {
  // 先剥掉参数：真实的 content-type 长这样 `audio/mpeg; charset=binary`，
  //   拿整串去比相等会漏（这一条是 stores.test.ts 抓出来的）
  const m = mime.toLowerCase().split(';')[0]?.trim() ?? ''
  if (m.includes('png')) return '.png'
  if (m.includes('webp')) return '.webp'
  if (m.includes('jpeg') || m.includes('jpg')) return '.jpg'
  if (m.includes('svg')) return '.svg'
  // 音频：精确匹配，别用 'mp3' 去撞 'mpeg'（撞不上的）
  if (m === 'audio/mpeg' || m === 'audio/mp3' || m.includes('mp3')) return '.mp3'
  if (m === 'audio/wav' || m === 'audio/x-wav' || m === 'audio/wave') return '.wav'
  if (m === 'audio/mp4' || m === 'audio/m4a' || m === 'audio/x-m4a') return '.m4a'
  if (m.includes('mp4')) return '.mp4'
  if (m.includes('json')) return '.json'
  return '.bin'
}

function refOf(entry: PutEntry, contentDigest: string): AssetRef {
  return {
    path: entry.path,
    digest: contentDigest,
    bytes: entry.bytes.byteLength,
    mime: entry.mime,
    originUrl: entry.originUrl,
    originExpiresAt: entry.originExpiresAt,
  }
}
