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
