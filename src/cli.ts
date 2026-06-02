#!/usr/bin/env node
// ai-seo-magic-button CLI — the local "magic button".
//
//   ai-seo-magic-button audit  <domain> [--pages N] [--out plan.json] [--md plan.md]
//   ai-seo-magic-button apply  <plan.json> [--dry-run] [--out dir]
//   ai-seo-magic-button verify <plan.json> [--pages N]
//   ai-seo-magic-button run    <domain> [--pages N]      (audit -> plan -> checklist)

import { readFile, writeFile } from "node:fs/promises";
import {
  auditSite,
  synthesizePlan,
  planToMarkdown,
  applyPlan,
  verifyPlan,
  pushToSink,
} from "./core/index.js";
import type { Plan } from "./core/schema.js";

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

const log = (m: string) => process.stderr.write(`  ${m}\n`);

async function cmdAudit(domain: string, flags: Record<string, string | boolean>) {
  const pages = flags.pages ? Number(flags.pages) : 10;
  const audit = await auditSite(domain, { pages, onProgress: log });
  const plan = synthesizePlan(audit, { includeInfo: Boolean(flags["include-info"]) });
  const outPlan = (flags.out as string) ?? "plan.json";
  const outMd = (flags.md as string) ?? "plan.md";
  await writeFile(outPlan, JSON.stringify(plan, null, 2), "utf8");
  await writeFile(outMd, planToMarkdown(plan), "utf8");
  printPlanSummary(plan);
  process.stdout.write(`\nWrote ${outPlan} and ${outMd}\n`);
}

async function cmdRun(domain: string, flags: Record<string, string | boolean>) {
  await cmdAudit(domain, flags);
}

async function cmdApply(planPath: string, flags: Record<string, string | boolean>) {
  const plan = await loadPlan(planPath);
  const res = await applyPlan(plan, {
    dryRun: Boolean(flags["dry-run"]),
    outDir: (flags.out as string) ?? "magic-button-out",
    onProgress: log,
  });
  const counts = res.applied.reduce<Record<string, number>>((c, r) => ((c[r.status] = (c[r.status] ?? 0) + 1), c), {});
  process.stdout.write(`\nApply results: ${JSON.stringify(counts)}\n`);
  for (const r of res.applied) {
    process.stdout.write(`  [${r.status}] ${r.title}${r.output_path ? ` -> ${r.output_path}` : ""}\n`);
  }
}

async function cmdVerify(planPath: string, flags: Record<string, string | boolean>) {
  const plan = await loadPlan(planPath);
  const pages = flags.pages ? Number(flags.pages) : 10;
  const res = await verifyPlan(plan, { pages, onProgress: log });
  process.stdout.write(
    `\nVerify: ${res.target}\n  before avg ${res.before_avg} -> after avg ${res.after_avg} (delta ${res.delta >= 0 ? "+" : ""}${res.delta})\n`
  );
}

async function cmdSink(planPath: string, flags: Record<string, string | boolean>) {
  const plan = await loadPlan(planPath);
  const res = await pushToSink(plan, { backend: flags.local ? "local" : undefined });
  process.stdout.write(`\nSink [${res.backend}]: ${res.detail}\n`);
}

function printPlanSummary(plan: Plan) {
  const s = plan.summary;
  const sevLine = (["critical", "high", "medium", "low", "info"] as const)
    .filter((k) => (s.by_severity[k] ?? 0) > 0)
    .map((k) => `${k} ${s.by_severity[k]}`)
    .join(" · ");
  process.stdout.write(
    `\n${plan.target}\n  pages audited: ${s.pages_audited} · avg score: ${s.avg_score} (${s.grade})\n  fixes: ${s.total_items} · est. lift: +${s.est_total_delta} points\n  severity: ${sevLine}\n`
  );
  const pr = s.platform_readiness;
  if (pr) {
    const parts = (["chatgpt", "perplexity", "google_ai_overview", "gemini"] as const)
      .filter((k) => typeof pr[k] === "number")
      .map((k) => `${k} ${pr[k]}`);
    if (parts.length) process.stdout.write(`  platforms: ${parts.join(" · ")}\n`);
  }
  if (s.score_caps && s.score_caps.length) {
    process.stdout.write(`  ⚠ score capped: ${s.score_caps.length} hard blocker(s)\n`);
  }
  for (const it of plan.items.slice(0, 8)) {
    process.stdout.write(`  ${String(it.priority).padStart(2)}. [${it.severity}] +${it.expected_score_delta} ${it.title}\n`);
  }
  if (plan.items.length > 8) process.stdout.write(`  … and ${plan.items.length - 8} more\n`);
}

async function loadPlan(path: string): Promise<Plan> {
  return JSON.parse(await readFile(path, "utf8")) as Plan;
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [cmd, arg] = positional;
  try {
    switch (cmd) {
      case "audit":
        if (!arg) throw new Error("usage: audit <domain>");
        await cmdAudit(arg, flags);
        break;
      case "run":
        if (!arg) throw new Error("usage: run <domain>");
        await cmdRun(arg, flags);
        break;
      case "apply":
        if (!arg) throw new Error("usage: apply <plan.json>");
        await cmdApply(arg, flags);
        break;
      case "verify":
        if (!arg) throw new Error("usage: verify <plan.json>");
        await cmdVerify(arg, flags);
        break;
      case "sink":
        if (!arg) throw new Error("usage: sink <plan.json>");
        await cmdSink(arg, flags);
        break;
      default:
        process.stdout.write(
          [
            "ai-seo-magic-button — whole-site AEO/GEO audit + ready-to-run plan",
            "",
            "  audit  <domain> [--pages N] [--include-info] [--out plan.json] [--md plan.md]",
            "  apply  <plan.json> [--dry-run] [--out dir]",
            "  verify <plan.json> [--pages N]",
            "  sink   <plan.json> [--local]",
            "  run    <domain> [--pages N] [--include-info]",
            "",
            "Child MCPs resolve via npx by default; override with",
            "AISEO_MCP_PATH / CITATION_MCP_PATH (absolute path to each dist/index.js).",
            "",
          ].join("\n")
        );
    }
  } catch (e: any) {
    process.stderr.write(`error: ${String(e?.message ?? e)}\n`);
    process.exit(1);
  }
}

main();
