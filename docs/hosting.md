# Hosting and operations

## Recommended host

The **Mac Studio is the primary and only host** (`MacStudio`, tailnet `100.67.215.33`,
checkout `~/code/p4-cpa`). The Mac mini no longer runs this stack; its last backup
before the move is dated 2026-10-26. This stack forwards requests to remote
providers; it does not run model inference locally. Actual CPU, RAM, disk growth
and power use depend on traffic; measure those on the Studio instead of assuming
a particular wattage.

Never run a second instance against the same provider accounts. There is no
standby, automatic failover or shared database.

Public cloud adds cost and moves provider credentials onto another host without
solving a present need. Public internet exposure adds an unnecessary attack surface.
Use private Tailscale access, retain application keys, and avoid router forwarding
or Tailscale Funnel. These are deployment choices, not claims that cloud hosting
cannot work.

**Provider terms:** OAuth subscription proxying may breach the relevant provider's
terms or account restrictions. Ownership of this MIT-licensed code does not grant
permission to reuse a subscription through it. Review your actual plan and current
[OpenAI terms](https://openai.com/policies/terms-of-use/) and
[Anthropic consumer terms](https://www.anthropic.com/legal/consumer-terms) before
connecting accounts. That decision belongs to the account owner.

## Runtime and startup

Recommend **OrbStack** for this setup: it is already installed on the verification
Mac, its Docker context is `orbstack`, and both source builds passed there. On
2026-11-01 the Studio reported `app.start_at_login: true`, and `pmset` showed
`autorestart 1` and `sleep 0`.
[OrbStack supports command-line startup with `orb start`](https://docs.orbstack.dev/headless).
Check its license for your use. **Colima** is an alternative if you prefer its
open-source runtime; **Docker Desktop** also works if you already use it. Choose
one engine and verify `docker context show`; do not alternate engines accidentally.
See [Colima's FAQ](https://github.com/abiosoft/colima/blob/main/docs/FAQ.md) and
[Docker Desktop startup settings](https://docs.docker.com/desktop/settings-and-maintenance/settings/).

On the Studio, clone this repo, run `scripts/init.sh`, build, start, and verify as in
the README. Then render LaunchAgents without installing them:

```sh
./scripts/install-launchd.sh
plutil -lint .artifacts/launchd/*.plist
```

Inspect the rendered paths, Docker context, and PATH before installing **on the Studio**:

```sh
./scripts/install-launchd.sh --install --runtime orbstack
```

This installs two user jobs, preserving identical loaded jobs on repeated runs:

- `codes.p4.cpa.start`: runs at login, starts OrbStack, then starts the already-built
  stack and waits up to 120 seconds for health. Failed attempts retry at intervals
  of at least 60 seconds. It never pulls, builds, or upgrades automatically.
- `codes.p4.cpa.backup`: daily at 03:15 local time, takes a consistent cold backup.

For Colima use `--runtime colima`. For Docker Desktop, enable its login startup
setting and use `--runtime existing`; the startup job retries until Docker is ready.
The installer captures the current Docker context and executable PATH. Reinstall
after moving the checkout, changing runtime/context, or changing executable paths.
It writes only to the current user's LaunchAgents and log directories, never a
system LaunchDaemon. Logs are under `~/Library/Logs/p4-cpa`; inspect and rotate
these host logs periodically. Docker log rotation is configured separately.

**Login is required.** These jobs do not guarantee startup before the user's login
session or before FileVault disk unlock. Keep FileVault enabled, plan for a person
to unlock after cold boot, and test an actual Studio reboot before relying on it.
In macOS power settings, prevent system sleep during service and enable restart
after power failure where supported; the display can sleep. Consider a UPS.
`restart: unless-stopped` restarts containers with the engine, but needs that engine
and an awake host. A backup scheduled during sleep/login absence is not a guarantee;
check archive timestamps after outages.

Inspect or stop only these jobs (stopping Docker containers alone is insufficient
for intentionally suspending an installation before its next login):

```sh
launchctl print gui/$(id -u)/codes.p4.cpa.start
launchctl print gui/$(id -u)/codes.p4.cpa.backup
launchctl bootout gui/$(id -u)/codes.p4.cpa.start
launchctl bootout gui/$(id -u)/codes.p4.cpa.backup
docker compose down
```

`bootout` unloads for this login session; the plist still loads next login. To keep
an installation disabled across logins, use `launchctl disable` for both labels.
Reverse with `launchctl enable` before reinstalling/loading.

## Tailnet-only HTTPS

Keep `BIND_IP=127.0.0.1` and `OAUTH_BIND_IP=127.0.0.1` in `.env` when using Serve.
Enable MagicDNS and HTTPS for your tailnet, sign in on the host, and inspect existing
Serve configuration before changing ports. Reserve unused HTTPS ports for this stack:

```sh
tailscale serve status
tailscale serve --bg --https=443 http://127.0.0.1:18317
tailscale serve --bg --https=8443 http://127.0.0.1:8317
tailscale serve status
```

Use the exact hostname printed by Serve: manager at
`https://<host>.<tailnet>.ts.net/management.html`, inference base at
`https://<host>.<tailnet>.ts.net:8443/v1`. On the Studio, 443 and 8443 are taken
(see [Studio port sharing](#studio-port-sharing)), so its ts.net mappings are
manager `https://macstudio.tailfb37f4.ts.net:8446` (`127.0.0.1:18317`) and inference
`https://macstudio.tailfb37f4.ts.net:8445/v1` (`127.0.0.1:8317`). Retain the manager admin and inference
client keys. Limit access in tailnet grants/ACLs to the people/devices that need it.
Serve background configuration persists; it still depends on Tailscale and the
local services running. Undo only these mappings:

```sh
tailscale serve --https=443 off
tailscale serve --https=8443 off
```

Do not overwrite an existing mapping on either port; select other available ports
and update client URLs. Do not use `tailscale serve reset` on a shared host.
[Serve is tailnet-only and supports separate HTTPS ports](https://tailscale.com/docs/reference/tailscale-cli/serve).
It may prompt to enable HTTPS; complete that deliberately on the host.

Direct tailnet binding is an alternative: set `BIND_IP` to the host's Tailscale IPv4
and recreate containers. That uses the application's HTTP port over the encrypted
Tailscale connection, without Serve HTTPS. Keep loopback binding for the recommended
Serve setup; do not use `0.0.0.0`. Callback binding remains loopback in either case.

## Custom hostname with private HTTPS

The optional `https` profile builds our Caddy image with the Cloudflare DNS module.
It obtains and renews a publicly trusted Let's Encrypt certificate using DNS-01:
only outbound HTTPS and temporary DNS TXT records are needed. No inbound public
ports, router forwarding, Cloudflare proxy, or Funnel are involved. Certificate
Transparency publicly records the hostname, even though the service is private.
See the [Cloudflare module](https://github.com/caddy-dns/cloudflare) and
[Tailscale TCP forwarding](https://tailscale.com/docs/reference/tailscale-cli/serve#use-a-tcp-forwarder).

Create a **DNS-only** Cloudflare A record `cpa.home.ccly.dev` pointing to the host's
tailnet IPv4 (`100.67.215.33`, the Studio, for this deployment). The `*.home.ccly.dev`
wildcard still points to the Mac mini, so this exact record must stay. Do not publish an unrelated AAAA record. If a local
resolver overrides `*.home.ccly.dev` to a LAN address, add an exact-name override
for `cpa.home.ccly.dev` to the tailnet address; preserve other home services.

Use an existing Cloudflare API token with **Zone / Zone / Read** and
**Zone / DNS / Edit**, restricted to the `ccly.dev` zone. Store it only in the
host's ignored `.env`, never in shell arguments, committed files, or logs. Add
these entries to existing installations; new `init.sh` runs copy them from
`.env.example`:

```dotenv
COMPOSE_PROFILES=https
HTTPS_HOST=cpa.home.ccly.dev
HTTPS_BIND_IP=127.0.0.1
HTTPS_PORT=19443
CLOUDFLARE_API_TOKEN=<existing scoped token>
```

Keep `.env` mode 0600. Leave `BIND_IP` and callback bindings at loopback. Build and
start the optional service before changing the working Tailscale route:

```sh
docker compose build https
docker compose up -d --wait https
curl --resolve cpa.home.ccly.dev:19443:127.0.0.1 \
  https://cpa.home.ccly.dev:19443/management.html -o /dev/null -w '%{http_code}\n'
```

Wait for certificate issuance before the curl check succeeds. The container health
check only tests Caddy's local admin API; it does not prove certificate issuance.
Caddy's admin API stays inside its container. Caddy persists certificates and ACME
state in `data/caddy` and `data/caddy-config`, covered by the existing cold backup.
It renews automatically while running with valid DNS credentials. Existing startup
and upgrade scripts honor `COMPOSE_PROFILES=https` in `.env`.

Publish Caddy only on loopback 19443 and use **raw TCP Serve** for tailnet port 443.
This preserves the custom certificate end to end. A ts.net HTTPS mapping on 443
conflicts with raw TCP, so move it to an unused port first:

```sh
tailscale serve status
tailscale serve --https=443 off
tailscale serve --bg --tcp=443 tcp://127.0.0.1:19443
```

The macOS app's CLI is `/Applications/Tailscale.app/Contents/MacOS/Tailscale` if
`tailscale` is absent from PATH. Only replace the p4-cpa mapping, never use `reset`.
Roll back with `tailscale serve --tcp=443 off`. The optional proxy can remain
running privately during rollback.

The repository Caddyfile routes the shared port by TLS server name (the layer4
plugin): `HTTPS_HOST` terminates in Caddy, and every other name passes through still
encrypted to `HTTPS_PASSTHROUGH_UPSTREAM` (`host.docker.internal:443` by default), so
another proxy on the host keeps its own certificates.

### Studio port sharing

On the Studio, tailnet port 443 is shared with P4 Code, not with another proxy.
Two ignored files under `data/` (so they travel in the cold backup) replace the
repository Caddyfile:

- `.env` sets `COMPOSE_FILE=docker-compose.yml:data/compose.studio.yml`. That overlay
  mounts `data/caddy-studio/Caddyfile` over `/etc/caddy/Caddyfile` and the ts.net
  certificate directory `data/ts-certs`.
- `data/caddy-studio/Caddyfile` sends `cpa.home.ccly.dev` to CPA, and both
  `macstudio.tailfb37f4.ts.net` and `p4code.local` to P4 Code on
  `host.docker.internal:3773`. It has no passthrough route, so
  `HTTPS_PASSTHROUGH_UPSTREAM` is unused there.
- `p4code.local` uses Caddy's own local CA (`tls internal`, root at
  `data/caddy/caddy/pki/authorities/local/root.crt`). It works only on machines with
  a hosts entry for the Studio's tailnet addresses and that root trusted for SSL.
- The ts.net certificate comes from `tailscale cert`, renewed daily by the
  `codes.p4.cpa.tscert` LaunchAgent running `data/caddy-studio/renew-tscert.sh`, which
  retries until Tailscale is connected and then reloads Caddy when the certificate changed.

Editing `https/Caddyfile` therefore changes nothing on the Studio. After a change,
check both names from another tailnet device: the manager returns 200 and
`https://macstudio.tailfb37f4.ts.net/` serves P4 Code.

Clients running on the Studio itself cannot use these names. Tailscale resets a
connection the Studio opens to its own tailnet address on 443 (curl reports
`Connection reset by peer`, Claude reports `ECONNRESET`). Point local clients at
loopback instead: inference `http://127.0.0.1:8317` (`/v1` for OpenAI-style clients)
and management `http://127.0.0.1:18317`. The Studio's P4 Code provider instances
`claude_cpa` and `codex_cpa` use these. Restart the P4 Code service after editing
their URLs in `settings.json` by hand; a running session keeps the old environment.

Use `https://cpa.home.ccly.dev/management.html` for the manager and
`https://cpa.home.ccly.dev/v1` for clients. `/v1/*` and `/v1beta/*` go to CPA with
streaming enabled; other paths go to the manager. Application keys remain required.
Verify the manager returns 200 and unauthenticated `/v1/models` returns 401, and
inspect the certificate issuer/expiry. Tailnet grants/ACLs still control access.

For hosts without Serve, `HTTPS_BIND_IP` may be a locally bindable tailnet address
and `HTTPS_PORT=443`, only if that port is free. Never set it to `0.0.0.0` or a LAN
address when tailnet-only reachability is required. On macOS, prefer the loopback
plus Serve setup because the Tailscale app owns its virtual address.

## Headless OAuth

Open OAuth Login in the manager over Tailscale. The provider's callback `localhost`
refers to the browser machine, not the Studio. Forward the callback ports over SSH
before starting login (adjust remote ports if `.env` changed them):

```sh
ssh -N -o ExitOnForwardFailure=yes \
  -L 8085:127.0.0.1:8085 -L 1455:127.0.0.1:1455 \
  -L 54545:127.0.0.1:54545 -L 51121:127.0.0.1:51121 \
  -L 11451:127.0.0.1:11451 po@macstudio
```

Enable macOS Remote Login for the intended user, restricted to your private network.
Forward only the chosen provider's port if another local application occupies one.
The SSH local port must match the callback URL; the remote port must match the
published Compose port. Do not expose callbacks publicly. Alternatively, paste the
full returned callback URL into the P4 CPA manager's callback field; never share its code/state.
Device-code login does not require these listeners. Verify credential creation and
one real request after connecting your own account.

## Backups and restoration

```sh
./scripts/backup.sh
BACKUP_DIR="$HOME/Backups/p4-cpa" BACKUP_KEEP=14 ./scripts/backup.sh
```

The backup script stops only currently running services in this Compose project,
archives `.env`, `config.yaml`, `auths/`, `data/` and `plugins/`, then restarts only
those services and waits for health. Expect a brief outage. It serializes with
startup and upgrade in this checkout. Avoid manual Docker operations during it,
and never run a second checkout against these same data directories.

SQLite and its WAL/SHM files are copied while containers are stopped. The complete
`data/` directory includes **`data.key`**, which must travel with the database.
Each archive records its source commit in `p4-cpa-backup.json`.
Archives have permission 0600, are outside the repository, and contain live secrets.
Use encrypted storage and an off-machine encrypted copy. Defaults retain the newest
14 completed archives; `BACKUP_KEEP` is an archive count, not days. Only filenames
created by this script are pruned, after successful backup and restart. Failed
archives remain as private `.partial` files for inspection. A failed restart is
reported even if the archive was created. A stack that was stopped stays stopped.
Start it once before its first backup so SQLite and `data.key` exist.

To set the scheduled backup destination/retention, pass `BACKUP_DIR` and `BACKUP_KEEP`
to `install-launchd.sh --install`; the installer records only these nonsecret
settings in the backup plist. Other Compose overrides are not captured: configure
production ports and project name in `.env`.

Verify a trusted archive by extracting into a **new empty private directory**:

```sh
umask 077
restore_dir=$(mktemp -d "$HOME/p4-cpa-restore.XXXXXX")
tar -xzf "$HOME/Backups/p4-cpa/<archive>.tar.gz" -C "$restore_dir"
```

Check `data/data.key`, `.env`, `config.yaml`, auth files and SQLite integrity. Do not
extract over a running installation. For recovery, stop/disable its startup job,
stop the stack, preserve the current data separately, and restore the entire matched
set. Retain the `.env` keys and never mix a database with another backup's data key.

## Upgrades and rollback

Commit local changes first; the upgrade script refuses a dirty tree:

```sh
./scripts/upgrade.sh
```

It takes a backup, records the prior commit, runs `git pull --ff-only origin main`,
builds both local images, recreates the stack with a health wait, and verifies
manager-to-CPA connectivity and authentication. A build failure leaves the running
old containers intact. An update failure may leave a partially updated stack; the
script prints the prior commit and backup path and does not guess at a rollback.

For manual rollback, stop the jobs and containers, inspect the failure, and preserve
current data. Select the printed prior commit in a clean recovery checkout, restore
the matching backup into it, build and start there, then run `scripts/verify.sh`.
Do not downgrade a migrated database without its matching pre-upgrade backup.
Repoint/reinstall launch jobs only after verification. These scripts do not pull
upstream subtrees automatically; source updates use `scripts/sync-upstream.sh`.

## Automatic deployment on the Studio

The repo ship skill is [.agents/skills/p4-cpa-ship/SKILL.md](../.agents/skills/p4-cpa-ship/SKILL.md).
The optional `codes.p4.cpa.autodeploy` LaunchAgent polls `origin/main` every 300 seconds.
It uses outbound Git and GitHub API access; no inbound webhook or production CI runner is needed.

Prerequisites on the Studio: a clean `main` checkout, running healthy stack,
Docker/Compose, Python 3, Git, and `gh` with unattended read access to this private repository
and its Actions runs. Keep authentication in the host's existing credential store. Never
put tokens in a plist, command argument, or committed file.

```sh
# Render and inspect first. This does not install or start the poller.
./scripts/install-launchd.sh --auto-deploy --runtime orbstack
plutil -lint .artifacts/launchd/*.plist
# On the Studio only, after the first verified deployment:
./scripts/install-launchd.sh --install --auto-deploy --runtime orbstack
launchctl print gui/$(id -u)/codes.p4.cpa.autodeploy
```

Each poll fetches main and requires successful `Validate deployment` push CI for the
exact SHA. Pending, failed, missing, or unreadable CI never deploys. PR checks alone
are insufficient. The job uses the same lock as startup and backup, refuses dirty or
non-main checkouts and stopped primary services, retains a cold backup, fast-forwards
to that exact SHA, builds, and recreates the stack with a 120-second health wait.
The verifier checks manager connectivity and authentication; both app containers must
carry the matching `org.opencontainers.image.revision` label. Build metadata is set
from the deployed repository SHA rather than the imported upstream versions.

State is `.artifacts/deployment.json`; logs are `~/Library/Logs/p4-cpa/autodeploy.log`.
A failed or interrupted deployment latches a pause for all later polls. Investigate
before explicitly retrying with `P4_CPA_DEPLOY_RETRY=1 ./scripts/auto-deploy.sh`.
The state records the prior revision and backup. There is no automatic data restore:
a migrated database needs its matching backup to roll back. Automatic backups use
`BACKUP_KEEP=0` and retain all archives; monitor space and prune only deliberately.
Deployment archives live in the `deployments/` subdirectory of `BACKUP_DIR`
(default `~/Backups/p4-cpa`), outside normal daily backup pruning. Retries retain
the original pre-deployment backup reference as well as creating a fresh archive.

To pause across logins, `launchctl disable gui/$(id -u)/codes.p4.cpa.autodeploy` and
`launchctl bootout gui/$(id -u)/codes.p4.cpa.autodeploy`. Use `launchctl enable` before
reinstalling. A normal merge does not change the installed poller or its interval;
reinstall after plist changes. The host must be awake and logged in. Expect brief
service interruption for backup and container replacement. Verify the private HTTPS
manager and `https://macstudio.tailfb37f4.ts.net/` (P4 Code on the shared port)
after deployment.

## Moving to another host

1. Fence the current host first: stop its stack and disable its jobs. If unreachable,
   power it off or otherwise ensure it cannot continue or restart.
2. Take/copy the latest complete private archive. On the new host, restore `.env`,
   `config.yaml`, `auths/`, `data/` including `data.key`, and `plugins/` together into
   a checkout at the matching commit. Keep local paths and backup locations separate.
3. Start and verify, configure the new host's Serve mappings, repoint the
   `cpa.home.ccly.dev` record, and update client URLs. Accounts and history are only
   as recent as the backup. Only one instance is active.

## Verification boundary

Source builds, local health/connectivity, backup/restore, scripts and plist syntax
can be checked on the development Mac. Installing LaunchAgents, cold-boot recovery,
Studio sleep/power settings, actual tailnet HTTPS access from another device, and
provider OAuth are verified on the Studio. No jobs or Tailscale mappings are installed
by rendering templates or reading this guide.
