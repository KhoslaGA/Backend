/** Home rating mock engine — coverage differences, not just price differences. */
import { fnv1a } from './auto.mjs';

const CARRIERS = [
  { code: 'aviva',       name: 'Aviva Canada',  badge: 'appointed', base: 1.00, overlandFlood: true  },
  { code: 'intact',      name: 'Intact',        badge: 'appointed', base: 1.05, overlandFlood: true  },
  { code: 'definity',    name: 'Definity',      badge: 'appointed', base: 0.96, overlandFlood: true  },
  { code: 'travelers',   name: 'Travelers',     badge: 'mga',       base: 1.08, overlandFlood: false },
  { code: 'caa',         name: 'CAA Insurance', badge: 'mga',       base: 0.95, overlandFlood: true  },
  { code: 'wawanesa',    name: 'Wawanesa',      badge: 'appointed', base: 0.91, overlandFlood: true  },
  { code: 'gore',        name: 'Gore Mutual',   badge: 'appointed', base: 0.98, overlandFlood: true  },
  { code: 'economical',  name: 'Economical',    badge: 'editorial', base: 1.02, overlandFlood: false },
];

// postal catastrophe bands: flood plains / wildfire FSAs
const catBand = (postal) => {
  const fsa = (postal ?? '').toUpperCase().slice(0, 3);
  if (/^L4H|^L0J|^K0A/.test(fsa)) return 'high';   // mock flood-prone
  if (/^P/.test(fsa)) return 'wildfire';
  return 'standard';
};

export function quoteHome(profile, { scenario = null } = {}) {
  const seed = fnv1a(JSON.stringify(profile));
  const cat = scenario === 'high-cat-zone' ? 'high' : catBand(profile.postalCode);
  const age = 2026 - profile.yearBuilt;

  let factor = 1.0;
  if (age > 40) factor *= 1.25; else if (age > 20) factor *= 1.1;
  if (profile.roofAgeYears > 15) factor *= 1.12;
  if (profile.construction === 'wood_frame') factor *= 1.08;
  factor *= 1 + (profile.claims5y ?? 0) * 0.3;
  if ((profile.claims5y ?? 0) === 0) factor *= 0.95; // claims-free discount
  const rc = profile.replacementCostCents / 50000000; // scaled vs $500K
  const base = 145000; // $1,450/yr

  const panel = CARRIERS.map((c, i) => {
    // hard declines
    if (profile.heating === 'oil' && ['aviva', 'intact', 'wawanesa'].includes(c.code))
      return decline(c, 'oil heating outside appetite');
    if (scenario === 'vacant' || profile.occupancy === 'vacant')
      return decline(c, 'vacant dwellings not written');
    if (cat === 'high' && !c.overlandFlood && profile.endorsements?.overlandFlood)
      return decline(c, 'overland flood not available in this territory');

    const jitter = 0.94 + ((seed >>> (i * 3)) % 121) / 1000;
    const catLoad = cat === 'high' ? 1.3 : cat === 'wildfire' ? 1.2 : 1.0;
    const premium = Math.round(base * c.base * factor * rc * catLoad * jitter);
    // coverage differences: which endorsements this carrier actually offers here
    const coverage = {
      waterDamage: true,
      sewerBackup: true,
      overlandFlood: c.overlandFlood && cat !== 'high' ? true : c.overlandFlood,
      earthquake: c.code !== 'economical',
    };
    return { carrierCode: c.code, carrierName: c.name, badge: c.badge, status: 'quoted',
      declineReason: null, annualPremiumCents: premium, coverage,
      bindMethod: 'broker_assisted', ratesIndicativeOnly: true };
  });

  return { mock: true, rates_indicative_only: true, quoteId: `mock-home-${seed.toString(16)}`, panel };
}
const decline = (c, reason) => ({ carrierCode: c.code, carrierName: c.name, badge: c.badge,
  status: 'declined', declineReason: reason, annualPremiumCents: null, coverage: null,
  bindMethod: 'broker_assisted', ratesIndicativeOnly: true });

/**
 * Compulife twin — mirrors request shape INCLUDING the REMOTE_IP-per-call
 * parameter and single-outbound-IP lockout, so the NAT proxy is tested before
 * it ever touches the paid API (protects the 1,200 quotes/month budget).
 */
const LIFE_CARRIERS = ['Empire Life', 'Equitable Life', 'Manulife', 'Sun Life', 'Canada Life',
  'BMO Insurance', 'Desjardins', 'iA Financial', 'RBC Insurance', 'Beneva', 'Assumption Life', 'UV Insurance'];

let seenSourceIp = null;         // module state simulates Compulife's IP lock window
let monthlyCount = 0;
export const _resetCompulifeState = () => { seenSourceIp = null; monthlyCount = 0; };

export function compulifeQuote(req, { sourceIp, scenario = null } = {}) {
  if (!req.REMOTE_IP) return { error: 'MISSING_REMOTE_IP', message: 'REMOTE_IP parameter is required on every call' };
  if (seenSourceIp && sourceIp && sourceIp !== seenSourceIp)
    return { error: 'IP_LOCKED', message: 'requests must originate from the registered outbound IP' };
  if (sourceIp) seenSourceIp = sourceIp;
  monthlyCount++;
  if (scenario === 'quota-exceeded' || monthlyCount > 1200)
    return { error: 'QUOTA_EXCEEDED', message: 'monthly quote volume exhausted' };

  const { age, sex, smoker, faceAmountCents, term, ciRider } = req;
  const seed = fnv1a(JSON.stringify(req));
  // deterministic premium curve: base per $100K/mo
  const basePer100k = 6.5 * Math.pow(1.085, age - 30) * (smoker ? 2.2 : 1) * (sex === 'M' ? 1.15 : 1) * (term === 20 ? 1.35 : term === 10 ? 1.0 : 2.4);
  const units = faceAmountCents / 10000000;

  const results = LIFE_CARRIERS.map((name, i) => {
    if (scenario === 'decline' && i % 4 === 0)
      return { carrier: name, status: 'declined', monthlyPremiumCents: null };
    const jitter = 0.9 + ((seed >>> (i * 2)) % 201) / 1000;
    let monthly = basePer100k * units * jitter * 100;
    if (scenario === 'table-rating' && i % 3 === 0) monthly *= 1.5; // rated offer
    if (ciRider) monthly *= 1.28;
    return { carrier: name, status: scenario === 'table-rating' && i % 3 === 0 ? 'rated' : 'standard',
      monthlyPremiumCents: Math.round(monthly) };
  }).sort((a, b) => (a.monthlyPremiumCents ?? 1e12) - (b.monthlyPremiumCents ?? 1e12));

  return { mock: true, rates_indicative_only: true, results, remainingQuota: Math.max(0, 1200 - monthlyCount) };
}
