# 一起协作

简体中文 | [English](CONTRIBUTING.md)

遇到问题时，请尽量写清浏览器、请求格式、API 地址的域名、复现步骤和实际结果。可以附截图，但务必先遮掉 API Key、OAuth Token、授权码、账号 ID 和完整 Prompt。

准备提交代码时：

1. 从 `main` 建一个短分支。
2. 尽量让一次提交只解决一件事。
3. 运行 `npm run lint` 和 `npm run build`。
4. 在 PR 里说清楚为什么改，以及你实际验证了什么。

界面改动最好附上桌面和窄屏截图。涉及新供应商时，请同时说明请求格式、流式事件和 `usage` 字段来自哪里。

## 请求标记与 Provider 停用

所有新增的模型推理路径都必须把 `[token-killer]` 放在最后一条用户文本的末尾。不要把标记放进 system prompt、Header、模型列表请求、OAuth、排行榜或健康检查。

改动请求构造、订阅代理、错误处理或本地存储时，请至少确认：

- 标记只出现一次，空用户文本也能正确处理；
- 输入 Token 估算包含实际发送的标记；
- 只有 `sensitive_words_detected` 和 `content_policy_violation` 会触发 Provider 停用；
- 普通 HTTP、网络和 CORS 错误不会写入黑名单；
- 已停用 Provider 会在 `fetch` 前被拦截；
- 不同域名、基础路径和订阅类型不会互相误伤；
- 清空本地数据时会一并清除 Provider 黑名单。

提交前运行：

```bash
npm test
npm run lint
npm run build
```

如果修改了这套协议，请同时更新 [`docs/provider-blocking.zh-CN.md`](docs/provider-blocking.zh-CN.md) 和相关回归测试。
