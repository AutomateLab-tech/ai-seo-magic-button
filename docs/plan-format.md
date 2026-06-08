# The dumb-agent-ready plan format + core-lib boundary (AL-723)

## Why this format

A fuzzy audit finding ("improve extractability") is useless to a weak agent. The
plan format turns findings into **atomic, runnable jobs**: each item is
self-contained, so a thin apply helper — or a dumb agent — can execute one item
with zero extra reasoning. All the *smart* work (which file, which tool, which
params, how to verify) is resolved at **plan time** and baked into the item, so
**apply time is pure execution**.

## `plan.json` schema (v1.0)

Authoritative types: [`src/core/schema.ts`](../src/core/schema.ts). A worked
example: [`examples/plan.example.json`](../examples/plan.example.json).

```jsonc
{
  "schema_version": "1.0",
  "target": "https://example.com",
  "generated_at": "2026-06-02T00:00:00.000Z",
  "generator": "ai-seo-magic-button@0.1.0",
  "summary": {
    "pages_audited": 4,
    "avg_score": 80,
    "grade": "B",
    "total_items": 6,
    "est_total_delta": 22,
    "by_severity": { "critical": 1, "high": 2, "medium": 2, "low": 1 }  // item count per severity
  },
  "items": [
    {
      "id": "p1-...",                 // stable slug
      "url": "https://example.com/x", // page the fix applies to
      "source_file": null,            // pre-mapped local file, or null (agent resolves)
      "category": "schema|structure|robots|technical|freshness|llms_txt|citation|content",
      "title": "...",
      "rationale": "...",
      "severity": "critical|high|medium|low|info",
      "priority": 1,                  // ascending; do 1 first
      "expected_score_delta": 12,     // estimated points gained
      "action": { /* see below */ },
      "acceptance": "how to verify the fix landed"
    }
  ]
}
```

### Severity tiers

`critical` > `high` > `medium` > `low` > `info`. Every *actionable* finding lands
in the plan with no threshold — an empty plan means a clean 100/100. Two kinds of
findings are excluded by default:

- **Anti-citation advice** ("block GPTBot") — always dropped; it contradicts the
  product goal of being citable.
- **`info` — purely-informational notes** whose suggested fix is a non-action
  (e.g. "Google-Agent ignores robots.txt — no action possible"). These have a
  `0` score delta and nothing to execute, so they're hidden unless you opt in
  with `--include-info` (CLI) / `include_info: true` (MCP tool). When included,
  they appear with `severity: "info"`.

### `action` — the deterministic execution descriptor

The apply layer switches on `action.type`:

| `type` | Driven by | Apply behaviour |
|---|---|---|
| `generate_llms_txt` | ai-seo `llms_txt_generate` | call tool → write `out_path` |
| `rewrite_aeo` | ai-seo `rewrite_aeo` | call tool → write back to `source_file` (or out dir); if no host LLM, emit a `*.prompt.md` for the agent |
| `rewrite_geo` | ai-seo `rewrite_geo` | same as above |
| `insert_schema` | deterministic | inject `jsonld` before `</head>` of `source_file`, or emit a snippet to paste |
| `manual` | the agent | follow `instructions` (e.g. edit robots.txt) |

Tool actions carry their **baked params** (`url`, `target_query`, `format`, …)
so apply never has to decide anything.

## Core-lib boundary decision

**Decision: the orchestration logic is a shared core library; the audit engines
stay as separate MCP processes the core SPAWNS as stdio subprocesses.**

The earlier worry (AL-723/AL-733) was that an MCP server can't cleanly call the
ai-seo / citation-intelligence MCPs "over the wire" — i.e. you can't rely on the
*host* to nest MCP calls. The resolution: don't rely on the host. The core lib
([`src/core`](../src/core)) is an MCP **client** that spawns each engine as a
child process via the MCP SDK's `StdioClientTransport`. That works identically
inside a CLI, a Claude skill, a plugin, or our own MCP server — because it is
just a subprocess, not a host-mediated MCP call.

So the boundary is:

- **Core lib (`src/core`)** — owns everything that is not UX: spawning the
  engines (`mcp-client`), crawl (`crawl`), audit orchestration (`audit`), plan
  synthesis (`plan`), apply helpers (`apply`), verify (`verify`), sink (`sink`).
- **Surface layers** — own UX only, import the core, add zero audit logic:
  - `src/cli.ts` — the local command line.
  - `src/mcp-server.ts` — exposes `generate_seo_plan` (AL-733).
  - `skill/` + `plugin/` — the Claude Code skill and plugin (AL-728).

This is why all surfaces stay thin and consistent: there is exactly one
implementation of audit + plan generation, and four ways to invoke it.
