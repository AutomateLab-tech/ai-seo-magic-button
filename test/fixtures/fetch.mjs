// Deterministic public-site responses. Tests never contact a real website.
globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  if (url.pathname === '/robots.txt') return new Response('User-agent: *\nAllow: /');
  if (url.pathname === '/sitemap.xml') return new Response(`<urlset><url><loc>${url.origin}/</loc></url>${url.hostname.endsWith('.35') ? `<url><loc>${url.origin}/pricing/</loc></url>` : ''}</urlset>`);
  if (url.pathname === '/llms.txt') return url.hostname.endsWith('.35')
    ? new Response('Not found', { status: 404 }) : new Response('# Recorded fixture\nA public test website.');
  throw new Error(`Unexpected fixture fetch: ${url}`);
};
