/**
 * Offer freshness differ — nightly job (BullMQ-scheduled in prod, runnable standalone).
 *
 * The honesty rule, structurally enforced: this module's DB grant surface is
 * SELECT on card/card_offer and INSERT/UPDATE on offer_watch ONLY. It cannot
 * write card_offer rows — offer changes reach the catalog exclusively through
 * the human-verified /admin/offers supersession path.
 *
 * Flow per card:
 *   fetch source page -> normalize -> sha256 -> compare to last seen hash
 *   changed  -> upsert offer_watch(status='NEEDS-VERIFICATION') + markdown flag line
 *   same     -> update last_checked_at
 *   fetch err-> status='FETCH-FAILED' (watchdog rule: report failure, never fabricate a pass)
 * Plus: any current offer with verified_at older than STALE_DAYS gets a staleness flag
 * regardless of page hash — silence from an issuer page is not verification.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import pg from 'pg';

const STALE_DAYS = Number(process.env.STALE_DAYS ?? 120);


export const normalize = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export const pageHash = (html) => createHash('sha256').update(normalize(html)).digest('hex');

export async function runFreshnessCheck({ pool, fetchImpl = fetch, now = () => new Date() }) {
  const flags = [];
  const { rows: cards } = await pool.query(`
    SELECT c.id, c.slug, co.source_url, co.verified_at, w.last_hash
    FROM card c
    JOIN card_offer co ON co.card_id = c.id AND co.superseded_by IS NULL
    LEFT JOIN offer_watch w ON w.card_id = c.id
    WHERE c.status = 'active' AND co.source_url NOT LIKE 'DEV-FIXTURE%'`);

  for (const card of cards) {
    // staleness check — independent of page content
    const ageDays = (now() - new Date(card.verified_at)) / 86400000;
    if (ageDays > STALE_DAYS) {
      flags.push({ slug: card.slug, status: 'STALE-VERIFICATION',
        note: `verified_at is ${Math.floor(ageDays)}d old (limit ${STALE_DAYS}d)` });
    }

    let hash;
    try {
      const res = await fetchImpl(card.source_url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      hash = pageHash(await res.text());
    } catch (e) {
      await upsertWatch(pool, card.id, card.last_hash, 'FETCH-FAILED', now());
      flags.push({ slug: card.slug, status: 'FETCH-FAILED', note: String(e.message ?? e) });
      continue; // DID NOT RUN for this card — reported, not papered over
    }

    if (card.last_hash && card.last_hash !== hash) {
      await upsertWatch(pool, card.id, hash, 'NEEDS-VERIFICATION', now());
      flags.push({ slug: card.slug, status: 'NEEDS-VERIFICATION',
        note: 'issuer page changed since last check — verify offer and supersede via /admin/offers' });
    } else {
      await upsertWatch(pool, card.id, hash, 'OK', now());
    }
  }

  if (flags.length) {
    const OUT_MD = process.env.FRESHNESS_MD ?? 'cowork/offers-review.md';
    try { mkdirSync(OUT_MD.split('/').slice(0, -1).join('/') || '.', { recursive: true }); } catch {}
    const stamp = now().toISOString();
    for (const f of flags)
      appendFileSync(OUT_MD, `- [${f.status}] ${f.slug} — ${f.note} (${stamp})\n`);
  }
  return { checked: cards.length, flags };
}

async function upsertWatch(pool, cardId, hash, status, at) {
  await pool.query(`
    INSERT INTO offer_watch (card_id, last_hash, status, last_checked_at)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (card_id) DO UPDATE
      SET last_hash = COALESCE(EXCLUDED.last_hash, offer_watch.last_hash),
          status = EXCLUDED.status, last_checked_at = EXCLUDED.last_checked_at`,
    [cardId, hash ?? null, status, at]);
}

// standalone: node packages/jobs/freshness.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = new pg.Pool({
    host: process.env.PGHOST ?? 'localhost',
    user: process.env.PGUSER ?? 'rf_jobs',
    password: process.env.PGPASSWORD ?? 'rf_jobs',
    database: process.env.PGDATABASE ?? 'ratefamily',
  });
  runFreshnessCheck({ pool })
    .then((r) => { console.log(JSON.stringify(r, null, 2)); return pool.end(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
