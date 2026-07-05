/**
 * Auto rating mock engine — pure, deterministic, no I/O.
 * Extends the May 29 fake-auto-API pattern: 8 Ontario carriers, GTA-realistic
 * premiums, per-carrier appetite (declines render in the panel — TAC rule:
 * a completed profile sees everything, unsuppressed).
 * Determinism: FNV-1a hash of the normalized profile seeds all variation.
 */

export const fnv1a = (str) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
};

const CARRIERS = [
  { code: 'aviva',       name: 'Aviva Canada',  badge: 'appointed', base: 1.00 },
  { code: 'intact',      name: 'Intact',        badge: 'appointed', base: 1.06 },
  { code: 'definity',    name: 'Definity',      badge: 'appointed', base: 0.97 },
  { code: 'travelers',   name: 'Travelers',     badge: 'mga',       base: 1.10 },
  { code: 'caa',         name: 'CAA Insurance', badge: 'mga',       base: 0.94 },
  { code: 'wawanesa',    name: 'Wawanesa',      badge: 'appointed', base: 0.92 },
  { code: 'pembridge',   name: 'Pembridge',     badge: 'mga',       base: 1.14 },
  { code: 'cooperators', name: 'Co-operators',  badge: 'editorial', base: 1.03 },
];

// FSA first-letter risk bands (coarse, deterministic)
const postalRisk = (postal) => {
  const fsa = (postal ?? '').toUpperCase().slice(0, 3);
  if (/^M9V|^M3N|^L6P|^L4T/.test(fsa)) return 1.35;  // high-risk GTA FSAs
  if (/^M/.test(fsa)) return 1.2;
  if (/^L[46]/.test(fsa)) return 1.15;
  if (/^[KN]/.test(fsa)) return 0.95;
  return 1.0;
};

const driverFactor = (d) => {
  const age = 2026 - d.birthYear;
  let f = 1.0;
  if (age < 21) f *= 2.1; else if (age < 25) f *= 1.6; else if (age < 30) f *= 1.25;
  else if (age > 70) f *= 1.2;
  if (d.licenceClass === 'G2') f *= 1.4;
  if (d.licenceClass === 'G1') f *= 1.9;
  if (d.yearsLicensed < 3) f *= 1.3;
  f *= 1 + d.atFaultClaims3y * 0.45 + d.minorConvictions3y * 0.15;
  return f;
};

/** Per-carrier appetite: who declines whom. Returns decline reason or null. */
export function appetite(carrier, profile) {
  const d = profile.drivers[0];
  const claims = profile.drivers.reduce((s, x) => s + x.atFaultClaims3y, 0);
  const convictions = profile.drivers.reduce((s, x) => s + x.minorConvictions3y, 0);
  switch (carrier.code) {
    case 'aviva':
    case 'intact':
      if (claims >= 2) return 'at-fault claim history outside appetite';
      if (d.licenceClass === 'G1') return 'principal operator must hold G2 or G';
      break;
    case 'definity':
      if (claims >= 2 && convictions >= 1) return 'combined claims and conviction history';
      break;
    case 'wawanesa':
      if (claims >= 1 && d.yearsLicensed < 3) return 'new driver with claims history';
      if (convictions > 2) return 'conviction count outside appetite';
      break;
    case 'caa':
      if (d.licenceClass === 'G1') return 'G1 principal operator not written';
      break;
    case 'travelers':
      if (claims >= 3) return 'claims frequency outside appetite';
      break;
    // pembridge (high-risk friendly) and cooperators: no hard declines in mock
  }
  return null;
}

export function quoteAuto(profile, { scenario = null, today = new Date('2026-07-05') } = {}) {
  // seed excludes elections: same risk profile = same jitter, so election
  // effects are measurable rather than drowned in per-profile noise
  const { reformElections: _re, renewal: _rn, priorAnnualPremiumCents: _pp, ...riskProfile } = profile;
  const seed = fnv1a(JSON.stringify(riskProfile));
  const risk = postalRisk(profile.postalCode);
  const drv = profile.drivers.map(driverFactor).reduce((a, b) => a * b, 1);
  const vehicleAge = Math.max(0, today.getFullYear() - profile.vehicle.year);
  const veh = Math.max(0.85, 1.15 - vehicleAge * 0.03) * (1 + Math.min(profile.vehicle.annualKm, 40000) / 100000);

  // July 1 2026 reform elections
  let reform = 1.0;
  const notes = [];
  if (profile.reformElections?.dcpdOptOut) { reform *= 0.93; notes.push('DCPD opt-out applied (O. Reg. 383/24)'); }
  if (profile.reformElections?.opcf49IncomeReplacement) { reform *= 1.04; notes.push('OPCF 49 income replacement elected'); }

  const basePremium = 165000; // $1,650 baseline annual, cents

  const panel = CARRIERS.map((c, i) => {
    if (scenario === 'all-decline') {
      return { carrierCode: c.code, carrierName: c.name, badge: c.badge, status: 'declined',
        declineReason: 'facility-risk profile — broker placement required',
        annualPremiumCents: null, bindMethod: 'broker_assisted', ratesIndicativeOnly: true };
    }
    const reason = appetite(c, profile);
    if (reason) {
      return { carrierCode: c.code, carrierName: c.name, badge: c.badge, status: 'declined',
        declineReason: reason, annualPremiumCents: null, bindMethod: 'broker_assisted', ratesIndicativeOnly: true };
    }
    // deterministic per-carrier jitter ±6%
    const jitter = 0.94 + ((seed >>> (i * 3)) % 121) / 1000;
    let premium = Math.round(basePremium * c.base * risk * drv * veh * reform * jitter);
    // renewal rate-capping simulation
    if (profile.renewal && profile.priorAnnualPremiumCents) {
      const cap = Math.round(profile.priorAnnualPremiumCents * 1.10);
      if (premium > cap) { premium = cap; }
    }
    return { carrierCode: c.code, carrierName: c.name, badge: c.badge, status: 'quoted',
      declineReason: null, annualPremiumCents: premium, bindMethod: 'broker_assisted', ratesIndicativeOnly: true };
  });

  return {
    mock: true,
    rates_indicative_only: true,
    quoteId: `mock-auto-${seed.toString(16)}`,
    notes,
    panel,
  };
}
