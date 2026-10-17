/**
 * make-default-avatar.mts —— 出**唯一那一个**默认头像
 *
 * ```bash
 * # ① 出几张候选，并拼一张按真实尺寸裁圆的对照表（调图像模型，会花钱）
 * node scripts/make-default-avatar.mts
 *
 * # 只出其中一张（某一张超时之后补那一张，别四张重出）
 * node scripts/make-default-avatar.mts --only=chuan
 *
 * # 只拼表，**不调模型**：拿盘上已有的原图拼，缺哪张就少哪一行
 * node scripts/make-default-avatar.mts --sheet
 *
 * # ② 挑中的那一张缩到 256×256 落 public/avatars/yun.webp
 * node scripts/make-default-avatar.mts --apply=yun-light     # 按键名挑
 * node scripts/make-default-avatar.mts --apply=2             # 或按表上的行号（1 起）
 * ```
 *
 * ## 它替换的是什么
 *
 * 工单 08 那六个手写 SVG（云/纸船/太阳/蒲公英/叶子/月亮 + 一排"挑一个"的缩略图）
 * 在 2026-10-17 被用户整条否掉：「算了吧，只提供一个默认头像，然后用户不可以切换，
 * 生成一个头像，符合当前项目的，现在的这个蓝色的不好看」。
 * 所以这一份只出一张，而且**它不再是用户数据**——是一个站点常量（见 `lib/avatars.ts`）。
 *
 * ## 提示词的三次迭代（每一次都留在文件里，因为每一次都对应一次实测）
 *
 * **v1**（工单 15 那个写法：`儿童绘本水彩插画，手绘质感…` 开头 + 主体写在第五段）
 * → 两张都出一整幅**有小孩的风景画**：女孩、草地、树、泰迪熊，脸画得清清楚楚。
 * 提示词里那句「不要有人脸、人物」和「主体：一朵蓬松的云」被整个忽略。
 * ★ 那条提示词**不是写错了**——它是写给 gpt-image-2 的（工单 15 里用户拿去自己出图）。
 *   换一个模型就得重测，这正是"提示词过拟合到某个模型"的样子。
 *
 * **v2** 动了三处才过：不写「儿童绘本 / 插画」（那是"画一个小孩"的引信）、
 * 第一句就是主体、反面约束点名要排除的东西（不要小孩/脸/草地/树/房子）。
 * 判据：268px 原图 + 64/44/22 三个裁圆，在 22px 那一列仍读得出"一朵云"。**形状对了。**
 *
 * **v3**（下面这一套）修的是 v2 那份**用户看了一眼就说不要**的：
 * 「这个头像我不喜欢，换一个」。看一眼就知道 v2 坏在哪 —— 头像那一格（92px 的圆）
 * 里是一团**砖橙夹着近黑**的疙瘩，读起来像烧糊了的棉花，而不是一朵云。
 * 根因是 v2 里那一句「云的右下缘压一点**近黑墨色** #17171d 的影，面积不超过云的一成」
 * —— "一成"是给**人**看的比例，模型按"这是这块最暗的地方"去理解了，
 * 于是把整条下缘涂成了深褐到近黑。**问题不在云这个主体，在明度。**
 *
 * v3 因此做了三件事，每一件都对着一个具体的失效：
 * 1. **把"暗"从提示词里拿走。** 不再提"影"和"近黑墨色"，改成正面写**明度**：
 *    「整幅必须亮、必须轻」「云的底部最深处仍然只比背景深一点点」。
 *    反面约束也从"不要蓝"扩到"不要黑、不要深褐、不要深橙、不要把底部涂实"。
 * 2. **近黑 #17171d 降级成"只准勾极细的线"**，并给它一个可查的上限（不超过画面 2%）。
 *    v2 里它是"影"的颜色，v3 里它不是任何一块面的颜色。
 * 3. **一次出四张、并排比**，而不是再猜一张。四张刻意在**明度**上分开，
 *    因为这一轮唯一能证伪的判据就是这个：
 *    `yun-light`（几乎纸白）/ `yun-soft`（薄涂陶土橙、均匀无深色）/
 *    `yun-bold`（墨色实心剪影，22px 下最清楚，赌"轻"不是问题、"糊"才是）/
 *    `chuan`（**换主体**：纸船，万一用户不要的是云本身）。
 *
 * ## v3 落在哪一张：`yun-soft`（2026-10-17）
 *
 * ```
 * node scripts/make-default-avatar.mts --apply=yun-soft
 * ```
 *
 * 怎么挑的**不是**靠盯着那张表看，是靠 `.out/probe-avatar.mts` 量出来的三个数
 * （圆内均值 / 最暗 5% 的均值 / 亮度低于 0.25 的像素占比），在真尺寸 64px 上：
 *
 * | 候选         | 均值  | 最暗5% | 近黑占比 |                                    |
 * | ------------ | ----- | ------ | -------- | ---------------------------------- |
 * | v2（被否的） | 0.766 | 0.265  | 2.1%     | ✗                                  |
 * | yun-light    | 0.870 | 0.636  | 0.0%     | ✓ 但离纸太近（纸 0.936，只差 0.066） |
 * | **yun-soft** | 0.777 | 0.392  | 0.1%     | ✓ **选它**                          |
 * | yun-bold     | 0.198 | 0.021  | 21.5%    | ✗ **故意**不过：它赌的就是"墨色也行"  |
 * | chuan        | 0.762 | 0.448  | 0.0%     | ✓ 留着当备选（换主体）               |
 *
 * ★ 判据是 `最暗5% ≥ 0.35 且 近黑占比 ≤ 1%`——**不是均值**。
 *   v2 的均值（0.766）与 yun-soft（0.777）几乎一样，均值这一项对"糊"是瞎的；
 *   把它俩分开的是最暗的那条尾巴。这条踩坑的经过写在 `probe-avatar.mts` 的注释里。
 *
 * 想换：`--apply=<yun-light|yun-bold|chuan|2>`（行号 1 起，见对照表）。
 * ★ 换之前先跑 `.out/probe-avatar.mts`：它量的就是"用户当初说不要"的那个坏法。
 *
 * ## v4：`yun-soft` 也被否了，这一次的问题不在明度（2026-10-17 当天晚些时候）
 *
 * 用户看了落地的那张说「这个默认头像我不喜欢，**想粑粑一样**，换一个好看的」。
 * 他说的是对的，而且这一条 v3 的判据**根本量不出来**：
 *
 * ★ **陶土橙 + 一朵三瓣的实心团块，形状与颜色合起来就是那个东西。**
 *   v3 把"太深"修掉了（读数上 v3 是干净的），但主体仍然是
 *   **一整块实心的、圆的、三瓣的暖色墩子**——那正是它被读成排泄物的全部原因。
 *   **v3 的判据（明度尾巴）对这个坏法是瞎的**：它在判据上过得很好，还是不能用。
 *
 * v4 因此动了三件事，每一件都对着一个具体的东西：
 *
 * 1. **换主体，而且是换成有棱角/有放射的**：`taiyang`（太阳，圆盘 + 八条放射光线）、
 *    `yezi`（叶子，两头尖的披针形 + 主脉侧脉）。这两个的轮廓**天生不是团块**。
 * 2. **留下的云改成"只画轮廓"**：`yun-xian`——云身是空的，不填任何颜色，
 *    只有一条一笔画下来的线。线描的云不会读成实心墩子。
 *    （保留云这个主体是因为它是本站第一个故事里的东西，这一条理由没变。）
 * 3. **纸船反过来做**：v3 的 `chuan` 是陶土橙薄涂，v4 的 `chuan` **船身改成纸白**，
 *    只靠陶土橙的折痕线分开两片折面——去掉"暖色实心块"这个共同点。
 *
 * 判据这一轮多了两个数（但它们**不能替代看图**，见下）：
 *   - `fill` 圆内"不是背景色"的像素占比 —— 实心墩子高（四成以上）
 *   - `edge` 圆内亮度梯度超阈值的像素占比 —— 线描/光线高，实心墩子贴着 0
 *   - `off`  实心像素质心到圆心的距离（按半径归一）—— 主体偏到一边、被圆裁掉一块
 * ★ 老实说：**"像不像那个东西"这一条没有数值判据**，那两个数只是挡住
 *   "又做回一团实心暖色"。最终是拿对照表给人看的——而且这一轮**应该**给人看，
 *   连着两次由我一个人拍板，两次都被否了。
 *
 * ## v4 落在哪一张：`chuan`（纸船，2026-10-17）
 *
 * ```
 * node scripts/make-default-avatar.mts --apply=chuan
 * ```
 *
 * 在真尺寸 64px 裁圆上量出来的四个数（`.out/probe-avatar.mts`）：
 *
 * | 候选    | 均值  | 最暗5% | 近黑 | 实心  | 边缘  | 偏心  |                 |
 * | ------- | ----- | ------ | ---- | ----- | ----- | ----- | --------------- |
 * | taiyang | 0.741 | 0.361  | 0.0% | 97.8% | 25.1% | 0.001 | ✗ 铺满整个圆    |
 * | yezi    | 0.839 | 0.503  | 0.0% | 33.7% | 11.8% | 0.019 | 勉强，最像团块  |
 * | **chuan** | 0.840 | 0.631 | 0.0% | 42.7% | 14.8% | 0.028 | ✓ **选它** |
 *
 * ★ **`taiyang` 是被 `fill` 挡下来的，不是靠我眯着眼看**：97.8% 意味着
 *   连"背景参照点"（圆内正上方 0.8r 那一点）都落在主体上——它把整个圆填满了，
 *   放射的光线到边就被裁掉。**同一个 97.8% 也让它的 `off` 失效**（0.001）：
 *   当几乎每个像素都算"实心"时，质心必然回到圆心，那个数就没有信息了。
 *   所以 `off` 只在 `fill` 中等时才读得出东西，别单看它。
 * ★ `yezi` 的边缘密度是四张里最低的（11.8%）：它就是"暖色实心块"最接近的那一张，
 *   只是形状比 v3 的云尖一点。留它做备选，但**它不该是默认**。
 * ★ `chuan` 的 22px 那一列最暗 5% 是 0.699（四张里最亮的一档），边缘 20.8%——
 *   缩到侧栏那 20px 时，读得出形状的是那条陶土橙折痕线，不是色块。
 *
 * ## 这一轮连带修掉的一个**哑** bug：`--apply=` 曾经是死代码
 *
 * 加 `--sheet` 那一条时写的是 `if (arg('sheet') !== undefined)`，
 * 而 `arg()` 没找到时返回的是缺省值 `''`——**不是 `undefined`**，于是那个比较恒真：
 * 出图与 `--apply=` 两条路一起走不到（`--apply=chuan` 跑完什么都没落，只是又拼了张表，
 * 而且它**不报错**）。修法是用 `env.mts` 新加的 `flag()` 判"开关在不在"。
 * 记在这里是因为它的症状是"命令成功退出、文件没变"，很难联想到判空写错了。
 *
 * ## 为什么反过来用**暖**色（这一条与工单 15 那段"冷调"是相反的）
 *
 * 工单 15 当时让六张头像跟个人主页那一屏一起转冷，理由是"别成为不在调子里的东西"。
 * 现在反过来了，判据也换了，两条都要说清：
 *
 * 1. **冷底 + 冷记号在那一屏上等于看不见。** 头像坐在 `--pf-paper`(#e8f0f6) 那个圈里，
 *    而那一屏的底是同一族的淡蓝（`.pfb` 那三团光晕），记号又是 `--pf-accent`(#427294)——
 *    用户说的"这个蓝色的不好看"，量出来就是**三个层次全是同一支色相**。
 * 2. **本站那条法律本来就写着暖色该在这儿**（`globals.css` 的 `:root`）：
 *    **"冷的是光，暖的是物件。"** 头像与角色墙那块裱照片的 mat、手写标签是同一类东西
 *    ——一个被拿在手里的**物件**，不是光。放在暖相纸 `--card-paper`(#f7efe3) 上、
 *    用全站那颗陶土橙 `--accent`(#c2410c) 起笔，它才**是一张本站封面的一小块**，
 *    而不是贴上去的一个冷色图标。
 *    ★ 这条不违背后端那一屏"整体转蓝"的指定：转的是**光**（页面底、描边、次级文字），
 *      暖色在这条法律里的身份本来就是物件。
 *    ★ v3 只调明度，**不动这一条**：暖色仍然是对的，坏的是"太深"。
 *
 * ## 为什么是云 / 纸船
 *
 * 六个里这两个是**本站自己要讲的第一个故事里出现过的东西**——
 * `public/demo` 那本「小宇的云」（云先变成恐龙的背，又变成一条船的肚子）。
 * 挑门面时，"本站自己的第一个故事里有它"这个理由压过"哪个剪影更好看"。
 * 云的横向团块在 22px 的圆里也读得出来，而它边缘那圈水彩晕开的样子
 * 正是那六个线描 SVG 缺的那件事。
 *
 * ## 判据（不靠"我盯着看觉得还行"）
 *
 * 拼出来的那张表里，每一张都按 `.pf__avatar` 真正的做法处理过：
 * **裁成圆**（`border-radius:999px` + `object-fit:cover`）、按真尺寸缩到
 * 64 / 44 / 22px、垫在那一屏的底上。剪影在 22px 那一列还读不读得出"一朵云"，
 * 是 v2 唯一一条能证伪的验收——**v3 给它加了一条**。
 *
 * ★ 加的那一条**第一版写错了**，留在这里当教训：
 *   第一版是「64px 的圆**不能比它后面那张纸更深**」。跑出来**四张候选全部不合格**，
 *   包括肉眼明显没问题的那些——因为"纸上的一个东西"本来就必须比纸深，
 *   不然它根本看不见。那句话作为判据是错的（它只是把"可见"说成了"不合格"）。
 *   真正能分开 v2 与合格候选的是**暗的那条尾巴**，不是均值也不是"比纸深不深"：
 *   `最暗5% ≥ 0.35 且 近黑占比 ≤ 1%`，量的脚本是 `.out/probe-avatar.mts`。
 *   表格与逐张读数在上面「v3 落在哪一张」那一节。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import sharp from 'sharp'

import { imageProviderOf } from '../src/lib/engine/providers/registry.ts'
import { arg, flag, readEnv } from './env.mts'

/** ★ 每迭代一次提示词就换一个目录，上一版的原图留着（并排比才看得出改了哪儿）
 *  v3 那四张仍在 `.out/avatars/v3/`：它们是"明度修好了、但还是不能用"的物证 */
