# API 参考

[English](api.md)

Token Killer 自己提供的 HTTP 接口全部统一在 `/api` 下。使用 API Key 模式时，浏览器仍然可以直接请求模型供应商；这些由用户填写的供应商地址不属于 Token Killer 服务 API，也不会被改写。

前端既接受 `https://burn.example.com` 这样的服务 Origin，也接受 `https://burn.example.com/api` 这样的显式 API 基地址。实际请求会自动拼接规范路由，不会重复添加 `/api`。

## 服务状态与地区

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/health` | 返回服务、存储、地区凭证与订阅 OAuth 的可用状态。 |
| `POST` | `/api/geo/assertion` | 按服务观察到的网络出口地区签发短时凭证。 |

`/api/geo/assertion` 是唯一正式地区接口。原先位于根路径的 `/geo` 别名不再提供；浏览器以前保存的旧地址会由前端自动迁移。

## 排行榜

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET`、`POST` | `/api/leaderboard` | 读取一页排行榜。前端使用 `POST`，从而不必把安装编号与地区凭证写入查询字符串。 |
| `POST` | `/api/leaderboard/profile` | 获取当前参与者编号、名次、段位、赛区与已保存的成就信息。 |
| `POST` | `/api/leaderboard/sessions` | 在消耗任务开始前创建带签名的提交会话。 |
| `POST` | `/api/leaderboard/runs` | 把已经完成并核验 usage 的运行提交到排行榜。 |

排行榜只接收用于汇总的数据，不会接收 API Key、OAuth 凭据、Prompt、模型响应或浏览器内的 Provider 黑名单。

成就由排行榜服务根据已经接收的 usage 回执计算，浏览器不能直接提交“已解锁”状态。参与者资料会返回成就 ID、解锁时间和汇总进度，不包含任何请求正文。服务暂时不可用时，前端仍可根据本地运行记录显示临时进度；重新连接后会与云端资料合并。

## 订阅 OAuth

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/oauth/openai/device/start` | 开始 ChatGPT/OpenAI 设备授权。 |
| `POST` | `/api/oauth/openai/device/poll` | 轮询设备授权结果。 |
| `POST` | `/api/oauth/openai/refresh` | 刷新 OpenAI 订阅凭据。 |
| `POST` | `/api/oauth/claude/exchange` | 交换 Claude 授权码。 |
| `POST` | `/api/oauth/claude/refresh` | 刷新 Claude 订阅凭据。 |
| `GET` | `/api/oauth/gemini/config` | 返回可公开的 Gemini OAuth 客户端配置。 |
| `POST` | `/api/oauth/gemini/exchange` | 交换 Gemini 授权码。 |
| `POST` | `/api/oauth/gemini/refresh` | 刷新 Gemini 订阅凭据。 |
| `POST` | `/api/oauth/grok/exchange` | 交换 Grok 授权码。 |
| `POST` | `/api/oauth/grok/refresh` | 刷新 Grok 订阅凭据。 |

请求之间，OAuth Secret 与 Refresh Token 仍由用户浏览器加密保存；进行交换或刷新时，配置的 Worker/VPS 必然会在请求期间处理相应凭据。

## 订阅模型转发

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/subscription/openai/responses` | 转发 OpenAI 订阅模型请求。 |
| `POST` | `/api/subscription/claude/messages` | 转发 Claude 订阅模型请求。 |
| `POST` | `/api/subscription/gemini/generate` | 转发 Gemini 订阅模型请求。 |
| `POST` | `/api/subscription/grok/responses` | 转发 Grok 订阅模型请求。 |

受当前上游协议限制，消费版订阅模型无法完全由静态前端调用，因此这些请求会经过配置的 Worker/VPS。API Key 模式在供应商允许 CORS 时仍由浏览器直接请求供应商。

## 响应约定

- JSON 响应使用 `Content-Type: application/json`。
- 项目 API 响应使用 `Cache-Control: no-store`。
- 配置 `ALLOWED_ORIGINS` 后，CORS 会限制为指定来源。
- 错误使用非 2xx 状态，并返回 JSON `error` 字段或对象。
- Provider 明确拒绝 Token Killer 标记时，结构化错误码会被保留，以便浏览器停止运行并更新本地 Provider 黑名单。

正式路由定义集中在 [`src/lib/apiRoutes.js`](../src/lib/apiRoutes.js)，由前端、Worker 与 Node 服务共同使用。
