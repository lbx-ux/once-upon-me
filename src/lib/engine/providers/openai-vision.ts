/**
 * openai-vision.ts —— 用多模态对话模型做「本页主角 vs 角色卡」的一致性比对
 *
 * 这是**一致性 Agent 的手**：它不决定重不重画，它只回答"这几条锚点对不对得上"。
 * 判定阈值与重画次数在 illustrate.ts，因为那是产品决策，不是模型能力。
 *
 * ★ 为什么判据是逐条清单而不是一句"像不像"：
 *   GLOSSARY「一致性分」写的是"它是判据不是事实，阈值靠人工判读校准"。
 *   要校准就得知道**它凭什么给这个分**。清单式提问让模型必须逐条回答，
 *   于是"0.71"旁边永远跟着"骨相：圆脸没画出来"——家长看得懂，我们也调得准阈值。
 */

import { EngineError } from '../errors.ts'
import type {
  CallBudget,
  CompareRequest,
  CompareResponse,
  PortraitAnalysisRequest,
  PortraitAnalysisResponse,
  PortraitAnalyzer,
  VisionComparator,
} from './types.ts'
import { requestJson, traceOf, type HttpDeps } from './http.ts'
import { extractJson } from '../../schemas/schema.ts'
import { ANCHOR_LABELS, ANCHOR_SLOTS, LOOK_TAGS, READ_SLOTS, type AnchorSlot } from '../domain.ts'

const SYSTEM = [
  '你是儿童绘本的角色一致性审核员。',
  '给你两张图：第一张是**标准像**（角色的唯一真相），第二张是**待审页**。',
  '只判断第二张里的主要人物与标准像是否为同一个孩子，不评价画得好不好、构图美不美。',
  '逐条核对给定的锚点清单。任何一条硬锚点不符，就要在 missed 里写出该条的槽位名。',
  '只输出 JSON：{"score":0 到 1 的小数,"missed":["槽位名"],"reason":"一句中文说明"}',
  '拿不准时把分打低，不要为了好看给高分——这个分数决定要不要重画，给高了就没人看得见那张崩脸。',
].join('\n')

/**
 * 读照片那条路的提示词（2026-10-15）。
 *
 * ★ 两条纪律与比对那条一样、理由也一样：
 *   ① **逐条答**（这里是"按槽位逐条描述"），于是每一句都能被家长对着照片核对；
 *   ② **只输出 JSON**，别寒暄。
 * ★ 三条不一样，都是刻意的：
 *   ① 温度仍是 0——这不是创作，是**读数**；
 *   ② 要求**只写看得见的**：看不见就写"看不清"，而不是补一个合理的猜测。
 *      这一条直接决定这张卡能不能用：编出来的锚点会跟着孩子进每一页。
 *   ③ 槽位名用 `ANCHOR_LABELS` 的中文（骨相/眼睛/…）。★ `ANCHOR_LABELS` 的注释写着
 *      "不进 prompt"——那条管的是**送进画图**的提示词；这里是送进**视觉模型的提问**，
 *      而中文槽位名正是给人读的那一套，模型按它回答、我们再映射回槽位。
 */