const RAW_DIR = resolve('.out/avatars/v4')
const OUT_FILE = resolve('public/avatars/yun.webp')

/** 出图尺寸。★ `wan2.7-image` 那张模型级白名单里有它（见 tokenrhythm-image.ts） */
const SIZE = '1024x1024'

/** 落库尺寸。★ 最大显示 64px（`.pf__avatar`），2x 有余量；再大是白付字节 */
const FINAL = 256

/** 拼对照表时垫的底：这一屏最深的那一层（`--pf-wash-bottom`） */
const WASH = '#e9f0f4'

/**
 * 五支颜色，四张候选共用。
 *
 * ★ 这是 `globals.css` 的 `:root` 那一条"冷的是光，暖的是物件"的暖的那一半：
 *   暖相纸 `#f7efe3` / 陶土橙 `#c2410c` / 墨灰 `#6b6a74` / 纸白 `#f4f8f9` / 墨 `#17171d`。
 */
const PALETTE =
  '整幅只准出现这五种颜色：暖相纸米色 #f7efe3、陶土橙 #c2410c、' +
  '墨灰 #6b6a74、纸白 #f4f8f9、近黑墨色 #17171d；' +
  '整幅必须偏暖，不要蓝、不要青、不要绿、不要紫、不要荧光色。'

