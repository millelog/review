# PRD: Review — markup.io-style client feedback on Vercel previews

## Introduction

A self-hosted tool at `review.cascadeonline.dev` that lets clients review Cascade Online Design site previews without accounts or passwords. You send a client a token link; they see the live Vercel preview in an iframe, click any element to pin a comment or change request, and reply in threads. You get debounced email notifications and push fixes to the same branch — comments re-anchor on the updated deploy. Replaces markup.io for free.

All design decisions below were resolved in a grilling session on 2026-08-28.

## Locked Decisions

| Decision | Choice |
|---|---|
| Rendering | Cross-origin iframe of the real Vercel deploy (no proxy) |
| Per-site cost | `frame-ancestors` header + `<script src=".../embed.js" defer>` in each reviewed repo; script no-ops unless framed |
| Preview resolution | Deterministic branch alias `{project}-git-{branch}-{team}.vercel.app`; deployment protection disabled on reviewed projects |
| Comment anchoring | CSS selector + relative offset within element, keyed to `(project, branch, path)`; viewport width recorded; "element gone" degradation |
| Access | Unguessable token links `/r/{token}` → (project, branch); no accounts; reviewer name prompted once, stored in localStorage |
| Notifications | SendGrid email to team on new comments, debounced to once per token per 10 min |
| Admin | `/admin` page, auth via path-scoped Cloudflare Access app (zero auth code) |
| Stack | Single Next.js (standalone) container, better-sqlite3, SQLite file on a persistent mounted volume |
| Hosting | gpu1 via Coolify + Cloudflare tunnel, per `homelab-command/docs/playbook-deploy-subdomain.md` |

## Goals

- Client goes from emailed link to first comment in under 30 seconds, zero signup.
- Comments survive redeploys of the branch: pins re-attach to their element or degrade visibly, never drift silently.
- Team learns of new feedback by email within 10 minutes.
- New project onboarded (header + script tag + admin entry + link minted) in under 5 minutes.
- Runs entirely on existing infra; $0/month.

## User Stories

### US-001: Data layer and schema
**Description:** As a developer, I need the SQLite schema so all other stories have persistence.

**Acceptance Criteria:**
- [ ] `projects` table: id, name, slug, vercel_project, vercel_team, created_at
- [ ] `tokens` table: token (8+ char random), project_id, branch, created_at, revoked_at nullable
- [ ] `comments` table: id, token, project_id, branch, path, parent_id nullable (threads), author, body, type ('comment' | 'change_request'), status ('open' | 'resolved'), selector, offset_x, offset_y, viewport_width, created_at
- [ ] `notifications` table or column tracking last-notified timestamp per token (for debounce)
- [ ] DB file lives at a path taken from env (`DATABASE_PATH`), created with WAL mode on boot
- [ ] Typecheck passes

### US-002: embed.js
**Description:** As a reviewer, clicks inside the reviewed site must reach the review shell, since the iframe is cross-origin.

**Acceptance Criteria:**
- [ ] Served at `/embed.js`, immediately no-ops when `window.self === window.top`
- [ ] Comment mode toggled via postMessage from parent; when on, click captures target element, computes a selector (prefer id, then data-* attrs, then structural nth-child path) + offset within element + viewport width, posts to parent, and prevents the default action
- [ ] Reports route changes (pushState/popstate/hashchange) and initial path to parent
- [ ] Given a list of `{id, selector}` from parent, resolves each to viewport coordinates and reports positions (recomputed on scroll/resize, throttled) so the parent can render pins overlaying the iframe
- [ ] Reports selectors that no longer resolve so parent can mark comments outdated
- [ ] No dependencies, single file, works when the host site is a Next.js app with client routing

### US-003: Reviewer shell — load preview via token
**Description:** As a client, I want to open my link and see the site so I can start reviewing.

**Acceptance Criteria:**
- [ ] `GET /r/{token}` resolves token → project + branch, 404 page for unknown/revoked tokens
- [ ] Iframe src is the Vercel branch alias built from project fields; `main` uses production alias/domain if configured
- [ ] First visit prompts for reviewer name, stored in localStorage, never asked again
- [ ] Desktop/mobile toggle resizes the iframe (e.g. 100%/390px)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-004: Create and view comments
**Description:** As a client, I want to click an element and leave a comment or change request so feedback lands exactly where I mean.

**Acceptance Criteria:**
- [ ] "Comment mode" toggle; while on, clicking in the iframe drops a pin at the clicked element and opens a compose box
- [ ] Compose supports type chip (💬 comment / 🔧 change request); saves author, body, anchor data via `POST /api/comments`
- [ ] Existing pins render overlaid at element positions reported by embed.js; clicking a pin opens its thread
- [ ] Pins whose selector no longer resolves are absent from the page but listed in sidebar with an "outdated" badge
- [ ] New comments from other viewers appear within ~5s (polling)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-005: Threads, resolve, sidebar
**Description:** As a team member or client, I want threaded replies and resolution state so feedback rounds converge.

**Acceptance Criteria:**
- [ ] Reply inside a pin's thread (parent_id)
- [ ] Open/resolved toggle on any root comment; resolved pins hidden by default with a "show resolved" switch
- [ ] Sidebar lists all root comments for the token across all paths, grouped by path, with type/status chips; clicking one navigates the iframe to that path and highlights the pin
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-006: Email notifications
**Description:** As the team, I want an email when a client leaves feedback so nothing sits unseen.

