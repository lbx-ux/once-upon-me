-- ============================================================================
-- 小主角的账号表 —— 三张，一张不多
--
-- ★ 这个文件是**唯一一份**建表语句：本地那份 H2（`local` profile）与服务器上的
--   MySQL 8 都读它。所以它只写两种库都认的那一小块 SQL：
--     · 没有 `ENGINE=` / `DEFAULT CHARSET=` —— 库级设定（建库时 utf8mb4）就够了，
--       写了就变成"只有 MySQL 认"，本地那一半立刻跑不起来；
--     · 没有 `CREATE INDEX IF NOT EXISTS` —— MySQL 8 **不支持**它，
--       而写在 CREATE TABLE 里的 `KEY idx (...)` H2 又不认。
--       所以次级索引一条都没有：这几张表在可预见的规模里是几百行，
--       真到了要索引那天，请在服务器上手工 `ALTER TABLE ... ADD INDEX`（MySQL-only 的写法），
--       而不是往这个文件里塞一句本地跑不通的话。
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
