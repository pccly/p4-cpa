# p4-cpa

Private deployment stack for [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)
and [CPA Manager Plus](https://github.com/seakee/CPA-Manager-Plus) Full Mode.
Both source trees live in this repository as Git subtrees with upstream history.
Docker builds our own `p4-cpa/cpa:local` and `p4-cpa/manager:local` images.
CPA handles model traffic; CPAMP
provides the management UI and persistent usage history.

For the always-on Mac mini setup, private HTTPS, backups, upgrades, and manual
Studio failover, see [Hosting and operations](docs/hosting.md).

## Quick start

Requires Docker with Compose v2+ (Docker Desktop or OrbStack on macOS), Bash,
and Python 3. Builds download Go, Node, Debian/Alpine base images and dependencies.
The source projects support Linux amd64 and arm64; local verification uses arm64.

```sh
git clone git@github.com:pccly/p4-cpa.git
cd p4-cpa
./scripts/init.sh
docker compose build
docker compose up -d --wait
```

Open <http://127.0.0.1:18317/management.html> and log in with `CPAMP_ADMIN_KEY`
from your local `.env` (open it in an editor). The CPA connection is preconfigured
as `http://cli-proxy-api:8317`. Add your own provider credentials through the
manager's OAuth Login or AI Providers page. No provider accounts are bundled.
Use `CPA_CLIENT_KEY` from `.env` in API clients with base URL
`http://127.0.0.1:8317/v1`. An empty installation has no available models.

```sh
docker compose ps
./scripts/verify.sh
docker compose down
```

`down` stops this project while retaining local data. Do not run another stack
against these same directories. Use one CPAMP collector per CPA usage queue.

## Configuration and keys

`init.sh` creates independent random management, admin, and client keys, writes
mode-600 `.env` and `config.yaml`, and creates private data directories. Re-running
it preserves existing secrets and configuration. You may copy `.env.example` to
`.env` and change ports or image references before initialization; blank keys are
generated. A lone existing `config.yaml` is preserved and requires restoring its
matching `.env`. Do not commit generated files or output from `docker compose config`.

- `CPA_MANAGEMENT_KEY` authorizes CPAMP to administer CPA.
- `CPAMP_ADMIN_KEY` signs into the CPAMP panel.
- `CPA_CLIENT_KEY` authorizes inference clients.

The manager uses upstream-supported `CPA_UPSTREAM_URL`, `CPA_MANAGEMENT_KEY`, and
`CPA_MANAGER_ADMIN_KEY` environment variables. Docker administrators can inspect
these values. This is an environment-managed deployment; saved panel configuration
and encrypted state still require `data/data.key`. Rotate a key deliberately in
both `.env` and the corresponding `config.yaml` setting, then recreate containers.
CPA hashes its management key in `config.yaml` on startup; `.env` keeps the original.
Editing `CPA_CLIENT_KEY` in `.env` alone does not update CPA's active key.

## Modify and sync source

- `cpa/`: CLIProxyAPI, initially `v8.0.11`; builds with its own `Dockerfile`.
- `manager/`: CPA Manager Plus, initially `v1.14.2`; builds with its own
  `Dockerfile.manager-server` (Go service plus embedded Node-built web panel).

Edit these files directly, commit changes here, and run `docker compose build`
followed by `docker compose up -d --wait`. No upstream application image is used.
Existing `AGENTS.md` and `CLAUDE.md` inside the source trees apply to their own scope.
No root imports or external source checkouts are required.

Upstream remotes are `cpa-upstream` and `manager-upstream`. After cloning this
repository, the sync helper adds a missing remote and checks its URL. Choose an
explicit release tag or branch; it never syncs both projects implicitly:

```sh
./scripts/sync-upstream.sh cpa v8.0.11
./scripts/sync-upstream.sh manager v1.14.2
```

The helper uses `git subtree pull` with full history and requires a clean worktree.
Review changes and resolve any merge conflicts normally. Update build version
arguments in `docker-compose.yml` when advancing upstream. `CPA_BUILD_DATE` can
override the default imported source timestamp in build metadata. Back up persistent
data, rebuild, and run `./scripts/verify.sh`. CPA v8 no longer provides legacy RESP
output, so this stack explicitly uses CPAMP's HTTP usage collector.

## Ports and private access

| Host default | Container | Purpose |
| --- | --- | --- |
| 127.0.0.1:8317 | CPA:8317 | Inference and management API |
| 127.0.0.1:18317 | CPAMP:18317 | Full management panel |
| 127.0.0.1:8085 | CPA:8085 | OAuth callback |
| 127.0.0.1:1455 | CPA:1455 | OAuth callback |
| 127.0.0.1:54545 | CPA:54545 | OAuth callback |
| 127.0.0.1:51121 | CPA:51121 | OAuth callback |
| 127.0.0.1:11451 | CPA:11451 | OAuth callback |

Ports can be overridden through `.env`. Set `BIND_IP` to this host's Tailscale IPv4
address for direct tailnet access, then recreate containers. Restrict access using
your tailnet ACLs. OAuth ports remain on loopback via separate `OAUTH_BIND_IP`.
The containers share one Compose bridge with outbound access for provider APIs.
CPA `management.allow-remote` is necessary for the manager container; host bindings
limit external access. Its separate built-in panel is disabled.

## OAuth on a headless host

Start OAuth Login in CPAMP, then open the provider authorization URL in your local
browser. Some providers redirect to `http://localhost:<callback-port>/...`, where
localhost means the browser's machine. For remote hosts, CPAMP supports pasting the
**complete callback URL** into its callback field, even when that local page fails
to load. Preserve both code and state, and never share callback URLs or auth files.
Device-code providers do not need a callback listener.

Alternatively, establish SSH forwarding before starting login, for example for
Codex with default host ports:

```sh
ssh -N -L 1455:127.0.0.1:1455 user@your-host
```

Forward the provider's selected port. If you changed the published host port,
keep the local port matching the provider callback and forward to that configured
host port (for example `-L 1455:127.0.0.1:21455`). Port publication alone does not
change OAuth redirect URLs. Callbacks only listen while their login flow is active.

## Persistent data

| Path | Contents |
| --- | --- |
| `.env`, `config.yaml` | Deployment secrets and CPA configuration |
| `auths/` | Provider OAuth credentials |
| `data/` | CPAMP SQLite databases, sidecars, `data.key`, archives |
| `logs/` | CPA logs |
| `plugins/` | Optional CPA plugins, disabled by default |

Stop both containers before copying the directories for a consistent backup.
Always back up the entire `data/` directory **including `data.key` together with
SQLite**; also retain `.env`, `config.yaml`, and `auths/`. Store backups privately.
Losing `data.key` prevents recovery of management keys encrypted in the database.

## Upstream references and license

- [CPA configuration](https://github.com/router-for-me/CLIProxyAPI/blob/v8.0.11/config.example.yaml)
- [CPAMP Docker deployment and environment settings](https://github.com/seakee/CPA-Manager-Plus/blob/v1.14.2/apps/docs/en/deployment/docker.md)
- [CPAMP OAuth callbacks](https://github.com/seakee/CPA-Manager-Plus/blob/v1.14.2/apps/docs/en/manual/oauth.md)

Deployment files are MIT licensed. Upstream applications retain their own MIT
licenses and copyrights; see [NOTICE](NOTICE). Image dependencies retain their
respective licenses. Upstream source and original LICENSE files are retained in `cpa/` and `manager/`.
