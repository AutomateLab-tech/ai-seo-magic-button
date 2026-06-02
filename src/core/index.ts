// Shared core library (AL-723 boundary).
//
// This barrel is the ONLY thing the surface layers (CLI, MCP server, Claude
// skill, plugin) import. The core owns audit + plan generation + apply + verify
// + sink. Surfaces own UX only — no audit logic lives in a surface.

export * from "./schema.js";
export { auditSite, type SiteAudit, type PageAudit, type Finding, type AuditOptions } from "./audit.js";
export { discoverUrls, type CrawlResult } from "./crawl.js";
export { synthesizePlan, planToMarkdown, type SynthOptions } from "./plan.js";
export { applyPlan, type ApplyResult, type ApplyRecord, type ApplyOptions } from "./apply.js";
export { verifyPlan, type VerifyResult } from "./verify.js";
export { pushToSink, type SinkResult, type SinkBackend } from "./sink.js";

import { auditSite, type AuditOptions } from "./audit.js";
import { synthesizePlan, type SynthOptions } from "./plan.js";
import type { Plan } from "./schema.js";

// One-call convenience: crawl + audit + synthesize -> plan.json object.
export async function generatePlan(domain: string, opts: AuditOptions & SynthOptions = {}): Promise<Plan> {
  const audit = await auditSite(domain, opts);
  return synthesizePlan(audit, { includeInfo: opts.includeInfo });
}
