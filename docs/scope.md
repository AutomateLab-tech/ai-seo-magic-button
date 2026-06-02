# ai-seo-magic-button — scope & positioning (AL-722)

## Promise

**Point it at your site, get a whole-site AEO/GEO audit plus a ready-to-run plan
your agent can execute.**

The output is an *analysis and a plan*, not direct edits. The product audits and
proposes; your agent (in any MCP host) executes. This "analyze and propose, not
fix" framing is the settled positioning — the apply helpers exist to make the
plan trivially executable, but they run the plan you can read, never silent
edits to a live site.

## What it is

- A **whole-site** AEO/GEO/LLM-visibility auditor. Crawls the sitemap, audits
  every sampled page, and layers in citation-gap signal.
- A generator of a **portable, structured plan** (`plan.json` + a markdown
  checklist) where every item is self-contained and agent-executable.
- A thin **orchestration layer** over two engines we already ship:
  - **ai-seo** (AI Citation Toolkit) — audit, score, rewrite for AEO/GEO.
  - **citation-intelligence** — which URLs AI engines cite, and gaps.
- Shipped on **all three surfaces** off one shared core lib: a Claude **skill**
  (the magic-button UX), a Claude **plugin** (bundles the skill), and an **MCP
  server** (`generate_seo_plan`, runs in Cursor/Cline/Windsurf/Claude Desktop).

## What it is not

- **Not** a single-URL checker — that is the existing web tool / GitHub Action.
  The value here is whole-site coverage and a runnable plan.
- **Not** a tool that edits your live site directly. It writes a plan; execution
  is explicit and reviewable.
- **Not** a re-implementation of the audit engines. It drives them.
- **Not** dependent on any API keys for the core audit→plan flow (the ai-seo and
  citation-intelligence audit/predict paths are rule-based). LLM-dependent
  rewrites degrade to prompt templates the executing agent finishes.

## Dependencies

- `@automatelab/ai-seo-mcp`
- `@automatelab/citation-intelligence`

Both are spawned as stdio subprocesses by the core lib. Resolve via `npx` by
default, or point `AISEO_MCP_PATH` / `CITATION_MCP_PATH` at local builds.

## Target audience

- Site owners and content teams who want AI-citation visibility (ChatGPT,
  Perplexity, Claude, Gemini, Google AI Overviews) and want a plan their coding
  agent can just run.
- Agencies running client sites who want a repeatable audit → plan → execute →
  verify loop.
