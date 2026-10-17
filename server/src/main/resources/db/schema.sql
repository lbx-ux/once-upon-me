-- ============================================================================
-- 小主角的账号与配置表 —— 六张，一张不多
--
-- ★ 这句原来是"三张，一张不多"（2026-10-15 写第一版时确实是三张）。
--   到现在这六张是：users / user_permissions / voices /
--   permission_requests / sms_send_log / sms_codes ——
--   每加一张都有它当时非加不可的理由，而那些理由各自写在那一张上面。
--   ★ 把总数写在这里是因为它会过期：这一行 2026-10-17 就过期过一次
--   （加了 voices 之后没人改它）。改表的时候顺手改这一行。
--
-- ★ 这个文件是**唯一一份**建表语句：本地那份 H2（`local` profile）与服务器上的
--   MySQL 8 都读它。所以它只写两种库都认的那一小块 SQL：
--     · 没有 `ENGINE=` / `DEFAULT CHARSET=` —— 库级设定（建库时 utf8mb4）就够了，
--       写了就变成"只有 MySQL 认"，本地那一半立刻跑不起来；
--     · 没有 `CREATE INDEX IF NOT EXISTS` —— MySQL 8 **不支持**它（实测：
--       `You have an error in your SQL syntax ... near 'IF NOT EXISTS idx_...'`）。
--       ★ 这一条 2026-10-17 在服务器上真的炸过一次：工单 09 往文件末尾加了一句
--       `CREATE INDEX IF NOT EXISTS`，本地（H2）一直好好的，而上到 MySQL 那一刻
--       **整个后端起不来**——`spring.sql.init` 挂在那句上，进程直接退。
--       所以：**次级索引一律写成建表语句里的 `KEY 名字 (列)`**，两个库都认
--       （`KEY` 那种写法 2026-10-17 在 H2 的 MySQL 兼容档与 MySQL 8.0.46 上各测过一次，
--       见 `permission_requests` 那条与工单 03 的记录）。
--       ★ 而"给**已经建过**的表补索引"没有 `IF NOT EXISTS` 可用：
--       那种情况按 `config/SchemaUpgrades` 的做法来（先问库，再 ALTER）。
-- ★ 时间戳一律由 Java 写（没有 `DEFAULT CURRENT_TIMESTAMP`）：两边时钟语义不同，
--   而"这条记录是什么时候来的"是审计要用的东西，不该由数据库的方言决定。
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  -- 登录名：11 位手机号，或一个短账号（测试账号 `123456` 就是这一类）
  account       VARCHAR(32)  NOT NULL,
  -- 手机号。★ 与 account 分开：测试账号没有手机号，而以后"改绑手机号"改的是这一列，
  --   不该动登录名
  phone         VARCHAR(20)  DEFAULT NULL,
  -- BCrypt 哈希。★ 可空：走验证码进来、还没设密码的新用户就是 NULL，
  --   而"没设过密码"与"密码是空串"是两件事（前者不许走密码登录，后者是坏数据）
  password_hash VARCHAR(100) DEFAULT NULL,
  -- 昵称。★ 空串是**合法值**，意思是"还没起过"——界面上它长成打码手机号，
  --   不是一块空白（与前端 `lib/auth/state.ts` 那条同名判断同一个口径）
  nickname      VARCHAR(32)  NOT NULL DEFAULT '',
  -- 默认头像的 id（`^[a-z0-9_-]{1,32}$`）。★ 存形状不存 URL：
  --   头像是前端自己的资产，后端只记住"这个人挑了哪一个"
  avatar        VARCHAR(32)  NOT NULL DEFAULT '',
  role          VARCHAR(16)  NOT NULL DEFAULT 'USER',
  created_at    DATETIME     NOT NULL,
  last_login_at DATETIME     DEFAULT NULL,
  -- ★ 密码最后一次改动的时刻。**它存在的唯一目的是撤销旧会话**：
  --   早于这一列签发的票一律作废（见 AuthService#requireUser）。
  --   没有它，"我改了密码"这件事对那些已经登着的会话毫无影响——
  --   而"改密码"这个动作在一半的场景里就是"有人知道我旧密码"。
  -- ★ 这一轮的 schema 不是迁移工具（全是 IF NOT EXISTS）：给一个**已经存在**的库
  --   加这一列靠 `config/SchemaUpgrades` 里那张清单——启动时先问库"这列在不在"，
  --   缺了就 ALTER（幂等）。2026-10-17 实测过：本地那个 H2 文件库是加这一列之前建的，
  --   没有那条补丁时 `mvn spring-boot:run` 直接起不来（Column not found + 一屏栈）
  password_changed_at DATETIME DEFAULT NULL,
  -- ★ 账号状态（2026-10-17，管理页要能"停号"）。`ACTIVE` / `DISABLED` 两个值。
  --   为什么是**另加一列**而不是复用 `password_hash = NULL` 或者别的巧妙法子：
  --   NULL 那个哈希的含义已经定死了，是"这个人还没设过密码"（上面那一行写着），
  --   两种含义挤在一列里，下一个人一定会把"停用"读成"还没设密码"。
  -- ★ 状态是**每次请求现读**的（`AuthService#requireUser` 与 `#login` 各判一次），
  --   所以停用对一个已经登着的会话是**即时**生效的——不是"等他下次登录"。
  status        VARCHAR(16)  NOT NULL DEFAULT 'ACTIVE',
  PRIMARY KEY (id),
  CONSTRAINT uk_users_account UNIQUE (account)
);

