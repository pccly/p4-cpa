# Upstream provenance

P4 CLI Proxy API (P4 CPA) starts its independent release line at **1.0.0**.
The web panel, manager service, and proxy core share that product version.
Dependency, protocol, database-schema, and provider-model versions retain their
original meanings and are not reset.

## Imported baseline

| Component | Original project | Imported release | Source commit |
| --- | --- | --- | --- |
| Proxy core (`cpa/`) | [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) | v8.0.11 | e2bff0107bb307337aaa19018ccddd55f64253d5 |
| Manager (`manager/`) | [CPA Manager Plus](https://github.com/seakee/CPA-Manager-Plus) | v1.14.2 | 05ebb7f275dbe575211cb886436d4b99936c1cd9 |

The imported sources and Git subtree history remain available for attribution,
reference, and deliberate future integration. Their release numbers are provenance,
not P4 CPA product versions. The `cpa-upstream` and `manager-upstream` remotes and
`scripts/sync-upstream.sh` are optional maintenance tools, not release authorities.

## P4 CPA 1.0.1 integration

Version **1.0.1** integrates CLIProxyAPI **v8.0.32**
(`911f49cbd49f4fe2516979754a7488a3fd14fe64`) and CPA Manager Plus **v1.14.7**
(`64ce94e6aa1af691555429a3211e67c59c0480ad`). The original import baselines above
remain the historical provenance. Use these new source commits as the comparison
base for the next upstream integration.

This update includes credential refresh and cooldown concurrency fixes, Claude
MCP tool handling and prompt-cache fixes, config reload/write concurrency guards,
quota reset reconciliation, retained usage-history checks, corrected cache-token
accounting, and background refresh improvements. P4's reset-first routing,
extra-usage controls, HTTP-default Codex transport, branding, settings layout,
and disabled upstream update polling remain in place. The unused historical
`cpa/assets/aiberm.png` asset is retained.

Before deployment, take a consistent backup of the persistent database and archives.
Manager automatically corrects eligible historical accounting on restart, which
can change usage and cost rollups. Validate this against a database copy without
starting a second stack against the shared provider accounts. The new latency
covering index uses deferred offline maintenance on existing non-empty databases;
its absence postpones the performance benefit but does not block correctness
fixes or startup. Follow the stopped-service maintenance procedure in
[hosting.md](hosting.md). No database maintenance runs as part of source integration.

## Independent releases

P4 CPA no longer displays upstream release links, latest-version badges, or update
notifications. The upstream update page redirects to System Info. Automatic manager
release polling is disabled in our image and Compose configuration. Update-library
source remains for historical reference; there is no P4 CPA update feed configured.

Set the same product version in `docker-compose.yml`, the manager workspace package
versions and lockfile, and Dockerfile version defaults for future releases. The web
build uses the explicit `VERSION` input or its package version, never upstream Git tags.
Build source commit identifiers continue to identify imported code where appropriate;
they are not rewritten as fabricated product commits.

Update through reviewed P4 CPA source and rebuild our images. Do not install upstream
release packages over this fork. Any future upstream integration is a deliberate
source change followed by compatibility checks and a P4 CPA release.

## Attribution and compatibility

Original MIT licenses and copyright notices remain in `cpa/LICENSE`,
`manager/LICENSE`, and [NOTICE](../NOTICE). The upstream manuals in
`manager/apps/docs/` describe the imported projects. Use [hosting.md](hosting.md)
for this stack's operations.

Go module paths, API headers, storage identifiers, environment variable names and
Compose service names retain compatibility. They are not user-facing product names.
