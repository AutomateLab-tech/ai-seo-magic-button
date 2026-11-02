#!/usr/bin/env node
import { readFileSync as readMcpPackage } from "node:fs";
const MCP_PACKAGE_VERSION: string = JSON.parse(readMcpPackage(new URL("../package.json", import.meta.url), "utf8")).version;
// MCP server surface (internal follow-up) — the portable core that runs in any MCP host
// (Cursor, Cline, Windsurf, Claude Desktop). Exposes the magic button as a
// single tool built on the SHARED core lib (src/core), the same lib the CLI,
// skill, and plugin use. No audit logic lives here — only the MCP wrapping.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { generatePlan, planToMarkdown } from "./core/index.js";

const server = new McpServer({ name: "ai-seo-magic-button", version: MCP_PACKAGE_VERSION });

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
      schema_version: z.literal("1.0"),
      target: z.string(),
      generated_at: z.string(),
      generator: z.string(),
      summary: z.object({
        pages_audited: z.number(),
        avg_score: z.number(),
        grade: z.string(),
        total_items: z.number(),
        est_total_delta: z.number(),
        by_severity: z.partialRecord(z.enum(["critical", "high", "medium", "low", "info"]), z.number()),
        platform_readiness: z.object({
          chatgpt: z.number().optional(), perplexity: z.number().optional(),
          google_ai_overview: z.number().optional(), gemini: z.number().optional(),
        }).optional(),
        score_caps: z.array(z.string()).optional(),
      }),
      items: z.array(z.object({
        id: z.string(), url: z.string(), source_file: z.string().nullable(),
        category: z.enum(["schema", "structure", "robots", "technical", "freshness",
          "llms_txt", "citation", "evidence", "trust", "entity", "content"]),
        severity: z.enum(["critical", "high", "medium", "low", "info"]),
        title: z.string(), rationale: z.string(), priority: z.number(),
        expected_score_delta: z.number(),
        action: z.discriminatedUnion("type", [
          z.object({ type: z.literal("generate_llms_txt"), tool: z.literal("llms_txt_generate"),
            params: z.object({ domain: z.string(), max_pages: z.number().optional() }), out_path: z.string() }),
          z.object({ type: z.literal("generate_pricing_md"), tool: z.literal("pricing_generate"),
            params: z.object({ domain: z.string(), pricing_url: z.string().optional() }), out_path: z.string() }),
          z.object({ type: z.literal("rewrite_aeo"), tool: z.literal("rewrite_aeo"),
            params: z.object({ url: z.string().optional(), text: z.string().optional(), target_query: z.string(),
              format: z.string().optional(), max_words: z.number().optional() }) }),
          z.object({ type: z.literal("rewrite_geo"), tool: z.literal("rewrite_geo"),
            params: z.object({ url: z.string().optional(), text: z.string().optional(), target_query: z.string(),
              add_comparison_table: z.boolean().optional(), max_words: z.number().optional() }) }),
          z.object({ type: z.literal("insert_schema"), jsonld: z.record(z.string(), z.unknown()) }),
          z.object({ type: z.literal("manual"), instructions: z.string() }),
        ]),
        acceptance: z.string(), failure_signal: z.string().optional(), leading_indicator: z.string().optional(),
      })),
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
