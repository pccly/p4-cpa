# Claude MCP tool search

Claude Code disables MCP tool search when `ANTHROPIC_BASE_URL` points to a custom
proxy unless `ENABLE_TOOL_SEARCH` is explicitly set. Without it, connected MCP
tool definitions load into the initial model context. CPA cannot enable this
client behavior from the server.

CPA's native Anthropic Messages path preserves `defer_loading`, the
`advanced-tool-use-2025-11-20` beta, and nested `tool_reference` blocks. OAuth tool
aliases are restored on both JSON and streaming responses. Deferred tools are
excluded from automatic tool cache breakpoints. Executor regression tests cover
discovery, reference replay, and invocation through both response paths.

## P4Code setup

For a Claude provider using this CPA's native Messages endpoint and a compatible
model, add this non-sensitive environment variable in P4Code Settings:

```text
ENABLE_TOOL_SEARCH   true
```

Keep the existing `ANTHROPIC_BASE_URL`, authentication, Claude home, MCP servers,
and instructions. Start a new session after saving; an already running Claude
process keeps its original environment.

Alternatively, set that provider's Binary path to the absolute path of
`scripts/claude-cpa.sh` in this checkout. The launcher runs `claude` from `PATH`,
enables tool search by default, and preserves an explicit `ENABLE_TOOL_SEARCH`
value, including `false` or `auto:5`. It requires an existing
`ANTHROPIC_BASE_URL` and does not supply or save credentials.

For terminal sessions, with the existing CPA environment already exported:

```sh
./scripts/claude-cpa.sh
# Or use the CLI directly:
ENABLE_TOOL_SEARCH=true claude
```

This repository does not change live P4Code provider settings. Selecting the
launcher or adding the environment variable is a client setup step, independent
of deploying CPA. Do not enable it indiscriminately for other gateways or models:
they must support tool references and the tool-search beta.

## Verify a new session

1. Confirm `ToolSearch` is available and unused MCP schemas are absent from the
   initial model context. Depending on CLI version, the request may omit unused
   definitions or send them with `defer_loading: true`. A list of tool names does
   not mean their schemas are loaded into context.
2. Ask Claude to discover and invoke one read-only MCP tool. Confirm a ToolSearch
   call, a result containing `tool_reference`, then that tool's successful call.
3. Compare the first model response's `input_tokens +
   cache_creation_input_tokens + cache_read_input_tokens` against a new session
   with the same model, instructions, MCP connections, and prompt but tool search
   disabled. This measures total initial context, not schema-only tokens.

Built-in tools follow separate loading rules. MCP servers configured with
`alwaysLoad: true` remain loaded upfront. A ToolSearch denial,
`CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`, unsupported models, or a gateway that
rejects tool references can prevent discovery; changing CPA alone cannot fix
those client or upstream constraints. Preserve required instructions and
integrations when comparing sessions.

Reference: [Claude Code tool-search configuration](https://code.claude.com/docs/en/mcp#configure-tool-search).