export const ANALYZE_SYSTEM = [
  '你在帮一个家长把孩子的照片读成"角色锚点"——这是以后每一页插画都要照着画的依据。',
  '只描述**这张照片里看得见的东西**。看不见、被挡住、不清楚的槽位，值就写「看不清」，',
  '绝对不要按常识补一个合理的猜测——编出来的一条会跟着这个孩子进每一页。',
  // ★ 2026-10-16 加的（用户原话：「有时候用户上传的图片并不是完整的照片，可能只有是上半身，
  //   ai能识别出来什么就在锚点里填上，识别不出来的就空出来，提示用户去填」）：
  //   上面那句"看不见就写看不清"讲的是**模糊**，而这里要讲的是**照片里根本没有**。
  //   两者在模型那里是不同的判断：半身照里的头身比不是"看不清"，是"这张照片不含这个信息"。
  //   不明说，模型会按"一个小孩大概什么样"把全身比例补出来——那是最坏的一种错，
  //   因为它看上去是一条正常锚点。
  // ★ 但这一句必须带下面那条**反着说的**才成立。实测（`--photo=.out/probe/halfbody.jpg`）：
  //   只写"照片里没有的就写看不清"，模型会把整张照片**判成废片**——那张胸口以上的裁图里
  //   明明看得见衣服上沿，它连「常服」都回了「看不清」。少读一格不是安全，是这一屏
  //   对用户白跑一次（而他的照片多半就是半身照）。判据只有一条：这一格看不看得见。
  '照片**可能不是全身照**：大头照、半身照、侧脸、背影都有可能。判断只看一件事：',
  '**这一格的答案在这张照片里看得见吗**。看不见的（全身的比例、背后的样子），',
  '值一律写「看不清」，**不要**按一个同龄孩子常见的样子替它补——那一条会跟着他进每一页。',
  '★ 反过来也**不要因为照片不完整就整张都不答**：看得见的那几格照旧要一条条读出来，',
  '一格都别少（只拍到胸口，衣服的上半截还是看得见的）。',
  // ★ 2026-10-16：这里原来举的例子是「圆脸、颊部饱满、下颌线软」——而它**就是**
  //   `DEFAULT_ANCHORS.bone` 那一行（第 3 步的预填示例）。实测两次里有一次模型把它
  //   **原样抄了回来**（`.out/vision-raw-2.log`：回来的骨相是「圆脸、颊部饱满、下颌线圆润」，
  //   头身比是「头身比约1:4、四肢圆润」，两句都是预填值），也就是说提示词自己递了一份答案，
  //   而家长拿到的是一份"读了我的照片"但其实是模板的东西。例子换成**抄不走的格式占位**。
  '每条一句中文短语：**形状 + 两处细节**，十来个字，例如「〈形状〉、〈细节〉、〈细节〉」',
  '——尖括号只是占位，**不许把我这些字抄进去**。',
  '不写情绪、不写场景、不写"很可爱"这类评价。',
  // ★ 2026-10-16：那把"锁"在这一句里。模型**每次自己挑一种形状**回（同一张照片、同一份提示词，
  //   一次是 `anchors` + 中文槽位名，下一次是 `anchor` + 英文槽位键），而只认一种就是
  //   「读到了 0 条」那一类静默的假成功。读回来那一侧已经放宽了（见 `anchorsObjectOf`），
  //   这里再把餐具摆明一次：**减少彩票，但不靠它成立**。
  '锚点表**固定放在顶层 `anchors` 这个键下面**（就是下面的样子，别改名、别套一层）。',
  '只输出 JSON：{"anchors":{"骨相":"…","眼睛":"…","头发":"…","头身比":"…","肤色":"…",',
  '"特征记号":"…","常服":"…"},"lookTags":["从给定的标签里挑，看不出来就空数组"],"note":"一句中文"}',
  // ★ 「补充」（`extra`）**不在**要读的槽位里：它是家长自己写的那一格。
  //   这一句必须写出来——原来 user 那一段用 `ANCHOR_SLOTS` 列出了**八个**槽位（含「补充」），
  //   而这里的 JSON 范例只有**七个**键，两处互相矛盾。实测模型照着七个回（没有输出补充）。
  '「补充」那一格**不用你读**：那是家长自己写的一句话，不要输出它。',
  // ★ note 那一格里要说清"这张照片缺了什么"。它是**给家长的一句解释**：
  //   界面上"另外几格空着"的原因写在那里，而家长看不懂的是"为什么空"。
  'note 里写一句：这张照片是什么（比如"正面半身照"），以及**哪些槽位因此读不出来**。',
].join('\n')

/**
 * 要读的槽位来自 `domain.ts` 的 `READ_SLOTS`（`ANCHOR_SLOTS` 去掉「补充」）。
 * ★ 判据只有一处：`/character/new` 那一屏也用它（"哪几格没读出来"的报数同源），
 *   两边各写一份的坏法就是这一刀踩到的那一个——槽位表里多一格，
 *   读照片那条路就去读一个不该它读的格子，而界面还会把"它没读出来"报给家长。
 *
 * ★ 槽位表（下面那道清单）与 system 最后那句禁令**必须同时存在**：
 *   只列清单不写禁令，模型照清单把「补充」也算一格；只写禁令不给清单，
 *   它就不知道要读哪几格。
 */

/**
 * 适配器的两个可拧的旋钮。★ 形状照着 `OpenAiTextOptions` 抄，理由与它一样：
 *   参数**随模型走**，不写在调用点里——写在那里就等于把一个模型参数钉死成一个产品参数。
 *
 * ★ 2026-10-16 补上来的原因是一条用户报障（截图：`/character/new` 上
 *   「模型这次没按格式把照片读出来……finish_reason=length · 正文 0 字 · 思考链 961 字」）。
 *   同一个坑文本那条路 10-13 已经踩过（`openai-text.ts` 的 `DEFAULT_TEXT_MAX_TOKENS`），
 *   视觉这条路当时漏了：预算被硬编码成 700。
 */
