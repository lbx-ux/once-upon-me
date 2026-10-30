-- ============================================================================
-- 小主角的账号、配置与额度表 —— 八张，一张不多
--
-- ★ 这句原来是"三张，一张不多"（2026-10-15 写第一版时确实是三张）。
--   ★ 2026-10-18：`permission_requests`（权限申请）随"权限收成一位、注册即全开"
--   一起退场，所以从六张回到五张：users / user_permissions / voices /
--   sms_send_log / sms_codes —— 每加一张都有它当时非加不可的理由，
--   而那些理由各自写在那一张上面。
--   ★ 2026-10-30：加了额度那三张（credit_accounts / book_credits / redeem_codes），
--   五张变八张。它们回答的是同一个新问题："谁能画几本"。三张的分工见每一张上面那一段
--   ——账本、余额、码，各是各的事，不合并。
--   ★ 同一天又去掉了一张：`credit_orders`（对公转账订单）随"这一版不要订单台账"
--   一起退场，所以是九张回到八张。它不是"没做"，是**决定不做**——额度只从兑换码与
--   站长补发进来，站外那笔钱不再在系统里留凭证。
--   ★ 它**只在新建的库上不再出现**：已经建过的库里那些旧表还在（`SchemaUpgrades`
--   刻意不做 DROP，见它的文件头），只是没有任何代码再读写它。
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
--       见工单 03 的记录）。
--       ★ 2026-10-30：额度那两张表又把这条用上了（`book_credits` 与 `redeem_codes`
--       各一条），写法照旧，没有 `CREATE INDEX`。
--       现在"写在建表语句里的索引"有五条：两条唯一约束 + 三条 `KEY`，
--       `SchemaSqlPortabilityTest` 拿它们当"索引这件事我们确实做了"的锚点。
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

-- 「这个人有没有创作权」——**一位**，一人一行（2026-10-18 由四列收成一列）。
--
-- ★ 收成一位之后为什么**仍然是单独一张表**（而不是往 `users` 上加一列）：
--   这两张表的**写入方不同**。这张表只有管理页会改，改的是"授权"这件事；
--   而 `users` 那边是这个人自己在改昵称、服务端在记最后登录时间。
--   混在一起之后，"谁把这个人的权限关了"与"谁改了昵称"共用一条 UPDATE，
--   日志里再也分不开。
--
-- ★ 2026-10-18 用户定的口径：**登录之后就能用各种模型，不用站长分配**；
--   站长那边留一个开关用来"把某个人的权限收回来"。所以存的是**一位**，
--   而不是"哪几项能力"——四项同真同假，分开存就是四个必然一起动的列。
--
-- ★ `DEFAULT 1` 是这一轮最要紧的一个字面量：**默认给上**。
--   它对**新写进来的行**成立（建号时也显式写 1，见 `UserPermission#allowedFor`），
--   而对**已经建过的库**它就是"老账号自动给上"那一句的落地——
--   `SchemaUpgrades` 补这一列时走的正是这个默认值。
--
-- ★ 一个理论上的疑问，先答在这里：这张表里**没有行**的人算什么？
--   算"**有**权限"。缺行只可能是"这个号是手写进 users 的"，
--   而既然默认是给上，"没被收回过"与"没有那一行"是同一件事。
--   判据只有一处：`AuthService#allowedOf`。
--
-- ★ 老库上原来那四列 `can_text / can_image / can_vision / can_speech` **还在**，
--   而没有任何代码读它们——`SchemaUpgrades` 刻意不做 DROP（理由在它的文件头：
--   "启动时按代码重排你的库"是一个会吃掉数据的动作）。
--   新库按下面这一份建，所以只有老库上会看到那四列。
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id    BIGINT   NOT NULL,
  -- 1 = 能用（默认），0 = 站长把这个人的权限收回了
  allowed    TINYINT  NOT NULL DEFAULT 1,
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

-- ── 权限申请（2026-10-17 加，2026-10-18 **退场**）────────────────────────────
-- 这里原来有一张 `permission_requests`（用户提申请 → 站长在管理页批或拒）。
-- 2026-10-18 它整条拆掉了：权限改成**注册即全开**，于是没有人需要申请，
-- 而"帮助"里那个唯一的入口也随模块一起删了。
--
-- ★ 为什么建表语句是**删掉**而不是留着：留着的话，新库上会凭空长出一张
--   永远没有代码读写的表，而下一个人会以为它还在生效。
-- ★ 而**已经建过的库里那张表还在**，里面那些已批/已拒的记录也还在——
--   `SchemaUpgrades` 刻意不做 DROP（那个类上的原话："启动时按代码重排你的库"
--   是一个会吃掉数据的动作，不该顺手拥有）。这是一笔有意的取舍：
--   表在、数据在、没有读者。真要清，那是一次单独的手工操作，不是启动时的副作用。

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

