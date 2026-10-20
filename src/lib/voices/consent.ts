/**
 * voices/consent.ts —— 「这一次授权」那个凭据号
 *
 * 这个文件原来叫 `store.ts`，因为里面还有一份存进 localStorage 的记录
 *   （`loadMyVoices` / `addMyVoice` / `removeMyVoice`）。2026-10-17（工单 16）
 *   那一份搬到了账号上（Java 的 `voices` 表 + `GET /api/voices`），
 *   所以名字必须跟着改：留着 `store.ts` 的话，下一次有人为了找"音色存在哪儿"
 *   点进来，会在一份关于"授权凭据"的文件里翻，而它一个存储都没有。
 *   （同一条理由让 `SettingsProvider` 那次也改了名——见 VoiceProvider 的文件头。）
 *
 * 留下来的这一条为什么还在客户端：它不是一条要持久化的记录，
 *   而是"这一次同意"的一个名字，随克隆请求一起发出去（`/api/voice/clone`）。
 *   服务端少了它就 400——于是"没有那一次单独同意就不建这条音色"这件事
 *   在接口上成立，而不只在文案上。
 *
 * 样本一个字节都不落盘这条没有变，而且更强了：样本除了上传给厂商那一次，
 *   不进磁盘、不进库、不进日志（§8.3 要的是"拿到 voice_id 后立即删"）。
 */

/**
 * 一次授权的凭据号。★ 它只是"这一次授权"的名字，不指代任何个人：
 *   前缀 `local` + 时间戳 + 一小段随机，足以在排障时把一条音色对回一次操作。
 *
 * 它不进 `voices` 表：那张表记的是"这个人手上现在有哪些嗓子"，
 *   而凭据号是"这条嗓子是哪一次同意换来的"——一次性的东西进持久层之后，
 *   下一次有人读它就会以为那是一次仍然有效的授权。
 */
export function newConsentRef(at: number = Date.now()): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `local:${at.toString(36)}-${rand}`
}
