/**
 * 第三屏「项目亮点」的内容
 *
 * 内容模块挨着组件放，与 `book/demoBook.ts` 同一个先例。
 *
 * ## 卡上只写"是什么"，不写"第几周做"
 *
 * 这一版把每条底部的**进度标注整行去掉了**（原来是 `W4 · 11/04–11/10`、
 * `↑ 上面那本书演示过` 那一类）。理由：首页是给人看产品的，不是给人看排期的；
 * 周次与"哪条已经演示过"都记在 README §一 的进度表与 §五，那里才是它该在的地方。
 *
 * **这不改变另一条规矩：没有的东西不许写成有。** 五条文案本身仍然只说机制与做法，
 * 不承诺已经完成 —— 去掉标注不等于把"还没做"这件事糊过去。
 *
 * 同理，**卡片上没有「查看详情」**：没有详情页可去。参考站那五张卡每张都挂一个
 * 点了没反应的链接，这一屏宁可 footer 右边什么都不放。
 * 这与「演示仅第 1 页配音」是同一条规矩。
 */

export type Highlight = {
  /** 同时是插画文件名：`public/highlights/{key}.webp` */
  key: string
  /** meta 行右侧的中文分类 */
  category: string
  /** meta 行右侧的英文标签，全大写 */
  tag: string
  title: string
  body: string
  /** 底部那一排小胶囊：只放这一条里真的存在的物件与动作 */
  chips: string[]
}

export const HIGHLIGHTS: Highlight[] = [
  {
    key: 'character-lock',
    category: '角色一致性',
    tag: 'CHARACTER LOCK',
    title: '一张角色卡，锁住二十页的脸',
    body: '先建角色卡：骨相、瞳色、头身比、那一撮翘起来的头发。之后每一页的提示词都从这张卡派生，再由校验环节逐页比对，不合格的那一页重画。换掉书里的名字很容易，换不掉的是脸。',
    chips: ['角色卡', '骨相锚点', '逐页比对'],
  },
  {
    key: 'thirty-seconds',
    category: '父母的声音',
    tag: 'THIRTY SECONDS',
    title: '录三十秒，让孩子听你的声音讲完',
    body: '家里任何人念一句话的样本，做音色克隆，再逐页配音。哪句要放轻、哪里该停一下，都留在同一条音轨上。在外地打工的父母，声音是能跨过距离的那一样东西。',
    chips: ['30 秒样本', '音色克隆', '逐页配音'],
  },
  {
    key: 'two-forms',
    category: '一个引擎两种形态',
    tag: 'TWO FORMS',
    title: '同一本故事，睡前一条路，白天两条岔口',
    body: '独读版约 20 页线性，一屏一图一句，不给孩子做选择的机会——越选越兴奋，睡不着。共读版是 2–3 层故事树，选择点走大图标加语音的双通道，因为孩子还不识字。去掉互动绘本仍成立，去掉绘本互动不成立：这是同一个东西的两种形态。',
    chips: ['独读版', '共读版', '故事树'],
  },
  {
    key: 'agent-pipeline',
    category: '多 Agent 流水线',
    tag: 'AGENT PIPELINE',
    title: '规划、生成、三个校验，全程摊开给你看',
    body: '分镜规划 → 画面生成 → 一致性 / 连贯 / 适龄三个校验 Agent 逐页打分，不合格的那页退回重画。整条链路对外是一条事件流，界面直接消费它——所以你能看见它此刻停在哪一步，而不只是一个转圈的 spinner。',
    chips: ['事件流', '三个校验 Agent', '过程可视化'],
  },
  {
    key: 'headless-engine',
    category: '无头引擎',
    tag: 'HEADLESS ENGINE',
    title: '引擎不碰 React，一个脚本能跑完整本书',
    body: 'lib/engine 禁止 import React，界面只是它的一个消费者。这条约束的验收方式不是文档里的一句话：不启动浏览器，用 node 脚本把一整本绘本生成出来。这也是「平台」而不是「一堆工具的串联」的技术证据。',
    chips: ['分层约束', '可脚本验收'],
  },
]

/** 插画路径：`public/highlights/{key}.webp`，五张都已落盘。 */
export const artPath = (key: string) => `/highlights/${key}.webp`