/**
 * 反面约束：**v3 把它从"不要人"扩成了"不要暗"，v4 又加上了"不要一团实心"。**
 *
 * ★ v2 只写了「不要人物/小孩/脸」这一类**主体**层面的排除，
 *   于是模型在"明度"这一层完全自由，就把云的下缘涂成了深褐。
 *   现在这里逐条点名"不要黑、不要深褐、不要深橙、不要压影、不要涂实"——
 *   反面约束要管的是**上一次坏掉的那个维度**，不是想得起来的那几个词。
 * ★ v4 补的是**形状**那一维：v3 的读数全过，但主体是"一整块实心的、圆的、
 *   三瓣的暖色墩子"，被读成了别的东西。所以这里点名不要实心团块、
 *   要求轮廓有明确的方向或棱角。**"不要太阳"那条从这一版起去掉了**——
 *   `taiyang` 这张的主体就是太阳。
 */
const NEGATIVE =
  '不要人物、不要小孩、不要人脸、不要眼睛、不要手、不要身体、不要动物；' +
  '不要草地、不要树、不要房子、不要山、不要飞鸟、不要任何风景或场景；' +
  '不要出现主体之外的第二个东西（另一朵云、另一个太阳、星星、月亮、雨滴……）；' +
  '不要文字、字母、数字、印章、签名、水印；' +
  '不要硬边机械描边，不要细密排线或密集内部纹理（缩到 22px 会糊成一片）；' +
  '不要渐变背景、不要光斑、不要边框、不要投影；' +
  '★ 不要黑色、不要深褐、不要深橙、不要任何深色块；不要把底部涂实，不要压影，' +
  '不要墨色阴影；' +
  '★ 主体不要是一整块实心的、圆的、没有棱角的团块——它的轮廓必须有明确的方向或棱角，' +
  '由几个大小不一的形状接出来，而不是一个圆墩。'