export type OpenAiVisionOptions = {
  /** 读照片的 token 预算。缺省见 `DEFAULT_ANALYZE_MAX_TOKENS` */
  analyzeMaxTokens?: number
  /**
   * **比对**（`compare`）的 token 预算。缺省见 `DEFAULT_COMPARE_MAX_TOKENS`。
   *
   * ★ 2026-10-16 补上这一格，起因是另一条用户报障（"我提供给你的是男孩子，
   *   怎么生成出来有男孩有女孩子"）。表面看是画错了，查下去发现**比对那一跳整个是哑的**：
   *   `compare()` 的 `max_tokens` 被硬编码成 **400**，而比对模型是推理模型，
   *   思考链本身就要几百上千 token——8 页**每一页**的判定都是
   *   `finish_reason=length · 正文 0 字 · 思考链 638 字` → `verdict: 'unavailable'`
   *   → 不重画。于是书里那句"没法核对"看着像"这道工序没接上"，
   *   实际是"这道工序每次都撞线"。
   *   ★ 同一个坑 `analyze` 那条路当天上午刚踩过（700 → 4096，见那一格的注释），
   *     `compare` 漏了——**两处都是"预算"这一个旋钮，改完要一起看**。
   * ★ 更值得记的是：那个模型的**思考链里其实把话说了**。用户书里第 5 页的原文：
   *   "待审页头发明显是齐肩中长发，不是短发，鬓角也长。这条严重不符"——
   *   它看见了，只是没轮到写正文，于是那句话被当成"没法核对"丢掉了。
   */
  compareMaxTokens?: number
  /** 供应商特有的额外字段（关思考之类的参数名各家不一致，在这里补，不改接口） */
  extra?: Record<string, unknown>
}

/**
 * 读照片的 token 预算。**缺省与文本那条路一致（4096）**，因为它是同一类调用：
 * 送出去的是一张图 + 一段提示词，要回来的是一段结构化文本，而模型多半是推理模型。
 *
 * ★ 原来这里是 **700**，它是坏的——但坏法要说准，2026-10-16 的实测把两种坏法分开了：
 *
 *   · **在聚合站这条路上（`kimi-k2.6`），700 并没有截断**。实测 700 → `finish_reason=stop`、
 *     正文 283 字、思考链 5066 字、`completion_tokens 3391`（其中 `reasoning_tokens 3234`）
 *     ——这家**不理 `max_tokens`**。所以我**没有**在本地复现出用户那一次；
 *     下面那条"截断"是**用户自己那台机器的配置**出来的（设置抽屉里的 base/key/模型是本机的）。
 *   · **在会理 `max_tokens` 的端点上，700 就是必然截断**：思考链要几千 token，
 *     700 还没想完就撞线，`finish_reason=length` + 正文 0 字。
 *     用户截图里那一行正是这个样子（思考链 961 字 ≈ 700 token，正文 0 字）
 *     ——预算恰好是 700 时才会出现的形态。
 *
 * 所以 700 → 4096 是**按第二类证据**改的，不是"本地复现了"。实测细节与结论
 * 见 `scripts/probe-vision-budget.mts` 与 `03-character-profile.md` 第 19 刀。
 * ★ 它仍然是**下界不是够用线**：换一家更重的推理模型就调 `VISION_MAX_TOKENS`
 *   （或把 `opts.analyzeMaxTokens` 传进来）。真撞线时 `describeUnreadable`
 *   会把每一次的预算都报出来，所以"加了多少还是不够"当场看得见。
 */
const DEFAULT_ANALYZE_MAX_TOKENS = 4096

/**
 * **比对**的 token 预算。缺省与 `analyze` 同一个数（4096），理由也是同一条：
 * 它送出去的是"两张图 + 一张清单"，要回来的是一段结构化 JSON，
 * 而模型多半是推理模型——**思考链先花掉预算，正文才轮到**。
 *
 * ★ 这里原来是硬编码的 **400**，等于把这条校验变成一个永远返回"没法核对"的空转。
 *   实测（用户那本 8 页的书，每一页都长这样）：
 *   `比对的模型没有按 JSON 回答（试了 1 次；finish_reason=length · 正文 0 字 ·
 *    思考链 638 字）`——8/8 页 `verdict: 'unavailable'`，**一次重画都没触发**。
 * ★ 4096 是**下界不是够用线**：比对的思考链比读数更长（要逐条锚点比对），
 *   换一家更重的推理模型就调 `VISION_COMPARE_MAX_TOKENS` / `VISION_MAX_TOKENS`。
 *   真撞线时 reason 里会把预算报出来（`describeUnreadable` 的 `budgets`），
 *   所以"加了多少还是不够"当场看得见。
 */
const DEFAULT_COMPARE_MAX_TOKENS = 4096