-- 四个能力开关，一人一行。★ 单独一张表而不是往 users 上加四列：
--   这是"授权"这件事，它的写入方只有管理页一个，改的是它、审计的也是它；
--   混进 users 之后，"改昵称"与"发权限"共用一条 UPDATE，日志里再也分不开
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id    BIGINT   NOT NULL,
  -- 文本（写故事）/ 图像（画插画）/ 视觉（核对形象）/ 语音（朗读）
  can_text   TINYINT  NOT NULL DEFAULT 0,
  can_image  TINYINT  NOT NULL DEFAULT 0,
  can_vision TINYINT  NOT NULL DEFAULT 0,
  can_speech TINYINT  NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (user_id)
);

-- 发过哪些验证码。★ 它是**频控与审计**的账本，不是验证码本身。
--   这张表回答的是另外三个问题：同一个号 60 秒内发过没有？同一个 IP 今天发了几条？
--   今天一共发了几条（每日硬顶）？
CREATE TABLE IF NOT EXISTS sms_send_log (
  id      BIGINT      NOT NULL AUTO_INCREMENT,
  phone   VARCHAR(20) NOT NULL,
  ip      VARCHAR(64) NOT NULL,
  sent_at DATETIME    NOT NULL,
  PRIMARY KEY (id)
);

-- 正等着被核验的那些验证码，一人一行（新的一条覆盖旧的）。
--
-- ★ 为什么验证码在我们这边而不是在阿里云那边：站长账号里那个模板是
--   **短信服务**的（`SMS_337215196`，模板内容是 `您的验证码为：${code}…`），
--   也就是"由我们生成、我们下发"——文档里对这种情况的原话是
--   「阿里云接口无法校验」。所以核验只能是我们的。
--   ★ 这不是退让，反而是更好的一条：核验在本地，我们才能给一个码**限次数**
--   （见 code_max_attempts）；交给厂商核验时，一次错误的尝试对我们完全不可见。
--
-- ★ 存的是 HMAC，不是明文码。六位数字的 SHA-256 只有 10^6 种，
--   一张彩虹表就能反查——所以用一把只有服务端知道的密钥做 HMAC
--   （密钥就是 JWT 那把，见 SmsCodeStore）。这段说明写在这里，
--   是因为"为什么不是 sha256(code)"是下一个读这张表的人一定会问的。
CREATE TABLE IF NOT EXISTS sms_codes (
  phone      VARCHAR(20) NOT NULL,
  code_hash  VARCHAR(64) NOT NULL,
  sent_at    DATETIME    NOT NULL,
  expires_at DATETIME    NOT NULL,
  attempts   INT         NOT NULL DEFAULT 0,
  PRIMARY KEY (phone)
);

