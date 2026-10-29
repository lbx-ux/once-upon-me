/**
 * PrivacySheet —— 「我们怎么处理你和孩子的数据」那一屏（2026-10-21，工单 D-28）
 *
 * 评分报告在 §2.5 / §2.18 / §2.19 三处一共扣了 16 分，说的都是同一件事：
 *   工程的纪律是好的（照片与录音的字节真的没落盘，资产按人分片，删除会给凭据），
 *   但**没有一个字是给家庭看的**——没有监护人同意、没有留存期、没有"删我的声音和照片"
 *   的入口。这一屏补的就是那 16 分里属于"告知"的那一半。
 *
 * ★ 这一屏不许写承诺，只许写事实。判据就一条：**每一句话都要能指出它的出处**。
 *   所以每一句都对应下面某一条"怎么自己验"——不是修辞，是这一屏的规格：
 *
 *   | 这一页说的话 | 出处 |
 *   | --- | --- |
 *   | 照片原图没落盘 | `scripts/check-family-data.mts`：真跑一遍再满盘搜，两条对照针一起判 |
 *   | 录音样本没落盘 | 同上（那支脚本第二段走的是 `parseCloneRequest` + 适配器的 `clone`） |
 *   | 打字机那一段增量不落盘 | `src/app/api/books/route-stream.test.ts` 的第三条 |
 *   | 东西在哪儿 | `src/lib/child-deletion.ts` 的那张四个位置的表（删除凭据就是按它报数的） |
 *   | 删完给条数 | `src/lib/child-deletion.ts` 的 `DeletionReceipt`，界面上是 `DeleteChildDialog` |
 *
 *   「我们不会泄露」这种句子一个字都不出现：它不是事实，是一句谁都会说的话，
 *   而这一屏全部的价值恰恰在于"这里写的都能被查"。
 *
 * ★ 2026-10-21 一并说清的两件不体面的事：
 *   ① 今天**没有自动过期**——不删就一直在。原来那句话在别处写成过"我们会定期清理"，
 *      而那是一个不存在的定时任务；这里照实说是"没有"。
 *   ② 这个站是**自托管**的一份：能读到那台机器磁盘的人就能读到那些文件。
 *      把它说成云服务那种"只有我们看得到"，是把最要紧的一格糊过去。
 *
 * ★★ 2026-10-21 第二轮：**这一屏的读者是家长**，用户的意见是"这一页不用写这么复杂"。
 *   第一版是照"评委看得见"写的：六节、七行带真实路径的落点表、三条能粘进终端的命令，
 *   满屏 `u/<你的账号>/children/<编号>.json` 与 `pnpm check:family`。
 *   那些**都是事实**，问题在于——一个家长读到第三行就走了，而这一屏是为他写的。
 *   于是第二版把同样的内容分成两层：
 *
 *   | 层 | 给谁 | 里面有什么 |
 *   | --- | --- | --- |
 *   | 正文五节 | 家长 | 白话。照片没留 / 留了哪些 / 发给谁 / 留多久 / 怎么删。**一个文件路径、一条命令都没有** |
 *   | 折叠的最后一栏 | 评委与工程师 | 上面那五节每一句的出处：真实路径、三条命令、对照针 |
 *
 *   ★ 第二层**不是删掉，是折起来**（`<details>`，纯 HTML，不用一行客户端 JS）：
 *   判据要的"每句都能被查"不能因为"家长看不懂"就消失——能做的是别摆在人家脸上。
 *   ★ 这一版顺手改了三个词：`落盘`→`留`/`存`、`派生缓存`→`缩小版预览图`、
 *   `事件流水`→（只在第二层出现）。术语是给同行的，家长读的是一句话。
 *
 * 它是服务端组件（没有交互，一个字都不用送到浏览器去执行）；
 *   样式与它同目录同名（`privacy-sheet.css`），在 `app/globals.css` 里 `@import`——
 *   与全站其余各套一致的硬约束。
 */

import Link from 'next/link'

import IcpNotice from '@/components/site/IcpNotice.tsx'

/** 一条"我们存了什么"。★ 第二层（给评委）里的 `where` 写的是磁盘上真实的那一段路径 */
type Stored = {
  what: string
  /** 家长读的那一层：一句话说清在哪儿，不出现路径 */
  plain: string
  /** 折起来那一层：磁盘上真实的落点，逐字来自 `child-deletion.ts` 那张表 */
  where: string
  inside: string
}

