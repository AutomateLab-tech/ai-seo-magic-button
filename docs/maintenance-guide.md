# AI-SEO Magic Button maintenance guide

Review the generated plan before execution. Scores and expected improvements are estimates. The core creates a plan; changes to source files belong in your agent workflow and need separate verification.

## Installation and compatibility

Follow the repository README for the supported install method and runtime. Pin the version used in a reproducible example. Keep credentials in your client configuration, outside shared fixtures.

## Verified tool surface

The local compiled server returned these names through MCP `tools/list` on 12 October 2026. Recheck after upgrading.

- `generate_seo_plan`

## First call

Start with `generate_seo_plan`. Required fields: `domain`. Read its input schema before passing a recorded fixture.

## Verify a change

Record the package or snapshot version, exact input, observation time and actual output. Check a materially different input and a valid neighboring case. Treat expected output as a fixture, not a live measurement.

## Usage walkthrough

See [the tested usage walkthrough](usage-walkthrough.md) for a concrete input and verification steps.

## Security and MCP checks

Run `npm ci`, `npm test`, and `npm audit --omit=dev --audit-level=high`. The tests use recorded provider fixtures and verify the full stdio plan response, invalid page counts, a multi-page plan and an empty valid plan. Version 0.1.2 updates the MCP SDK and proxy-addr and aligns the MCP output schema with the plan format.
