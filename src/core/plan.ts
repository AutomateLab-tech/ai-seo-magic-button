// Plan synthesis (AL-725) — the core product output.
//
// Convert a SiteAudit into a portable plan.json (machine-readable, each item
// self-contained and agent-executable) plus a human-readable markdown checklist,
// prioritized by estimated score impact.

import {
  Plan,
  PlanItem,
  Category,
  Severity,
  SEVERITY_RANK,
  SCHEMA_VERSION,
} from "./schema.js";
import type { SiteAudit, Finding, PageAudit } from "./audit.js";

const GENERATOR = "ai-seo-magic-button@0.1.0";

const DELTA_BY_SEVERITY: Record<Severity, number> = { critical: 12, high: 8, medium: 4, low: 2, info: 0 };

// Options for plan synthesis.
export interface SynthOptions {
  // Include purely-informational findings (notes with nothing to do, e.g.
  // "Google-Agent ignores robots.txt"). Off by default — they're not fixes.
  includeInfo?: boolean;
}

// A finding is INFORMATIONAL when its suggested fix is a non-action — the audit
// is telling you a fact, not something to change ("No action needed",
// "No robots.txt action possible"). These carry a severity upstream but there's
// nothing to execute, so they're excluded from the plan unless asked for.
function isInformational(fix: string): boolean {
  const f = fix.trim().toLowerCase();
  if (!f) return false;
  return /^(no|none)\b/.test(f) && /\b(action|change|fix|robots)\b/.test(f.slice(0, 24));
}

// Some upstream audits flag "GPTBot is not disallowed" as a content-PROTECTION
// concern (block the bot to avoid training-harvest). That is the OPPOSITE of
// what a citation product wants: to be cited you must ALLOW these crawlers. Drop
// any finding that recommends blocking AI agents — it contradicts the promise.
function isAntiCitation(text: string): boolean {
  const t = text.toLowerCase();
  return /not disallowed|harvested for model training|disallow:\s*\//.test(t);
}

function normSeverity(s: unknown): Severity {
  const v = String(s ?? "").toLowerCase();
  if (v.startsWith("crit")) return "critical";
  if (v.startsWith("hi") || v === "error") return "high";
  if (v.startsWith("med") || v === "warn" || v === "warning") return "medium";
  return "low";
}

const VALID_CATEGORIES = new Set<Category>([
  "schema", "structure", "robots", "technical", "freshness",
  "llms_txt", "citation", "evidence", "trust", "entity", "content",
]);

function categorize(text: string, hint?: string): Category {
  // Honor the upstream ai-seo category when it's one we model, or map its
  // extra categories onto ours. Falls back to keyword inference otherwise.
  const h = (hint ?? "").toLowerCase().trim();
  if (VALID_CATEGORIES.has(h as Category)) return h as Category;
  if (h === "authority") return "evidence";
  if (h === "presence") return "entity";
  if (h === "sitemap") return "technical";

  const t = (hint ? hint + " " : "") + text.toLowerCase();
  if (/llms\.?txt/.test(t)) return "llms_txt";
  if (/schema|json-?ld|structured data|microdata/.test(t)) return "schema";
  if (/robot|crawler|gptbot|claudebot|user-agent/.test(t)) return "robots";
  if (/canonical|https|meta|title|h1|hreflang|noindex|opengraph|twitter/.test(t)) return "technical";
  if (/fresh|lastmod|datemodified|stale|outdated/.test(t)) return "freshness";
  if (/sameas|knowledge graph|organization|entity/.test(t)) return "entity";
  if (/author|byline|editorial|privacy|terms|contact|e-e-a-t|eeat/.test(t)) return "trust";
  if (/citation|statistic|quotation|sources?\b/.test(t)) return "evidence";
  if (/extractab|passage|bluf|faq|heading|answer|word/.test(t)) return "citation";
  return "structure";
}

