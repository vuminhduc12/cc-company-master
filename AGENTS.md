# AGENTS.md

## Cursor Cloud specific instructions

### Product overview

Single Next.js 15 (App Router) monolith: **D Finance AI Stock Manager**. No separate backend, Docker, or docker-compose. All pages and `/api/*` routes are served from one process on port **3000**.

### Standard commands

See `README.md` and `package.json` scripts:

| Task | Command |
|------|---------|
| Install deps | `npm install` |
| Dev server | `npm run dev` |
| Lint | `npm run lint` |
| Typecheck | `npm run typecheck` |
| Production build | `npm run build` |

### Running the dev server

Use a persistent tmux session so the server survives across commands:

```bash
SESSION_NAME="nextjs-dev-server"
tmux -f /exec-daemon/tmux.portal.conf has-session -t "=$SESSION_NAME" 2>/dev/null || \
  tmux -f /exec-daemon/tmux.portal.conf new-session -d -s "$SESSION_NAME" -c "/workspace" -- "${SHELL:-zsh}" -l
tmux -f /exec-daemon/tmux.portal.conf send-keys -t "$SESSION_NAME:0.0" 'cd /workspace && npm run dev' C-m
```

App URL: http://localhost:3000

### Environment variables

`.env.local` is **optional** for local development. Without it, the app uses bundled mock data and `localStorage` fallbacks. Copy `.env.example` only when testing Supabase, OpenAI, News API, or Alpha Vantage integrations.

### External services (all optional)

- **Supabase** — persistence/auth; requires cloud project + `supabase/schema.sql` in SQL Editor
- **Yahoo Finance** — live quotes/history (outbound HTTP, no API key)
- **OpenAI / News API / Alpha Vantage** — enhanced AI and news features

Core pages (Dashboard, Watchlist, Margin Simulator, Settings) work without any of the above.

### Gotchas

- `npm run dev:clean` removes `.next` before starting — use if hot reload behaves oddly after dependency changes.
- Manual AI job trigger on `/settings` POSTs to `/api/cron/daily-job`; works without `CRON_SECRET` in local dev.
- CI workflow `.github/workflows/deploy-docs.yml` references a `docs/` VitePress site that is not present in this repo (stale).
