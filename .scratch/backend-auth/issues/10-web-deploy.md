# 10 —— 整个站上服务器（Nginx + Next 生产 + 数据目录分离）

`Status:` **open**

## 要做什么

```
公网 ──:80──> Nginx ──┬── /         ──> Next.js 生产 127.0.0.1:3000
                      └── /backend/  ──> Spring 127.0.0.1:8080（要 X-Internal-Token）
```

- 装 `node 24` + `pnpm`；`/opt/xiaozhujue/app/` 放源码与 `.next`。
  ★ **必须在服务器上构建**：本机没有 Docker，而 sharp 是原生模块，
  Windows 产物在 Linux 上跑不起来。
- ★ **加 2 GB swap**：`pnpm build` 与 sharp 现缩一张 3 MB PNG 都会冲一下内存，
  2C2G 不加 swap 会在某个不该的时刻 OOM。这是本节唯一不能省的一步。
- `ASSET_ROOT=/var/lib/xiaozhujue/assets`（**数据与代码分开**：
  部署时 `rsync --delete` 不许碰作品，合在一起手一抖就是一次真实的数据损失）。
- `/etc/xiaozhujue/web.env`（600）：全部密钥 + `BACKEND_URL=http://127.0.0.1` +
  `INTERNAL_TOKEN`，由 systemd 的 `EnvironmentFile` 挂进来。
- Nginx 四行必须写对：`client_max_body_size 24m`（录音克隆要传音频）、
  SSE 那条 `proxy_buffering off` + `proxy_read_timeout 900s`
  （默认 60 秒会在第 1 页就掐断整本生成）。
- `scripts/deploy-web.sh`：`rsync` 源码（排除 node_modules/.next/.out/.git/.next*）
  → `pnpm install --frozen-lockfile` → `pnpm build` → `systemctl restart xiaozhujue-web`。
- 一次性：把本机 `.out/web`（66 MB）搬到 `/var/lib/xiaozhujue/assets/`。
- 本机 `.env.local` 加 `BACKEND_URL=http://123.56.148.105/backend` +
  `INTERNAL_TOKEN`（本地开发时 Next 打的是 Nginx 那条内部通路，不必再起一个 Java）。

## 怎么算做完

- **从另一台机器**（手机）打开 `http://123.56.148.105`：首页出得来、能登录、
  能看到已有的书与角色卡。★ 这是本轮的总判据。
- 线上生成一本新书：`/var/lib/xiaozhujue/assets/books/<id>/` 里出现 `page-*.png`，
  换一台设备打开仍能看（含缩略图）。
- `systemctl status xiaozhujue-web` / `xiaozhujue-api` 都是 active；
  服务器重启之后两个都自己回来。
