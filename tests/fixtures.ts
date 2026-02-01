import { vi } from 'vitest';
import type {
  IrsRevocationRow,
  IrsRevocationResult,
  OfacSdnRow,
  OfacSanctionsResult,
  CourtRecordsResult,
  CourtListenerCase,
} from '../src/domain/red-flags/types.js';

// ============================================================================
// IRS Fixtures
// ============================================================================

export function makeIrsRow(overrides?: Partial<IrsRevocationRow>): IrsRevocationRow {
  return {
    ein: '123456789',
    legalName: 'REVOKED NONPROFIT INC',
    dba: '',
    city: 'NEW YORK',
    state: 'NY',
    zip: '10001',
    country: 'US',
    exemptionType: '03',
    revocationDate: '2022-05-15',
    postingDate: '2022-06-01',
    reinstatementDate: '',
    ...overrides,
  };
}

export function makeCleanIrsResult(): IrsRevocationResult {
  return {
    found: false,
    revoked: false,
    detail: 'EIN not found in IRS auto-revocation list (good \u2014 no revocation on record)',
  };
}

export function makeRevokedIrsResult(): IrsRevocationResult {
  return {
    found: true,
    revoked: true,
    detail: 'Tax-exempt status REVOKED on 2022-05-15 \u2014 failed to file Form 990 for 3 consecutive years',
    revocationDate: '2022-05-15',
    legalName: 'REVOKED NONPROFIT INC',
  };
}

export function makeReinstatedIrsResult(): IrsRevocationResult {
  return {
    found: true,
    revoked: false,
    detail: 'Was revoked on 2022-05-15 but reinstated on 2023-01-10',
    revocationDate: '2022-05-15',
    reinstatementDate: '2023-01-10',
    legalName: 'REINSTATED NONPROFIT INC',
  };
}

// ============================================================================
// OFAC Fixtures
// ============================================================================

export function makeOfacRow(overrides?: Partial<OfacSdnRow>): OfacSdnRow {
  return {
    entNum: '12345',
    name: 'BAD ACTOR FOUNDATION',
    sdnType: 'Entity',
    program: 'SDGT',
    title: '',
    remarks: '',
    ...overrides,
  };
}

export function makeCleanOfacResult(): OfacSanctionsResult {
  return {
    found: false,
    detail: 'No OFAC SDN matches found (good \u2014 not on sanctions list)',
    matches: [],
  };
}

export function makeMatchedOfacResult(): OfacSanctionsResult {
  return {
    found: true,
    detail: 'OFAC SDN MATCH \u2014 1 sanctioned entity/entities found matching "Bad Actor Foundation"',
    matches: [
      {
        entNum: '12345',
        name: 'BAD ACTOR FOUNDATION',
        sdnType: 'Entity',
        program: 'SDGT',
        matchedOn: 'primary',
      },
    ],
  };
}

// ============================================================================
// Court Fixtures
// ============================================================================

export function makeCourtCase(overrides?: Partial<CourtListenerCase>): CourtListenerCase {
  return {
    id: 99001,
    caseName: 'USA v. Test Nonprofit Inc',
    court: 'SDNY',
    dateArgued: null,
    dateFiled: '2024-06-01',
    docketNumber: '1:24-cv-01234',
    absoluteUrl: '/docket/99001/usa-v-test-nonprofit-inc/',
    ...overrides,
  };
}

export function makeCleanCourtResult(): CourtRecordsResult {
  return {
    found: false,
    detail: 'No federal court records found (good)',
    caseCount: 0,
    cases: [],
  };
}

export function makeFlaggedCourtResult(caseCount = 2): CourtRecordsResult {
  const cases = Array.from({ length: caseCount }, (_, i) =>
    makeCourtCase({ id: 99001 + i, caseName: `Case ${i + 1}` })
  );
  return {
    found: true,
    detail: `${caseCount} federal court case(s) found`,
    caseCount,
    cases,
  };
}

// ============================================================================
// Mock Store Factory
// ============================================================================

export function makeMockStore() {
  return {
    lookupEin: vi.fn().mockReturnValue(undefined),
    lookupName: vi.fn().mockReturnValue([]),
    initialize: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue({ irs_refreshed: true, ofac_refreshed: true }),
  };
}
