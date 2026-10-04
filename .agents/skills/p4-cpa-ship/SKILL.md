---
name: p4-cpa-ship
description: Merge and deploy p4-cpa to its primary Mac mini, or inspect and recover its automatic deployment. Use for shipping this repository, not other projects or upstream subtree publication.
---

# Ship P4 CPA

Read the global ship skill for commit and merge rules, then `docs/hosting.md` for host operations. This project release procedure continues after its merge phase.

## Merge

- Ship only the authorized session changes. Preserve `.env`, config.yaml, auths, data, and unrelated edits.
- Run the web build and focused changed-area tests. For auto deployment, run `python3 -m unittest discover -s scripts -p 'test_*.py'` and lint rendered plists.
- Rebase latest origin/main, obtain correctness and security reviews, and create a PR. Wait for every relevant check, pin the squash merge to the reviewed PR head, and retain branches.
- After merge, wait for the `Validate deployment` push run on the exact merge SHA. PR checks do not satisfy the deployment gate.

## Deploy

The primary host is the Mac mini at 100.92.118.42. Confirm SSH identity and production checkout path from the current host before mutation; do not assume development host paths or copy secrets to find access.

The mini polls origin/main every 300 seconds with `codes.p4.cpa.autodeploy`. It requires a clean main checkout, authenticated Git and `gh` read access to this private repo, a running primary stack, and successful `validate.yml` push CI for the exact target.

- Inspect `launchctl print gui/$(id -u)/codes.p4.cpa.autodeploy`, `.artifacts/deployment.json`, and `~/Library/Logs/p4-cpa/autodeploy.log` over SSH.
- To deploy now, run `scripts/auto-deploy.sh` in the production checkout. It shares the backup/start lock, retains a cold backup, fast-forwards to the pinned SHA, builds, starts with health checks, verifies authentication and connectivity, and checks runtime image revision labels.
- First installation: merge and wait for CI, retain a cold backup before changing the production checkout (including bind-mounted configuration), fast-forward the clean production checkout to that SHA, then run `scripts/auto-deploy.sh`. After healthy verification, install the poller with `scripts/install-launchd.sh --install --auto-deploy --runtime orbstack`. Capture the actual working PATH and Docker context. Never install it on the Studio standby.
- Re-run the installer after changes to its plist, checkout path, Docker context, or executable paths. Normal polls never change the installed job.
- Failed or interrupted deployment pauses subsequent polls, including newer commits. Inspect the failure and preserve its matched backup. Only after the cause is resolved, run `P4_CPA_DEPLOY_RETRY=1 scripts/auto-deploy.sh` once. Never automatically restore or downgrade a migrated database.
- Backup archives are retained; deletion requires a separate authorized retention operation. Login and an awake mini remain required.

## Verify and report

Require `.artifacts/deployment.json` status healthy at the merge SHA, healthy Compose services, and `scripts/verify.sh` success. Check public-facing private HTTPS separately: management.html returns 200, unauthenticated /v1/models returns 401, and an unrelated shared SNI hostname still works. Never print Compose's resolved secrets.

Use Computer Use to verify changed behavior on the deployed manager. Keep proof images in the conversation, never GitHub unless asked. Report the PR URL, deployed SHA, and poller status. If SSH or CI access is missing, finish the reviewable code and report that deployment is blocked rather than claiming it ran.
