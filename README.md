# Review

Markup.io-style client feedback tool. Clients open a token link at
`review.cascadeonline.dev/r/{token}`, see the live Vercel branch preview in an
iframe, and pin threaded comments and change requests on elements. No accounts.

Full spec: `tasks/prd-review-tool.md`.

## Develop

```bash
pnpm install
pnpm dev            # http://localhost:3000
pnpm typecheck
pnpm test
```

Reviewed sites must allow framing (`frame-ancestors https://review.cascadeonline.dev`)
and load `https://review.cascadeonline.dev/embed.js` in their root layout.

### Env

| Var | Default | Notes |
|-----|---------|-------|
| `DATABASE_PATH` | `./data/review.db` | SQLite file; its directory is the volume mount point |
| `SENDGRID_API_KEY` | — | required for notification emails |
| `NOTIFY_EMAIL` | — | team recipient |
| `NOTIFY_FROM` | `NOTIFY_EMAIL` | verified SendGrid sender |
| `APP_URL` | `https://review.cascadeonline.dev` | base for links in emails and `/admin` |
| `PREVIEW_OVERRIDE` | — | dev only: point the iframe at a local fake site |

### Notifications

A minutely sweep (started from `instrumentation.ts`) emails `NOTIFY_EMAIL` once a review
link has gone 30 minutes without a new comment, covering everything since the last email;
the subject and `References` header are stable per project/branch so each link is one
thread. A daily recap of every comment since the previous recap goes out at 3pm Pacific.

## Run in Docker

```bash
docker compose up -d --build
```

Single service, listening on 3000 (exposed to the compose network, not published —
Traefik routes to it in production). SQLite lives on the `review-data` named volume
mounted at `/app/data`, so comments survive `docker compose restart`.

## Deploy to gpu1

Manual steps, per `homelab-command/docs/playbook-deploy-subdomain.md`. Run from
`/home/millerl/repos/homelab-command` with `set -a; source .env; set +a`.

1. **GitHub** — `gh repo create millelog/review --public --source=. --push`.
2. **Coolify project** — `POST http://gpu1.lan:8000/api/v1/projects` `{"name":"review"}`, keep the returned `uuid`.
3. **Coolify app** — `POST /api/v1/applications/public` with `server_uuid: a408so8`,
   `build_pack: "dockercompose"`, `docker_compose_location: "/docker-compose.yml"`
   (`.yml`, not `.yaml`), `docker_compose_domains: {"review":{"domain":"https://review.cascadeonline.dev"}}`,
   `git_branch: "main"`, `instant_deploy: true`.
4. **Env vars** — set `SENDGRID_API_KEY`, `NOTIFY_EMAIL`, `NOTIFY_FROM`, `APP_URL` on the
   Coolify app. `DATABASE_PATH` already defaults to the volume path in the image.
5. **Tunnel ingress** — `PUT /accounts/$CLOUDFLARE_ACCOUNT_ID/cfd_tunnel/$CLOUDFLARE_TUNNEL_ID/configurations`,
   adding `{"hostname":"review.cascadeonline.dev","service":"https://localhost:443","originRequest":{"noTLSVerify":true}}`
   before the catch-all `http_status:404` rule (which must stay last).
6. **DNS** — proxied `CNAME review` → `$CLOUDFLARE_TUNNEL_ID.cfargotunnel.com` in zone
   `$CLOUDFLARE_ZONE_ID_CASCADEONLINE_DEV`.
7. **Cloudflare Access for `/admin`** — `POST /accounts/$CLOUDFLARE_ACCOUNT_ID/access/apps`
   with `{"name":"review-admin","domain":"review.cascadeonline.dev/admin","type":"self_hosted","session_duration":"24h"}`,
   then attach the Friends/Family allow policy. The app itself ships no auth code —
   the reviewer routes (`/r/{token}`) stay public.
8. **Verify** — `curl -L https://review.cascadeonline.dev/` returns 200, `/admin`
   redirects to the Access login, and a comment survives a container restart.
9. **Update homelab docs** — add the hostname row to `infra/cloudflare.md` and append
   `review` to the Coolify apps line in `hosts/gpu1.md`.
