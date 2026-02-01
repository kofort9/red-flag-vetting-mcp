import { describe, it, expect } from 'vitest';
import { aggregateFlags, getRecommendation } from '../src/domain/red-flags/scoring.js';
import { generateSummary } from '../src/domain/red-flags/messages.js';
import {
  makeCleanIrsResult,
  makeRevokedIrsResult,
  makeReinstatedIrsResult,
  makeCleanOfacResult,
  makeMatchedOfacResult,
  makeCleanCourtResult,
  makeFlaggedCourtResult,
} from './fixtures.js';

// ============================================================================
// aggregateFlags
// ============================================================================

describe('aggregateFlags', () => {
  it('returns empty array when all checks are clean', () => {
    const flags = aggregateFlags(
      makeCleanIrsResult(),
      makeCleanOfacResult(),
      makeCleanCourtResult()
    );
    expect(flags).toEqual([]);
  });

  it('adds CRITICAL flag for IRS revocation', () => {
    const flags = aggregateFlags(
      makeRevokedIrsResult(),
      makeCleanOfacResult(),
      makeCleanCourtResult()
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].severity).toBe('CRITICAL');
    expect(flags[0].source).toBe('irs_revocation');
    expect(flags[0].type).toBe('tax_exempt_status_revoked');
  });

  it('does NOT flag reinstated IRS status', () => {
    const flags = aggregateFlags(
      makeReinstatedIrsResult(),
      makeCleanOfacResult(),
      makeCleanCourtResult()
    );
    expect(flags).toEqual([]);
  });

  it('adds CRITICAL flag for OFAC match', () => {
    const flags = aggregateFlags(
      makeCleanIrsResult(),
      makeMatchedOfacResult(),
      makeCleanCourtResult()
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].severity).toBe('CRITICAL');
    expect(flags[0].source).toBe('ofac_sanctions');
    expect(flags[0].type).toBe('sanctions_list_match');
  });

  it('adds MEDIUM flag for 1-2 court cases', () => {
    const flags = aggregateFlags(
      makeCleanIrsResult(),
      makeCleanOfacResult(),
      makeFlaggedCourtResult(2)
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].severity).toBe('MEDIUM');
    expect(flags[0].source).toBe('court_records');
  });

  it('adds HIGH flag for 3+ court cases', () => {
    const flags = aggregateFlags(
      makeCleanIrsResult(),
      makeCleanOfacResult(),
      makeFlaggedCourtResult(3)
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].severity).toBe('HIGH');
  });

  it('aggregates multiple flags from different sources', () => {
    const flags = aggregateFlags(
      makeRevokedIrsResult(),
      makeMatchedOfacResult(),
      makeFlaggedCourtResult(1)
    );
    expect(flags).toHaveLength(3);
    expect(flags.map((f) => f.source)).toEqual([
      'irs_revocation',
      'ofac_sanctions',
      'court_records',
    ]);
  });
});

// ============================================================================
// getRecommendation
// ============================================================================

describe('getRecommendation', () => {
  it('returns CLEAN when no flags', () => {
    expect(getRecommendation([])).toBe('CLEAN');
  });

  it('returns BLOCK when any CRITICAL flag exists', () => {
    const flags = aggregateFlags(
      makeRevokedIrsResult(),
      makeCleanOfacResult(),
      makeCleanCourtResult()
    );
    expect(getRecommendation(flags)).toBe('BLOCK');
  });

  it('returns FLAG for HIGH/MEDIUM flags without CRITICAL', () => {
    const flags = aggregateFlags(
      makeCleanIrsResult(),
      makeCleanOfacResult(),
      makeFlaggedCourtResult(5)
    );
    expect(getRecommendation(flags)).toBe('FLAG');
  });
});

// ============================================================================
// generateSummary
// ============================================================================

describe('generateSummary', () => {
  it('returns correct headline for CLEAN', () => {
    const summary = generateSummary([], 'CLEAN', 3);
    expect(summary.headline).toBe('No Red Flags Detected');
    expect(summary.sources_checked).toBe(3);
    expect(summary.flags_found).toBe(0);
    expect(summary.recommendation).toBe('CLEAN');
  });

  it('returns correct headline for FLAG', () => {
    const flags = aggregateFlags(
      makeCleanIrsResult(),
      makeCleanOfacResult(),
      makeFlaggedCourtResult(1)
    );
    const summary = generateSummary(flags, 'FLAG', 3);
    expect(summary.headline).toContain('Manual Review');
    expect(summary.flags_found).toBe(1);
  });

  it('returns correct headline for BLOCK', () => {
    const flags = aggregateFlags(
      makeRevokedIrsResult(),
      makeCleanOfacResult(),
      makeCleanCourtResult()
    );
    const summary = generateSummary(flags, 'BLOCK', 3);
    expect(summary.headline).toContain('CRITICAL');
    expect(summary.headline).toContain('Do Not Proceed');
    expect(summary.flags_found).toBe(1);
  });
});
