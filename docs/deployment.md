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
