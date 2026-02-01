import {
  RedFlag,
  RedFlagSeverity,
  Recommendation,
  IrsRevocationResult,
  OfacSanctionsResult,
  CourtRecordsResult,
} from './types.js';

export function aggregateFlags(
  irs: IrsRevocationResult,
  ofac: OfacSanctionsResult,
  court: CourtRecordsResult
): RedFlag[] {
  const flags: RedFlag[] = [];

  // IRS revocation = CRITICAL
  if (irs.revoked) {
    flags.push({
      severity: 'CRITICAL',
      source: 'irs_revocation',
      type: 'tax_exempt_status_revoked',
      detail: irs.detail,
    });
  }

  // OFAC match = CRITICAL
  if (ofac.found) {
    flags.push({
      severity: 'CRITICAL',
      source: 'ofac_sanctions',
      type: 'sanctions_list_match',
      detail: ofac.detail,
    });
  }

  // Court records
  if (court.found) {
    const severity: RedFlagSeverity = court.caseCount >= 3 ? 'HIGH' : 'MEDIUM';

    flags.push({
      severity,
      source: 'court_records',
      type: 'federal_court_cases',
      detail: court.detail,
    });
  }

  return flags;
}

export function getRecommendation(flags: RedFlag[]): Recommendation {
  if (flags.some((f) => f.severity === 'CRITICAL')) {
    return 'BLOCK';
  }
  if (flags.length > 0) {
    return 'FLAG';
  }
  return 'CLEAN';
}
