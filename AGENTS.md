# P4 CPA

Owned proxy and manager sources live in `cpa/` and `manager/`. Read their local instructions when editing them.

For ship, merge-and-deploy, or Mac Studio auto deployment, load [.agents/skills/p4-cpa-ship/SKILL.md](.agents/skills/p4-cpa-ship/SKILL.md) after the global ship skill. Deployment procedures live in that skill and [docs/hosting.md](docs/hosting.md).

The Mac Studio is the only host and uses the private tailnet; the Mac mini no longer runs this stack. Preserve runtime secrets and persistent data. Do not start another stack with the same accounts.
