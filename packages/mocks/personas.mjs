/**
 * Ten canonical personas — every mock and every E2E test uses these.
 * Each has known expected outcomes per carrier; assertions are exact, not fuzzy.
 */
export const PERSONAS = {
  P1_CLEAN_COMMUTER: {
    label: 'Clean GTA commuter',
    auto: {
      postalCode: 'L6P1A1',
      drivers: [{ birthYear: 1988, licenceClass: 'G', yearsLicensed: 18, atFaultClaims3y: 0, minorConvictions3y: 0 }],
      vehicle: { year: 2022, make: 'Toyota', model: 'RAV4', annualKm: 18000 },
      reformElections: { dcpdOptOut: false, opcf49IncomeReplacement: false },
    },
  },
  P2_NEWCOMER: {
    label: 'Newcomer, 3 yrs foreign licence, no Canadian history',
    auto: {
      postalCode: 'L4T3M2',
      drivers: [{ birthYear: 1994, licenceClass: 'G', yearsLicensed: 1, atFaultClaims3y: 0, minorConvictions3y: 0 }],
      vehicle: { year: 2018, make: 'Honda', model: 'Civic', annualKm: 15000 },
      reformElections: { dcpdOptOut: false, opcf49IncomeReplacement: false },
    },
  },
  P3_HIGH_RISK: {
    label: 'Two at-fault claims',
    auto: {
      postalCode: 'M9V4T4',
      drivers: [{ birthYear: 1990, licenceClass: 'G', yearsLicensed: 12, atFaultClaims3y: 2, minorConvictions3y: 1 }],
      vehicle: { year: 2020, make: 'BMW', model: '330i', annualKm: 22000 },
      reformElections: { dcpdOptOut: false, opcf49IncomeReplacement: false },
    },
  },
  P4_G2_STUDENT: {
    label: 'G2 student',
    auto: {
      postalCode: 'N2L3G1',
      drivers: [{ birthYear: 2006, licenceClass: 'G2', yearsLicensed: 1, atFaultClaims3y: 0, minorConvictions3y: 0 }],
      vehicle: { year: 2015, make: 'Mazda', model: '3', annualKm: 10000 },
      reformElections: { dcpdOptOut: false, opcf49IncomeReplacement: false },
    },
  },
  P5_BRAMPTON_HOMEOWNER: {
    label: 'Brampton homeowner, finished basement, sewer backup',
    home: {
      postalCode: 'L6R2K7', yearBuilt: 2009, construction: 'brick_veneer', roofAgeYears: 6,
      heating: 'gas_forced_air', replacementCostCents: 62000000, claims5y: 0,
      endorsements: { waterDamage: true, sewerBackup: true, overlandFlood: true, earthquake: false },
    },
  },
  P6_CONDO_OWNER: {
    label: 'Downtown condo owner',
    condo: {
      postalCode: 'M5V3L9', contentsLimitCents: 7500000, liabilityCents: 200000000,
      unitImprovementsCents: 2500000, deductibleCents: 100000, claims5y: 0,
    },
  },
  P7_CONTRACTOR: {
    label: 'Small contractor (CGL)',
    commercial: {
      postalCode: 'L6T4V9', industryCode: 'contractor_general', annualRevenueCents: 45000000,
      employees: 3, cglLimitCents: 200000000, propertyLimitCents: 15000000,
    },
  },
  P8_TERM_LIFE_35F: {
    label: '35F non-smoker, term',
    life: { age: 35, sex: 'F', smoker: false, faceAmountCents: 75000000, term: 20, ciRider: false },
  },
  P9_TERM_LIFE_62M_SMOKER: {
    label: '62M smoker with CI rider',
    life: { age: 62, sex: 'M', smoker: true, faceAmountCents: 25000000, term: 10, ciRider: true },
  },
  P10_SUPER_VISA: {
    label: 'Super Visa parents, one pre-existing condition',
    travel: {
      plan: 'super_visa', ages: [61, 64], coverageCents: 10000000, deductibleCents: 100000,
      preExisting: [false, true], stabilityMonths: 4, durationDays: 365,
    },
  },
};