/** 共用布局段：会被裁成圆、主体收在内切圆里、不画边框与底衬 */
const FRAME =
  '正方形构图，主体居中，四周留白充足，主体的轮廓完整收在画面中心直径 70% 的圆内' +
  '（这张图会被裁成圆形，四角看不见）；' +
  '背景整幅平铺暖相纸米色 #f7efe3，不画边框、不画圆形底衬、不画投在纸上的阴影；'

/**
 * 四张候选。
 *
 * ★ 它们刻意在**主体与画法**上分开，而不在"风格"上分开——v3 已经证伪了
 *   "换个说法就能变好看"这条路（那一轮只动明度，四张读数全过，
 *   可用户要的东西一点没变）。这一轮要证伪的假设只有一个：
 *   **"实心的、圆的、暖色的团块"是不是那个坏法的全部来源。**
 *   所以四张里没有一张是实心暖色团块：
 *     `taiyang`  圆盘 + 放射光线（轮廓天生不是团块）
 *     `yezi`     两头尖的披针形 + 主脉与侧脉
 *     `yun-xian` 只剩一条线的云（云身是空的，不填色）
 *     `chuan`    纸白的船身，只靠一条折痕线分开两片折面
 */
const CANDIDATES: { key: string; note: string; prompt: string }[] = [
  {
    key: 'taiyang',
    note: '太阳：陶土橙圆盘 + 八条长短交替的实心放射光线',
    prompt: [
      '一个太阳。',
      '水彩画，手绘，纸面颗粒可见，笔触边缘柔和、略有晕染，不追求写实；',
      FRAME,
      '太阳是一枚实心的圆盘，用陶土橙 #c2410c 平涂，浓度均匀，不要渐变、不要水痕；',
      '★ 圆盘四周放射出八条**长短交替的直光线**：用陶土橙 #c2410c 画成细长的实心尖角，尖朝外；',
      '★ 光线之间要留出暖相纸米色 #f7efe3 的空隙，**不要把光线连成一片**，',
      '  也不要把它们画成弯曲的火焰或者波浪；',
      '盘面左上方留一小块纸白 #f4f8f9 的高光，不超过盘面的三成；',
      '★ 圆盘占画面中心直径 40% 的圆，连同光线整体不超过 70%；',
      PALETTE,
      '近黑墨色 #17171d 只允许用作极小面积的勾线，总面积不超过画面的百分之二；',
      '★ 画面里只有这一个太阳，除此之外什么都没有。',
      NEGATIVE,
      '★ 这一张的验收是"一眼看出是太阳"：缩到 20px，那八条放射的光线仍然要看得出来——',
      '  那是它区别于"一团实心圆"的全部依据。',
    ].join('\n'),
  },
  {
    key: 'yezi',
    note: '叶子：两头尖的披针形，陶土橙薄涂 + 纸白主脉与侧脉',
    prompt: [
      '一片叶子。',
      '水彩画，手绘，纸面颗粒可见，笔触边缘柔和、略有晕染，不追求写实；',
      FRAME,
      '侧视，叶片是一个两头尖的长椭圆形，也就是披针形，叶尖朝右上方，叶柄在左下方；',
      '★ 叶片用陶土橙 #c2410c 薄薄平涂，浓度均匀，不要一处深一处浅；',
      '主脉是一条从叶柄一直通到叶尖的纸白 #f4f8f9 细线，粗细一致；',
      '侧脉用比叶面稍深一点的陶土橙画出五六条斜向细线，从主脉斜伸到叶缘，不要画满整片；',
      '★ 叶缘留两三个浅浅的缺口，像被虫咬过，不要画成锯齿；',
      '★ 不要画树枝、不要画第二片叶子、不要画叶影；',
      PALETTE,
      '近黑墨色 #17171d 只允许用作极小面积的勾线，总面积不超过画面的百分之二；',
      '★ 画面里只有这一片叶子，除此之外什么都没有。',
      NEGATIVE,
      '★ 这一张的验收是"像一片真叶子"：22px 的圆里要读得出那条主脉，',
      '  而不是一枚暖色的尖椭圆。',
    ].join('\n'),
  },
  {
    key: 'yun-xian',
    note: '云：只画轮廓，云身是空的（一笔画下来的线，不填色）',
    prompt: [
      '一朵云的轮廓。',
      '★ 这一张**只画一条线**：云身内部是空的，就是暖相纸米色 #f7efe3 的底色，',
      '  里面不填任何颜色、不画任何纹理；',
      '手绘，纸面颗粒可见，线条像一支笔一笔画下来的，粗细基本一致，略有手抖，不追求工整；',
      FRAME,
      '云的轮廓要起伏明确：由三到四个大小不一的圆弧接成，顶上的弧最大、两侧的弧渐小，',
      '弧与弧之间不要出现尖角；',
      '线条只在云的下缘那一段用陶土橙 #c2410c，上面几段用墨灰 #6b6a74，读得出光从上面来；',
      '★ 不要双线、不要描边叠影、不要在云身内部排线或者加阴影——',
      '  这一张的坏法就是"又画成了一团实心色块"，所以它必须始终是空的。',
      PALETTE,
      '近黑墨色 #17171d 只允许用作极小面积的勾线，总面积不超过画面的百分之二；',
      '★ 画面里只有这一朵云的轮廓，除此之外什么都没有。',
      NEGATIVE,
      '★ 这一张的验收是"是一笔画出来的"：22px 的圆里那几段弧仍然连得起来，',
      '  而且不能被小尺寸糊成一圈黑边（所以线要细，不要实心块面）。',
    ].join('\n'),
  },
  {
    key: 'chuan',
    note: '纸船：船身改成纸白，只靠陶土橙的折痕线分开两片折面',
    prompt: [
      '一只折纸小船。',
      '水彩画，手绘，纸面颗粒可见，笔触边缘柔和、略有晕染，不追求写实；',
      FRAME,
      '侧视，船身由两片折面构成：上面一片是尖顶的三角帆形折角，',
      '下面一片是斜边的梯形船底，两片之间是一条折痕；',
      '★ 船身主体是纸白 #f4f8f9，像一张真的白纸，**不要把船身整片涂成橙色**；',
      '★ 那两片折面靠一条陶土橙 #c2410c 的折痕线分开：',
      '  折痕是一条干净的直线，粗细一致，不勾硬边；',
      '下面那片船底用陶土橙 #c2410c 的**极淡水彩**带一层，浓度不超过两成，读得出它背光；',
      '★ 船下不要画水面、不要画波浪线、不要画水影，让它浮在纸面上；',
      '不要画桅杆、不要画旗子、不要画人影；',
      PALETTE,
      '近黑墨色 #17171d 只允许用作极小面积的勾线，总面积不超过画面的百分之二；',
      '★ 画面里只有这一只船，除此之外什么都没有。',
      NEGATIVE,
      '★ 这一张的验收是"像一张折过的白纸"：22px 的圆里要读得出那两片折面和那条折痕，',
      '  而不是一团暖色的三角。',
    ].join('\n'),
  },
]

