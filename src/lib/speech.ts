/**
 * speech.ts —— 语音输入的纯逻辑：孩子那句话说的是哪一边
 *
 * 共读版的选择点有两个大按钮（左 / 右），而孩子不识字。按钮已经带图标与朗读，
 * 但"用嘴说"是更自然的那个动作——这个模块只回答一件事：**一段识别结果落在哪一边**。
 *
 * 四条约定，每条都对应一次会真发生的事：
 *
 * 1. **只认方位与序数，不认"这个 / 那个"**。
 *    「这个」在没有手指的情况下不指向任何一边；把它猜成左边，等于替孩子做了选择。
 *    猜不出来就说没听清——孩子会再说一次，而"说错了"改不回来。
 *
 * 2. **两边都出现就判不出来**（`left === right` 那一条）。
 *    「左边还是右边」是一句提问，不是答案；「左右」两个字同时出现时也一样。
 *    这一条同时兜住了"模型把两个词都识别出来"的抖动。
 *
 * 3. **不解析否定**。「不是左边」会被判成左边（含"左边"）。三岁孩子不说这种句子，
 *    而一个真的否定解析器仍然会在"不要右边那个，要左边"上出错。宁可说没听清。
 *
 * 4. **只把标准化的那一小段拿去做 `includes`**：去空白、去标点、转小写。
 *    识别结果带标点是常态（"左边。"），而标点会让"第一个"被拆成"第一，个"。
 *    ★ 不引分词器：这一层要能在 node 里测，而它判的是几个固定词，不是自然语言。
 *
 * 失败文案也在这里：两处入口（创作输入框 / 选择点）必须说同一句话，
 * 而分成两份的那天，其中一份会先漂。
 */

/** 选了哪一支。与 `ReaderBook` 的 `Pick` 差一个 `null`（那个是"还没选"） */
export type PickSide = 'a' | 'b'

/** 语音这一路能失败的方式。`unsupported` 是能力探测，不是运行时错误 */
export type SpeechFailure =
  'unsupported' | 'not-allowed' | 'no-speech' | 'network' | 'audio-capture' | 'aborted' | 'unknown'

/**
 * 左边 / 第一支的词。
 * ★ 繁体两种（左邊 / 第一個）一起收：某些输入法与识别服务会吐繁体，
 *   而"同一个意思换一个字就不认"会让人以为是麦克风坏了。
 * ★ 不写裸的「前 / 后」：「以前」「后来」都含它们，而这两句和方位毫无关系。
 *   写「前面 / 后面 / 往前 / 往后」，误判面小得多。
 */
const LEFT_WORDS = [
  '左',
  '左邊',
  '左面',
  '左侧',
  '左側',
  '前面',
  '前边',
  '前邊',
  '前一个',
  '前一個',
  '往前',
  '第一个',
  '第一個',
  '第一',
  '第1个',
  '第1個',
  '第1',
  '上面',
  '上边',
  '上邊',
  'left',
]

const RIGHT_WORDS = [
  '右',
  '右邊',
  '右面',
  '右侧',
  '右側',
  '后面',
  '后边',
  '後邊',
  '后一个',
  '後一個',
  '往后',
  '第二个',
  '第二個',
  '第二',
  '第2个',
  '第2個',
  '第2',
  '下面',
  '下边',
  '下邊',
  'right',
]

/**
 * 识别结果列表里的一项。只写这一层用到的两个字段：
 * `isFinal` 与第 0 个候选的 `transcript`（浏览器给的形状见 `use-speech.ts`）。
 */
export type SpeechResultLike = {
  isFinal: boolean
  [index: number]: { transcript: string } | undefined
}

/**
 * 把一次 `onresult` 的 `results` 读成"定稿 + 中间稿"。
 *
 * ★ **每次都从整个列表重建，不按 `resultIndex` 做增量。**
 *   增量那版在"某个浏览器把 resultIndex 又报回 0"时会把同一句定稿加两遍
 *   （孩子说一遍，屏幕上出现两遍）；重建只依赖"引擎手里现在有哪些结果"，
 *   而那是这一层唯一能确定的事。代价是每个事件 O(n)，n 是一句话的分段数。
 *
 * 抽成纯函数是为了让这条不变量能在 node 里被钉住（`speech.test.ts`）——
 * 它住在 hook 里的时候，唯一的验证方式是拿真麦克风说一遍。
 */
export function speechTextOf(results: ArrayLike<SpeechResultLike>): {
  finals: string
  interim: string
} {
  let finals = ''
  let interim = ''
  for (let i = 0; i < results.length; i += 1) {
    const result = results[i]
    const transcript = result?.[0]?.transcript ?? ''
    if (result?.isFinal) finals += transcript
    else interim += transcript
  }
  return { finals, interim }
}

/** 去掉空白与常见中英文标点。★ 全角逗号句号是识别结果里最常见的两个 */
const NOISE = /[\s，。！？、,.!?;；:："'“”‘’…—\-·~～]/g

/** 标准化：转小写 + 去标点与空白。导出是为了让测试钉住"标点不影响判定" */
export function normalizeSpoken(raw: string): string {
  return raw.toLowerCase().replace(NOISE, '')
}

/**
 * 一段识别结果 → 选了哪一支。判不出来一律 `null`（理由见文件头 1–3）。
 *
 * `includes` 而不是 `startsWith`：孩子的回答常常是「我想走左边那条」，
 * 而这句话里没有哪个位置是固定的。
 */
export function spokenPickOf(raw: string): PickSide | null {
  const text = normalizeSpoken(raw)
  if (text === '') return null
  const left = LEFT_WORDS.some((word) => text.includes(word))
  const right = RIGHT_WORDS.some((word) => text.includes(word))
  // 两边都命中 / 两边都没有 = 判不出来。写成 `left === right` 是为了少一条分支
  if (left === right) return null
  return left ? 'a' : 'b'
}

/**
 * 失败说给谁听。两处入口共用这一份。
 *
 * `aborted` 没有文案：那是"用户自己取消了这一次"（打字 / 离开这一屏），
 * 不是失败；给它一句话会让一次正常的取消看起来像出错了。
 */
export function speechFailureText(reason: SpeechFailure): string {
  switch (reason) {
    case 'unsupported':
      return '这个浏览器没有语音识别。Chrome 或 Edge 可以，也可以直接写。'
    case 'not-allowed':
      return '麦克风没有打开。允许之后再说一次，或者用键盘写。'
    case 'no-speech':
      return '没听见。再说一次试试。'
    case 'network':
      // ★ 一句实话：Chrome 的识别要连它自己的服务，连不上时这一路就是用不了
      return '这台设备的语音服务连不上。用键盘写吧。'
    case 'audio-capture':
      return '没有找到麦克风。'
    case 'unknown':
      return '语音没认出来。再试一次，或者直接写。'
    case 'aborted':
      return ''
  }
}