// Turn a URL path into a plausible target query for rewrite items.
function queryFromUrl(url: string): string {
  try {
    const p = new URL(url).pathname.replace(/\/+$/, "");
    const slug = p.split("/").filter(Boolean).pop() ?? "";
    const words = slug.replace(/[-_]+/g, " ").replace(/\.[a-z]+$/i, "").trim();
    return words || "this page";
  } catch {
    return "this page";
  }
}

function slugifyId(prefix: string, n: number, label: string): string {
  const s = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28);
  return `${prefix}${n}-${s || "item"}`;
}

export function synthesizePlan(audit: SiteAudit, opts: SynthOptions = {}): Plan {
  const includeInfo = opts.includeInfo ?? false;
  const raw: Array<Omit<PlanItem, "id" | "priority">> = [];

  // --- Site-level: AI-crawler blocks (critical — nothing else matters if bots can't read you) ---
  if (audit.site.crawler_blocks && audit.site.crawler_blocks.length > 0) {
    raw.push({
      url: audit.origin,
      source_file: null,
      category: "robots",
      title: `Unblock AI crawlers: ${audit.site.crawler_blocks.join(", ")}`,
      rationale: `These AI crawlers are blocked by robots.txt or UA gating, so AI engines can't read the site to cite it: ${audit.site.crawler_blocks.join(", ")}.`,
      severity: "critical",
      expected_score_delta: DELTA_BY_SEVERITY.critical,
      action: {
        type: "manual",
        instructions: `Edit robots.txt at ${audit.origin}/robots.txt to allow: ${audit.site.crawler_blocks.join(", ")}. Remove Disallow rules and any server-side UA blocks for these agents.`,
      },
      acceptance: `audit.crawler_access on ${audit.origin} reports can_fetch=true for all listed crawlers.`,
    });
  }

  // --- Site-level: llms.txt — only when it's genuinely missing AND we have a
  // sitemap to build it from. Presence is checked by a real GET in the audit. ---
  if (audit.sitemap_url && audit.site.llms_txt_present === false) {
    raw.push({
      url: audit.origin,
      source_file: "llms.txt",
      category: "llms_txt",
      title: "Generate and publish llms.txt",
      rationale:
        "llms.txt gives AI agents a curated map of the site's best content. Note: it's a discovery aid, not a proven citation lever — primary-source evidence shows no direct citation lift, so this is a low-priority nicety.",
      severity: "low",
      expected_score_delta: DELTA_BY_SEVERITY.low,
      action: {
        type: "generate_llms_txt",
        tool: "llms_txt.generate",
        params: { domain: audit.domain, max_pages: 30 },
        out_path: "llms.txt",
      },
      acceptance: `${audit.origin}/llms.txt exists and passes llms_txt.validate.`,
    });
  }

  // --- Site-level top fixes ---
  for (const f of audit.site.top_5_fixes ?? []) {
    const msg = String(f.message ?? f.fix ?? JSON.stringify(f));
    const fix = String(f.fix ?? "");
    if (isAntiCitation(`${msg} ${fix}`)) continue;
    const info = isInformational(fix);
    if (info && !includeInfo) continue;
    const sev: Severity = info ? "info" : normSeverity(f.severity);
    raw.push({
      url: audit.origin,
      source_file: null,
      category: categorize(msg, f.category as string),
      title: msg.slice(0, 80),
      rationale: String(f.fix ?? msg),
      severity: sev,
      expected_score_delta: DELTA_BY_SEVERITY[sev],
      action: { type: "manual", instructions: String(f.fix ?? msg) },
      acceptance: "Re-run audit.site; this finding no longer appears in top_5_fixes.",
      failure_signal: typeof f.failure_signal === "string" ? f.failure_signal : undefined,
      leading_indicator: typeof f.leading_indicator === "string" ? f.leading_indicator : undefined,
    });
  }

  // --- Per-page ---
  for (const page of audit.pages) {
    if (page.error) continue;
    const score = page.score ?? 100;

    // Any page short of a perfect score gets the tool-driven AEO rewrite remedy.
    const verdict = page.citation_verdict?.will_ai_cite;
    if (score < 90 || verdict === "unlikely" || verdict === "marginal") {
      const targetQuery = queryFromUrl(page.url);
      const sev: Severity = verdict === "unlikely" || score < 55 ? "high" : "medium";
      const blockers = page.citation_verdict?.top_3_blockers ?? [];
      raw.push({
        url: page.url,
        source_file: null,
        category: "citation",
        title: `Rewrite for AEO: ${targetQuery}`,
        rationale:
          page.citation_verdict?.one_line_summary ||
          `Page scores ${score} and is "${verdict ?? "below threshold"}" to be cited.` +
            (blockers.length ? ` Blockers: ${blockers.join("; ")}.` : ""),
        severity: sev,
        expected_score_delta: Math.max(4, Math.round((78 - score) / 3)),
        action: {
          type: "rewrite_aeo",
          tool: "rewrite.aeo",
          params: { url: page.url, target_query: targetQuery, format: "article", max_words: 1500 },
        },
        acceptance: `score.citation_worthiness for ${page.url} improves; BLUF + FAQ present.`,
      });
    }

    // Every actionable per-page finding becomes a plan item — no severity
    // threshold. We drop two kinds: anti-citation advice (e.g. "block GPTBot",
    // which lowers citation eligibility and contradicts the product goal) and
    // purely-informational notes whose "fix" is a non-action (unless asked for).
    for (const f of page.findings) {
      const msg = String(f.message ?? f.fix ?? "");
      const fix = String(f.fix ?? "");
      if (!msg || isAntiCitation(`${msg} ${fix}`)) continue;
      const info = isInformational(fix);
      if (info && !includeInfo) continue;
      const sev: Severity = info ? "info" : normSeverity(f.severity);
      raw.push({
        url: page.url,
        source_file: null,
        category: categorize(msg, f.category as string),
        title: msg.slice(0, 80),
        rationale: String(f.fix ?? msg),
        severity: sev,
        expected_score_delta: DELTA_BY_SEVERITY[sev],
        action: { type: "manual", instructions: String(f.fix ?? msg) },
        acceptance: `Re-run audit.page on ${page.url}; finding resolved.`,
        failure_signal: typeof f.failure_signal === "string" ? f.failure_signal : undefined,
        leading_indicator: typeof f.leading_indicator === "string" ? f.leading_indicator : undefined,
      });
    }
  }

  // --- Site-level: pricing.md for agent commerce (#14) — only when the crawl
  // surfaced a pricing/plans page worth exposing in machine-readable form. ---
  const pricingPage = audit.pages.find((p) => /\/(pricing|plans)(\/|$|\?)/i.test(p.url) && !p.error);
  if (pricingPage) {
    raw.push({
      url: pricingPage.url,
      source_file: "pricing.md",
      category: "content",
      title: "Generate and publish pricing.md",
      rationale:
        "A machine-readable /pricing.md lets AI shopping/agent flows read your tiers without parsing a JS-rendered table. Low priority, only relevant for SaaS/commerce.",
      severity: "low",
      expected_score_delta: DELTA_BY_SEVERITY.low,
      action: {
        type: "generate_pricing_md",
        tool: "pricing.generate",
        params: { domain: audit.domain, pricing_url: pricingPage.url },
        out_path: "pricing.md",
      },
      acceptance: `${audit.origin}/pricing.md exists with named tiers and prices.`,
    });
  }

  // --- De-dupe identical findings (same url + title) that surfaced from both the
  // site-level pass and a per-page audit. ---
  const seenKey = new Set<string>();
  const deduped = raw.filter((it) => {
    const key = `${it.url}::${it.title.toLowerCase()}`;
    if (seenKey.has(key)) return false;
    seenKey.add(key);
    return true;
  });

  // --- Prioritize: severity, then estimated delta desc. Assign stable ids + priority. ---
  deduped.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.expected_score_delta - a.expected_score_delta);

  const items: PlanItem[] = deduped.map((it, i) => ({
    ...it,
    id: slugifyId("p", i + 1, it.title),
    priority: i + 1,
  }));

  const audited = audit.pages.filter((p) => typeof p.score === "number");
  const avg = audited.length ? Math.round(audited.reduce((s, p) => s + (p.score as number), 0) / audited.length) : 0;

  // Honest headroom: you can never gain more than (100 - score) on a page, so
  // cap the summed per-item estimate at the real per-page gap. Otherwise a long
  // list of small fixes implies an impossible total lift.
  const headroom = audited.reduce((s, p) => s + Math.max(0, 100 - (p.score as number)), 0);
  const rawDelta = items.reduce((s, it) => s + it.expected_score_delta, 0);

  const bySeverity = items.reduce<Partial<Record<Severity, number>>>((acc, it) => {
    acc[it.severity] = (acc[it.severity] ?? 0) + 1;
    return acc;
  }, {});

  return {
    schema_version: SCHEMA_VERSION,
    target: audit.origin,
    generated_at: audit.generated_at,
    generator: GENERATOR,
    summary: {
      pages_audited: audited.length,
      avg_score: avg,
      grade: audit.site.overall_grade ?? gradeFor(avg),
      total_items: items.length,
      est_total_delta: Math.min(rawDelta, headroom),
      by_severity: bySeverity,
      platform_readiness: audit.site.platform_readiness,
      score_caps: audit.site.score_caps,
    },
    items,
  };
}

