// Apply helpers (AL-780) — the deterministic execution layer.
//
// THIN by design: all the smart work (mapping, fix selection, params) happened
// at plan time (AL-725). Apply just iterates the plan and drives the bundled
// ai-seo tools. This is what lets the product work behind a weak/dumb agent.
//
// For each item:
//   open the pre-mapped source (if any) -> call the named tool with baked
//   params -> write the result back (or to the out dir) -> record the delta.
//
// Tool rewrites (rewrite_aeo/geo) need an LLM via MCP sampling. When the host
// provides none, those tools return mode:"prompt_template" — we surface those
// as "needs agent" so the executing agent finishes them. Nothing is silently
// dropped.

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { connectAiSeo, type ToolClient } from "./mcp-client.js";
import type { Plan, PlanItem } from "./schema.js";

export interface ApplyOptions {
  outDir?: string;   // where generated artifacts land (default ./magic-button-out)
  repoRoot?: string; // root for resolving source_file paths (default cwd)
  dryRun?: boolean;
  onProgress?: (msg: string) => void;
}

export interface ApplyRecord {
  id: string;
  title: string;
  status: "applied" | "needs_agent" | "skipped" | "error";
  detail: string;
  output_path?: string;
}

export interface ApplyResult {
  applied: ApplyRecord[];
  generated_at: string;
}

async function write(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

export async function applyPlan(plan: Plan, opts: ApplyOptions = {}): Promise<ApplyResult> {
  const outDir = resolve(opts.outDir ?? "magic-button-out");
  const repoRoot = resolve(opts.repoRoot ?? process.cwd());
  const dryRun = opts.dryRun ?? false;
  const log = opts.onProgress ?? (() => {});
  const records: ApplyRecord[] = [];

  // Only spawn ai-seo if at least one item needs a tool.
  const needsTool = plan.items.some((it) => "tool" in it.action);
  let aiSeo: ToolClient | null = null;
  try {
    if (needsTool && !dryRun) {
      log("spawning ai-seo MCP for tool-driven items…");
      aiSeo = await connectAiSeo();
    }

    for (const item of [...plan.items].sort((a, b) => a.priority - b.priority)) {
      records.push(await applyItem(item, { aiSeo, outDir, repoRoot, dryRun, log }));
    }
  } finally {
    await aiSeo?.close();
  }

  return { applied: records, generated_at: new Date().toISOString() };
}

async function applyItem(
  item: PlanItem,
  ctx: { aiSeo: ToolClient | null; outDir: string; repoRoot: string; dryRun: boolean; log: (m: string) => void }
): Promise<ApplyRecord> {
  const base = { id: item.id, title: item.title };
  const action = item.action;

  if (ctx.dryRun && action.type !== "manual") {
    return { ...base, status: "skipped", detail: `dry-run: would run ${"tool" in action ? action.tool : action.type}` };
  }

  try {
    switch (action.type) {
      case "generate_llms_txt": {
        const res = await ctx.aiSeo!.call<any>(action.tool, action.params);
        const content: string =
          typeof res === "string" ? res : res?.content ?? res?.llms_txt ?? res?._text ?? JSON.stringify(res);
        const out = join(ctx.outDir, action.out_path);
        await write(out, content);
        return { ...base, status: "applied", detail: `wrote ${content.length} bytes`, output_path: out };
      }

      case "generate_pricing_md": {
        const res = await ctx.aiSeo!.call<any>(action.tool, action.params);
        const content: string =
          typeof res === "string" ? res : res?.pricing_md ?? res?.content ?? res?._text ?? JSON.stringify(res);
        const out = join(ctx.outDir, action.out_path);
        await write(out, content);
        return { ...base, status: "applied", detail: `wrote ${content.length} bytes`, output_path: out };
      }

      case "rewrite_aeo":
      case "rewrite_geo": {
        const tool = action.type === "rewrite_aeo" ? "rewrite_aeo" : "rewrite_geo";
        const res = await ctx.aiSeo!.call<any>(tool, action.params);
        const mode = res?.mode;
        const text: string = typeof res === "string" ? res : res?.rewritten ?? res?.content ?? res?._text ?? "";
        if (mode === "prompt_template" || !text) {
          // No host LLM — hand the self-contained prompt to the executing agent.
          const out = join(ctx.outDir, `${item.id}.prompt.md`);
          await write(out, typeof res === "string" ? res : res?.prompt ?? JSON.stringify(res, null, 2));
          return { ...base, status: "needs_agent", detail: "no host LLM; emitted rewrite prompt for the agent", output_path: out };
        }
        // Write the rewrite back to the source file if mapped, else to the out dir.
        if (item.source_file) {
          const dest = resolve(ctx.repoRoot, item.source_file);
          await write(dest, text);
          return { ...base, status: "applied", detail: "rewrote source file", output_path: dest };
        }
        const out = join(ctx.outDir, `${item.id}.rewrite.md`);
        await write(out, text);
        return { ...base, status: "applied", detail: "wrote rewrite to out dir (no source_file mapped)", output_path: out };
      }

      case "insert_schema": {
        const jsonld = `<script type="application/ld+json">\n${JSON.stringify(action.jsonld, null, 2)}\n</script>\n`;
        if (item.source_file) {
          const dest = resolve(ctx.repoRoot, item.source_file);
          const existing = await readFile(dest, "utf8").catch(() => "");
          const next = existing.includes("</head>") ? existing.replace("</head>", `${jsonld}</head>`) : existing + jsonld;
          await write(dest, next);
          return { ...base, status: "applied", detail: "injected JSON-LD before </head>", output_path: dest };
        }
        const out = join(ctx.outDir, `${item.id}.schema.html`);
        await write(out, jsonld);
        return { ...base, status: "needs_agent", detail: "no source_file mapped; emitted schema snippet to paste", output_path: out };
      }

      case "manual":
      default:
        return { ...base, status: "needs_agent", detail: action.type === "manual" ? action.instructions : "unknown action" };
    }
  } catch (e: any) {
    return { ...base, status: "error", detail: String(e?.message ?? e) };
  }
}
