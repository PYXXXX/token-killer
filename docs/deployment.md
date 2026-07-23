# Deploy your own Token Killer

English | [简体中文](deployment.zh-CN.md)

Token Killer can run as a static frontend or as a complete service with a leaderboard and subscription OAuth. Choose the path that fits your needs:

| Option | What you get | Best for |
| --- | --- | --- |
| GitHub Pages | Static frontend, browser-local statistics, API-key mode | Getting an instance online quickly |
| Cloudflare Worker + D1 | Frontend, leaderboard, regional rankings, subscription OAuth | Operating a complete instance |

If you are unsure, start with GitHub Pages. Adding the Worker later does not require rebuilding the frontend from scratch.

## Option 1: deploy the static frontend

### 1. Fork the repository

Sign in to GitHub, open [PYXXXX/token-killer](https://github.com/PYXXXX/token-killer), and click **Fork** in the top-right corner.

You can also open the [fork page](https://github.com/PYXXXX/token-killer/fork) directly. Keep the name `token-killer` or choose another one; the frontend uses relative asset paths, so renaming the repository does not break the Pages build.

### 2. Enable GitHub Actions

Open **Actions** in your fork. If GitHub says workflows are disabled for the fork, click **I understand my workflows, go ahead and enable them**.

If an organization policy blocks Actions, open **Settings → Actions → General** and make sure GitHub-authored actions are allowed.

### 3. Enable GitHub Pages

Open **Settings → Pages**. Under **Build and deployment**, set **Source** to **GitHub Actions**.

The repository already contains [`.github/workflows/deploy-pages.yml`](../.github/workflows/deploy-pages.yml), so you do not need to create a workflow.

### 4. Run the first deployment

Open **Actions → Deploy to GitHub Pages**, click **Run workflow**, select `main`, and start the run.

Once both `build` and `deploy` are green, the site URL appears in the run summary and under **Settings → Pages**. It usually looks like:

```text
https://your-name.github.io/repository-name/
```

### 5. Publish future updates

Every new commit pushed to `main` triggers another Pages build and deployment.

If you edit files on GitHub, commit directly to `main`. With local Git:

```bash
git add .
git commit -m "Describe what changed"
git push origin main
```

### 6. Sync changes from upstream

When the original project publishes an update, open your fork and click **Sync fork → Update branch**.

You can also use GitHub CLI:

```bash
gh repo sync your-name/token-killer -b main
```

Syncing triggers a new Pages deployment. If your fork changed the same files, GitHub may ask you to resolve conflicts first.

## Option 2: deploy the full service

The full deployment puts the frontend, API, leaderboard, regional detection, and subscription OAuth on Cloudflare. The leaderboard uses D1. Region information comes from Cloudflare request metadata; raw IP addresses are not stored in the database.

### 1. Prepare the environment

You need:

- Node.js 22 or newer;
- a Cloudflare account;
- a fork or clone of Token Killer.

Install dependencies and sign in to Cloudflare:

```bash
npm install
npx wrangler login
```

### 2. Create the D1 database

```bash
npx wrangler d1 create token-killer
```

The command returns a `database_id`. Open [`wrangler.jsonc`](../wrangler.jsonc) and replace:

```jsonc
"database_id": "REPLACE_WITH_YOUR_D1_DATABASE_ID"
```

with the ID you just received. You may also change the top-level `name`; it becomes part of the Worker name.

### 3. Allow the frontend origin

Leave `ALLOWED_ORIGINS` empty when the frontend and Worker share one origin.

When GitHub Pages hosts the frontend and the Worker hosts the API, add the frontend origin to [`wrangler.jsonc`](../wrangler.jsonc). Do not include the repository path or a trailing slash:

```jsonc
"vars": {
  "ALLOWED_ORIGINS": "https://your-name.github.io"
}
```

Separate multiple origins with commas:

```jsonc
"ALLOWED_ORIGINS": "https://a.example.com,https://b.example.com"
```

### 4. Add the leaderboard signing secret

Run:

```bash
npx wrangler secret put LEADERBOARD_HMAC_SECRET
```

Enter at least 32 random characters. This command can generate a suitable value:

```bash
openssl rand -hex 32
```

Never put this secret in `wrangler.jsonc`, a README, an issue, or Git history.

### 5. Initialize the database

```bash
npm run db:migrate:remote
```

Wrangler asks whether to apply the files in `migrations/`. Confirm to continue.

D1 issues globally unique leaderboard numbers. Existing deployments must run this command again to apply `0005_leaderboard_profiles.sql`. The migration keeps existing numbers where possible; participants involved in a collision receive a new server-issued number the next time they connect.

### 6. Configure Gemini OAuth (optional)

The current ChatGPT, Claude, and Grok flows do not require you to store additional client secrets. Gemini requires your own Google OAuth Client ID and Client Secret.

Create an OAuth client in Google Cloud Console and add this callback URL:

```text
https://codeassist.google.com/authcode
```

Then store both secrets:

```bash
npx wrangler secret put GEMINI_OAUTH_CLIENT_ID
npx wrangler secret put GEMINI_OAUTH_CLIENT_SECRET
```

Without these secrets, API-key mode, the leaderboard, and other subscription providers still work; only Gemini login stays unavailable.

### 7. Build and deploy

```bash
npm run deploy:cloudflare
```

Wrangler prints a `workers.dev` URL when deployment finishes. Open the health endpoint to confirm the service is running:

```text
https://your-worker.workers.dev/api/health
```

An `ok` value of `true` means D1 and the leaderboard signing secret are ready.

### 8. Connect GitHub Pages to the Worker

If users open the Worker URL directly, the frontend and API share an origin and no extra service URL is required.

If you keep the frontend on GitHub Pages, open Token Killer's **Settings** panel:

1. Put the full Worker URL in **OAuth service**.
2. Put the same Worker URL in **Leaderboard service URL**.
3. Do not add `/api` or a specific endpoint path.

Example:

```text
https://token-killer.your-account.workers.dev
```

After entering the OAuth service, click **Check service**. Login buttons for ChatGPT, Claude, Gemini, and Grok are enabled only after the health check succeeds and reports that provider as available. If Gemini client credentials are missing, the other providers remain available while Gemini stays disabled.

## Optional: prefer a mainland-direct region lookup

A visitor in mainland China may browse through a rules-based proxy: overseas destinations use the proxy, while a mainland destination is reached directly. If the leaderboard runs overseas, its edge location may therefore see the proxy exit instead of the visitor's mainland province and city.

Token Killer can ask a separate mainland-accessible endpoint for a short-lived signed location assertion before contacting the leaderboard. A valid assertion that says `CN` takes priority. If the probe times out, returns a non-mainland result, or fails signature validation, the leaderboard quietly falls back to its own edge location. Hong Kong SAR, Macao SAR, and Taiwan Province remain under China's province-level directory and are never treated as a mainland-direct match.

This endpoint is optional and is used only for leaderboard location. It never receives an API key, OAuth credential, installation ID, prompt, model response, or inference request.

### 1. Expose `/geo` on the API service

The included Worker/Node API exposes `POST /geo`; the older `POST /api/geo/assertion` path remains compatible. When the frontend and API share an origin, update the reverse proxy so `/geo` reaches the API container. The provided Caddy snippet already includes this route.

The settings switch is off by default unless `VITE_MAINLAND_GEO_API_URL` was configured at build time. When a visitor enables **Prefer the mainland China region**, the frontend fills in `/geo` on the current origin, checks it before leaderboard calls, and shows the detected region. A different HTTPS origin can be entered at any time.

### 2. Give a Singapore VPS a local GeoIP database

A Node service does not receive Cloudflare's `request.cf`. To make `/geo` work directly on a Singapore VPS, Token Killer can read a GeoLite2 City or Country `.mmdb` file locally through MaxMind's official Node reader. The lookup stays on the VPS and does not send the visitor's IP to another geolocation API. City enables province and city rankings; Country remains a supported fallback when only the mainland/non-mainland assertion is required.

Download a current city database from [MaxMind](https://dev.maxmind.com/geoip/geolite2-free-geolocation-data), then place it at:

```text
/opt/token-killer/geoip/GeoLite2-City.mmdb
```

The provided Compose file mounts that directory read-only. Keep these values in `deploy/vps/.env`:

```env
GEOIP_DATABASE_PATH=/geoip/GeoLite2-City.mmdb
TRUST_PROXY_IP_HEADERS=true
```

`TRUST_PROXY_IP_HEADERS=true` is safe only when the Node port is private and every request passes through your trusted Caddy/CDN. The provided Caddy route overwrites `X-Real-IP` with the connecting address. If the Node port is exposed directly to the internet, leave this setting `false`.

GeoIP is approximate and sometimes lacks a city. A country-only match can still join China's national ranking; province and city rankings appear only when the database returns those fields. Keep the database updated.

### 3. Preserve a direct network path

Running the API in Singapore is supported, but no server can recover the residential IP after an HTTP proxy has replaced it. If the current site origin itself goes through the proxy, same-origin `/geo` sees the proxy exit too.

For rules-based proxy users, bind `/geo` to a separate direct-friendly hostname or put that hostname behind a CDN/load balancer whose route remains direct and preserves the original client IP. Users can enter that hostname in **Geo detection service**. If a trusted upstream already supplies normalized location fields instead of an IP database, set `TRUST_GEO_HEADERS=true` and inject `X-Geo-Country`, `X-Geo-Region-Code`, `X-Geo-Region`, and `X-Geo-City`; the proxy must strip any visitor-supplied copies first.

### 4. Share a dedicated signing secret

Configure the same secret on the mainland probe and the leaderboard service:

```bash
npx wrangler secret put GEO_ASSERTION_HMAC_SECRET
```

For the VPS deployment, place the value in `/opt/token-killer/secrets/geo_assertion_hmac_secret` and use the provided `GEO_ASSERTION_HMAC_SECRET_FILE` setting. Use at least 32 random characters, keep it server-side, and do not reuse a browser-visible `VITE_*` value. A single combined deployment can fall back to `LEADERBOARD_HMAC_SECRET`, but a separate dedicated secret is recommended.

Add the frontend origin to the probe's `ALLOWED_ORIGINS`. GitHub Pages is HTTPS, so the probe must also use HTTPS or the browser will block it as mixed content.

### 5. Point the frontend at the probe

Visitors enable **Settings → Prefer the mainland China region** and can keep the current-origin `/geo` default or enter another service URL. To enable the switch and provide a default in a GitHub Pages fork, open **Settings → Secrets and variables → Actions → Variables** and create:

```text
VITE_MAINLAND_GEO_API_URL=https://geo.example.cn
```

Push to `main` or rerun **Deploy to GitHub Pages**. The workflow exposes this public URL only at build time; the signing secret is never part of the frontend build. You can also set `VITE_MAINLAND_GEO_API_URL` before a local or Cloudflare build.

Assertions expire after ten minutes and are cached briefly in the browser. They carry normalized location fields, timestamps, and a random nonce. They do not carry the raw IP address, although the probe's infrastructure can necessarily observe the source IP while serving the request. Review or disable proxy access logs according to your privacy policy.

## Provider blocking and deployment

The provider blocklist lives in each visitor's browser. It requires neither D1 nor the leaderboard service, and works the same way on static GitHub Pages and a complete Worker deployment.

When a server explicitly rejects an inference request carrying `[token-killer]` with a recognized error code, the frontend stops the run and blocks future requests to that provider before they are sent. Users can inspect or remove entries under **Settings → Blocked providers**.

If you also operate a model relay and want to reject Token Killer traffic, read [Identifying and blocking Token Killer traffic](provider-blocking.md). An ordinary `403`, `429`, or `500` response does not count as an explicit opt-out.

## Test the full service locally

Copy the example environment file:

```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` and replace at least `LEADERBOARD_HMAC_SECRET`. Add Gemini Client ID and Client Secret only when you need Gemini login.

Initialize local D1 and start the service:

```bash
npm run db:migrate:local
npm run dev:cloudflare
```

`.dev.vars` is ignored by Git. Do not force-add it with `git add -f`.

## Pre-deployment checklist

- `ALLOWED_ORIGINS` contains only frontend origins you actually operate.
- The D1 `database_id` points to your own database.
- Every secret was stored through Wrangler or the Cloudflare dashboard.
- The repository contains no `.dev.vars`, `.env`, API key, OAuth token, or user data.
- `npm test`, `npm run lint`, and `npm run build` all pass.
- `/api/health` is reachable, and leaderboard submission and reading have been tested once.
- **Check service** enables exactly the OAuth providers that are available.
- You have read the terms of every connected model provider.

## Further reading

- [GitHub: Configuring a publishing source for Pages](https://docs.github.com/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [GitHub: Syncing a fork](https://docs.github.com/pull-requests/collaborating-with-pull-requests/working-with-forks/syncing-a-fork)
- [Cloudflare: D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/)
- [Cloudflare: Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
