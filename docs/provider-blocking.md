# Identifying and blocking Token Killer traffic

English | [简体中文](provider-blocking.zh-CN.md)

This document is for operators of API relays, community services, and model gateways.

Token Killer deliberately leaves a fixed marker in model-inference requests. Operators can detect the marker and reject the request before it reaches an upstream model. Once the client confirms that the rejection is specifically about this marker, it stops the current run and disables the provider in that browser.

## Request marker

There is one canonical marker:

```text
[token-killer]
```

It appears at the very end of the final `user` text. The complete form is:

```text
Original user text

[token-killer]
```

Nothing—not even whitespace—follows the marker. Empty user text becomes `[token-killer]`. If a request already ends with the marker, Token Killer does not append it again.

Token Killer does not change `User-Agent`, `Originator`, or any other existing header for this purpose, and it never places the marker in a system prompt. Gateways should inspect user input rather than relying on a custom header.

## Location by request format

| Request format | Marker location |
| --- | --- |
| OpenAI Chat Completions | `content` of the final `user` message |
| OpenAI Responses | Final `input_text.text` in the final `user` input |
| OpenAI legacy Completions | End of the final `prompt` |
| Anthropic Messages | Text content of the final `user` message |
| Gemini `generateContent` / `streamGenerateContent` | Final text part in the final `user` content |
| ChatGPT, Claude, Gemini, and Grok subscription proxies | End of the upstream user text after Worker conversion |

OpenAI Chat Completions example:

```json
{
  "model": "example-model",
  "messages": [
    {
      "role": "user",
      "content": "Keep producing purposeless text.\n\n[token-killer]"
    }
  ]
}
```

OpenAI Responses example:

```json
{
  "model": "example-model",
  "input": [
    {
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "Keep producing purposeless text.\n\n[token-killer]"
        }
      ]
    }
  ]
}
```

Non-inference traffic—model catalogs, OAuth, leaderboards, and health checks—does not carry the marker.

## Returning an explicit rejection

Token Killer treats a response as an operator opt-out only when it contains a recognized structured error code. The currently recognized codes are:

- `sensitive_words_detected`
- `content_policy_violation`

The code may appear in any of these locations:

- `error.code`
- `code`
- `error.type`
- `type`

Recommended response:

```json
{
  "error": {
    "code": "content_policy_violation",
    "type": "invalid_request_error",
    "message": "This provider does not accept Token Killer traffic."
  }
}
```

You may keep the HTTP status normally used by your content-moderation layer. The client never disables a provider based on status alone. A gateway response with status `500` is still recognized when its structured error code is explicit.

Ordinary `401`, `403`, `404`, `429`, and `500` responses—as well as network errors, CORS failures, timeouts, insufficient credit, and unavailable models—never disable a provider. A vague message containing words such as “policy,” “forbidden,” or “sensitive words” is not enough.

## New API setup

[QuantumNous/new-api](https://github.com/QuantumNous/new-api) includes prompt-sensitive-word filtering and uses `sensitive_words_detected` as its structured error code.

Menu labels vary slightly by version, but the current setup is:

1. Open **Sensitive Words** in system settings.
2. Enable sensitive-word filtering.
3. Enable inspection of user prompts.
4. Add `[token-killer]` as its own line in the blocked-word list.
5. Save, then verify with the inference request at the end of this document.

See New API's [sensitive-word settings](https://github.com/QuantumNous/new-api/blob/main/setting/sensitive.go), [request inspection](https://github.com/QuantumNous/new-api/blob/main/controller/relay.go), and [error-code definitions](https://github.com/QuantumNous/new-api/blob/main/types/error.go).

## Sub2API setup

[Wei-Shaw/sub2api](https://github.com/Wei-Shaw/sub2api) supports blocked keywords in its risk-control system and returns `content_policy_violation` when content moderation rejects a request.

Menu labels vary slightly by version, but the current setup is:

1. Open **Risk Control** in the admin panel.
2. Enable content moderation and choose a mode that rejects before the upstream request.
3. Open the **Keywords** configuration.
4. Select keyword-only blocking or keyword plus moderation API.
5. Add `[token-killer]` as its own blocked keyword.
6. Save, then verify with the inference request at the end of this document.

See Sub2API's [risk-control interface](https://github.com/Wei-Shaw/sub2api/blob/main/frontend/src/views/admin/RiskControlView.vue), [keyword matcher](https://github.com/Wei-Shaw/sub2api/blob/main/backend/internal/service/content_moderation_keyword_matcher.go), and [rejection error](https://github.com/Wei-Shaw/sub2api/blob/main/backend/internal/handler/content_moderation_helper.go).

## Implementing this in your own gateway

If the gateway has no keyword filter, implement the check in an application layer that can parse JSON safely. All three conditions should be true:

1. The request is a model-inference request.
2. The inspected text belongs to the user, not the system prompt.
3. After trimming trailing whitespace, the final user text ends with `[token-killer]`.

Return a structured error before the request reaches the upstream model. For example:

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

Plain Nginx configuration is not a good place to parse several JSON request shapes. Perform the check in the application, a Cloudflare Worker, njs, OpenResty Lua, or another gateway layer with safe JSON parsing. Do not replace JSON parsing with a request-body regular expression, and do not loosen CORS, authentication, or body-size limits merely to identify Token Killer.

## What the client does after rejection

After recognizing an explicit code, Token Killer:

1. stops the current burn loop immediately and does not retry;
2. keeps `usage` and run statistics from rounds that already succeeded;
3. writes the provider, normalized endpoint, error code, HTTP status, and timestamp to a browser-local blocklist;
4. blocks future inference requests before `fetch` runs;
5. asks the user to remove the block manually from **Settings → Blocked providers** if they want to try again.

For ordinary APIs, the identity combines provider type, request-format scope, and normalized base URL. Standard inference suffixes are removed, so `/v1/chat/completions`, `/v1/responses`, and `/v1/messages` on the same service resolve to one provider. Different domains and different custom base paths remain separate.

Subscription mode combines the subscription provider with the Worker URL. ChatGPT, Claude, Gemini, and Grok remain separate even when they share one Worker.

The browser-local key is:

```text
token-killer:provider-blocklist:v1
```

The blocklist is never sent to the leaderboard and never stores API keys, OAuth credentials, full prompts, or response bodies. Users can remove one entry, remove all entries, or clear it together with all local data.

## Verification

Use a test account and test model, never a production user's key. This example uses Chat Completions:

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

Expected result:

- the request is rejected before it reaches the upstream model;
- the JSON response contains `sensitive_words_detected` or `content_policy_violation`;
- ordinary requests without `[token-killer]` are unaffected;
- browser calls can read the JSON response instead of seeing only a CORS error;
- Token Killer stops immediately and shows the provider in Settings.

If the server rejects the request but Token Killer does not disable it, first confirm that the body is valid JSON and that the code appears in one of the four supported fields. Do not “fix” the issue by mapping every `403` or `500` to a blocking code; that would incorrectly disable providers for authentication failures, rate limits, and upstream outages.
