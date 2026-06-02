# ai-seo-magic-button

**Point it at your site, get a whole-site AEO/GEO audit plus a ready-to-run plan
your agent can execute.** One magic button for AI-SEO - runs as a Claude skill, a
Claude plugin, **and** an MCP server, so it works in any MCP host (Cursor, Cline,
Windsurf, Claude Desktop).

It produces an **actionable plan, not direct edits**: a portable `plan.json` plus
a markdown checklist, where every item is self-contained and agent-executable.
You then run your agent against the plan to execute it.

Under the hood it is a thin orchestration layer over two engines:
[`@automatelab/ai-seo-mcp`](https://www.npmjs.com/package/@automatelab/ai-seo-mcp)
(audit + score + rewrite) and
[`@automatelab/citation-intelligence`](https://www.npmjs.com/package/@automatelab/citation-intelligence)
(what AI engines cite). No API keys are needed for the core audit→plan flow.

## The two-step flow

1. **Run it** → it crawls your site, audits every page, and generates
   `plan.json` + a markdown checklist, prioritized by estimated score lift.
2. **Run your agent against the generated plan** to execute it (rewrites, schema,
   llms.txt, robots) - then verify the score actually lifted.

## Install

### As an MCP server (any host)

```jsonc
// e.g. claude_desktop_config.json / Cursor / Cline
{
  "mcpServers": {
    "ai-seo-magic-button": {
      "command": "npx",
      "args": ["-y", "ai-seo-magic-button", "mcp"]
    }
  }
}
```

Exposes one tool: **`generate_seo_plan`** `{ domain, pages? }` → returns the full
`plan.json` (as structured content) plus the markdown checklist.

### As a Claude Code plugin

```
/plugin install https://github.com/AutomateLab-tech/ai-seo-magic-button
```

### As a Claude skill

Copy `skill/` into your `.claude/skills/` (or install via the plugin above). The
skill is the conversational magic-button UX - see [`skill/SKILL.md`](skill/SKILL.md).

## CLI

```bash
npm install && npm run build

# audit -> plan.json + plan.md
node dist/cli.js audit example.com --pages 10

# execute the plan's tool-driven items (writes to ./magic-button-out)
node dist/cli.js apply plan.json

# re-audit and diff the score (proof the plan worked)
node dist/cli.js verify plan.json

# optional: push items into an agency-os Notion board (else local checklist)
node dist/cli.js sink plan.json
```

The child engines resolve via `npx` by default. To use local builds:

```bash
export AISEO_MCP_PATH=/abs/path/ai-seo-mcp/dist/index.js
export CITATION_MCP_PATH=/abs/path/citation-intelligence-mcp/dist/index.js
```

## Worked example

```
$ node dist/cli.js audit example.com --pages 2

https://example.com
  pages audited: 1 · avg score: 48 (D)
  fixes: 8 · est. lift: +78 points
   1. [critical] +12 No JSON-LD structured data found on this page.
   2. [critical] +12 No FAQ structure found (no FAQPage schema or H3 question headings).
   3. [critical] +12 No sitemap found at standard locations.
   6. [high]     +10 Rewrite for AEO: this page
   7. [medium]   +4  Low authority signals - missing Organization/author schema.
   8. [medium]   +4  No canonical link element found.
```

A full sample `plan.json` is in [`examples/plan.example.json`](examples/plan.example.json).
Each item carries a self-contained `action` (the tool + baked params) and an
`acceptance` check - see [`docs/plan-format.md`](docs/plan-format.md).

## How it is built

One shared core lib, four thin surfaces. See
[`docs/scope.md`](docs/scope.md) for positioning and
[`docs/plan-format.md`](docs/plan-format.md) for the schema + core-lib boundary.

```
src/core/   audit + plan + apply + verify + sink  (the only place with logic)
src/cli.ts        CLI surface
src/mcp-server.ts MCP server surface (generate_seo_plan)
skill/            Claude skill surface
plugin/           Claude plugin surface
```

## License

MIT
