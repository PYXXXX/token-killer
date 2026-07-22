# Contributing

English | [简体中文](CONTRIBUTING.zh-CN.md)

This project is still young, so the contribution process is intentionally light.

When reporting a problem, include the browser, request format, API hostname, reproduction steps, and actual result. Screenshots are welcome, but always redact API keys, OAuth tokens, authorization codes, account IDs, and full prompts first.

When preparing a change:

1. Create a short-lived branch from `main`.
2. Keep each commit focused on one concern where practical.
3. Run `npm test`, `npm run lint`, and `npm run build`.
4. Explain why the change is needed and what you verified in the pull request.

For interface changes, include screenshots at desktop and narrow viewport sizes. For a new provider, document its request format, streaming events, and the source of its `usage` fields.

## Request marker and provider blocking

Every inference path must append `[token-killer]` to the end of the final user text. Never place the marker in a system prompt, header, model-list request, OAuth request, leaderboard request, or health check.

When changing request construction, subscription proxies, error handling, or local storage, verify at least the following:

- the marker appears exactly once, including when the user text is empty;
- input-token estimates include the marker that is actually sent;
- only `sensitive_words_detected` and `content_policy_violation` disable a provider;
- ordinary HTTP, network, and CORS errors never enter the provider blocklist;
- an already disabled provider is stopped before `fetch`;
- different domains, base paths, and subscription providers never affect one another;
- clearing local data also clears the provider blocklist.

Before submitting:

```bash
npm test
npm run lint
npm run build
```

If you change this protocol, update [`docs/provider-blocking.md`](docs/provider-blocking.md) and its regression tests in the same pull request.