function gradeFor(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

// --- Human-readable markdown checklist ---
export function planToMarkdown(plan: Plan): string {
  const lines: string[] = [];
  lines.push(`# AI-SEO plan for ${plan.target}`);
  lines.push("");
  lines.push(
    `Audited **${plan.summary.pages_audited}** pages · avg score **${plan.summary.avg_score}** (${plan.summary.grade}) · **${plan.summary.total_items}** fixes · est. **+${plan.summary.est_total_delta}** points`
  );
  lines.push("");
  const sevOrder: Severity[] = ["critical", "high", "medium", "low", "info"];
  const sevLine = sevOrder
    .filter((s) => (plan.summary.by_severity[s] ?? 0) > 0)
    .map((s) => `${s} ${plan.summary.by_severity[s]}`)
    .join(" · ");
  if (sevLine) lines.push(`Severity: ${sevLine}`);
  const pr = plan.summary.platform_readiness;
  if (pr) {
    const parts = (["chatgpt", "perplexity", "google_ai_overview", "gemini"] as const)
      .filter((k) => typeof pr[k] === "number")
      .map((k) => `${k} ${pr[k]}`);
    if (parts.length) lines.push(`Platform readiness: ${parts.join(" · ")}`);
  }
  if (plan.summary.score_caps && plan.summary.score_caps.length) {
    lines.push("");
    lines.push(`> **Score capped** — hard blockers detected: ${plan.summary.score_caps.join(" ")}`);
  }
  lines.push("");
  lines.push(`Generated ${plan.generated_at} by ${plan.generator}`);
  lines.push("");
  lines.push("> This is an actionable plan, not direct edits. Run your agent against `plan.json` to execute it.");
  lines.push("");
  for (const it of plan.items) {
    const tool = "tool" in it.action ? ` \`${it.action.tool}\`` : "";
    lines.push(`- [ ] **${it.severity.toUpperCase()}** (+${it.expected_score_delta}) ${it.title}${tool}`);
    lines.push(`  - URL: ${it.url}`);
    lines.push(`  - Why: ${it.rationale}`);
    lines.push(`  - Done when: ${it.acceptance}`);
    if (it.failure_signal) lines.push(`  - Failed if: ${it.failure_signal}`);
    if (it.leading_indicator) lines.push(`  - Watch: ${it.leading_indicator}`);
  }
  lines.push("");
  return lines.join("\n");
}