/** 一张图 → 裁成圆（与 `.pf__avatar` 的 `border-radius:999px` 同一件事） */
async function circle(bytes: Buffer, size: number): Promise<Buffer> {
  const square = await sharp(bytes).resize(size, size, { fit: 'cover' }).png().toBuffer()
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" ` +
      `r="${size / 2}" fill="#fff"/></svg>`,
  )
  return sharp(square)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer()
}

/**
 * 行标签。
 *
 * ★ v2 那张表**没有标签**，所以"挑第几张"这件事只能靠"从上往下数"——
 *   而在四张候选上那是会数错的。键名一律用 ASCII（`yun-light` 而不是「淡云」）：
 *   sharp 走的 librsvg 在没有中文衬底字体时会画成一排空框，那比不写标签更坏。
 */
function labelOf(key: string, width: number, height: number): Buffer {
  return Buffer.from(
    `<svg width="${width}" height="${height}">` +
      `<rect width="${width}" height="${height}" rx="6" fill="#17171d"/>` +
      `<text x="9" y="${height / 2 + 5}" font-family="monospace" font-size="14" ` +
      `fill="#f4f8f9">${key}</text></svg>`,
  )
}

/**
 * 拼那张对照表。
 *
 * ★ 它存在的理由与 `check-scrim.mts` 同一条：**"看着还行"不是判据**。
 *   同一张图在 1024 下好看、在 22 的圆里糊成一团，是这一批图最常见的坏法，
 *   而那种坏法只有把两个尺寸并排放在同一张纸上才看得出来。
 *   ★ v3 加的判据**不在这一张图上**："比纸深"是错的（见上面「判据」那一节），
 *     真正的读数是 `.out/probe-avatar.mts` 量的最暗 5% 与近黑占比。
 *     这张表仍然要拼，因为它管的是另一半——22px 下还读不读得出形状。
 */
