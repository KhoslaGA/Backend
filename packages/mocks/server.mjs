/**
 * Standalone mock server — deliberately NOT part of the production API process.
 * Every response carries mock:true (the frontend client throws on these in prod).
 *
 * Control headers:
 *   X-Mock-Scenario: decline | all-decline | high-cat-zone | vacant | timeout |
 *                    error-500 | slow-3s | table-rating | quota-exceeded | garbage
 *   X-Mock-Date:     ISO date — shifts "today" for renewal/staleness logic
 *   X-Source-IP:     simulates the outbound IP for the Compulife twin lock
 *
 * Run: node packages/mocks/server.mjs  (port 4000)
 */
import { createServer } from 'node:http';
import { quoteAuto } from './engines/auto.mjs';
import { quoteHome, compulifeQuote, _resetCompulifeState } from './engines/home-life.mjs';
import { PERSONAS } from './personas.mjs';

const PORT = process.env.MOCK_PORT ?? 4000;

const readBody = (req) => new Promise((resolve) => {
  let data = '';
  req.on('data', (c) => (data += c));
  req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve(null); } });
});

const server = createServer(async (req, res) => {
  const scenario = req.headers['x-mock-scenario'] ?? null;
  const today = req.headers['x-mock-date'] ? new Date(req.headers['x-mock-date']) : new Date('2026-07-05');
  const sourceIp = req.headers['x-source-ip'] ?? null;
  const send = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };

  // chaos layer
  if (scenario === 'timeout') return; // hang — client timeout logic must handle
  if (scenario === 'error-500') return send(500, { mock: true, error: 'mock internal error' });
  if (scenario === 'garbage') return send(200, '{not json!!');
  if (scenario === 'slow-3s') await new Promise((r) => setTimeout(r, 3000));
  else await new Promise((r) => setTimeout(r, 300 + Math.floor(Math.random() * 500))); // realistic carrier latency

  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'POST' && url.pathname === '/mock/rating/auto/quote') {
      const body = await readBody(req);
      if (!body?.drivers?.length || !body?.vehicle) return send(400, { mock: true, error: 'incomplete profile' });
      return send(200, quoteAuto(body, { scenario, today }));
    }
    if (req.method === 'POST' && url.pathname === '/mock/rating/home/quote') {
      const body = await readBody(req);
      if (!body?.postalCode || !body?.replacementCostCents) return send(400, { mock: true, error: 'incomplete profile' });
      return send(200, quoteHome(body, { scenario }));
    }
    if (req.method === 'POST' && url.pathname === '/mock/compulife/quote') {
      const body = await readBody(req);
      return send(200, compulifeQuote(body, { sourceIp, scenario }));
    }
    if (req.method === 'POST' && url.pathname === '/mock/compulife/_reset') {
      _resetCompulifeState();
      return send(200, { ok: true });
    }
    if (url.pathname === '/mock/personas') return send(200, { mock: true, personas: PERSONAS });
    return send(404, { mock: true, error: 'unknown mock route' });
  } catch (e) {
    return send(500, { mock: true, error: String(e?.message ?? e) });
  }
});

if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(PORT, () => console.log(`mock server on :${PORT} — every payload carries mock:true`));
}
export { server };
