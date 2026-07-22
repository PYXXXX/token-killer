# 如何识别并屏蔽来自 Token Killer 的请求

简体中文 | [English](provider-blocking.md)

这份文档写给中转站、公益站和 API 网关运营者。

Token Killer 会主动在模型推理请求里留下固定标记。运营者可以在请求进入上游模型前识别这个标记并明确拒绝；客户端确认拒绝原因后，会停止当前任务，并在当前浏览器中停用对应的 Provider。

## 请求标记

唯一标记是：

```text
[token-killer]
```

它会出现在最后一条 `user` 文本的最末尾，完整形式为：

```text
原始用户文本

[token-killer]
```

标记后面没有其他字符或空白。空的用户文本会直接变成 `[token-killer]`，已经带标记的请求不会重复追加。

Token Killer 不会为此修改 `User-Agent`、`Originator` 或其他现有 Header，也不会把标记放进 system prompt。因此，服务端应检查用户输入内容，不要依赖自定义 Header。

## 各请求格式中的位置

| 请求格式 | 标记所在位置 |
| --- | --- |
| OpenAI Chat Completions | 最后一条 `user` message 的 `content` |
| OpenAI Responses | 最后一条 `user` input 中最后一个 `input_text.text` |
| OpenAI legacy Completions | 最终 `prompt` 的末尾 |
| Anthropic Messages | 最后一条 `user` message 的文本内容 |
| Gemini `generateContent` / `streamGenerateContent` | 最后一条 `user` content 中最后一个文本 part |
| ChatGPT、Claude、Gemini、Grok 订阅代理 | Worker 转换后的上游用户文本末尾 |

OpenAI Chat Completions 示例：

```json
{
  "model": "example-model",
  "messages": [
    {
      "role": "user",
      "content": "继续输出无意义内容。\n\n[token-killer]"
    }
  ]
}
```

OpenAI Responses 示例：

```json
{
  "model": "example-model",
  "input": [
    {
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "继续输出无意义内容。\n\n[token-killer]"
        }
      ]
    }
  ]
}
```

模型目录、OAuth、排行榜和健康检查等非推理请求不会携带这个标记。

## 返回怎样的拒绝响应

Token Killer 只根据结构化错误码确认运营者明确拒绝了标记请求。当前识别：

- `sensitive_words_detected`
- `content_policy_violation`

错误码可以位于：

- `error.code`
- `code`
- `error.type`
- `type`

推荐返回：

```json
{
  "error": {
    "code": "content_policy_violation",
    "type": "invalid_request_error",
    "message": "This provider does not accept Token Killer traffic."
  }
}
```

HTTP 状态码可以沿用网关自己的内容审核状态。客户端不会只凭 HTTP 状态判断停用，因此即使网关返回 `500`，只要结构化错误码正确，仍能识别为明确拒绝。

普通的 `401`、`403`、`404`、`429`、`500`、网络错误、CORS 错误、超时、余额不足或模型不可用都不会触发 Provider 停用。不要只返回包含“敏感词”“policy”或“forbidden”的模糊消息，这类文本不会被当作明确拒绝。

## 在 New API 中配置

