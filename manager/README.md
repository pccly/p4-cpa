# P4 CPA manager

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="logo-white.svg">
  <img src="logo.svg" alt="P4 CPA" width="320">
</picture>

The P4 CPA management panel, with the Kiln theme and Ember core identity.
This directory is the manager subtree of [P4 CPA](https://github.com/pccly/p4-cpa).

- [Stack setup and configuration](../README.md)
- [Private hosting, backups, and upgrades](../docs/hosting.md)
- [中文](README_CN.md)

## Development

From this directory, run `npm ci`, then `npm run dev` for the web panel or
`npm run dev:demo` for fictional demo data. Run `npm run build` to build the panel.
Build the complete manager image from the repository root with
`docker compose build cpa-manager-plus`.

## Upstream and updates

Based on [CPA Manager Plus](https://github.com/seakee/CPA-Manager-Plus), imported
at v1.14.2. The bundled `apps/docs/` manuals describe upstream behavior;
use the root deployment guide for this private stack.

P4 CPA starts at 1.0.0 and uses its own release line. Upstream update prompts are
disabled. See [upstream provenance and release policy](../docs/upstream.md).
Review source changes and rebuild local images using the root guide. Upstream installers,
images, and release packages do not include the P4 CPA branding or deployment setup.
Technical environment names, API headers, and storage identifiers remain compatible.

Upstream copyright and MIT terms remain in [LICENSE](LICENSE) and [NOTICE](../NOTICE).
