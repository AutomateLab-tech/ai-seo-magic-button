import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import proxyaddr from 'proxy-addr';

test('IPv4 callers cannot exploit a short mapped IPv6 trust subnet', () => {
  assert.equal(proxyaddr.compile('::ffff:10.0.0.0/8')('203.0.113.9'), false);
});
test('unrelated broad IPv6 subnet cannot trust IPv4 callers', () => {
  assert.equal(proxyaddr.compile('::/1')('203.0.113.9'), false);
});
test('correct mapped and plain IPv4 trust subnets still work', () => {
  for (const subnet of ['::ffff:10.0.0.0/104', '10.0.0.0/8']) {
    const trust = proxyaddr.compile(subnet);
    assert.equal(trust('10.1.2.3'), true);
    assert.equal(trust('203.0.113.9'), false);
  }
});
test('MCP initializes, rejects invalid input, and returns a valid full plan', { timeout: 30000 }, async () => {
  const fixture = fileURLToPath(new URL('./fixtures/provider.mjs', import.meta.url));
  const preload = new URL('./fixtures/fetch.mjs', import.meta.url).href;
  const packageRoot = process.env.TEST_PACKAGE_DIR
    ? pathToFileURL(path.resolve(process.env.TEST_PACKAGE_DIR) + path.sep) : new URL('../', import.meta.url);
  const entry = fileURLToPath(new URL('dist/mcp-server.js', packageRoot));
  const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', preload, entry],
    env: { ...process.env, AISEO_MCP_PATH: fixture, CITATION_MCP_PATH: fixture }, stderr: 'pipe' });
  const client = new Client({ name: 'security-regression-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    const pkg = JSON.parse(readFileSync(new URL('package.json', packageRoot), 'utf8'));
    assert.equal(client.getServerVersion().version, pkg.version);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(t => t.name), ['generate_seo_plan']);
    for (const pages of [0, 51, 1.5]) {
      const result = await client.callTool({ name: 'generate_seo_plan', arguments: { domain: '93.184.216.34', pages } });
      assert.equal(result.isError, true);
    }
    for (const domain of ['93.184.216.34', 'https://93.184.216.35', '93.184.216.36']) {
      const varied = domain.endsWith('.35');
      const result = await client.callTool({ name: 'generate_seo_plan', arguments: { domain, pages: varied ? 2 : 1 } });
      assert.notEqual(result.isError, true, JSON.stringify(result));
      const plan = result.structuredContent;
      assert.equal(plan.schema_version, '1.0');
      assert.equal(plan.generator, `ai-seo-magic-button@${pkg.version}`);
      assert.equal(plan.summary.pages_audited, varied ? 2 : 1);
      if (domain.endsWith('.36')) assert.deepEqual(plan.items, []);
      else assert.ok(plan.items.some(item => item.category === 'technical'));
      if (varied) {
        assert.ok(plan.items.some(item => item.action.type === 'generate_llms_txt'));
        assert.ok(plan.items.some(item => item.action.type === 'generate_pricing_md'));
      }
      assert.ok(plan.items.every(item => item.action.type && item.acceptance));
    }
  } finally { await client.close(); }
});
