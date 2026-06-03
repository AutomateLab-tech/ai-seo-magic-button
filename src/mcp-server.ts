#!/usr/bin/env node
// MCP server surface (AL-733) — the portable core that runs in any MCP host
// (Cursor, Cline, Windsurf, Claude Desktop). Exposes the magic button as a
// single tool built on the SHARED core lib (src/core), the same lib the CLI,
// skill, and plugin use. No audit logic lives here — only the MCP wrapping.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { generatePlan, planToMarkdown } from "./core/index.js";

const server = new McpServer({ name: "ai-seo-magic-button", version: "0.1.0" });

server.registerTool(
  "generate_seo_plan",
  {
    title: "Generate a whole-site AI-SEO plan",
    description:
      "Crawl a site, run a whole-site AEO/GEO audit (via the ai-seo + citation-intelligence engines), and return a portable, agent-executable plan.json plus a markdown checklist. This produces an actionable PLAN, not direct edits.",
    inputSchema: {
      domain: z.string().describe("Site to audit — hostname or origin, e.g. example.com"),
      pages: z.number().int().min(1).max(50).optional().describe("Max pages to audit (default 10)"),
      include_info: z
        .boolean()
        .optional()
        .describe("Include purely-informational findings (non-actionable notes). Off by default."),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    outputSchema: {
      domain: z.string(),
      pages_audited: z.number(),
      generated_at: z.string(),
      items: z.array(
        z.object({
          url: z.string(),
          category: z.enum(["schema", "structure", "citation", "content"]),
          severity: z.enum(["critical", "high", "medium", "low", "info"]),
          title: z.string(),
          expected_score_delta: z.number(),
          action: z.object({
            tool: z.string(),
            params: z.record(z.unknown()),
          }),
          acceptance: z.string(),
        })
      ),
    },
  },
  async ({ domain, pages, include_info }) => {
    const plan = await generatePlan(domain, { pages: pages ?? 10, includeInfo: include_info ?? false });
    return {
      content: [{ type: "text", text: planToMarkdown(plan) }],
      structuredContent: plan as unknown as Record<string, unknown>,
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