export function createOpenAiVision(
  deps: HttpDeps,
  modelId: string,
  opts: OpenAiVisionOptions = {},
): VisionComparator & PortraitAnalyzer {
  return {
    id: `openai-vision(${modelId})`,
    modelId,
    async compare(req: CompareRequest, budget?: CallBudget): Promise<CompareResponse> {
      if (!deps.apiKey) {
        throw new EngineError(
          'provider-not-configured',
          'VISION_API_KEY / LLM_API_KEY 未配置，视觉比对不可用',
        )
      }
      const user = [
        {
          type: 'text',
          text: `锚点清单：\n${req.checklist.map((line, i) => `${i + 1}. ${line}`).join('\n')}`,
        },
        { type: 'image_url', image_url: { url: req.referenceDataUrl } },
        { type: 'text', text: '上面是标准像。' },
        { type: 'image_url', image_url: { url: req.pageDataUrl } },
        { type: 'text', text: '上面是待审页。按清单逐条核对后只输出 JSON。' },
      ]

      /** 这一次用的预算。★ 报错时要把它带出去——不带的话，"预算不够"这四个字无从验证 */
      const maxTokens = opts.compareMaxTokens ?? DEFAULT_COMPARE_MAX_TOKENS

      const body = await requestJson(deps, {
        method: 'POST',
        path: '/chat/completions',
        body: {
          model: modelId,
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: user },
          ],
          // 判定要稳定，不要发挥。温度 0 是这里唯一的选项。
          temperature: 0,
          // ★ 原来是写死的 400（见 `DEFAULT_COMPARE_MAX_TOKENS` 那段：它让 8/8 页
          //   都判成"没法核对"，一次重画都没触发）
          max_tokens: maxTokens,
        },
        signal: budget?.signal,
        // ★ 缺省 300s，不是 90s。这个调用一次要送**两张 1440×1440 的 data URL**
        //   （约 7 MB base64），90s 实测不够：live 跑书时 kimi-k2.6 做比对，
        //   多页直接回 504 或 fetch failed。而超时的代价是"这一页没核对"，
        //   它会让 r_redraw（§12.2 产出物 4）算不出来——所以宁等勿弃。
        //   同时**要认 deps.timeoutMs**：原来这里把它整个忽略了，
        //   于是 .env 里配多少都没用，配了也是白配。
        timeoutMs: budget?.timeoutMs ?? deps.timeoutMs ?? 300_000,
      })

      const reply = readReply(body)
      const text = reply.text
      const parsed = parseLooseJson(text)
      if (!parsed) {
        return {
          score: null,
          missed: [],
          // ★ 这里**不**替它试第二次（读数可以重试，比对不行：比对一次要送两张 1440² 的图，
          //   而且它的产物是一个"没核对"的标记，重试的收益抵不上那次调用的代价）。
          //   但失败的原因照旧要说清，走的与读数同一条 `describeUnreadable`。
          //   ★ 预算要**传进去**：不传的话那句"预算不够"的排障提示里，恰恰没有那个数
          //     （用户那本书的 8 条 reason 就都没带它，只有"思考链 638 字"）。
          reason: describeUnreadable(reply, 1, '比对', [maxTokens]),
          modelId,
          traceId: traceOf(body) || undefined,
        }
      }
      const score = typeof parsed.score === 'number' ? clamp01(parsed.score) : null
      return {
        score,
        missed: Array.isArray(parsed.missed) ? parsed.missed.map(String) : [],
        reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        modelId,
        traceId: traceOf(body) || undefined,
      }
    },

    /**
     * 读一张照片，按八个槽位说这个孩子长什么样（2026-10-15）。
     *
     * ★ 与 `compare` 共用同一套 HTTP 管道（`requestJson` / `extractContent` /
     *   `parseLooseJson` / trace）：再写一条 fetch 只会多一处超时与多一处错误映射。
     * ★ 拿不到 JSON 时**抛**，不像比对那样回一个 `score: null`：比对的产物是一个分数，
     *   分数缺席还能记成"没核对"；而这里如果不抛，调用方会拿到一份**空锚点表**，
     *   然后把它当成"读到了、只是没内容"填进表单——那是静默的假成功。
     */
    async analyzePortrait(
      req: PortraitAnalysisRequest,
      budget?: CallBudget,
    ): Promise<PortraitAnalysisResponse> {
      if (!deps.apiKey) {
        throw new EngineError(
          'provider-not-configured',
          'VISION_API_KEY / LLM_API_KEY 未配置，读照片不可用',
        )
      }
      const slots = READ_SLOTS.map((slot) => `${ANCHOR_LABELS[slot]}（${slot}）`).join('、')
      // 已填的锚点里，空值与「补充」都不送：空的没有粒度可参考，补充是家长那一格
      const known = (req.anchors ?? []).filter(
        (anchor) => anchor.value.trim() !== '' && anchor.slot !== 'extra',
      )
      const user = [
        { type: 'text', text: `要读的槽位：${slots}` },
        ...(known.length > 0
          ? [
              {
                type: 'text',
                text:
                  '这个孩子**已经填过**的锚点（只用来告诉你"每条该细到什么程度"）：\n' +
                  known.map((anchor) => `${anchor.slot}: ${anchor.value}`).join('\n') +
                  '\n★ 它们多半和你眼前这张照片对不上——可能是别人写的，也可能是系统预填的示例。' +
                  '**一个字都不要沿用**：照片里是什么就写什么。',
              },
            ]
          : []),
        { type: 'text', text: `可选的标签只有这些：${LOOK_TAGS.join('、')}` },
        { type: 'image_url', image_url: { url: req.photoDataUrl } },
        { type: 'text', text: '上面是孩子的照片。按槽位逐条描述后只输出 JSON。' },
      ]

      /**
       * ★ 试两次（2026-10-16）。这件事**只对读数成立**，理由是它与出图那条路的区别：
       *   出图重试可能是一张重复扣费的图，读数重试只是一次很便宜的文本调用。
       * ★ 只重试"拿到了回包但里面没有能用的内容"，**不重试**任何抛出来的错：
       *   `requestJson` 里那条"4xx 一律不重试"是网络层的判据，这里不越过它
       *   （超出配额、余额不足那几种重试一百次也一样）。
       * ★ 这条不是凭感觉加的：`kimi-k2.6` 是**推理模型**，实测一次读照片
       *   要产 2400+ token 的思考链（`reasoning_tokens`），正文只有 250 字左右
       *   （`.out/vision-raw-2.log` / `-3.log`）。想完没写、或上游把正文截掉，
       *   都是这种模型**偶发**的坏法——而界面上那句话原来写的是"再点一次通常就好了"，
       *   等于把这一次重试交给家长手动做。现在引擎自己做掉。
       */
      const ATTEMPTS = 2
      /**
       * 第二次的预算倍数。**只在"上一次被截断"时用得上**（见循环尾那一段）：
       * 预算够却答歪了，加钱只会更歪；而 `finish_reason=length` 就是差钱。
       */
      const RETRY_BUDGET_FACTOR = 4
      const analyzeMaxTokens = opts.analyzeMaxTokens ?? DEFAULT_ANALYZE_MAX_TOKENS
      /** 每一次实际用掉的预算。★ 它要进错误消息——"试了两次"不说清是**多大的两次**，等于没说 */
      const budgets: number[] = []
      let maxTokens = analyzeMaxTokens
      let reply: Reply | null = null
      let parsed: Record<string, unknown> | null = null
      let traceId = ''
      for (let attempt = 1; attempt <= ATTEMPTS && !parsed; attempt += 1) {
        budgets.push(maxTokens)
        const body = await requestJson(deps, {
          method: 'POST',
          path: '/chat/completions',
          body: {
            model: modelId,
            messages: [
              { role: 'system', content: ANALYZE_SYSTEM },
              { role: 'user', content: user },
            ],
            // 读数，不是创作。温度 0 与比对那条同一个理由
            temperature: 0,
            max_tokens: maxTokens,
            ...(opts.extra ?? {}),
          },
          signal: budget?.signal,
          // 只送**一张**图（比对那条送两张），所以缺省比 300s 短一档
          timeoutMs: budget?.timeoutMs ?? deps.timeoutMs ?? 180_000,
        })
        reply = readReply(body)
        parsed = parseLooseJson(reply.text)
        traceId = traceOf(body) || traceId
        // 正文一个字都没写出来 + 被截断 ⇒ 下一次把预算放大再试
        if (!parsed && reply.text.trim() === '') maxTokens *= RETRY_BUDGET_FACTOR
      }

      if (!parsed) {
        throw new EngineError(
          'provider-bad-response',
          describeUnreadable(reply, ATTEMPTS, '读照片', budgets),
        )
      }

      // 表先找出来（模型每次换个地方放），再从表里认槽位。两件事分开的理由见 anchorsObjectOf
      const table = anchorsObjectOf(parsed)
      const lookTags = fieldOf(parsed, table, LOOK_TAG_KEYS)
      const note = fieldOf(parsed, table, ['note', '备注', '说明'])
      return {
        anchors: anchorsFromAnalysis(table),
        lookTags: lookTagsFromAnalysis(lookTags),
        ...(typeof note === 'string' && note.trim() !== '' ? { note: note.trim() } : {}),
        modelId,
        ...(traceId ? { traceId } : {}),
      }
    },
  }
}

