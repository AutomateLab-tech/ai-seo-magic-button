// Audit orchestration (AL-724).
//
// Crawl the site, run per-page ai-seo audits, pull a site-level composite, and
// layer citation-intelligence predictions on top. Returns a unified SiteAudit
// that the plan synthesis stage (AL-725) turns into plan.json.

import { connectAiSeo, connectCitation, type ToolClient } from "./mcp-client.js";
import { discoverUrls, originOf } from "./crawl.js";
import { isSafeUrl } from "./ssrf.js";
import type { PlatformReadiness } from "./schema.js";

export interface Finding {
  severity?: string;
  message?: string;
  fix?: string;
  category?: string;
  [k: string]: unknown;
}

export interface PageAudit {
  url: string;
  score: number | null;
  grade?: string;
  dimension_scores?: Record<string, number>;
  citation_verdict?: { will_ai_cite?: string; top_3_blockers?: string[]; one_line_summary?: string };
  content_quality?: string;
  findings: Finding[];
  platform_readiness?: PlatformReadiness; // per-engine readiness (ai-seo 0.7+)
  score_caps?: string[];                  // veto reasons that capped this page's score
  // citation-intelligence predicted-citation signal for this URL (heuristic)
  predict?: { score?: number; grade?: string; fixes?: string[] };
  error?: string;
}

export interface SiteAudit {
  domain: string;
  origin: string;
  generated_at: string;
  sitemap_url: string | null;
  site: {
    overall_score?: number;
    overall_grade?: string;
    top_5_fixes?: Finding[];
    llms_txt_present?: boolean;
    crawler_blocks?: string[]; // AI bots blocked from the homepage
    platform_readiness?: PlatformReadiness; // avg per-engine readiness across audited pages
    score_caps?: string[];                  // union of veto reasons across pages
  };
  pages: PageAudit[];
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// Does the site actually serve /llms.txt? A real GET, so we never recommend
// generating one that already exists. Guards against SPA catch-all routes that
// return 200 + HTML for any path by rejecting html-looking bodies.
async function llmsTxtPresent(origin: string): Promise<boolean> {
  try {
    if (!(await isSafeUrl(`${origin}/llms.txt`))) return false;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10000);
    const res = await fetch(`${origin}/llms.txt`, {
      signal: ctl.signal,
      headers: { "user-agent": "ai-seo-magic-button/0.1" },
    });
    clearTimeout(t);
    if (!res.ok) return false;
    const body = (await res.text()).trim();
    if (body.length < 10) return false;
    return !/^\s*<(!doctype|html)/i.test(body);
  } catch {
    return false;
  }
}

// Average the per-engine platform_readiness scores across audited pages.
function aggregatePlatformReadiness(pages: PageAudit[]): PlatformReadiness | undefined {
  const engines: (keyof PlatformReadiness)[] = ["chatgpt", "perplexity", "google_ai_overview", "gemini"];
  const acc: Record<string, number[]> = {};
  for (const p of pages) {
    const pr = p.platform_readiness;
    if (!pr) continue;
    for (const e of engines) {
      const v = pr[e];
      if (typeof v === "number") (acc[e] ??= []).push(v);
    }
  }
  const out: PlatformReadiness = {};
  let any = false;
  for (const e of engines) {
    const xs = acc[e];
    if (xs && xs.length) { out[e] = Math.round(xs.reduce((a, b) => a + b, 0) / xs.length); any = true; }
  }
  return any ? out : undefined;
}

export interface AuditOptions {
  pages?: number;       // max pages to audit (default 10)
  concurrency?: number; // parallel page audits (default 2)
  onProgress?: (msg: string) => void;
}

