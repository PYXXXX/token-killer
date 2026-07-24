# Token Killer

简体中文 | [English](README.md)

> Token 用不完？那就浪费掉！
>
> Token 用不好？不如浪费掉！

Token Killer 是一个纯前端实现的 Token 消耗器：填入接口、模型和目标额度，它会持续发起请求，并把这些毫无意义的 Token 消耗认真记录下来。

[在线体验](https://burn.bilirec.com) · [部署自己的 Token Killer](docs/deployment.zh-CN.md)

## 为什么会有这个项目

随着 vibe coding 流行起来，越来越多人开始把 Token 消耗量和开发实力画上等号。这显然不可取。

在 Token Killer，Token 消耗量只与你的财力有关。💰💰💰

通过内置的排行榜与段位系统，你可以轻松和全世界的开发者比拼，看看谁才是 Token 消耗王。👑

排行榜默认接入作者维护的服务。你也可以按照[部署指南](docs/deployment.zh-CN.md)搭建一套完全属于自己的排行榜。

## 它能做什么

- 支持 OpenAI Responses、Chat Completions、旧版 Completions、Anthropic Messages 和 Gemini `generateContent` 等常见请求格式。
- 可以从你填写的 API 地址刷新模型列表，并参考 OpenRouter 目录估算价格。
- 支持按 Token 数量或金额设定目标，并在每轮收到 `usage` 后重新计算剩余预算。
- 支持轮次间安全暂停、后台标签页保护、请求超时和可选运行限制；无法确认结果的请求不会自动重试。
- 记录每日与累计消耗、费用、轮数和运行历史。
- 每次运行都会保存匹配到的 OpenRouter 模型、单价和目录更新时间，方便追溯历史费用估算。
- 生成分享卡、计算段位，并参与全球、国家及地区排行榜。
- 提供自然的英文与简体中文界面，并配有对应语言的项目文档。
- API Key 和 OAuth 凭据使用浏览器生成的密钥加密保存。
- 可以只部署静态前端，也可以搭配 Cloudflare Workers 等 Serverless 服务使用排行榜、地区排名和订阅 OAuth。

## 订阅额度用不完？小问题

如果你觉得每月交给 ChatGPT、Claude、Gemini 或 Grok 的订阅费还没有值回票价，Token Killer 也准备了 OAuth 登录入口，让你把自己的付费订阅接进来，榨干每一分价值。

OAuth 功能需要先部署授权服务。项目内置的实现以 Cloudflare Workers 为例；未配置服务地址或服务检测失败时，登录按钮会保持不可用。具体步骤见[完整服务部署](docs/deployment.zh-CN.md#路线二部署完整服务)。

这部分的授权参数、刷新流程和上游兼容方式参考了 [Wei-Shaw/sub2api](https://github.com/Wei-Shaw/sub2api)，感谢。

> [!WARNING]
> 高频、自动化或异常调用可能触发服务商的限流、风控、订阅限制甚至封号。使用前请自行阅读并遵守对应平台的服务条款；本项目及项目部署者不对账号或订阅损失负责。

OAuth 凭据保存在用户自己的浏览器中。订阅请求需要经过你配置的 Worker 完成授权交换与转发，运行期间 Worker 会在内存中接触凭据与 Prompt，但不会把账号凭据写入排行榜数据库。Gemini OAuth 还需要配置自己的 Client ID 和 Client Secret。

## 如何主动防止滥用

如果你不希望自己的服务被人通过 Token Killer 消耗，Token Killer 会在请求中附加可识别标记。服务端可以主动拒绝这类请求，并返回约定的错误码；客户端收到拒绝后，会在当前浏览器中停用对应的 Provider。

[如何识别并屏蔽来自 Token Killer 的请求？](docs/provider-blocking.zh-CN.md) 给出了请求标记、拒绝响应和反向代理配置示例，并以 [QuantumNous/new-api](https://github.com/QuantumNous/new-api) 与 [Wei-Shaw/sub2api](https://github.com/Wei-Shaw/sub2api) 的常见 Docker 部署方式为例。

这套标记是给愿意主动表明身份的客户端准备的，不应替代服务端原有的身份验证、额度限制、速率限制和滥用检测。

## 搭建自己的 Token Killer

最简单的方法是 [Fork 本仓库](https://github.com/PYXXXX/token-killer/fork)。仓库已经准备好 GitHub Pages 工作流，开启 Actions 与 Pages 后，就会得到一个属于你的静态站点。

如果还需要自己的排行榜、地区排名和订阅 OAuth 服务，可以继续部署仓库内的 Cloudflare Worker 与 D1 数据库。两种路线都写在[部署指南](docs/deployment.zh-CN.md)里。

| 部署方式 | 包含功能 | 适合场景 |
| --- | --- | --- |
| GitHub Pages | API Key 模式、浏览器统计、段位和分享卡 | 想快速搭建静态站点 |
| Cloudflare Workers + D1 | 静态前端的全部功能，以及排行榜、地区排名和订阅 OAuth | 想运营完整实例 |

GitHub Pages 工作流位于 [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml)。完成第一次配置后，每次向 `main` 推送提交都会自动更新站点。

## 用前须知

### Token 目标仅供参考

请求发出前，任何客户端都无法准确预知最终计费 Token。输入分词、隐藏推理、缓存计费和上游实现都会影响结果。

Token Killer 会顺序执行请求，按照每轮返回的 `usage` 重新校准剩余预算，并在接近目标时缩小下一轮输出上限。它可以避免明显会越界的下一轮，但不会假装自己一定能命中最后 1 Token 或最后 1 美分。

### CORS 跨域问题

纯前端模式要求目标 API 允许浏览器跨域请求。若服务端没有正确配置 CORS，即使地址和 API Key 都正确，浏览器也可能拒绝请求。

### 凭据与隐私

API Key 与 OAuth 凭据由浏览器生成的不可导出 AES-GCM 密钥加密保存。不要在 Issue、截图、终端输出或公开日志中粘贴 API Key、授权码、Access Token、Refresh Token、账号 ID 或完整 Prompt。

排行榜使用随机生成的编号识别参与者，不提供自定义昵称。默认开启的自动赛区选择会先使用 `/geo` 服务签发的网络出口地区凭证，失败后再回退到排行榜边缘节点；用户也可以关闭自动选择，手动指定国家、一级行政区和城市。所有国家在能够取得相应字段时都支持地区与城市排行榜；香港特别行政区、澳门特别行政区和台湾省仍归入“中国”目录，其中台湾省支持城市排行榜，香港和澳门仅支持省级排行。应用与排行榜数据库都不会保存原始 IP。

### 项目关系

Token Killer 是非官方开源项目，与 OpenAI、Anthropic、Google、xAI、OpenRouter 及其他模型或中转服务提供方不存在隶属或背书关系。相关名称仅用于说明兼容性。

## 本地运行

需要 Node.js 22 或更新版本。

```bash
git clone https://github.com/PYXXXX/token-killer.git
cd token-killer
npm install
npm run dev
```

提交改动前，建议跑一遍：

```bash
npm run lint
npm run build
```

## 一起完善

欢迎提交 [Issue](https://github.com/PYXXXX/token-killer/issues) 或 Pull Request。提交前，请先阅读[贡献说明](CONTRIBUTING.zh-CN.md)。

发现凭据泄露、排行榜校验绕过或其他安全问题时，请不要公开披露，按照[安全说明](SECURITY.zh-CN.md)使用 GitHub 的私密漏洞报告入口。

## 社区支持

[LINUX DO](https://linux.do/)


## 致谢

- [Wei-Shaw/sub2api](https://github.com/Wei-Shaw/sub2api)：消费版 OAuth 与上游兼容流程的主要参考。
- [OpenRouter Models API](https://openrouter.ai/docs/api/api-reference/models/get-models)：模型目录与价格数据来源。
- [Countries States Cities Database](https://github.com/dr5hn/countries-states-cities-database)（ODbL 1.0）与 [province-city-china](https://github.com/uiwjs/province-city-china)（MIT）：静态地区与城市选择目录。
- [Cloudflare Workers 与 D1](https://developers.cloudflare.com/)：可选的 OAuth、排行榜与地区服务运行环境。

## License

[GNU LGPL v3](LICENSE)。如果你准备把 Token Killer 用于公开服务，也请一并检查所接入模型供应商与上游项目的许可证和服务条款。