/**
 * 一个值太短就不算"读到了"。★ 门槛是 **2 个字**，不是 3：
 * 「圆脸」「短发」「单眼皮」都是真锚点（预填里那七条是 5–18 字，但短不等于没用），
 * 而 1 个字（「圆」）是噪声。这一条是写用例时把自己写错过的——第一版写了 3，
 * 于是「圆脸」被丢掉，而它明明是一条合格的锚点。
 */
const MIN_ANCHOR_LENGTH = 2

/**
 * 「读不出来」的哨兵值。★ 这一条是**提示词自己招来的**：`ANALYZE_SYSTEM` 要求
 * 模型对看不见的槽位写「看不清」（宁缺勿编）。那它就得在这里被认出来——
 * 否则「看不清」会**当成一条锚点填进表单**，然后进 prompt，然后在每一页里画出来。
 * ★ 用"包含"而不是"等于"：模型常写成「看不清，被挡住了」。
 */
const UNREAD_MARKERS = [
  '看不清',
  '看不见',
  '看不到',
  '不清楚',
  '无法判断',
  '无法确定',
  '未知',
  '不明',
  'n/a',
  'unknown',
]

/**
 * 模型把锚点表放在哪个键下面。**约定是 `anchors`，但实测它每次自己挑**：
 * 同一张照片、同一份提示词，一次回 `{"anchors":{…}}`（中文槽位名），
 * 下一次回 `{"anchor":{…}}`（英文槽位键）。所以两个名字都进候选。
 */
