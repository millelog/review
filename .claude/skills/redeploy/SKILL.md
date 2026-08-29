---
name: redeploy
description: Deploy or force-redeploy review.cascadeonline.dev on Coolify (gpu1) after pushing to main. Use when asked to deploy, redeploy, ship, or push this app live, or when a push to main didn't show up on the live site.
---

# Redeploy review.cascadeonline.dev

The app runs on **gpu1** via Coolify (`dockercompose` build pack), fronted by a
Cloudflare tunnel. Coolify has a git webhook, but it is unreliable — after every
push to `main`, trigger the deploy explicitly.

## Constants

| Thing | Value |
|-------|-------|
| Coolify API | `http://gpu1.lan:8000/api/v1` |
| App uuid | `fwow4oog0cc4s4k4440o00go` |
| Project uuid | `i484g0w4k80ww08w80csogo8` |
| Server uuid | `a408so8` (gpu1) |
| Token | `COOLIFY_TOKEN` in `~/repos/homelab-command/.env` (gitignored, contains `|` — always quoted) |
| Live URL | https://review.cascadeonline.dev |

## Deploy

```bash
set -a; source /home/millerl/repos/homelab-command/.env; set +a
curl -sS -X POST -H "Authorization: Bearer $COOLIFY_TOKEN" \
  "http://gpu1.lan:8000/api/v1/deploy?uuid=fwow4oog0cc4s4k4440o00go&force=true" | jq .
```

`force=true` skips the build cache — use it whenever a plain deploy shipped
stale assets. Response returns a `deployment_uuid`.

## Watch it finish

```bash
curl -sS -H "Authorization: Bearer $COOLIFY_TOKEN" \
  "http://gpu1.lan:8000/api/v1/deployments/<deployment_uuid>" | jq -r .status
```

`queued` → `in_progress` → `finished`. A Next.js build here takes ~2–4 min.
Then verify the live site actually changed:

```bash
curl -sSI https://review.cascadeonline.dev | head -3
```

## Notes

- The container's sqlite lives on a Coolify volume; redeploys do not wipe it.
  The schema is created **lazily** on the first request that touches the DB —
  hit `/api/comments?token=x` before poking sqlite directly in a fresh container.
- Direct DB access inside the container (top-level `require` fails on the pnpm
  layout):
  `node -e "require('/app/node_modules/.pnpm/better-sqlite3@13.0.3/node_modules/better-sqlite3')(process.env.DATABASE_PATH)"`
- `/admin` is gated by Cloudflare Access (app `ab71ab24-c88d-4d4a-99de-8f0bc1989f1d`).
- Full Coolify/Cloudflare playbook, including creating apps and moving domains:
  `~/repos/homelab-command/docs/playbook-deploy-subdomain.md` and
  `~/repos/homelab-command/hosts/gpu1.md`.
