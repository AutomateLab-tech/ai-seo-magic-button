import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'recorded-audit-fixture', version: '1.0.0' });
const results = {
  audit_site: { overall_score: 60, overall_grade: 'C', top_5_fixes: [] },
  audit_page: { overall_score: 60, findings: [
    { severity: 'high', category: 'technical', message: 'Missing canonical', fix: 'Add a canonical URL' },
  ] },
  audit_crawler_access: { crawlers: [] },
  audit_sitemap: { urls: [] },
};
for (const [name, result] of Object.entries(results)) {
  server.registerTool(name, { inputSchema: { url: z.string().optional(), domain: z.string().optional(), sitemap_url: z.string().optional() } },
    async ({ url }) => ({ content: [{ type: 'text', text: JSON.stringify(
      name === 'audit_page' && url?.includes('93.184.216.36') ? { overall_score: 100, findings: [] } : result
    ) }] }));
}
await server.connect(new StdioServerTransport());
