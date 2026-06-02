// SSRF / DNS-rebinding guard (mirrors ai-seo-mcp's guard).
//
// The magic button fetches arbitrary user-supplied domains (sitemap crawl,
// llms.txt probe). Block private/loopback/link-local/reserved targets — both
// IP literals and hostnames that resolve to private IPs.

import net from "node:net";
import { lookup } from "node:dns/promises";

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    if (low === "::1" || low === "::") return true;
    if (low.startsWith("fe80")) return true;
    if (low.startsWith("fc") || low.startsWith("fd")) return true;
    const mapped = low.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  return false;
}

/** Reason string if the host must be blocked, else null. */
export async function blockedHost(hostname: string): Promise<string | null> {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (!h) return "empty host";
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) {
    return `host "${hostname}" is internal`;
  }
  if (net.isIP(h)) return isPrivateIp(h) ? `IP ${hostname} is private/reserved` : null;
  try {
    const addrs = await lookup(h, { all: true });
    for (const a of addrs) if (isPrivateIp(a.address)) return `host ${hostname} resolves to private IP ${a.address}`;
  } catch {
    return null;
  }
  return null;
}

/** True if a full URL is safe to fetch (http/https + non-private host). */
export async function isSafeUrl(url: string): Promise<boolean> {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return (await blockedHost(u.hostname)) === null;
  } catch {
    return false;
  }
}
