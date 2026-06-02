// Whole-site URL discovery (AL-724).
//
// The differentiator vs the existing single-URL web tool / GitHub Action is
// WHOLE-SITE coverage. We discover URLs from the sitemap (following sitemap
// indexes), capped, before auditing each page.

import { isSafeUrl } from "./ssrf.js";

function originOf(domain: string): string {
  const d = domain.trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(d)) return new URL(d).origin;
  return `https://${d}`;
}

async function fetchText(url: string, timeoutMs = 15000): Promise<string | null> {
  // SSRF guard: never fetch private/loopback/reserved targets.
  if (!(await isSafeUrl(url))) return null;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { "user-agent": "ai-seo-magic-button/0.1 (+sitemap-crawler)" },
    });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function extractLocs(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1].trim());
  return out;
}

export interface CrawlResult {
  origin: string;
  sitemap_url: string | null;
  total_found: number;
  urls: string[]; // capped to limit
}

// Discover up to `limit` page URLs for a domain. Resolves sitemap location from
// robots.txt first, then falls back to /sitemap.xml. Follows one level of
// sitemap-index nesting.
export async function discoverUrls(domain: string, limit = 15): Promise<CrawlResult> {
  const origin = originOf(domain);

  // 1. find sitemap (robots.txt Sitemap: directive, else /sitemap.xml)
  let sitemapUrl: string | null = null;
  const robots = await fetchText(`${origin}/robots.txt`);
  if (robots) {
    const m = robots.match(/^\s*sitemap:\s*(\S+)/im);
    if (m) sitemapUrl = m[1].trim();
  }
  if (!sitemapUrl) sitemapUrl = `${origin}/sitemap.xml`;

  const root = await fetchText(sitemapUrl);
  if (!root) return { origin, sitemap_url: null, total_found: 0, urls: [origin] };

  let locs = extractLocs(root);
  const isIndex = /<sitemapindex/i.test(root);

  if (isIndex) {
    // follow nested sitemaps until we have enough URLs
    const pages: string[] = [];
    for (const child of locs) {
      if (pages.length >= limit) break;
      const childXml = await fetchText(child);
      if (childXml) pages.push(...extractLocs(childXml));
    }
    locs = pages;
  }

  // de-dupe, keep only http(s)
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const u of locs) {
    if (!/^https?:\/\//i.test(u)) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    urls.push(u);
  }

  // ensure homepage is represented
  if (!urls.includes(origin) && !urls.includes(`${origin}/`)) urls.unshift(origin);

  return {
    origin,
    sitemap_url: sitemapUrl,
    total_found: urls.length,
    urls: urls.slice(0, limit),
  };
}

export { originOf };
