# 部署自己的 Token Killer

简体中文 | [English](deployment.md)

Token Killer 可以只部署前端，也可以连同排行榜和订阅 OAuth 服务一起部署。先选一条适合自己的路线：

| 路线 | 得到什么 | 适合谁 |
| --- | --- | --- |
| GitHub Pages | 静态前端、本机统计、API Key 模式 | 只想先跑起来的人 |
| Cloudflare Worker + D1 | 前端、排行榜、地区排名、订阅 OAuth | 想运营完整实例的人 |

如果你拿不准，先从 GitHub Pages 开始。后面补 Worker 不需要重做前端。

## 路线一：部署静态前端

### 1. Fork 仓库

登录 GitHub 后，打开 [PYXXXX/token-killer](https://github.com/PYXXXX/token-killer)，点击右上角的 **Fork**。

你也可以直接打开 [Fork 页面](https://github.com/PYXXXX/token-killer/fork)。仓库名称可以继续使用 `token-killer`，也可以改成自己喜欢的名字；前端使用相对资源路径，改名不会影响 Pages 构建。

### 2. 启用 GitHub Actions

进入你 Fork 后的仓库，打开 **Actions**。如果页面提示 Fork 中的工作流尚未启用，点击 **I understand my workflows, go ahead and enable them**。

如果组织策略限制了 Actions，请进入 **Settings → Actions → General**，确认仓库允许运行 GitHub 官方 Actions。

### 3. 打开 GitHub Pages

进入 **Settings → Pages**，在 **Build and deployment** 中把 **Source** 设为 **GitHub Actions**。

仓库已经包含 [`.github/workflows/deploy-pages.yml`](../.github/workflows/deploy-pages.yml)，不需要自己新建工作流。

### 4. 运行第一次部署

打开 **Actions → Deploy to GitHub Pages**，点击 **Run workflow**，选择 `main` 分支后开始运行。

工作流中的 `build` 和 `deploy` 都变成绿色后，访问地址会显示在任务摘要和 **Settings → Pages** 中。通常是：

```text
https://你的用户名.github.io/仓库名/
```

### 5. 以后如何更新

你向 `main` 分支推送新提交后，Pages 会自动重新构建和发布。

如果只在 GitHub 网页上改文件，提交到 `main` 即可。使用本地 Git 时：

```bash
git add .
git commit -m "写清楚这次改了什么"
git push origin main
```

### 6. 从上游同步更新

原项目发布新版本后，可以在 Fork 的仓库首页点击 **Sync fork → Update branch**。

使用 GitHub CLI 也可以同步：

```bash
gh repo sync 你的用户名/token-killer -b main
```

同步会触发一次新的 Pages 部署。如果你的 Fork 已经修改过相同文件，GitHub 可能会要求你先解决冲突。

## 路线二：部署完整服务

完整服务会把前端、API、排行榜、地区识别和订阅 OAuth 一起部署到 Cloudflare。排行榜使用 D1；访问地区来自 Cloudflare 提供的请求信息，数据库不会保存原始 IP。

### 1. 准备环境

你需要：

- Node.js 22 或更新版本；
- 一个 Cloudflare 账号；
- 已 Fork 或 Clone 的 Token Killer 仓库。

安装依赖并登录 Cloudflare：

```bash
npm install
npx wrangler login
```

### 2. 创建 D1 数据库

```bash
npx wrangler d1 create token-killer
```

命令会返回一个 `database_id`。打开 [`wrangler.jsonc`](../wrangler.jsonc)，把：

```jsonc
"database_id": "REPLACE_WITH_YOUR_D1_DATABASE_ID"
```

替换成刚才得到的 ID。你也可以同时修改顶层的 `name`，它将成为 Worker 名称的一部分。

### 3. 配置允许访问的前端

如果前端和 Worker 部署在同一个域名，可以让 `ALLOWED_ORIGINS` 保持为空。

如果前端放在 GitHub Pages、API 放在 Worker，需要在 [`wrangler.jsonc`](../wrangler.jsonc) 中填写前端的 Origin。这里不要包含仓库路径，也不要在末尾加 `/`：

```jsonc
"vars": {
  "ALLOWED_ORIGINS": "https://你的用户名.github.io"
}
```

允许多个站点时使用英文逗号分隔：

```jsonc
"ALLOWED_ORIGINS": "https://a.example.com,https://b.example.com"
```

### 4. 配置排行榜签名密钥

运行：

```bash
npx wrangler secret put LEADERBOARD_HMAC_SECRET
```

按照提示输入至少 32 个随机字符。可以用下面的命令生成一份：

```bash
openssl rand -hex 32
```

不要把这个值写进 `wrangler.jsonc`、README、Issue 或 Git 历史。

### 5. 初始化数据库

```bash
npm run db:migrate:remote
```

Wrangler 会询问是否应用 `migrations/` 中的迁移，确认后继续。

排行榜编号由 D1 唯一签发。已经部署过旧版本时也需要重新执行这条命令，以应用 `0005_leaderboard_profiles.sql`；迁移会尽量保留现有编号，撞号的参与者会在下次连接时由服务端重新分配。

### 6. 配置 Gemini OAuth（可选）

ChatGPT、Claude 和 Grok 的现有授权流程不要求你额外保存客户端密钥。Gemini 需要你准备自己的 Google OAuth Client ID 与 Client Secret。

在 Google Cloud Console 创建 OAuth 客户端，并把下面的地址加入授权回调地址：

```text
https://codeassist.google.com/authcode
```

随后分别保存两个 Secret：

```bash
npx wrangler secret put GEMINI_OAUTH_CLIENT_ID
npx wrangler secret put GEMINI_OAUTH_CLIENT_SECRET
```

不配置这两个值不会影响 API Key、排行榜和其他订阅入口，但 Gemini 登录会不可用。

### 7. 构建并部署

```bash
npm run deploy:cloudflare
```

部署结束后，Wrangler 会显示一个 `workers.dev` 地址。打开下面的接口确认服务已经启动：

```text
https://你的-worker.workers.dev/api/health
```

健康检查中的 `ok` 为 `true`，表示 D1 和排行榜签名密钥已经就绪。

### 8. 让 GitHub Pages 使用你的 Worker

如果你直接访问 Worker 地址，前端与 API 同域，不需要额外填写服务地址。

如果你继续使用 GitHub Pages 前端，请打开 Token Killer 的 **配置** 面板：

1. 在“OAuth 授权服务”中填写完整 Worker 地址；
2. 在“排行榜服务地址”中填写同一个 Worker 地址；
3. 地址末尾不要填写 `/api`，也不要填写具体接口路径。

示例：

```text
https://token-killer.你的账号.workers.dev
```

填写 OAuth 授权服务后，先点击“检测服务”。只有 Worker 健康检查通过，并且返回对应平台可用时，ChatGPT、Claude、Gemini、Grok 的登录按钮才会启用。未配置 Gemini Client ID 与 Client Secret 时，其他入口仍可使用，Gemini 按钮会保持不可用。

## 可选：优先识别大陆直连地区

中国大陆用户经常使用规则代理：访问海外地址时走代理，访问大陆地址时保持直连。如果排行榜部署在境外，它看到的可能是代理出口，而不是用户实际所在的大陆省市。

Token Killer 可以先向一个大陆可直连地址申请短时签名地区凭证，再访问排行榜。只有签名有效且国家为 `CN` 的凭证才会优先使用；探测超时、返回非大陆、签名无效时都会静默回退到排行榜边缘节点的定位。香港特别行政区、澳门特别行政区和台湾省仍归入“中国”目录下的省级地区，不会被当作“大陆直连”结果。

这个接口完全可选，只用于排行榜地区识别。它不会收到 API Key、OAuth 凭据、安装编号、Prompt、模型响应或任何推理请求。

### 1. 在大陆可直连的 HTTPS 域名部署探测服务

仓库内的 Worker/Node API 已提供 `POST /api/geo/assertion`。要利用规则代理的分流特性，这个域名必须能被用户直接访问；如果它与境外排行榜走完全相同的网络路径，就无法改善定位结果。

探测服务需要可信的国家、省和城市信息。Cloudflare 会通过 `request.cf` 提供；自托管 Node 服务也可以接收可信 CDN、负载均衡器或带 GeoIP 能力的反向代理注入的 Header。此时设置：

```env
TRUST_GEO_HEADERS=true
```

并由反向代理写入：

```text
X-Geo-Country: CN
X-Geo-Region-Code: ZJ
X-Geo-Region: Zhejiang
X-Geo-City: Hangzhou
```

如果服务直接从公网接受这些 Header，绝对不要开启 `TRUST_GEO_HEADERS`。可信反向代理必须先删除访客自行携带的 `X-Geo-*` 和 `CF-IPCountry`，再写入经过识别的值。只有国家信息时仍可匹配中国全国榜；省市榜需要相应字段。

### 2. 在探测服务和排行榜之间共享专用签名密钥

两端配置同一个密钥：

```bash
npx wrangler secret put GEO_ASSERTION_HMAC_SECRET
```

使用 VPS 部署时，把密钥放在 `/opt/token-killer/secrets/geo_assertion_hmac_secret`，并使用示例中的 `GEO_ASSERTION_HMAC_SECRET_FILE`。密钥至少 32 个随机字符，只能留在服务端，不能写成前端可见的 `VITE_*` 变量。单体部署会在未配置时回退使用 `LEADERBOARD_HMAC_SECRET`，但分离部署更建议使用独立密钥。

探测服务的 `ALLOWED_ORIGINS` 还需要包含前端 Origin。GitHub Pages 使用 HTTPS，因此探测地址也必须是 HTTPS，否则浏览器会按混合内容拦截。

### 3. 让前端使用探测服务

用户可以在 **配置 → 大陆地区探测地址** 中填写探测服务的基础地址。若希望自己的 GitHub Pages Fork 默认使用该地址，进入仓库 **Settings → Secrets and variables → Actions → Variables**，添加：

```text
VITE_MAINLAND_GEO_API_URL=https://geo.example.cn
```

随后推送到 `main`，或重新运行 **Deploy to GitHub Pages**。工作流只会把这个公开 URL 注入前端构建，签名密钥绝不会进入前端。自行本地构建或部署 Cloudflare 时，也可以在构建前设置 `VITE_MAINLAND_GEO_API_URL`。

地区凭证十分钟后失效，并会在浏览器中短暂缓存。凭证只含规范化后的地区、时间和随机 nonce，不含原始 IP；但探测服务的网络基础设施在响应请求时必然能够看到来源 IP，请按自己的隐私策略审查或关闭访问日志。

## Provider 停用与部署的关系

Provider 黑名单保存在访问者自己的浏览器中，不需要 D1，也不依赖排行榜服务。静态 GitHub Pages 和完整 Worker 部署都会使用相同的本地停用逻辑。

当服务端通过约定错误码明确拒绝带有 `[token-killer]` 标记的推理请求时，前端会立即停止当前运行，并在后续请求发送前拦截该 Provider。用户可以在 **配置 → 已屏蔽的 Provider** 中查看原因和地址，或手动解除。

如果你同时运营模型中转服务，并希望拒绝 Token Killer 流量，请参阅[如何识别并屏蔽来自 Token Killer 的请求](provider-blocking.zh-CN.md)。不要仅凭普通 `403`、`429` 或 `500` 响应判断客户端已被屏蔽。

## 本地测试完整服务

复制示例环境变量：

```bash
cp .dev.vars.example .dev.vars
```

编辑 `.dev.vars`，至少替换 `LEADERBOARD_HMAC_SECRET`。需要 Gemini 登录时再填写对应的 Client ID 和 Client Secret。

初始化本地 D1 并启动：

```bash
npm run db:migrate:local
npm run dev:cloudflare
```

`.dev.vars` 已被 Git 忽略，不要用 `git add -f` 强行提交。

## 上线前检查

- `ALLOWED_ORIGINS` 只包含你真正运营的前端域名；
- D1 的 `database_id` 指向你自己的数据库；
- 所有 Secret 都通过 Wrangler 或 Cloudflare 控制台保存；
- 仓库中没有 `.dev.vars`、`.env`、API Key、OAuth Token 或用户数据；
- `npm run lint` 与 `npm run build` 均能通过；
- `npm test` 能通过；
- `/api/health` 可以访问，排行榜提交和读取都经过一次实际测试；
- 配置页“检测服务”能够正确启用实际可用的 OAuth 平台；
- 已经阅读所接入模型供应商的服务条款。

## 相关文档

- [GitHub：配置 Pages 发布来源](https://docs.github.com/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [GitHub：同步 Fork](https://docs.github.com/pull-requests/collaborating-with-pull-requests/working-with-forks/syncing-a-fork)
- [Cloudflare：D1 Wrangler 命令](https://developers.cloudflare.com/d1/wrangler-commands/)
- [Cloudflare：Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