async function sheetOf(raw: { key: string; bytes: Buffer }[]): Promise<Buffer> {
  const SIZES = [64, 44, 22]
  const CELL = 96
  /** 左边那一大格。★ 拼图的画布必须**先算够高**：sharp 的 composite 在
   *  "图比画布大" 时直接抛错（这里第一版就是 268 的图塞进 240 高的画布） */
  const BIG = 268
  const PAD = 8
  const GAP = 16
  const LABEL_W = 104
  const width = PAD + LABEL_W + BIG + GAP + SIZES.length * CELL + PAD
  const rowH = BIG + GAP
  const height = PAD + raw.length * rowH

  const layers: sharp.OverlayOptions[] = []
  for (const [row, { key, bytes }] of raw.entries()) {
    const top = PAD + row * rowH
    layers.push({
      input: labelOf(key, LABEL_W - 8, 26),
      left: PAD,
      top: top + Math.round((BIG - 26) / 2),
    })
    layers.push({
      input: await sharp(bytes).resize(BIG, BIG, { fit: 'cover' }).png().toBuffer(),
      left: PAD + LABEL_W,
      top,
    })
    for (const [col, size] of SIZES.entries()) {
      layers.push({
        input: await circle(bytes, size),
        left: PAD + LABEL_W + BIG + GAP + col * CELL + Math.round((CELL - size) / 2),
        top: top + Math.round((BIG - size) / 2),
      })
    }
  }
  return sharp({
    create: { width, height, channels: 3, background: WASH },
  })
    .composite(layers)
    .png()
    .toBuffer()
}

