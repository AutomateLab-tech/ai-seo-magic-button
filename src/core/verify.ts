// Re-audit / verify loop (AL-727).
//
// After execution, re-run the audit and diff the score against the baseline so
// the user gets proof the plan actually lifted the score. Closes the loop.

import { auditSite, type SiteAudit, type AuditOptions } from "./audit.js";
import type { Plan } from "./schema.js";

export interface VerifyResult {
  target: string;
  before_avg: number;
  after_avg: number;
  delta: number;
  per_page: Array<{ url: string; before: number | null; after: number | null; delta: number | null }>;
  verified_at: string;
}

function avgScore(audit: SiteAudit): number {
  const s = audit.pages.filter((p) => typeof p.score === "number");
  return s.length ? Math.round(s.reduce((a, p) => a + (p.score as number), 0) / s.length) : 0;
}

// Re-audit the same site and compare against the baseline plan's summary +
// optional baseline audit (per-page diff when provided).
export async function verifyPlan(
  plan: Plan,
  opts: AuditOptions & { baseline?: SiteAudit } = {}
): Promise<VerifyResult> {
  const after = await auditSite(plan.target, opts);
  const afterAvg = avgScore(after);
  const beforeAvg = opts.baseline ? avgScore(opts.baseline) : plan.summary.avg_score;

  const beforeByUrl = new Map<string, number | null>();
  if (opts.baseline) for (const p of opts.baseline.pages) beforeByUrl.set(p.url, p.score);

  const per_page = after.pages.map((p) => {
    const before = beforeByUrl.has(p.url) ? beforeByUrl.get(p.url)! : null;
    const delta = typeof before === "number" && typeof p.score === "number" ? p.score - before : null;
    return { url: p.url, before, after: p.score, delta };
  });

  return {
    target: plan.target,
    before_avg: beforeAvg,
    after_avg: afterAvg,
    delta: afterAvg - beforeAvg,
    per_page,
    verified_at: new Date().toISOString(),
  };
}
