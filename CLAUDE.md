@AGENTS.md

## Deploying

This app is hosted at https://review.cascadeonline.dev on gpu1 via Coolify.
Pushing to `main` is not enough — trigger the deploy with the `redeploy` skill
(`.claude/skills/redeploy/SKILL.md`).

"Push" always means push **and** redeploy. Run the `redeploy` skill after every
push to `main` without being asked.