async function main(): Promise<void> {
  const apply = arg('apply')

  /**
   * `--sheet`：**只拼表，不调模型。**
   *
   * ★ 加这一条是因为它当场就咬了一次：四张候选里第三张**出图超时**
   *   （`EngineError: 生成类请求超时**不要重试**`——服务端可能已建单，
   *   重试等于可能付两遍钱），于是"出完再拼表"这条路上，
   *   **一张失败就拿不到整张对照表**，而盘上那两张是好好的。
   *   现在表可以从**盘上已有的原图**拼：缺哪张就少哪一行，不重出、不重付。
   * ★ 判"开关在不在"必须用 `flag()` 而不是 `arg() !== undefined`：
   *   `arg()` 缺省回 `''`，那个比较**恒真**，于是这一条加上去之后
   *   出图与 `--apply=` 两条路一起变成了死代码（实测：`--apply=chuan`
   *   什么都没落，只是又拼了一张表）。见 `env.mts` 里 `flag()` 那段。
   */
  if (flag('sheet')) {
    const present: { key: string; bytes: Buffer }[] = []
    for (const { key } of CANDIDATES) {
      const bytes = await readFile(join(RAW_DIR, `${key}.png`)).catch(() => null)
      if (bytes) present.push({ key, bytes })
      else console.log(`（少 ${key}——盘上没有，这一行空着）`)
    }
    if (present.length === 0) throw new Error(`盘上一张都没有：${RAW_DIR}`)
    await writeFile(join(RAW_DIR, 'sheet.png'), await sheetOf(present))
    console.log(`\n对照表：${join(RAW_DIR, 'sheet.png')}（${present.length} 行，没调模型）`)
    return
  }

  if (apply) {
    // ★ 键名或行号都收：行号是"表上从上往下数第几个"（1 起），键名是左边那个标签
    const byKey = CANDIDATES.find((c) => c.key === apply)
    const index = byKey ? CANDIDATES.indexOf(byKey) : Number(apply) - 1
    const picked = CANDIDATES[index]
    if (!picked) {
      throw new Error(
        `没这一张：${apply}——表上只有 ${CANDIDATES.map((c, i) => `${i + 1}=${c.key}`).join(' / ')}`,
      )
    }
    const file = join(RAW_DIR, `${picked.key}.png`)
    const bytes = await readFile(file).catch(() => null)
    if (!bytes) throw new Error(`没有 ${file}——先不带参数跑一次出图`)
    await mkdir(resolve('public/avatars'), { recursive: true })
    const out = await sharp(bytes)
      .resize(FINAL, FINAL, { fit: 'cover' })
      .webp({ quality: 88 })
      .toBuffer()
    await writeFile(OUT_FILE, out)
    console.log(`\n落好了：${OUT_FILE}（${FINAL}×${FINAL}，${(out.length / 1024).toFixed(1)}KB）`)
    return
  }

  const env = await readEnv()
  const image = imageProviderOf(env)
  const only = arg('only')
  const wanted = only ? CANDIDATES.filter((c) => c.key === only) : CANDIDATES
  if (wanted.length === 0) throw new Error(`--only=${only} 不在候选里`)
  await mkdir(RAW_DIR, { recursive: true })

  const raw: { key: string; bytes: Buffer }[] = []
  for (const { key, prompt } of wanted) {
    const started = Date.now()
    const generated = await image.generate({ prompt, size: SIZE })
    await writeFile(join(RAW_DIR, `${key}.png`), generated.bytes)
    raw.push({ key, bytes: Buffer.from(generated.bytes) })
    console.log(
      `${key.padEnd(10)} ${((Date.now() - started) / 1000).toFixed(1)} 秒  ` +
        `${(generated.bytes.length / 1024).toFixed(0)}KB  ${generated.modelId}`,
    )
  }

  // ★ 只出单张时不拼表：表的意义是"并排比"，一张就没有可比的
  if (raw.length > 1) {
    await writeFile(join(RAW_DIR, 'sheet.png'), await sheetOf(raw))
    console.log(
      `\n对照表：${join(RAW_DIR, 'sheet.png')}\n` +
        `（每一行 = 一张候选；左边是键名，右边三列是 64 / 44 / 22 裁成圆）\n` +
        `★ 这张表看的是**形状**：22px 那一列还读不读得出主体\n` +
        `★ 明度要在另一处量（这张表看不出"糊"）：node .out/probe-avatar.mts\n` +
        `挑一张：node scripts/make-default-avatar.mts --apply=<键名 或 行号>`,
    )
  }
}

await main()