-- ── 权限申请（2026-10-17）─────────────────────────────────────────────────
-- 用户 2026-10-17 的原话：「现在是用户要发邮件，可以修改一下，帮助这有一个发送请求，
-- 点击发送请求之后，就可以先管理者申请权限了，然后管理端就接收到申请，
-- 这也比发邮件好一点，管理端也可以清楚的看到是谁发送的请求」。
--
-- ★ 四个 `wants_*` 列**照抄 `user_permissions` 的四个名字**（不是另起一套简写）：
--   申请的是"哪几个能力"，而批准的动作就是把这四列原样搬进 `user_permissions`。
--   名字一样，那次搬运才是一行直白的赋值；换个名字就得有一张映射表，
--   而那张表迟早会有一格写错——错法是"点了通过、结果开的是另一个能力"。
--
-- ★ `status` 三态（PENDING / APPROVED / REJECTED），**不是"有就是没处理"**：
--   拒掉的那一条必须留着。它是"这个人申请过、被拒了"的唯一记录，
--   而"看不见已处理的申请"会让申请人反复提交同一件事、让站长反复拒同一件事。
--
-- ★ `note` 就是原来那封邮件里写的东西（"你要用的是哪一项、用来做什么"）。
--   ★ 它**可空**：四个勾选已经说清了"要哪几项"，说明是加分项不是门槛——
--     拿它当必填只会逼人写一句"想做绘本"。
CREATE TABLE IF NOT EXISTS permission_requests (
  id           BIGINT      NOT NULL AUTO_INCREMENT,
  user_id      BIGINT      NOT NULL,
  wants_text   TINYINT     NOT NULL DEFAULT 0,
  wants_image  TINYINT     NOT NULL DEFAULT 0,
  wants_vision TINYINT     NOT NULL DEFAULT 0,
  wants_speech TINYINT     NOT NULL DEFAULT 0,
  note         VARCHAR(500) DEFAULT NULL,
  -- PENDING / APPROVED / REJECTED
  status       VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  created_at   DATETIME    NOT NULL,
  -- 谁批的、什么时候。★ 只有管理员能动，所以这两列就是一张"谁开的这个口子"的账
  decided_at   DATETIME    DEFAULT NULL,
  decided_by   BIGINT      DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_permission_requests_status (status, created_at)
);

-- ★ 列表按"待处理在前、新的在前"取，这条索引就是给那个排序用的
--   （写在建表语句里，不是一句 CREATE INDEX —— 理由见文件头那一条）。
--   没有它，管理页每次打开都要全表排序一遍——现在只有五个人看不出差别，
--   而这张表是**只增不减**的（已拒的也留着），所以它一定会长大。

-- ── 音色（2026-10-17，工单 16）─────────────────────────────────────────────
-- 用户 2026-10-17 定的口径：「音色一并挂到账号上」。它原来住在浏览器
-- localStorage 的两个 key 里（当前选的那个 + 我录过的那几条），
-- 而"我录的声音"看起来像账号的属性、实际却在一台设备上——换台设备就没了。
--
-- ★ 这张表里**一个字节的音频都没有**，那不是漏了：样本除了上传给厂商那一次，
--   不进磁盘、不进库、不进日志（§8.3 要的是"拿到 voice_id 后立即删"，
--   我们的实现比它更严）。这里只有厂商回的 voice_id、当时的模型、用户起的名字与时间。
--
-- ★ `model` 不是记账，是**判据**：克隆出来的音色绑死在创建它时的 TTS 模型上
--   （实测跨模型直接 400 `[411]`），所以当前模型与它对不上时那张卡不许选。
--
-- ★ 唯一键 `(user_id, voice_id)`：同一个人手上同一条嗓子只该有一行。
--   没有它的话，"选两次同一个"会插两行，而 `chosen` 会在两行之间打架。
--
-- ★ 列名用 `chosen` 而不是 `current`：后者是 MySQL 的保留字，
--   而这一列会被拼进 SQL（MyBatis 那层）。
CREATE TABLE IF NOT EXISTS voices (
  id         BIGINT       NOT NULL AUTO_INCREMENT,
  user_id    BIGINT       NOT NULL,
  -- 厂商侧的 voice_id（预置那两个也在内：第一次被选中时才落一行）
  voice_id   VARCHAR(128) NOT NULL,
  -- 用户起的名字。★ 预置音色给的是控制台里那个名字
  name       VARCHAR(64)  NOT NULL DEFAULT '',
  -- 创建它时的 TTS 模型。见上面那条说明
  model      VARCHAR(128) NOT NULL DEFAULT '',
  -- 是不是"下次做书用这一个"。★ 一个人最多一条为真（由 VoiceService 保证）
  chosen     TINYINT      NOT NULL DEFAULT 0,
  created_at DATETIME     NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uk_voices_user_voice UNIQUE (user_id, voice_id)
);
