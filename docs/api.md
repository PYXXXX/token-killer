# API reference

[简体中文](api.zh-CN.md)

Token Killer keeps every application-owned HTTP endpoint under `/api`. The browser may still call model providers directly in API-key mode; those provider URLs are not Token Killer service APIs and are not rewritten.

The frontend accepts either a service origin such as `https://burn.example.com` or an explicit API base such as `https://burn.example.com/api`. It appends the canonical route without duplicating `/api`.

## Service and region

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Report service, storage, geo assertion, and subscription OAuth availability. |
| `POST` | `/api/geo/assertion` | Return a short-lived signed assertion for the network-exit region observed by the service. |

`/api/geo/assertion` is the only public geo route. The former root-level `/geo` alias is no longer served; saved browser settings that use it are migrated by the frontend.

## Leaderboard

| Method | Route | Purpose |
| --- | --- | --- |
| `GET`, `POST` | `/api/leaderboard` | Read one leaderboard page. The frontend uses `POST` so it can include an installation ID and region assertion without placing them in a query string. |
| `POST` | `/api/leaderboard/profile` | Resolve the current participant number, rank, tier, and regional context. |
| `POST` | `/api/leaderboard/sessions` | Create a signed submission session before a burn run starts. |
| `POST` | `/api/leaderboard/runs` | Submit a completed, verified usage receipt to the leaderboard. |

Only leaderboard-safe aggregate data is accepted. API keys, OAuth credentials, prompts, model responses, and the provider blocklist are never leaderboard fields.

## Subscription OAuth

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/oauth/openai/device/start` | Start the ChatGPT/OpenAI device authorization flow. |
| `POST` | `/api/oauth/openai/device/poll` | Poll that device authorization flow. |
| `POST` | `/api/oauth/openai/refresh` | Refresh an OpenAI subscription credential. |
| `POST` | `/api/oauth/claude/exchange` | Exchange a Claude authorization code. |
| `POST` | `/api/oauth/claude/refresh` | Refresh a Claude subscription credential. |
| `GET` | `/api/oauth/gemini/config` | Return the public Gemini OAuth client configuration. |
| `POST` | `/api/oauth/gemini/exchange` | Exchange a Gemini authorization code. |
| `POST` | `/api/oauth/gemini/refresh` | Refresh a Gemini subscription credential. |
| `POST` | `/api/oauth/grok/exchange` | Exchange a Grok authorization code. |
| `POST` | `/api/oauth/grok/refresh` | Refresh a Grok subscription credential. |

OAuth secrets and refresh tokens remain encrypted in the user's browser between requests. The configured Worker/VPS necessarily handles credentials during exchange and refresh.

## Subscription inference relay

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/subscription/openai/responses` | Relay an OpenAI subscription request. |
| `POST` | `/api/subscription/claude/messages` | Relay a Claude subscription request. |
| `POST` | `/api/subscription/gemini/generate` | Relay a Gemini subscription request. |
| `POST` | `/api/subscription/grok/responses` | Relay a Grok subscription request. |

Subscription inference cannot be performed as a static browser-only flow with the current upstream protocols, so these requests pass through the configured Worker/VPS. API-key inference remains browser-to-provider whenever the provider permits CORS.

## Response conventions

- JSON responses use `Content-Type: application/json`.
- API responses use `Cache-Control: no-store`.
- CORS is restricted by `ALLOWED_ORIGINS` when configured.
- Errors return a non-2xx status and a JSON `error` value or object.
- Explicit provider opt-out errors preserve their structured error code so the browser can stop the run and update its local provider blocklist.

The canonical route definitions live in [`src/lib/apiRoutes.js`](../src/lib/apiRoutes.js) and are shared by the frontend, Worker, and Node server.
