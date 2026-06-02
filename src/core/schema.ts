// plan.json schema (AL-723) — the portable, dumb-agent-ready deliverable.
//
// Design rule: every PlanItem is SELF-CONTAINED. A weak agent (or a thin apply
// helper) must be able to execute one item with no extra reasoning — every
// decision (which tool, which params, which file, how to verify) is baked in at
// PLAN TIME so APPLY TIME is pure execution. See docs/plan-format.md.

export const SCHEMA_VERSION = "1.0" as const;

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type Category =
  | "schema"      // JSON-LD / structured data
  | "structure"   // headings, BLUF, FAQ, extractability
  | "robots"      // crawler access (AI bots)
  | "technical"   // canonical, meta, HTTPS, title/H1
  | "freshness"   // dateModified / staleness
  | "llms_txt"    // llms.txt presence / validity
  | "citation"    // passage-level citability / extractability
  | "evidence"    // citations, statistics, expert quotations
  | "trust"       // E-E-A-T trust signals (author, dates, policies)
  | "entity"      // entity identity / knowledge-graph signals
  | "content";    // generic copy improvement / AI-filler

// A PlanAction is a deterministic descriptor of HOW to execute the item.
// `tool` actions are driven by the apply helpers against the ai-seo MCP.
export type PlanAction =
  | { type: "generate_llms_txt"; tool: "llms_txt.generate"; params: { domain: string; max_pages?: number }; out_path: string }
  | { type: "generate_pricing_md"; tool: "pricing.generate"; params: { domain: string; pricing_url?: string }; out_path: string }
  | { type: "rewrite_aeo"; tool: "rewrite.aeo"; params: { url?: string; text?: string; target_query: string; format?: string; max_words?: number } }
  | { type: "rewrite_geo"; tool: "rewrite.geo"; params: { url?: string; text?: string; target_query: string; add_comparison_table?: boolean; max_words?: number } }
  | { type: "insert_schema"; jsonld: Record<string, unknown> }
  | { type: "manual"; instructions: string };

export interface PlanItem {
  id: string;                    // stable slug, e.g. "p2-llms-txt"
  url: string;                   // page the fix applies to (or site origin)
  source_file: string | null;   // pre-mapped local file to edit; null if unknown (agent resolves)
  category: Category;
  title: string;
  rationale: string;
  severity: Severity;
  priority: number;              // 1 = do first; ascending
  expected_score_delta: number;  // estimated AI-SEO points gained
  action: PlanAction;
  acceptance: string;            // how to verify the fix landed
  failure_signal?: string;       // falsifiability: signal that the fix did NOT work
  leading_indicator?: string;    // falsifiability: leading indicator to monitor
}

// Per-engine readiness (mirrors ai-seo audit.page platform_readiness).
export interface PlatformReadiness {
  chatgpt?: number;
  perplexity?: number;
  google_ai_overview?: number;
  gemini?: number;
}

export interface PlanSummary {
  pages_audited: number;
  avg_score: number;
  grade: string;
  total_items: number;
  est_total_delta: number;
  by_severity: Partial<Record<Severity, number>>;  // count of plan items per severity
  platform_readiness?: PlatformReadiness;          // avg per-engine readiness across audited pages
  score_caps?: string[];                           // hard blockers that capped page scores (veto reasons)
}

export interface Plan {
  schema_version: typeof SCHEMA_VERSION;
  target: string;                // domain / origin the plan was built for
  generated_at: string;          // ISO8601; stamped by the caller
  generator: string;             // "ai-seo-magic-button@<version>"
  summary: PlanSummary;
  items: PlanItem[];
}

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};