-- ── 额度（2026-10-30）─────────────────────────────────────────────────────
-- 三张表回答同一个问题："谁能画几本"。它们**不合并**，因为各自记的是不同的事：
--   credit_accounts  现在还剩几本（余额，扣减要能原子判够不够）
--   book_credits     这个数是怎么变成现在这个数的（只追加的账本）
--   redeem_codes     一张码值几本、谁核销的（码就是钱，存 HMAC 不存明文）
-- 把三张压成一张，退一次款就要改写两条互相依赖的历史；分开之后每一张都能单独对账。
-- ★ 第四张 `credit_orders`（对公转账订单）同日**决定不做**：这一版没有支付通道，
--   也没有订单台账。已经建过的库里它还在（本文件不做 DROP），只是没有代码再读写它。
--
-- ★ 余额那一列是**账本的缓存**，不是账本本身：`SUM(book_credits.delta)` 必须
--   永远等于 `credit_accounts.balance`。留它只为一件事——扣减用一条
--   `UPDATE ... SET balance = balance - 1 WHERE balance >= 1` 完成"读、判、写"。
--   两者的差就是管理页上那个"账本差额"（正常恒为 0）。
CREATE TABLE IF NOT EXISTS credit_accounts (
  user_id    BIGINT   NOT NULL,
  -- 还剩几本。★ 缺行 = 0 本（与 user_permissions 的"缺行 = 有"刻意相反）
  balance    INT      NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (user_id)
);

-- 额度账本：一行 = 一次授予（+）或一次扣减（-）。只追加，不改、不删。
--
-- ★ 列名是 `ref_no` 而不是 `ref`：后者在某个方言里太容易撞上保留字，
--   而这一类问题只在 H2 或 MySQL 的一侧出现——正是 `chosen` 那一列付过学费的形状。
-- ★ `reason` 只有四个值（grant / redeem / consume / refund），见 `BookCredit`。
-- ★ 退款按书号**求和封顶**：这个书号的 consume 合计减去 refund 合计，就是还能退多少
--   （同一本书失败两次、重试两次，两笔都退得回来）。判据走 (user_id, reason, ref_no)
--   三列，规模只有几百行，不另建索引。
CREATE TABLE IF NOT EXISTS book_credits (
  id         BIGINT       NOT NULL AUTO_INCREMENT,
  user_id    BIGINT       NOT NULL,
  delta      INT          NOT NULL,
  reason     VARCHAR(24)  NOT NULL,
  ref_no     VARCHAR(128) DEFAULT NULL,
  note       VARCHAR(200) NOT NULL DEFAULT '',
  created_at DATETIME     NOT NULL,
  PRIMARY KEY (id),
  KEY idx_book_credits_user (user_id, created_at)
);

-- 兑换码。一码一行，主键是**明文码的 HMAC**（十六进制 64 字符），不是明文。
--
-- ★ 库里没有明文，只有后四位（`code_tail`）。这不是"前端小心一点"：
--   那张表里根本没有可以还原明文的列，库被读走也拿不到码。
--   代价是码丢了只能补发、不能查回——这是对的。
-- ★ 核销是一条带条件的 UPDATE：
--   `SET redeemed_by = ? WHERE code_hash = ? AND redeemed_by IS NULL
--    AND (expires_at IS NULL OR expires_at > ?)`。
--   "先查再写"在两个人同时提交同一张码时会发两份额度。
-- ★ `batch` 不是一张表，只是生成时写下的一个标签（同一批一起导出、一起对账）。
CREATE TABLE IF NOT EXISTS redeem_codes (
  code_hash   CHAR(64)     NOT NULL,
  code_tail   CHAR(4)      NOT NULL,
  books       INT          NOT NULL,
  batch       VARCHAR(40)  NOT NULL,
  note        VARCHAR(200) NOT NULL DEFAULT '',
  expires_at  DATETIME     DEFAULT NULL,
  redeemed_by BIGINT       DEFAULT NULL,
  redeemed_at DATETIME     DEFAULT NULL,
  created_at  DATETIME     NOT NULL,
  PRIMARY KEY (code_hash),
  KEY idx_redeem_codes_batch (batch)
);
