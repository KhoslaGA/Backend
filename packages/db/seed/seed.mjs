// Dev-fixture seed. Figures are APPROXIMATE for development only.
// source_url carries the DEV-FIXTURE marker so this data can never be
// mistaken for verified production offers. Production offers come only
// through the admin CMS with real verified_at + issuer source_url.
import pg from 'pg';

const pool = new pg.Pool({ host: 'localhost', user: 'rf', password: 'rf', database: 'ratefamily' });
const FIXTURE = (slug) => `DEV-FIXTURE://not-verified/${slug}`;

const issuers = [
  ['scotiabank', 'Scotiabank', 'fintel', 'approved'],
  ['national-bank', 'National Bank', 'fintel', 'applied'],
  ['borrowell', 'Borrowell', 'fintel', 'applied'],
  ['neo-financial', 'Neo Financial', 'fintel', 'applied'],
  ['tangerine', 'Tangerine', 'fintel', 'applied'],
  ['amex', 'American Express Canada', 'cj', 'applied'],
  ['td', 'TD Canada Trust', 'direct', 'none'],
  ['mbna', 'MBNA', 'direct', 'none'],
];

// [issuer, slug, name, network, newcomer, secured, band, fee¢, aprbps, welcome, welcome¢, rewards, fxbps]
const cards = [
  ['scotiabank','scotia-passport-visa-infinite','Scotiabank Passport Visa Infinite','visa',true,false,'good',15000,2099,'Up to 40,000 Scene+ points in year one',40000,{travel:2.0,groceries:3.0,base:1.0},0],
  ['scotiabank','scotia-momentum-visa-infinite','Scotiabank Momentum Visa Infinite','visa',false,false,'good',12000,2099,'10% cash back first 3 months (up to $200)',20000,{cashback:4.0,groceries:4.0,base:1.0},250],
  ['scotiabank','scotia-secured-visa','Scotiabank Secured Visa','visa',true,true,'none',0,1999,null,null,{base:0.5},250],
  ['national-bank','nbc-world-elite','NBC World Elite Mastercard','mastercard',false,false,'excellent',15000,2099,'Up to $300 welcome value',30000,{travel:2.0,base:1.5},250],
  ['borrowell','borrowell-rewards','Borrowell Rewards Card','mastercard',true,false,'poor',0,1999,null,null,{cashback:1.0,base:1.0},250],
  ['neo-financial','neo-credit','Neo Mastercard','mastercard',true,false,'fair',0,1999,'Average 5% cash back at partners',null,{cashback:5.0,base:0.5},250],
  ['neo-financial','neo-secured','Neo Secured Mastercard','mastercard',true,true,'none',0,1999,null,null,{cashback:5.0,base:0.5},250],
  ['tangerine','tangerine-money-back','Tangerine Money-Back Mastercard','mastercard',true,false,'fair',0,1995,'Extra 10% back first 2 months (up to $100)',10000,{cashback:2.0,base:0.5},250],
  ['amex','amex-cobalt','American Express Cobalt','amex',false,false,'good',15588,2199,'Up to 15,000 MR points in year one',15000,{groceries:5.0,travel:2.0,base:1.0},250],
  ['amex','amex-green','American Express Green Card','amex',true,false,'fair',0,2199,'10,000 MR points welcome',10000,{base:1.0},250],
  ['td','td-cash-back-visa-infinite','TD Cash Back Visa Infinite','visa',false,false,'good',13900,2099,'10% cash back first 3 months (conditions)',35000,{cashback:3.0,base:1.0},250],
  ['mbna','mbna-true-line','MBNA True Line Mastercard','mastercard',false,false,'fair',0,1299,'0% balance transfer for 12 months (3% fee)',null,{base:0},250],
];
// give MBNA True Line a BT APR for the balance-transfer category
const btAprFor = { 'mbna-true-line': 0 };

const run = async () => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows: [t] } = await c.query("SELECT id FROM tenant WHERE slug='toprates'");
    const tid = t.id;

    const issuerIds = {};
    for (const [slug, name, net, status] of issuers) {
      const { rows: [r] } = await c.query(
        `INSERT INTO issuer (tenant_id, slug, name, affiliate_network, program_status)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (tenant_id, slug) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`, [tid, slug, name, net, status]);
      issuerIds[slug] = r.id;
    }

    for (const [iss, slug, name, network, newcomer, secured, band, fee, apr, wtext, wval, rewards, fx] of cards) {
      const { rows: [card] } = await c.query(
        `INSERT INTO card (tenant_id, issuer_id, slug, name, network, newcomer_eligible, secured, min_credit_band)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (tenant_id, slug) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`, [tid, issuerIds[iss], slug, name, network, newcomer, secured, band]);

      const { rows: [existing] } = await c.query(
        'SELECT 1 FROM card_offer WHERE card_id = $1 AND superseded_by IS NULL LIMIT 1', [card.id]);
      if (!existing) {
        await c.query(
          `INSERT INTO card_offer (tenant_id, card_id, annual_fee_cents, purchase_apr_bps,
             balance_transfer_apr_bps, welcome_offer_text, welcome_offer_value_cents,
             rewards_summary, fx_fee_bps, verified_at, source_url)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now(), $10)`,
          [tid, card.id, fee, apr, btAprFor[slug] ?? null, wtext, wval, JSON.stringify(rewards), fx, FIXTURE(slug)]);
      }

      // active apply link only for approved programs; others exercise the fallback path
      const [, , , netApproved] = issuers.find(([s]) => s === iss);
      if (netApproved === 'approved') {
        await c.query(
          `INSERT INTO affiliate_link (tenant_id, card_id, destination, url, network, tracking_template, active)
           VALUES ($1,$2,'apply',$3,'fintel','?subid={click_id}', true)
           ON CONFLICT DO NOTHING`,
          [tid, card.id, `https://track.fintel-example.test/${slug}`]);
      }
    }
    await c.query('COMMIT');
    const { rows: [n] } = await c.query('SELECT count(*) FROM card');
    console.log(`seeded — ${n.count} cards total`);
  } catch (e) { await c.query('ROLLBACK'); throw e; }
  finally { c.release(); await pool.end(); }
};
run();