[QuantumNous/new-api](https://github.com/QuantumNous/new-api) 自带 Prompt 敏感词检查，并使用 `sensitive_words_detected` 作为结构化错误码。

不同版本的菜单名称可能略有差异，当前版本可以按下面的思路配置：

1. 进入系统设置中的 **Sensitive Words / 敏感词** 区域。
2. 开启敏感词过滤。
3. 开启对用户 Prompt 的检查。
4. 在敏感词列表中单独加入一行 `[token-killer]`。
5. 保存后用本文末尾的推理请求进行验证。

可以对照 New API 的[敏感词设置](https://github.com/QuantumNous/new-api/blob/main/setting/sensitive.go)、[请求检查逻辑](https://github.com/QuantumNous/new-api/blob/main/controller/relay.go)和[错误码定义](https://github.com/QuantumNous/new-api/blob/main/types/error.go)。

## 在 Sub2API 中配置

[Wei-Shaw/sub2api](https://github.com/Wei-Shaw/sub2api) 的风险控制功能支持阻止关键词，并在内容审核拒绝时返回 `content_policy_violation`。

不同版本的后台文案可能略有差异，当前版本可以按下面的思路配置：

1. 进入管理后台的 **风险控制**。
2. 开启内容审核，并选择请求上游前拦截的模式。
3. 打开 **关键词** 配置。
4. 选择“关键词拦截”或“关键词与审核 API”模式。
5. 在阻止关键词中单独加入一行 `[token-killer]`。
6. 保存后用本文末尾的推理请求进行验证。

可以对照 Sub2API 的[风险控制界面](https://github.com/Wei-Shaw/sub2api/blob/main/frontend/src/views/admin/RiskControlView.vue)、[关键词匹配实现](https://github.com/Wei-Shaw/sub2api/blob/main/backend/internal/service/content_moderation_keyword_matcher.go)和[拒绝错误码](https://github.com/Wei-Shaw/sub2api/blob/main/backend/internal/handler/content_moderation_helper.go)。

## 自建网关如何实现

如果网关没有现成的关键词过滤功能，请在能可靠解析 JSON 请求体的应用层实现。判断条件应同时满足：

1. 请求是模型推理请求；
2. 检查的是用户文本，不是 system prompt；
3. 最后一条用户文本去掉尾部空白后，以 `[token-killer]` 结尾。

匹配后应在请求到达上游模型前返回结构化错误码。例如：

```js
const REQUEST_MARKER = '[token-killer]'

function shouldBlock(userText) {
  return String(userText ?? '').trimEnd().endsWith(REQUEST_MARKER)
}

function blockedResponse() {
  return new Response(JSON.stringify({
    error: {
      code: 'content_policy_violation',
      type: 'invalid_request_error',
      message: 'This provider does not accept Token Killer traffic.',
    },
  }), {
    status: 403,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}
```

普通 Nginx 配置不适合直接解析多种 JSON 请求结构。可以在应用本身、Cloudflare Worker、njs、OpenResty Lua 或其他支持安全解析 JSON 的网关层完成检查。不要用请求体正则替代 JSON 解析，也不要为了识别 Token Killer 放宽 CORS、鉴权或请求体大小限制。

## 客户端收到拒绝后会怎样

确认错误码后，Token Killer 会：

1. 立即停止当前消耗循环，不再重试；
2. 保留此前已经成功产生的 usage 和运行统计；
3. 把 Provider、规范化地址、错误码、HTTP 状态和时间写入浏览器本地黑名单；
4. 在后续推理请求真正发送前进行本地拦截；
5. 提示用户前往设置中的“已屏蔽的 Provider”手动解除。

普通 API 会按 Provider 类型、请求格式类别和规范化基础地址区分。标准推理后缀会被移除，因此同一服务的 `/v1/chat/completions`、`/v1/responses` 和 `/v1/messages` 会识别为同一个 Provider；不同域名和不同自定义基础路径不会互相影响。

订阅模式会同时使用订阅类型和 Worker 地址区分。ChatGPT、Claude、Gemini、Grok 即使共用一个 Worker，也会分别记录。

黑名单使用浏览器本地键：

```text
token-killer:provider-blocklist:v1
```

它不会被提交到排行榜，也不会保存 API Key、OAuth 凭据、完整 Prompt 或响应正文。用户可以单独解除、全部解除，或通过清空本地数据一并清除。

## 如何验证

请使用测试账号和测试模型，不要用生产用户的密钥。下面以 Chat Completions 为例：

```bash
curl https://api.example.com/v1/chat/completions \
  -H 'Authorization: Bearer YOUR_TEST_KEY' \
  -H 'Content-Type: application/json' \
  --data '{
    "model": "YOUR_TEST_MODEL",
    "max_tokens": 1,
    "messages": [
      {
        "role": "user",
        "content": "provider block test\n\n[token-killer]"
      }
    ]
  }'
```

预期结果：

- 请求在发送到上游模型前被拒绝；
- JSON 中包含 `sensitive_words_detected` 或 `content_policy_violation`；
- 不带 `[token-killer]` 的普通请求不受影响；
- 浏览器跨域调用时能够读到 JSON，而不是只看到 CORS 错误；
- Token Killer 收到拒绝后立即停止，并在设置中显示对应 Provider。

如果服务端确实拒绝了请求，但 Token Killer 没有自动停用，先检查返回体是否为 JSON，以及错误码是否位于支持的四个字段之一。不要通过把所有 `403` 或 `500` 都改成屏蔽错误码来解决，这会误伤鉴权失败、限流和上游故障。
