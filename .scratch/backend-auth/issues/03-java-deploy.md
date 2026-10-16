# 03 —— Java 上服务器（JDK + MySQL + systemd）

`Status:` **open**（等用户给一次 ssh 密码）

## 要做什么

在 `123.56.148.105`（Ubuntu 24.04 / 2C2G / 40G ESSD）上把这台机器安排好：

1. 装 `openjdk-17-jre-headless` + `mysql-server` 8；建库 `xiaozhujue`
   （`CREATE DATABASE ... DEFAULT CHARACTER SET utf8mb4`）与账号 `xzj@localhost`。
2. 目录：`/opt/xiaozhujue/server/`（jar）、`/etc/xiaozhujue/api.yml`（600：库口令、
   JWT 密钥、阿里云四项）、`/var/lib/xiaozhujue/`（作品，见工单 10）。
3. `systemd` unit：`SPRING_PROFILES_ACTIVE=prod`、`-Xmx320m`、`Restart=always`、
   只监听 127.0.0.1:8080。
4. ★ **收紧安全组**：现在 22/80/443/8080/3306 都是通的（实测）。
   3306 与 8080 从公网拿掉，MySQL 与 Java 都只听回环，对外只留 80（Nginx）。
5. `server/deploy.sh`：`mvn package` → `scp` jar → `systemctl restart xiaozhujue-api`
   → `curl /api/health` 冒烟。

## 怎么算做完

- `ssh root@123.56.148.105 'systemctl status xiaozhujue-api'` 是 active。
- 从服务器上 `curl 127.0.0.1:8080/api/health` 回 200。
- 从**本机** `curl 123.56.148.105:8080/api/health` **连不上**（只剩 Nginx 那条内部通路）。
- 管理员账号建出来（库里有、`role=ADMIN`）。

## Comments

- 首次 `ssh` 那一下的密码只能人来输（本机没有 sshpass，我这边无法非交互输密码）：
  在终端里输一次，然后 `ssh-copy-id` 装公钥，之后全程免密。