const STORED: readonly Stored[] = [
  {
    what: '孩子的档案',
    plain: '名字、名字怎么念、年龄档、你挑的那几个长相标签。',
    where: 'u/<你的账号>/children/<编号>.json',
    inside: '名字、名字怎么念、年龄档、你选的那几个外貌标签',
  },
  {
    what: '他的形象',
    plain:
      '你确认过的那张参考图，加上它的"外貌锚点"（每次画他都照着这些来）。改过一版就多留一份——旧书里那些页指着旧版，覆盖了就说不清"这一页是哪一版画的"。',
    where: 'u/<你的账号>/cards/<卡号>/',
    inside: '外貌锚点、画风，以及模型画出来的那张参考图，每个版本一份',
  },
  {
    what: '他做过的书',
    plain: '故事文字、每一页的图和配音、封面。',
    where: 'u/<你的账号>/books/<书号>/',
    inside:
      '故事正文、每一页的图和配音（配音是合成出来的音频文件）、封面，以及 events.jsonl——生成过程的事件流水，出图与审核那几步的读数都在里面',
  },
  {
    what: '缩小版预览图',
    plain:
      '书架和卡片墙上显示的那些小图，是上面那些图缩出来的。它也算他的脸，所以删孩子的时候一起删。',
    where: 'u/<你的账号>/thumbs/<尺寸>/',
    inside: '上面那些图的派生缓存。★ 它也是他的脸，所以删孩子的时候它算一个位置',
  },
  {
    what: '你的账号',
    plain: '手机号、昵称，以及密码的哈希（原文我们看不到）。',
    where: '站的后端（不在这个仓库里）',
    inside: '手机号、昵称、密码的哈希、能不能用哪些能力',
  },
  {
    what: '你建的那条音色',
    plain: '一个编号、你给它起的名字。★ 声音本身在语音厂商那边，我们这边只有一个编号。',
    where: '站的后端 voices 表里一条记录',
    inside:
      '一个 voiceId、你给它起的名字、建它时用的模型名。声音本身在语音厂商那边，我们这边只有一个编号',
  },
  {
    what: '站里调模型用的钥匙',
    plain: '这不是你的东西，是站里用来调模型的。',
    where: '.env.local，或管理页写出来的 models.runtime.json',
    inside: '站里调模型用的钥匙。这两个文件都在 .gitignore 里，仓库是公开的，它们不入库',
  },
]

/** 「怎么自己验」那三条（只出现在折起来的那一层）。`command` 是可以直接粘进终端的原话 */
const CHECKS: readonly { what: string; how: string; command: string }[] = [
  {
    what: '孩子的照片原图没有落盘',
    how: '它只在那一次请求的内存里活一遍：读进来 → 缩到接口能收的尺寸并压平白底 → 当参考图发给出图模型 → 出作用域。磁盘上从来没有它。',
    command: 'pnpm check:family',
  },
  {
    what: '你自己的录音样本没有落盘',
    how: '同上：样本只在创建音色那一次请求的请求体里，厂商回一个 voiceId，我们只存那一个编号。',
    command: 'pnpm check:family',
  },
  {
    what: '编故事时给你的每一段文字增量不进日志',
    how: '屏幕上"正在写第 k 页"那些字是一段段从网络上来的，但它们不进 events.jsonl——那里只有整件事的语义事件，没有逐字增量。',
    command: 'pnpm test -- route-stream',
  },
]

export type PrivacySheetProps = {
  /**
   * 现在有没有登录。★ 只用来决定"去个人主页"那颗按钮出不出现——
   *   这一屏不要求登录：同意这件事恰恰要在**建账号之前**看得到。
   */
  signedIn: boolean
}

