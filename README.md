# Token Killer

把用不完的 AI Token 烧掉，也把这件事认真记下来。

Token Killer 是一个浏览器优先的 Token 消耗与统计工具。你可以连接兼容 API，设定 Token 或金额目标，让请求按轮次运行；结束后再看看今天到底烧掉了多少、花了多少钱，以及自己处在什么段位。

项目还在施工中。现在公开出来，是因为它已经足够好玩，也希望有人一起把边角磨得更舒服。

## 现在能做什么

- 支持 OpenAI Responses、Chat Completions、旧版 Completions、Anthropic Messages 和 Gemini `generateContent`。
- 可从当前 API 地址刷新模型列表，并用 OpenRouter 目录估算价格。
- 按 Token 或金额设定目标，顺序请求并根据每轮 `usage` 收缩后续预算。
- API Key 和 OAuth 凭据使用浏览器生成的不可导出 AES-GCM 密钥加密保存。
- 记录每日与累计消耗，生成分享卡，并提供一套带小段位和无限星级的排位系统。
- 带有可选的 Cloudflare Worker：用于消费版账号 OAuth、排行榜和地区排名。

## 先跑起来

需要 Node.js 22 或更新版本。

```bash
npm install
npm run dev
```

然后打开终端里显示的本地地址。生产构建可以这样检查：

```bash
npm run lint
npm run build
```

## 部署到 GitHub Pages

仓库已经带有 [Pages 工作流](.github/workflows/deploy-pages.yml)。第一次部署只需要：

1. 打开仓库的 **Settings → Pages**。
2. 在 **Build and deployment** 的 Source 中选择 **GitHub Actions**。
3. 回到 **Actions**，打开 `Deploy to GitHub Pages`，点击 **Run workflow**。
4. 等两个任务都变成绿色，Pages 页面会显示访问地址。

之后每次推送到 `main`，前端都会自动重新部署。

GitHub Pages 只托管静态前端。API Key 模式可以直接使用，但前提是目标接口允许浏览器跨域请求。消费版账号登录和全网排行榜仍需要单独部署 Cloudflare Worker；不配置 Worker 不影响前端界面和本机统计。

## 关于 Token 精度

请求发出前，没有办法跨供应商预知最终计费 Token。输入分词、隐藏推理、缓存计费和上游实现都会影响结果。

Token Killer 会顺序执行请求，预留下一轮输入预算，收到真实 `usage` 后重新校准，并在接近目标时缩小输出上限。它能避免明显会越界的下一轮，但不会假装自己可以保证最后 1 Token 或最后 1 美分绝对命中。

## 凭据与隐私

普通 API Key 由浏览器直接发给你填写的 API 地址。消费版 OAuth 凭据也保存在本机；使用订阅模式时，无状态 Worker 会在请求期间接触凭据和 Prompt，但不会把账号凭据写入 D1、KV 或 R2。

排行榜只需要汇总数据，不需要昵称。请不要在 Issue、截图或日志中提交 API Key、授权码、Token、账号 ID 或完整 Prompt。

## Cloudflare Worker（可选）

Worker 和 D1 配置已经保留在仓库里，但排行榜数据库会在前端部署稳定后继续整理。想本地调试完整版本，可以先阅读 [`wrangler.jsonc`](wrangler.jsonc) 和 [`migrations/`](migrations/)；不要直接把示例 secret 用在生产环境。

Gemini OAuth 的 Client ID 与 Client Secret 不放在源码中。本地调试时写入 `.dev.vars`；部署 Worker 时分别用 `wrangler secret put GEMINI_OAUTH_CLIENT_ID` 和 `wrangler secret put GEMINI_OAUTH_CLIENT_SECRET` 保存。

## 致谢

消费版 OAuth 参数、刷新流程和上游兼容性参考了 [Wei-Shaw/sub2api](https://github.com/Wei-Shaw/sub2api)。这里没有把 Sub2API 当作外部服务，而是用前端与 Worker 代码重新实现所需流程。

也感谢 [OpenRouter Models API](https://openrouter.ai/docs/api/api-reference/models/get-models) 和 [Cloudflare D1](https://developers.cloudflare.com/d1/) 提供公开文档。

## License

[GNU LGPL v3](LICENSE)。如果你准备把它用于公开服务，也请一并检查所接入供应商的服务条款。
