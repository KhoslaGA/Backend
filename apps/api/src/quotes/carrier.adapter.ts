import type { AutoQuoteRequest } from '@ratefamily/contracts';

/**
 * Carrier adapter boundary — the ONLY seam between the API and rating sources.
 * Today: MockCarrierAdapter (ratefamily-mocks server). Post-gates: ApolloAdapter,
 * AprilAdapter, InsureLine panel rails — same interface, invisible swap.
 * Rule: adapters return the upstream payload untouched; the API never edits
 * premiums, never suppresses declines (TAC), never strips the mock envelope.
 */
export interface CarrierAdapter {
  quoteAuto(req: AutoQuoteRequest, scenario?: string): Promise<unknown>;
  quoteLife(req: Record<string, unknown>): Promise<unknown>;
  readonly source: 'mock' | 'apollo' | 'april' | 'panel';
}

export class MockCarrierAdapter implements CarrierAdapter {
  readonly source = 'mock' as const;
  constructor(private baseUrl = process.env.MOCK_RATING_BASE ?? 'http://localhost:4100') {}

  private async post(path: string, body: unknown, scenario?: string) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(scenario ? { 'X-Mock-Scenario': scenario } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      throw new Error(`rating upstream ${res.status}: ${detail?.message ?? 'error'}`);
    }
    return res.json();
  }

  quoteAuto(req: AutoQuoteRequest, scenario?: string) {
    return this.post('/mock/rating/auto/quote', req, scenario);
  }
  quoteLife(req: Record<string, unknown>) {
    // Compulife twin — the real ComplifeAdapter later routes via the NAT proxy
    return this.post('/mock/compulife/quote', req);
  }
}
