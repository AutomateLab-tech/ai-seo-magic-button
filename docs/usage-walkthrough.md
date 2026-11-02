# Review and execute an audit plan

The MCP entry point is `generate_seo_plan` with `domain` and optional `pages`. The same core also supports the CLI and skill/plugin wrappers. Check the README's current installation paths before running a wrapper.

Open `examples/plan.example.json` as a format example. A plan contains `schema_version`, `target`, `generator`, `summary` and `items`. Each item supplies a source URL, category, severity, priority, action and acceptance text. The example's score is illustrative; it is not a measured score for your site.

Check each action's destination and proposed change. Resolve a missing `source_file` against the real site before editing. Keep a copy of the original file, apply a small group of related items, then verify their acceptance conditions. Estimated score gains are not guaranteed improvements.

The core includes apply and verification helpers; the MCP planning call itself returns a plan. A generated manual action still requires an actual implementation decision. Fix the content or markup rule at its source, then test another affected page. Record the real result and any unresolved item before continuing.

For the recorded example, run `npx -y ai-seo-magic-button apply examples/plan.example.json --dry-run --out fixture-results`. The checked example reports seven manual items needing an agent and one skipped tool action. A dry run does not implement those items.
