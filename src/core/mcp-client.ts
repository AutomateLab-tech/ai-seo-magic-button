// Thin stdio MCP client (AL-723/AL-724 plumbing).
//
// The magic button is an ORCHESTRATOR: it spawns the ai-seo and
// citation-intelligence MCP servers as stdio subprocesses and calls their
// tools over JSON-RPC. Spawning-as-subprocess (rather than relying on the host
// to nest MCP calls) is what lets the SAME core lib run inside a CLI, a Claude
// skill, a plugin, OR our own MCP server — resolving the "an MCP server can't
// cleanly call other MCPs over the wire" problem noted in AL-723/AL-733.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface ToolClient {
  call<T = any>(name: string, args: Record<string, unknown>): Promise<T>;
  close(): Promise<void>;
}

interface ServerSpec {
  command: string;
  args: string[];
}

function tokenize(cmd: string): string[] {
  // Minimal shell-ish split; good enough for "node /path/to/index.js".
  return cmd.trim().split(/\s+/);
}

// Resolve how to launch a child MCP. Priority:
//   1. <PREFIX>_PATH  -> run with the current node binary (best for local dev)
//   2. <PREFIX>_CMD   -> full command string override
//   3. default        -> `npx -y <pkg>` (works once published)
function resolveSpec(prefix: string, pkg: string): ServerSpec {
  const path = process.env[`${prefix}_PATH`];
  if (path) return { command: process.execPath, args: [path] };
  const cmd = process.env[`${prefix}_CMD`];
  if (cmd) {
    const t = tokenize(cmd);
    return { command: t[0], args: t.slice(1) };
  }
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  return { command: npx, args: ["-y", pkg] };
}

export const AI_SEO_SPEC = () => resolveSpec("AISEO_MCP", "@automatelab/ai-seo-mcp");
export const CITATION_SPEC = () => resolveSpec("CITATION_MCP", "@automatelab/citation-intelligence");

async function connect(spec: ServerSpec, label: string): Promise<ToolClient> {
  const transport = new StdioClientTransport({
    command: spec.command,
    args: spec.args,
    env: process.env as Record<string, string>,
    stderr: "ignore",
  });
  const client = new Client({ name: "ai-seo-magic-button", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);
  return {
    async call<T>(name: string, args: Record<string, unknown>): Promise<T> {
      const res: any = await client.callTool({ name, arguments: args });
      const text: string | undefined = res?.content?.find((c: any) => c.type === "text")?.text;
      // A tool that returns isError (or an error-shaped text payload) is a
      // failure, not a result — surface it so callers don't persist garbage.
      if (res?.isError || (text && /^MCP error -?\d/.test(text))) {
        throw new Error(`${name} failed: ${text ?? "tool error"}`);
      }
      if (res?.structuredContent && Object.keys(res.structuredContent).length > 0) {
        return res.structuredContent as T;
      }
      if (text) {
        try {
          return JSON.parse(text) as T;
        } catch {
          return { _text: text } as unknown as T;
        }
      }
      return res as T;
    },
    async close() {
      try {
        await client.close();
      } catch {
        /* best effort */
      }
    },
  };
}

export const connectAiSeo = () => connect(AI_SEO_SPEC(), "ai-seo");
export const connectCitation = () => connect(CITATION_SPEC(), "citation-intelligence");
