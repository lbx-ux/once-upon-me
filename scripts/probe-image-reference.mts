/**
 * probe-image-reference.mts —— 一次性探针：图像接口到底认不认"参考图"字段
 *
 * 为什么需要探：`E:\compete\模型.md` §4 记的图像接口只有顶层 `prompt` 字符串 +
 * `size`，而带 `role: "reference_image"` 的那套结构是**视频接口**的 `content` 数组
 * （§3）。§10 第 10 条还明说"媒体 URL 必须公网 HTTPS"，所以本地文件塞不进去。
 * 于是"wan2.7-image 能不能吃参考图"是**未知**，不是"不能"。
 *
 * ★ 探法：**故意给一个不合法的值**（`"not-a-url"`）。
 *   第一次跑的时候**判据写反了**：以为"400 = 字段被认出来"，结果 7 个候选全部
 *   返回同一个 400 —— `BAD_REQUEST · 请求包含未知字段`。这个错误本身给出了两个事实：
 *
 *   1. **这条接口对未知字段是硬拒的**，不是"多了就忽略"的宽容网关。正因为如此，
 *      "字段名存不存在"才是一次**不花钱**的探针（400 不计费，§5 计费规则）。
 *   2. 7 个候选名**一个都不存在**。连同 §4 记的请求体只有 `{model, prompt, size}`，
 *      可下的结论是：**这条接口上没有参考图入口**，跨页一致性只能靠文本锚点段。
 *      "平台是否另开了图生图接口"是另一件事，**未核实**，不要把上一句读成它。
 *
 *   判读表（改这个脚本前先看它）：
 *     `400 · 请求包含未知字段` → 这个字段名**不存在**
 *     `400 · 尺寸/URL/参数类文案` → 字段存在（本仓至今没见过这一种）
 *     `200` → 字段被忽略、或真的画了，**没结论**，不记作"支持"
 *
 * ★ **后续（2026-10-14，工单 02）**：上面那句"平台是否另开了图生图接口"的
 *   **未核实**已经有答案了——**开了**，是 `/v1/images/edits`，字段
 *   `{model, image:<dataURL>, prompt}`，实测 200 出图。
 *   ★ 但这**不推翻本脚本的任何一行**：它探的是 `/v1/images/generations` 的
 *   **请求体**，那 7 个候选名在**那条路由上**至今不存在。两个结论各管各的路由，
 *   把它们合并成一句"这家支持参考图"就是把"路由级事实"讲成了"模型级事实"——
 *   而我们的适配器是按路由分岔的（`generate` vs `edit`），所以那句合并之后
 *   既没法解释代码，也没法预测下一次调用会怎样。
 *   新的那条路的实测见 `scripts/e2e-image-reference.mts`。
 *
 * 结论要回填到 `qwen-image.ts` 的注释、`.env.example` 与
 * `docs/tech-selection.md` §7 的对应行；本文件留着是为了让那条结论可复现。
 */

import { requestJson } from '../src/lib/engine/providers/http.ts'
import { arg, readEnv } from './env.mts'

const BAD = 'not-a-url'

type Candidate = { field: string; body: (prompt: string, size: string) => unknown; note: string }

const CANDIDATES: Candidate[] = [
  {
    field: 'image',
    body: (p, s) => ({ prompt: p, size: s, image: BAD }),
    note: 'OpenAI 图片编辑的老字段名',
  },
  {
    field: 'image_url',
    body: (p, s) => ({ prompt: p, size: s, image_url: BAD }),
    note: '聊天接口里图片走这个名字',
  },
  {
    field: 'reference_image',
    body: (p, s) => ({ prompt: p, size: s, reference_image: BAD }),
    note: '视频里 role 的拼法',
  },
  {
    field: 'reference_images',
    body: (p, s) => ({ prompt: p, size: s, reference_images: [BAD] }),
    note: '复数数组',
  },
  {
    field: 'images',
    body: (p, s) => ({ prompt: p, size: s, images: [BAD] }),
    note: '数组，OpenAI 的 edits 用过',
  },
  {
    field: 'input_image',
    body: (p, s) => ({ prompt: p, size: s, input_image: BAD }),
    note: '图生图常见拼法',
  },
  {
    field: 'content[]',
    body: (p, s) => ({
      prompt: p,
      size: s,
      content: [{ type: 'image', image_url: BAD, role: 'reference_image' }],
    }),
    note: '照抄视频接口的 content 结构',
  },
]

async function main(): Promise<void> {
  const env = await readEnv()
  const apiKey = env['IMAGE_API_KEY'] ?? ''
  if (!apiKey) throw new Error('IMAGE_API_KEY 未配置')
  const baseUrl = env['IMAGE_BASE_URL'] ?? 'https://tokenrhythm.studio/v1'
  const model = arg('model', env['IMAGE_MODEL'] ?? 'wan2.7-image')
  const size = arg('size', '768x768')
  const prompt = '一张纯色背景的测试图'

  process.stdout.write(
    `探针：${model} @ ${baseUrl}/images/generations，${CANDIDATES.length} 个候选字段\n`,
  )
  process.stdout.write(
    '判读：`请求包含未知字段` = **这个字段名不存在**；尺寸/URL/参数类文案 = 字段存在；200 = 没结论\n\n',
  )

  for (const candidate of CANDIDATES) {
    const body = { model, ...(candidate.body(prompt, size) as Record<string, unknown>) }
    try {
      const response = await requestJson(
        { baseUrl, apiKey, timeoutMs: 120_000 },
        { method: 'POST', path: '/images/generations', body },
      )
      process.stdout.write(
        `  ${candidate.field.padEnd(18)} HTTP 200 —— **没结论**（字段可能被忽略，也可能真画了）\n` +
          `     ${candidate.note}\n` +
          `     响应片段：${JSON.stringify(response).slice(0, 200)}\n`,
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const status = /HTTP (\d{3})/.exec(message)?.[1] ?? '?'
      const unknownField = message.includes('未知字段')
      process.stdout.write(
        `  ${candidate.field.padEnd(18)} HTTP ${status} —— ${
          unknownField ? '**字段不存在**' : '字段可能存在，读原文确认'
        }\n` +
          `     ${candidate.note}\n` +
          `     ${message}\n`,
      )
    }
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`\n探针失败：${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
})