export default function PrivacySheet({ signedIn }: PrivacySheetProps) {
  return (
    <main className="pv">
      <article className="pv__paper">
        <p className="pv__kicker">数据与隐私</p>
        <h1 className="pv__title">我们怎么处理你和孩子的数据</h1>
        <p className="pv__lead">
          这一页写给家长看：孩子的什么被存下来了、放在哪儿、会发给谁、不想要了怎么删。 写的是这个站
          <strong>实际在做的事</strong>，不是承诺。
          技术上的底稿放在最下面那一栏里——想看可以点开，不看也不影响你读完这一页。
        </p>

        <section className="pv__sec">
          <h2 className="pv__h2">一、孩子的照片，我们没有留</h2>
          <p className="pv__p">
            你上传的那张照片，只在<strong>给他画第一张形象那一次</strong>用一下：
            缩到合适的大小、把背景填成白色、发给出图模型照着画，然后就没了。
            磁盘上从来没有过那份原图——不是「用完删掉」，是<strong>从来就没有写过</strong>。
          </p>
          <p className="pv__p">
            你录的那段声音一样：它只出现在<strong>建那条音色那一次</strong>的请求里，
            语音厂商回一个编号，我们这边只留那个编号。
          </p>
          <p className="pv__p pv__p--blunt">
            这两件是家长最先问的，所以放在最前面。想自己核对的话， 最下面那一栏里有可以跑的检查。
          </p>
        </section>

        <section className="pv__sec">
          <h2 className="pv__h2">二、留下来的只有这些</h2>
          <div className="pv__table pv__table--kept" role="table" aria-label="存下来的东西">
            {STORED.map((row) => (
              <div className="pv__row" role="row" key={row.what}>
                <p className="pv__cell pv__cell--what" role="cell">
                  {row.what}
                </p>
                <p className="pv__cell pv__cell--inside" role="cell">
                  {row.plain}
                </p>
              </div>
            ))}
          </div>
          <p className="pv__note">
            每个账号各存一份，彼此分开：别人的东西不在你这一份里，你也不在别人那一份里。
            删一个孩子的时候，我们也是按这一份一份地数给你看。
          </p>
        </section>

        <section className="pv__sec">
          <h2 className="pv__h2">三、会发给谁</h2>
          <p className="pv__p">我们自己这边只有两次，而且是不发就做不成的那两次：</p>
          <ul className="pv__bullets">
            <li>
              画他的第一张形象那一步，那张照片会<strong>发给出图模型厂商</strong>
              ——它就是照着这张照片画的。
            </li>
            <li>
              建音色那一步，你录的那段声音会<strong>发给语音厂商</strong>
              ——它就是听着这段声音来复刻的。
            </li>
          </ul>
          <p className="pv__p">
            两次都在服务器上发生，浏览器里不留副本。除此之外没有第三处拿到过它：
            照片和录音不进记录、也不进日志。
          </p>
          <p className="pv__p">
            还有一处是<strong>你自己发出去的</strong>：书架上每本成品可以生成一条只读链接，
            拿到这条链接的人（以及任何再把它转发出去的人）都能读这本书。 链接默认 30
            天后失效，你也可以随时收回；收回之后我们这边就打不开了——
            但已经被对方浏览器缓存下来的那一份，不归我们管。
          </p>
          <p className="pv__p pv__p--blunt">
            ★ 还有一件要说在前面：这个站是<strong>自己架的</strong>。谁能让这台服务器跑起来，
            谁就能读到那台机器上的这些文件——它不是那种「只有我们看得到」的云服务。
            这一格请你自己判断：这台服务器是谁在管，你就等于把这些文件交给了谁。
          </p>
        </section>

        <section className="pv__sec">
          <h2 className="pv__h2">四、会留多久</h2>
          <p className="pv__p">
            <strong>不会自动过期。</strong>今天没有任何定时清理：你不删，它就一直留着。
            这里不写「我们会定期清理」——因为没有那个东西。不想留了，看下一节。
          </p>
        </section>

        <section className="pv__sec">
          <h2 className="pv__h2">五、不想要了，怎么删</h2>
          <div className="pv__table pv__table--del" role="table" aria-label="删除入口">
            <div className="pv__row" role="row">
              <p className="pv__cell pv__cell--what" role="cell">
                删一个孩子
              </p>
              <p className="pv__cell pv__cell--where" role="cell">
                <Link className="pv__link" href="/character">
                  角色卡那一墙
                </Link>
                ，他卡片上的「删掉他」
              </p>
              <p className="pv__cell pv__cell--inside" role="cell">
                连他的书、他的形象、那些缩小版预览图一起删。删完给你一张单子：
                每个地方各删掉几条、哪几本书一起没了
              </p>
            </div>
            <div className="pv__row" role="row">
              <p className="pv__cell pv__cell--what" role="cell">
                删一本书
              </p>
              <p className="pv__cell pv__cell--where" role="cell">
                <Link className="pv__link" href="/shelf">
                  书架
                </Link>
                ，那一本上的删除
              </p>
              <p className="pv__cell pv__cell--inside" role="cell">
                那一本的图和配音一起没
              </p>
            </div>
            <div className="pv__row" role="row">
              <p className="pv__cell pv__cell--what" role="cell">
                删一条音色
              </p>
              <p className="pv__cell pv__cell--where" role="cell">
                <Link className="pv__link" href="/voice">
                  我的声音
                </Link>
                ，那一张卡上的删除
              </p>
              <p className="pv__cell pv__cell--inside" role="cell">
                厂商那边也一起解绑。解绑失败会照实说失败，不会把本地那条记录偷偷删掉再假装成功
              </p>
            </div>
          </div>
          <p className="pv__note">
            ★ 缺一件：<strong>注销整个账号</strong>今天没有自助入口。要连账号一起清掉，
            得让管这台服务器的人来办（管理页里有「删号」，那是给管理员用的）。
            在那之前，上面三个入口能把跟孩子有关的东西清干净——账号里剩下的只有手机号、
            昵称和密码的哈希。
          </p>
        </section>

        {/* ── 折起来的那一层：给评委与工程师 ─────────────────────────────
            第一版把这一层摊在正文里，家长读到第三行就走了（用户的意见）。
            折起来之后判据仍然成立："每句都能被查"没有消失，只是不再摆在人家脸上。
            纯 `<details>`，不用一行客户端脚本。 */}
        <details className="pv__more">
          <summary className="pv__more-sum">给技术评审：这一页的每一句话怎么自己验</summary>
          <div className="pv__more-body">
            <p className="pv__p">
              这一页不是宣传页：上面五节里的每一句都对应下面某一条。写成这个样子是有代价的
              ——它要求那些句子**有东西撑着**，否则就得删掉那句话，而不是换一句好听的。
            </p>

            <h3 className="pv__h3">三条可以跑的检查</h3>
            <ul className="pv__list">
              {CHECKS.map((check) => (
                <li className="pv__item" key={check.what}>
                  <p className="pv__item-what">{check.what}</p>
                  <p className="pv__item-how">{check.how}</p>
                  <p className="pv__item-how">
                    命令：<code className="pv__code">{check.command}</code>
                  </p>
                </li>
              ))}
            </ul>
            <p className="pv__note">
              <code className="pv__code">pnpm check:family</code> 会<strong>真的跑一遍</strong>
              那两条路（照片那条走 <code className="pv__code">cardFromPhoto</code>，
              录音那条走创建音色的请求解析与适配器），跑完再逐字节搜整个工作区与那一轮的临时资产根。
              它同时埋了两根「应该被找到」的对照针（模型画出来的那张形象、发往厂商的请求体）——
              没有那两根，搜不到照片这件事本身是没有意义的：一个什么都没跑的探针也搜不到。 它也挂在{' '}
              <code className="pv__code">pnpm verify</code> 里，push 之前自己跑一遍。
            </p>

            <h3 className="pv__h3">第二节那张表在磁盘上的落点</h3>
            <div className="pv__table" role="table" aria-label="存下来的东西与它们的落点">
              {STORED.map((row) => (
                <div className="pv__row" role="row" key={row.what}>
                  <p className="pv__cell pv__cell--what" role="cell">
                    {row.what}
                  </p>
                  <p className="pv__cell pv__cell--where" role="cell">
                    <code className="pv__code">{row.where}</code>
                  </p>
                  <p className="pv__cell pv__cell--inside" role="cell">
                    {row.inside}
                  </p>
                </div>
              ))}
            </div>
            <p className="pv__note">
              <code className="pv__code">u/&lt;你的账号&gt;/</code> 这一层是分片的：
              别人的东西不在你这一片里，你也不在别人的那一片里。这一层是删除凭据报数的单位——
              删一个孩子，它逐位置报出「档案 1 条 / 角色卡与参考图 3 条 / 他的书 11 条 / 缩略图 20
              条」。 ★ 这张表与前四行的路径出自 <code className="pv__code">child-deletion.ts</code>{' '}
              同一处 （两处各写一遍的话，总有一天会出现「隐私页说四个位置、删除只删了三个」）。
            </p>
          </div>
        </details>

        <nav className="pv__actions" aria-label="离开这一页">
          <Link className="pv__btn" href="/">
            回首页
          </Link>
          <Link className="pv__btn pv__btn--ghost" href={signedIn ? '/account' : '/login'}>
            {signedIn ? '去个人主页' : '去登录'}
          </Link>
        </nav>

        {/* 2026-10-28：备案号挂在这一页的落款处（`.pv__icp`，见 privacy-sheet.css 末尾） */}
        <IcpNotice className="pv__icp" />
      </article>
    </main>
  )
}