export async function auditSite(domain: string, opts: AuditOptions = {}): Promise<SiteAudit> {
  const pages = opts.pages ?? 10;
  const concurrency = opts.concurrency ?? 2;
  const log = opts.onProgress ?? (() => {});
  const origin = originOf(domain);
  const hostname = new URL(origin).hostname;

  log(`crawling ${origin} (up to ${pages} pages)…`);
  const crawl = await discoverUrls(domain, pages);

  let aiSeo: ToolClient | null = null;
  let citation: ToolClient | null = null;
  try {
    log("spawning ai-seo + citation-intelligence MCPs…");
    [aiSeo, citation] = await Promise.all([connectAiSeo(), connectCitation()]);

    // Site-level composite (homepage + robots + sitemap + schema), crawler access,
    // and a direct check for whether /llms.txt is actually served.
    log("running site-level audit…");
    const [siteRes, crawlerRes, llmsPresent] = await Promise.all([
      aiSeo.call<any>("audit_site", { domain: hostname, respect_robots: true }).catch(() => ({})),
      citation.call<any>("audit_crawler_access", { url: origin }).catch(() => ({})),
      llmsTxtPresent(origin),
    ]);

    const siteData = siteRes ?? {};
    const crawlerData = crawlerRes ?? {};
    const crawlerBlocks: string[] = Array.isArray(crawlerData?.crawlers)
      ? crawlerData.crawlers.filter((c: any) => c?.can_fetch === false).map((c: any) => c?.user_agent).filter(Boolean)
      : [];

    // Citation-intelligence predicted-citation pass over the sitemap (heuristic, no API keys).
    log("pulling citation-intelligence gap signal…");
    let predictByUrl = new Map<string, any>();
    if (crawl.sitemap_url) {
      const cgaps = await citation
        .call<any>("audit_sitemap", { sitemap_url: crawl.sitemap_url, limit: pages, concurrency: 3 })
        .catch(() => null);
      if (cgaps?.urls) for (const u of cgaps.urls) predictByUrl.set(u.url, u);
    }

    // Per-page audits.
    log(`auditing ${crawl.urls.length} pages…`);
    const pageAudits = await mapWithConcurrency(crawl.urls, concurrency, async (url): Promise<PageAudit> => {
      try {
        const a = await aiSeo!.call<any>("audit_page", { url, respect_robots: true });
        const predict = predictByUrl.get(url);
        const pr = a?.platform_readiness;
        const platform_readiness: PlatformReadiness | undefined = pr
          ? {
              chatgpt: pr.chatgpt?.score,
              perplexity: pr.perplexity?.score,
              google_ai_overview: pr.google_ai_overview?.score,
              gemini: pr.gemini?.score,
            }
          : undefined;
        return {
          url,
          score: typeof a?.overall_score === "number" ? a.overall_score : a?.score ?? null,
          grade: a?.overall_grade ?? a?.grade,
          dimension_scores: a?.dimension_scores,
          citation_verdict: a?.citation_verdict,
          content_quality: a?.content_quality,
          findings: Array.isArray(a?.findings) ? a.findings : [],
          platform_readiness,
          score_caps: Array.isArray(a?.score_caps) ? a.score_caps : undefined,
          predict: predict ? { score: predict.score, grade: predict.grade, fixes: predict.fixes } : undefined,
        };
      } catch (e: any) {
        return { url, score: null, findings: [], error: String(e?.message ?? e) };
      }
    });

    const scoreCaps = Array.from(
      new Set(pageAudits.flatMap((p) => p.score_caps ?? []))
    );

    return {
      domain: hostname,
      origin,
      generated_at: new Date().toISOString(),
      sitemap_url: crawl.sitemap_url,
      site: {
        overall_score: siteData?.overall_score,
        overall_grade: siteData?.overall_grade,
        top_5_fixes: Array.isArray(siteData?.top_5_fixes) ? siteData.top_5_fixes : [],
        llms_txt_present: llmsPresent,
        crawler_blocks: crawlerBlocks,
        platform_readiness: aggregatePlatformReadiness(pageAudits),
        score_caps: scoreCaps.length ? scoreCaps : undefined,
      },
      pages: pageAudits,
    };
  } finally {
    await Promise.all([aiSeo?.close(), citation?.close()]);
  }
}
