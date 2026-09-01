---
name: add-project
description: Register another site in the review tool — a repo in dev1's ~/repos deployed on our Vercel team. Use when asked to add a project/repo/site to review, mint a client review link, or when a review page frames blank or won't take comments because the site lacks the embed bridge.
---

# Add a site to review.cascadeonline.dev

Four steps: unprotect the Vercel preview, add the embed bridge to the site's
repo, insert the project + token in the prod DB, verify. Sites always live in
`~/repos/<repo>` on dev1 and in the `cascade-online` Vercel team.

## 1. Vercel: unprotect the preview

The iframe loads the branch alias
`https://{vercel_project}-git-{branch}-cascade-online.vercel.app`. Deployment
protection is on by default and 302s to SSO, which the iframe cannot pass.

```bash
VT=$(jq -r .token ~/.local/share/com.vercel.cli/auth.json)
PRJ=$(jq -r .projectId ~/repos/<repo>/.vercel/project.json)   # else: vercel projects ls
TEAM=$(jq -r .orgId ~/repos/<repo>/.vercel/project.json)      # team_F4KpJ9ML7CkrwqBIfFPZJweh
curl -sS -X PATCH "https://api.vercel.com/v9/projects/$PRJ?teamId=$TEAM" \
  -H "Authorization: Bearer $VT" -H 'Content-Type: application/json' \
  -d '{"ssoProtection":null}' | jq '{name, ssoProtection}'
curl -sS -o /dev/null -w '%{http_code}\n' \
  https://<vercel_project>-git-<branch>-cascade-online.vercel.app/   # want 200, not 302
```

## 2. The site's repo: framing + embed bridge

Without both of these the review page frames blank or takes no comments. Copy
from `~/repos/morrow` (or `~/repos/nest-nurses`) — every site is the same
Payload/Next template.

`next.config.ts` — replace whatever `X-Frame-Options` the template ships with:

```ts
// framing allowed for same-origin (Payload live preview) and the review tool
{ key: 'Content-Security-Policy', value: "frame-ancestors 'self' https://review.cascadeonline.dev" },
```

`src/app/(frontend)/layout.tsx` — in `<head>`:

```tsx
{/* review.cascadeonline.dev bridge — inert unless the page is framed by the review tool */}
<script src="https://review.cascadeonline.dev/embed.js" defer />
```

Commit and push; Vercel rebuilds the branch alias. Pushing `main` also deploys
that site's production — confirm with the user first.

## 3. Prod DB: project + token

`/admin` is behind Cloudflare Access and there is no admin API, so insert
directly. Coolify's container name changes every deploy — derive it.

```bash
C=$(ssh gpu1 'docker ps --format "{{.Names}}" | grep ^review-fwow')
ssh gpu1 "docker exec $C node -e \"
const {randomBytes}=require('crypto');
const db=require('/app/node_modules/.pnpm/better-sqlite3@13.0.3/node_modules/better-sqlite3')(process.env.DATABASE_PATH);
const p=db.prepare('INSERT INTO projects (name, slug, vercel_project, vercel_team) VALUES (?,?,?,?) RETURNING *').get('<Name>','<slug>','<vercel_project>','cascade-online');
const t='<slug>-<branch>-'+randomBytes(6).toString('base64url');
db.prepare('INSERT INTO tokens (token, project_id, branch) VALUES (?,?,?)').run(t,p.id,'<branch>');
console.log(t);
\""
```

Token format mirrors `mintToken` in `lib/admin.ts`. Schema is created lazily —
in a fresh container hit `/api/comments?token=x` before poking sqlite.

## 4. Verify

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://review.cascadeonline.dev/r/<token>
curl -sS -H "Authorization: Bearer $REVIEW_AGENT_KEY" \
  'https://review.cascadeonline.dev/api/agent?project=<slug>&branch=<branch>'
```

Hand the client `https://review.cascadeonline.dev/r/<token>`. Staff copy with
internal notes: `/admin/r/<token>`.
