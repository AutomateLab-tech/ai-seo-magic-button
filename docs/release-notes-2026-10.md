# AI-SEO Magic Button 0.1.2

- Upgrade the MCP SDK to 1.32.1 and proxy-addr to 2.0.8 to resolve the reported high and critical dependency advisories.
- Align the MCP output schema with the shared plan.json contract, including summary, categories and action variants. Valid plans no longer fail output validation.
- Run security regression and stdio MCP tests in CI. Recorded fixtures cover invalid inputs, actionable plans, multiple pages and an empty valid plan without contacting live providers.

The public plan format and CLI remain unchanged. Production dependency audit: zero vulnerabilities at verification.
