# Token Killer VPS 后端

这套配置让 VPS 上的 Node/SQLite 服务处理 `/api/*`，现有 Caddy 将其他请求反向代理到 GitHub Pages。

## 目录

- 应用：`/opt/token-killer`
- 环境变量：`/opt/token-killer/deploy/vps/.env`
- 排行榜密钥：`/opt/token-killer/secrets/leaderboard_hmac_secret`
- SQLite Docker volume：`token-killer-data`
- 数据库备份：`/opt/token-killer/backups`
- Caddy 配置：`/opt/cliproxyapi/caddy/Caddyfile`

## 常用命令

```bash
cd /opt/token-killer/deploy/vps
sudo docker compose -f compose.yml ps
sudo docker compose -f compose.yml logs --tail=100 token-killer-api
sudo docker compose -f compose.yml up -d --build token-killer-api
```

手动备份：

```bash
sudo docker exec token-killer-api node server/backup.js
```

恢复前先停止 API，把选定备份复制回 Docker volume 中的 `token-killer.sqlite`，确认文件所有者为容器内的 `node` 用户，再启动服务。不要在 API 正在写入时直接覆盖数据库文件。

## 更新

同步新的服务器端源码后重新构建容器。数据库迁移会在进程启动时按文件名顺序自动应用；`token_killer_migrations` 表记录已经执行的迁移。
