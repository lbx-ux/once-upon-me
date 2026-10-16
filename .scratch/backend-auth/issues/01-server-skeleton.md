# 01 —— 后端骨架：Spring Boot + 三张表 + 健康检查

`Status:` **done**（2026-10-16）

## 要做什么

新建 `server/`（Maven 模块），把账号这件事的地基铺好：

- Spring Boot 3.3.5（Java 17）、MyBatis-Plus、MySQL 8、`spring-security-crypto`（只要 BCrypt）、
  jjwt、`dypnsapi20170525`。
  ★ **不引 starter-security**：引了它默认那条过滤器链会把所有接口一起拦掉，
  而我们的鉴权是自己写的一层（一张 JWT + 一把 BFF 共享令牌）。
- `db/schema.sql`：`users` / `user_permissions` / `sms_send_log`。
  ★ 只写 **H2 与 MySQL 8 都认**的那一小块 SQL（不写 `ENGINE=`、不写表内 `KEY (...)`
  ——后者 H2 不认，而 `CREATE INDEX IF NOT EXISTS` MySQL 8 不认）。
  本地那一档（H2）与服务器那一档（MySQL）因此读的是同一个文件。
- `app.*` 配置全部从环境变量来（`AppProperties` record），仓库里只有字段名。
  `local` profile 用 H2 文件库（**文件不是内存**：重启之后数据还在，
  所以"登出 → 用密码登回来"那条路测得完）。
- `StartupChecks`：启动即失败的几条 —— JWT 密钥少于 32 字节、生产没给内部令牌、
  开了真短信却没给 AccessKey、管理员账号不合登录名形状。
- `InternalTokenFilter`：`X-Internal-Token`（常量时间比较），`/api/health` 豁免。
- `GET /api/health`：只回服务名与时间，不报版本、不报数据库、不报配置。

## 怎么算做完

- `mvn -q -DskipTests package` 通过（本机 Maven 走的是 JDK 17，与服务器一致）。
- `mvn spring-boot:run` 起得来，`curl 127.0.0.1:8080/api/health` 回 200。

## Comments

- 2026-10-16 实测：`mvn package` 首次成功（依赖大半在本地仓库里）；
  启动 7.7 秒；`/api/health` 回 `{"service":"xiaozhujue-api","time":"...+08:00"}`。
- ★ 时间一律 `LocalDateTime` + 出参补 `+08:00`（`Times.iso`）：不补的话，
  前端 `new Date()` 会按**浏览器所在时区**解释那个串，同一个"首次登录时间"
  在北京是对的、在别的时区就差几个小时。