const ANCHOR_CONTAINER_KEYS = ['anchors', 'anchor'] as const

/** `lookTags` 也一样（实测放在顶层，但没有理由赌它永远放顶层） */
const LOOK_TAG_KEYS = ['lookTags', 'look_tags', 'tags'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 从模型的整份 JSON 里找出**锚点那张表**。
 *
 * ★ 这一层是 2026-10-16 补的，起因是一次**静默的假成功**：模型把表放在 `anchor`
 *   （单数）里，而我们只读 `anchors`，于是 `anchorsFromAnalysis(undefined)` 回了一个
 *   空数组——界面上写「读到了 0 条」，看着像"这张照片读不出东西"，
 *   而模型的答案其实**就在回包里**（实测原文见 `03-character-profile.md` 第 19 刀）。
 *   用户报的「我试了好几次，都出现这个问题了」里，有一部分就是它。
 *
 * ★ 放宽的是**认表**，不是**认槽位**：候选表要交给 `anchorsFromAnalysis`，
 *   里面认得出至少一个真槽位才算数。所以一份随便的 JSON（比如比对那条路的
 *   `{score, missed, reason}`）不会被这里误认成锚点表——找不到就是空表，
 *   而"空表"与"表里有几格是看不清"在界面上是两句不同的话（见 NewChild.tsx）。
 *
 * ★ 顺序是有理由的：先是约定好的那两个名字（它们是提示词写明的形状），
 *   再退到"扫一遍顶层，谁像表就是谁"（模型的键名可以完全出乎意料），
 *   最后才把**整份 JSON 当成一张平铺的表**（模型把七个槽位直接铺在顶层）。
 */
export function anchorsObjectOf(parsed: Record<string, unknown>): unknown {
  const named = ANCHOR_CONTAINER_KEYS.map((key) => parsed[key]).filter(isRecord)
  const nested = Object.values(parsed).filter(isRecord)
  const candidates = [...named, ...nested, parsed]
  return candidates.find((table) => anchorsFromAnalysis(table).length > 0) ?? named[0] ?? {}
}

/**
 * 取一个字段：**顶层找不到就往被挑中的那张表里再看一眼**。
 *
 * ★ 理由与 `anchorsObjectOf` 同源——模型把 `lookTags` / `note` 放哪一层也不固定。
 *   多看一层不会放进脏数据：这两个字段各有自己的判据
 *   （标签只留 `LOOK_TAGS` 里有的、note 只认非空字符串）。
 */
function fieldOf(
  parsed: Record<string, unknown>,
  table: unknown,
  keys: readonly string[],
): unknown {
  for (const key of keys) {
    if (parsed[key] !== undefined) return parsed[key]
  }
  if (isRecord(table)) {
    for (const key of keys) {
      if (table[key] !== undefined) return table[key]
    }
  }
  return undefined
}

/**
 * 模型回的锚点表 → 我们认识的槽位。**坏输入丢掉，不抛**。
 *
 * ★ 中文槽位名与英文槽位键都认：提示词给的是「骨相（bone）」这种带括号的形式，
 *   模型有可能只回中文名、也有可能回键名，两种都不该白扔。
 * ★ 认不出来的键**不进结果**（比如模型自己加了"表情"）——`ANCHOR_SLOTS` 是封闭的，
 *   多出来的槽位进不了卡（`buildCard` 会拒），在门口丢掉比在引擎深处抛错好。
 * ★ **丢掉的那几格由调用方负责**：这一层只回"读到了什么"，
 *   而"没读到的那些格原来是示例值、必须清掉"是界面的事（见 NewChild.tsx）——
 *   在引擎里替界面清，会让这条函数的语义变成"既读又改"。
 */
export function anchorsFromAnalysis(raw: unknown): { slot: string; value: string }[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
  const labelToSlot = new Map<string, AnchorSlot>(
    ANCHOR_SLOTS.map((slot) => [ANCHOR_LABELS[slot], slot]),
  )
  const out: { slot: string; value: string }[] = []
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'string') continue
    const text = value.trim()
    if (text.length < MIN_ANCHOR_LENGTH) continue
    const lowered = text.toLowerCase()
    if (UNREAD_MARKERS.some((marker) => lowered.includes(marker))) continue
    const cleaned = key.replace(/[（(].*?[)）]/g, '').trim()
    const slot = (ANCHOR_SLOTS as readonly string[]).includes(cleaned)
      ? (cleaned as AnchorSlot)
      : (labelToSlot.get(cleaned) ?? labelToSlot.get(key.trim()))
    if (!slot) continue
    if (out.some((anchor) => anchor.slot === slot)) continue
    out.push({ slot, value: text })
  }
  return out
}