**Acceptance Criteria:**
- [ ] On new comment, if no notification sent for that token in the last 10 minutes, send via SendGrid API to `NOTIFY_EMAIL`: "N new comments on {project}/{branch}" with link
- [ ] Comments created within the debounce window are covered by the next send (no lost notifications: check for unnotified comments when window expires or on next comment)
- [ ] SendGrid key and recipient from env; failure to send logs but never blocks comment creation
- [ ] One runnable check covering the debounce logic

### US-007: Admin
**Description:** As the team, I want to register projects and mint links without touching the DB by hand.

**Acceptance Criteria:**
- [ ] `/admin`: list projects, add project (name, slug, vercel_project, vercel_team), generate token link for a project+branch, copy-link button, revoke token
- [ ] Shows comment counts (open/total) per project
- [ ] No auth code in-app; route protection is Cloudflare Access (deployment step)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-008: Deploy to gpu1
**Description:** As the team, I want the service live at review.cascadeonline.dev.

**Acceptance Criteria:**
- [ ] Dockerfile (Next standalone) + `docker-compose.yml` modeled on `redfin-rental-scraper`: single service, named volume mounted at the `DATABASE_PATH` directory
- [ ] Deployed via `homelab-command/docs/playbook-deploy-subdomain.md`: GitHub repo, Coolify app (server a408so8, `docker_compose_location: /docker-compose.yml`, `docker_compose_domains`), tunnel ingress `https://localhost:443` + noTLSVerify before the catch-all, proxied CNAME to the tunnel
- [ ] Path-scoped Cloudflare Access app covering `review.cascadeonline.dev/admin` with the existing Friends/Family policy
- [ ] `infra/cloudflare.md` and `hosts/gpu1.md` in homelab-command updated
- [ ] `curl -L https://review.cascadeonline.dev/` returns 200; `/admin` redirects to Access; comment survives a container restart (volume verified)

### US-009: Onboard first real project
**Description:** As the team, I want one client site wired up end-to-end to prove the loop.

**Acceptance Criteria:**
- [ ] Chosen project gets `frame-ancestors https://review.cascadeonline.dev` header and the embed.js script tag in its root layout
- [ ] Vercel deployment protection disabled for that project
- [ ] Token link minted; full flow verified: open link → name prompt → pin comment on a branch preview → reply → resolve → email received
- [ ] Push a commit to the branch and confirm the pin re-anchors (or degrades to outdated) on the new deploy

## Functional Requirements

- FR-1: The system must resolve `/r/{token}` to a (project, branch) pair and render that branch's Vercel alias in an iframe; unknown or revoked tokens get a 404.
- FR-2: The system must serve `/embed.js`, which is inert outside an iframe and otherwise brokers clicks, route changes, and pin positions between the reviewed page and the shell via postMessage.
- FR-3: Comments must store: author, body, type, status, path, CSS selector, in-element offset, viewport width, parent (for threads), and token.
- FR-4: Pins must render at their anchored element's current position; unresolvable selectors must surface as "outdated" in the sidebar, never as misplaced pins.
- FR-5: Reviewer identity is a display name captured once per browser (localStorage); no accounts, sessions, or passwords anywhere in the reviewer flow.
- FR-6: The shell must poll for new comments (~5s) so concurrent reviewers see each other's feedback.
- FR-7: New comments must trigger a SendGrid email to the configured team address, debounced to at most one email per token per 10 minutes, with no comments escaping notification.
- FR-8: `/admin` must support project CRUD, token minting/revocation, and per-project open-comment counts, relying entirely on Cloudflare Access for auth.
- FR-9: SQLite must live on the compose volume; all secrets (SendGrid key, notify address, DB path) come from environment variables.
- FR-10: The reviewer UI must offer a desktop/mobile viewport toggle for the iframe.

## Non-Goals

- No reverse proxy of reviewed sites; sites that can't set `frame-ancestors` are unsupported.
- No drawing/shapes, attachments, or screenshots on comments.
- No emails to reviewers/clients (team-only notifications).
- No realtime websockets, presence, mentions, reactions, or edit history.
- No Vercel API integration in v1 (aliases are built deterministically; no project/branch picker).
- No support for Vercel deployment protection bypass; protection is simply disabled on reviewed projects.
- No Postgres.

## Technical Considerations

- Next.js standalone output; better-sqlite3 with WAL; single container.
- The iframe is cross-origin: the shell can never read iframe DOM directly — everything goes through embed.js postMessage (origin-checked both directions against the expected preview origin / review origin).
- Selector strategy ordering: `id` → stable `data-*` attributes → structural path. Avoid class-based selectors (Tailwind/CSS-module churn breaks them).
- Branch names need URL-slugging to match Vercel's alias rules (`feature/x` → `feature-x`); alias length caps exist — document, don't solve, in v1.
- SendGrid via bare `fetch` to their v3 API; no SDK dependency.
- Existing infra references: tunnel/DNS/Access details in `homelab-command/infra/cloudflare.md`, API recipes in `infra/cloudflare-api.md`, deploy playbook in `docs/playbook-deploy-subdomain.md`.

## Success Metrics

- First client review round completed with zero support questions about "how do I log in".
- Markup.io subscription cancelled / never purchased.
- Pin drift complaints: zero (outdated pins degrade, never mislocate).
- Onboarding a new project takes < 5 minutes.

## Open Questions

- Production (`main`) reviews: use the project's real custom domain or the Vercel production alias? (Custom domain requires that domain to also allow framing — same header, so likely fine; decide at US-009.)
- Should revoking a token hide its comments from future tokens on the same project/branch, or do comments belong to project/branch permanently? (Current schema keys comments by token *and* project/branch — default: new token on same branch shows prior comments.)
- Mobile-width pin accuracy: comments left at 390px viewport shown to a desktop viewer — display at the element regardless, but flag the viewport chip on the pin?
