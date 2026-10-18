# 01 · 库与 Java：四项开关收成一列 `allowed`

Status: done

## 做什么

- `schema.sql`：`user_permissions` 收成一列 `allowed TINYINT NOT NULL DEFAULT 1`；
  `permission_requests` 建表语句删掉；文件头"六张表"改"五张"。
- `SchemaUpgrades`：`ADDED_COLUMNS` 加 `user_permissions.allowed TINYINT NOT NULL DEFAULT 1`；
  **表不在就跳过**（与 `DATA_FIXES` 同一条纪律）。
- `UserPermission`：四列 → `allowed`，`allowedFor` / `of`；删 `noneFor` / `allFor` / `toPermissions`。
- 删 `Permissions.java`（没有调用方了）。
- `AuthService.allowedOf`（缺行 = 给上）、建号 `allowedFor`；`UserView.permissions` → `allowed`；
  `AccountSeeder` 跟着改。
- `AdminService`：`overview` 缺行 = 给上、`setAllowed`、建号给上、`deleteUser` 去掉申请级联；
  `AdminUserRow.permissions` → `allowed`；`PermissionPatch` 收成 `allowed`。
- 删 Java 那边的 `PermissionRequest*`（含 controller / mapper / service / DTO）与
  `AdminController` 里那两条端点。

## 判据

- `mvn -o -f server/pom.xml test` 全绿；`SchemaUpgradesTest` 里"老行 = 1"那一条是新的。
- 本地后端重启时日志里出现「给已有的表补了一列：user_permissions.allowed」。

## Comments

- 2026-10-18 完成。`mvn -o -f server/pom.xml test` → `Tests run: 77, Failures: 0, Errors: 0` /
  `BUILD SUCCESS`（删掉的那组申请测试原是 9 条，改动前后都全绿）。
- **真库上量到的**（`server/run-local.cmd` 起的 8080，重启日志第 54 行就是那句补列告警）：
  用 H2 自己的 Shell 连 `server/.local-db/xiaozhujue`（`AUTO_SERVER=TRUE`，所以后端跑着也连得上）——

  ```sql
  SELECT COUNT(*) AS 总数, SUM(allowed) AS 有权限 FROM user_permissions;   -- 12 | 12
  ```

  12 个账号**一个不缺地**都成了「有权限」，截图里那两个当初四个开关全关的号
  （`13900000202` / `13941721473`）现在也是 `allowed = 1`。这就是"老账号自动给上"。

- 迁移的形状也量了：`user_permissions` 的列现在是
  `user_id / can_text / can_image / can_vision / can_speech / updated_at / allowed`——
  `allowed` 是**追加**上去的，原来那四列一个都没被碰（`SchemaUpgrades` 只加不删）。
  `permission_requests` 表也仍在（这张本地库上是 0 行），没有代码再读写它。
- 一处计划外但必须处理的连带：`SchemaUpgrades` 加列时原来不检查表在不在，
  而 `SchemaUpgradesTest` 那份"只有 users 表"的老库会炸在
  `Table "user_permissions" not found`。补了 `tableExists` 跳过，理由与 `DATA_FIXES` 同一条。
- 另：`VoiceIntegrationTest` 里三处注释引用了被删掉的 `PermissionRequestIntegrationTest`
  （其中一处正是"请求体要发 UTF-8 字节"那段理由）。理由搬到 `send` 的 javadoc 上——
  那个测试是现在**唯一**还用这个写法的读者，注释跟着读者走。