/** 标签只保留清单里有的那些：模型爱自己造词（"大眼睛"），而表单里没有那一格 */
export function lookTagsFromAnalysis(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const allowed = new Set<string>(LOOK_TAGS)
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const tag = item.trim()
    if (allowed.has(tag) && !out.includes(tag)) out.push(tag)
  }
  return out
}

/**
 * 回包里"模型到底写了什么"。**这一点在 2026-10-16 之前只有一个字段**（`content`），
 * 于是当模型想完没写时，我们手上的排障原文是**空的**——用户看到的就是那句
 * 「没按 JSON 回答（原文前 120 字：）」，括号里什么都没有，而它对我们自己也一样没用。
 *
 * ★ 四个字段都是实测出来的（`.out/probe-vision-raw.mts`，跑的是真 `kimi-k2.6`）：
 *   `message` 的键是 `content` / `role` / `reasoning_content` / `provider_specific_fields`，
 *   一次读照片的 `usage` 是 `completion_tokens 2526（其中 reasoning_tokens 2395）`——
 *   也就是说这个模型的**正文只有 250 字上下，思考链有 4000 字**。
 *   正文为空时，能解释"为什么"的东西全在另外三个字段里。
 */
type Reply = {
  /** `message.content`：模型**打算给你看**的那一段。空 = 它什么都没写 */
  text: string
  /** 思考链。★ 它**不是**答案，只在"没有答案"时用来解释为什么没有 */
  reasoning: string
  /** `stop` = 它自己说完了；`length` = 被截了；`content_filter` = 被安全策略掐了 */
  finishReason: string
  /** 有些家把拒绝写在 `refusal` 里（照片里是真人小孩时最该看的就是这个字段） */
  refusal: string
}

export function readReply(body: unknown): Reply {
  const message = findMessage(body)
  return {
    text: contentToText(message?.['content']),
    reasoning:
      typeof message?.['reasoning_content'] === 'string' ? message['reasoning_content'] : '',
    finishReason: findString(body, 'finish_reason'),
    refusal: typeof message?.['refusal'] === 'string' ? message['refusal'] : '',
  }
}

/**
 * `content` 有两种合法形状：字符串，或**分片数组**（`[{type:"text",text:"…"}]`，
 * 多模态回包常见）。老实现只认字符串，遇到数组形状会**静默回空串**——
 * 症状与"模型没写"一模一样，而那是两件完全不同的事。
 */
function contentToText(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) {
    return raw
      .map((part) =>
        part &&
        typeof part === 'object' &&
        typeof (part as Record<string, unknown>)['text'] === 'string'
          ? ((part as Record<string, unknown>)['text'] as string)
          : '',
      )
      .join('')
  }
  return ''
}

