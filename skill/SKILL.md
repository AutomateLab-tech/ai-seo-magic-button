---
name: ai-seo-magic-button
description: >
  The one-command "magic button" for AI-SEO. Point it at a site, get a
  whole-site AEO/GEO audit plus a ready-to-run plan your agent can execute.
  Trigger when the user says "audit my site for AI SEO", "make my site
  citable by ChatGPT/Perplexity/Claude", "AEO/GEO audit", "generate an
  AI-SEO plan", or "improve my AI citation eligibility".
---

# ai-seo-magic-button

The magic button: **point it at your site, get a whole-site AEO/GEO audit plus a
ready-to-run plan your agent can execute.** It produces an actionable PLAN
(`plan.json` + markdown checklist) — not direct edits. You then drive your agent
against the plan to execute it.

It is a thin orchestration layer over two engines: the **ai-seo** MCP (audit +
score + rewrite) and the **citation-intelligence** MCP (what AI engines cite).
Both are spawned automatically as subprocesses; you do not call them yourself.

## Setup (once)

This skill shells out to the `ai-seo-magic-button` CLI. From the product dir:

```
npm install && npm run build
```

The child MCPs resolve via `npx` by default. For local engines, point at them:

```
AISEO_MCP_PATH=/abs/path/ai-seo-mcp/dist/index.js
CITATION_MCP_PATH=/abs/path/citation-intelligence-mcp/dist/index.js
```

## The two-step flow

**Step 1 — run it (audit → plan).** It crawls the site, audits each page, pulls
citation gaps, and writes `plan.json` + `plan.md`:

```
node dist/cli.js audit <domain> --pages 10 --out plan.json --md plan.md
```

Read `plan.json`. Present the summary (avg score, grade, top fixes by estimated
score lift, and the `by_severity` tally) to the user. Each item is self-contained:
`url`, `category`, `severity` (`critical|high|medium|low|info`),
`expected_score_delta`, an `action` (the tool + baked params), and an `acceptance`
check. The plan lists every actionable finding (empty = 100/100); purely-
informational notes are hidden unless you add `--include-info`.

**Step 2 — execute the plan.** Work the items in `priority` order:

- `action.type: "generate_llms_txt" | "rewrite_aeo" | "rewrite_geo"` — run the
  apply helper, which drives the named ai-seo tool and writes the result back:
  ```
  node dist/cli.js apply plan.json --out magic-button-out
  ```
  Items that need an LLM the host can't provide are emitted as `*.prompt.md` and
  marked `needs_agent` — finish those yourself, in this Claude session.
- `action.type: "insert_schema"` — paste the JSON-LD into the page `<head>`.
- `action.type: "manual"` — follow `action.instructions` (e.g. edit robots.txt).

**Verify the lift.** After executing, re-audit and diff the score:

```
node dist/cli.js verify plan.json
```

Report the before → after delta to the user as proof.

## Optional: push to a board

If the user runs agency-os (a Notion Tasks DB), push each plan item in as a task
so it flows Suggestion → To-Do → Done:

```
node dist/cli.js sink plan.json
```

With no board configured it degrades to a local `plan.md` checklist.

## Rules

- This produces an **actionable plan, not direct edits**. Never imply it edited
  the live site. Apply writes to `magic-button-out/` or a mapped `source_file`.
- Honour `priority`. Lead with critical/high items and the biggest
  `expected_score_delta`.
- Never recommend blocking AI crawlers — being cited requires allowing them.