/** `choices[0].message`，但层级不一致是这家供应商的老毛病，所以留一层递归兜底 */
function findMessage(body: unknown): Record<string, unknown> | null {
  const choices = (body as Record<string, unknown> | null)?.['choices']
  const first = Array.isArray(choices)
    ? (choices[0] as Record<string, unknown> | undefined)
    : undefined
  const message = first?.['message']
  if (message && typeof message === 'object' && !Array.isArray(message)) {
    return message as Record<string, unknown>
  }
  return (function walk(node: unknown): Record<string, unknown> | null {
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = walk(item)
        if (found) return found
      }
      return null
    }
    if (node && typeof node === 'object') {
      const record = node as Record<string, unknown>
      if ('content' in record || 'reasoning_content' in record) return record
      for (const value of Object.values(record)) {
        const found = walk(value)
        if (found) return found
      }
    }
    return null
  })(body)
}

function findString(body: unknown, key: string): string {
  if (Array.isArray(body)) {
    for (const item of body) {
      const found = findString(item, key)
      if (found) return found
    }
    return ''
  }
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    if (typeof record[key] === 'string') return record[key] as string
    for (const value of Object.values(record)) {
      const found = findString(value, key)
      if (found) return found
    }
  }
  return ''
}

/**
 * 「这一次没读出东西」到底长什么样。
 *
 * ★ 这一句是**给人看的排障原文**（它会原样出现在家长那一屏的括号里），所以它必须
 *   回答"哪一步空的"，而不是只留一个空括号：
 *   · 正文 0 字 → 说清是"想了但没写"，并把**思考链的末尾**带上（那才是当时的现场）；
 *   · 正文有字但解析不了 → 照旧带正文前 120 字；
 *   · 连思考链都没有 → 直说，那说明这个回包本身就是空的。
 *
 * ★ 2026-10-16 加了两样，都是"这句话不够用"逼出来的：
 *   ① **每一次的预算**（`budgets`）。"试了两次"而不说多大，等于没说——
 *      700 试两次还是 700 那两次，与"第一次 700、第二次 2800"是完全不同的两件事；
 *   ② `finish_reason=length` 时给出**处置**。它是"差钱"不是"不会"，
 *      而这两件事的下一步动作正好相反（一个是加预算/换模型，一个是改提示词）。
 */
export function describeUnreadable(
  reply: Reply | null,
  attempts: number,
  what = '读照片',
  budgets: readonly number[] = [],
): string {
  if (!reply) return `${what}的模型没有回任何内容。`
  const blank = reply.text.trim() === ''
  const facts = [
    reply.finishReason ? `finish_reason=${reply.finishReason}` : '',
    blank ? '正文 0 字' : `正文 ${reply.text.length} 字`,
    reply.reasoning ? `思考链 ${reply.reasoning.length} 字` : '',
    budgets.length > 0 ? `预算 ${budgets.join(' → ')}` : '',
    reply.refusal ? `refusal=${reply.refusal}` : '',
  ].filter((bit) => bit !== '')
  const scene = blank
    ? reply.reasoning
      ? `它思考的末尾：${reply.reasoning.slice(-160)}`
      : '回包里连思考链都没有（这一条是空回包）'
    : `正文前 120 字：${reply.text.slice(0, 120)}`
  const remedy =
    reply.finishReason === 'length'
      ? '这一条是**预算不够**（不是"这家不会出 JSON"）：这个模型把预算花在思考链上，正文没轮到。' +
        '处置是把它换成一个非推理的多模态模型，或把它的 token 预算调大。'
      : ''
  return `${what}的模型没有按 JSON 回答（试了 ${attempts} 次；${facts.join(' · ')}）。${scene}${remedy}`
}

/**
 * 模型偶尔把 JSON 包在 ```json 围栏里或前后带话，所以先抠出第一个平衡的 `{ }`。
 *
 * ★ 这段扫描器**原来在这里又写了一遍**（与 `schemas/schema.ts` 的 `extractJson` 是同一段
 *   "转义感知的括号深度扫描"），2026-10-15 合并掉了。合并的判据不是"看着像"，
 *   而是工单 01 §1.3 那条：**改一处必须记得改另一处**——例如转义括号那个边界，
 *   修了一处而漏了另一处，症状是"某个模型偶尔解析不出来"，而它俩长得一样、不好查。
 *
 * ★ 合并时**故意保留"从第一个 `{` 开始"这一步**，没有直接换成 `extractJson(text)`：
 *   后者会先看 `[`，于是 `[{"score":1}]` 这种回包会先被认成一个数组、
 *   再被判成"不是对象"而丢掉，而老实现能从里面抠出那个对象。
 *   合并是为了**少一份扫描器**，不是为了顺手改行为。
 */
export function parseLooseJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  const value = extractJson(text.slice(start))
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}
