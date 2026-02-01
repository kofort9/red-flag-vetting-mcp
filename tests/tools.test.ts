import { describe, it, expect, vi } from 'vitest';
import {
  checkRedFlags,
  checkIrsRevocation,
  checkOfacSanctions,
  checkCourtRecords,
  refreshData,
} from '../src/domain/red-flags/tools.js';
import {
  makeCleanIrsResult,
  makeRevokedIrsResult,
  makeCleanOfacResult,
  makeMatchedOfacResult,
  makeCleanCourtResult,
  makeFlaggedCourtResult,
  makeMockStore,
} from './fixtures.js';

// ---- Mock factories ----

function mockIrsClient(result = makeCleanIrsResult()) {
  return { check: vi.fn().mockReturnValue(result) } as any;
}

function mockOfacClient(result = makeCleanOfacResult()) {
  return { check: vi.fn().mockReturnValue(result) } as any;
}

function mockCourtClient(result = makeCleanCourtResult()) {
  return { searchByOrgName: vi.fn().mockResolvedValue(result) } as any;
}

// ============================================================================
// checkRedFlags
// ============================================================================

describe('checkRedFlags', () => {
  it('returns validation error when ein missing', async () => {
    const result = await checkRedFlags(
      mockIrsClient(),
      mockOfacClient(),
      mockCourtClient(),
      { ein: '', name: 'Test Org' }
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('required');
  });

  it('returns validation error when name missing', async () => {
    const result = await checkRedFlags(
      mockIrsClient(),
      mockOfacClient(),
      mockCourtClient(),
      { ein: '123456789', name: '' }
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('required');
  });

  it('returns validation error when EIN too long', async () => {
    const result = await checkRedFlags(
      mockIrsClient(),
      mockOfacClient(),
      mockCourtClient(),
      { ein: 'x'.repeat(21), name: 'Test' }
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('too long');
  });

  it('returns validation error when name too long', async () => {
    const result = await checkRedFlags(
      mockIrsClient(),
      mockOfacClient(),
      mockCourtClient(),
      { ein: '123456789', name: 'x'.repeat(501) }
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('too long');
  });

  it('returns clean report when all checks pass', async () => {
    const result = await checkRedFlags(
      mockIrsClient(),
      mockOfacClient(),
      mockCourtClient(),
      { ein: '123456789', name: 'Clean Org' }
    );
    expect(result.success).toBe(true);
    expect(result.data!.clean).toBe(true);
    expect(result.data!.flags).toEqual([]);
    expect(result.data!.summary.recommendation).toBe('CLEAN');
  });

  it('returns flagged report when IRS revoked', async () => {
    const result = await checkRedFlags(
      mockIrsClient(makeRevokedIrsResult()),
      mockOfacClient(),
      mockCourtClient(),
      { ein: '123456789', name: 'Bad Org' }
    );
    expect(result.success).toBe(true);
    expect(result.data!.clean).toBe(false);
    expect(result.data!.flags).toHaveLength(1);
    expect(result.data!.summary.recommendation).toBe('BLOCK');
  });

  it('works with null courtClient (Phase 1-2)', async () => {
    const result = await checkRedFlags(
      mockIrsClient(),
      mockOfacClient(),
      null,
      { ein: '123456789', name: 'Test Org' }
    );
    expect(result.success).toBe(true);
    expect(result.data!.checks.court_records.found).toBe(false);
    expect(result.data!.checks.court_records.detail).toContain('not configured');
  });

  it('includes attribution', async () => {
    const result = await checkRedFlags(
      mockIrsClient(),
      mockOfacClient(),
      null,
      { ein: '123456789', name: 'Test' }
    );
    expect(result.attribution).toBeTruthy();
  });
});

// ============================================================================
// checkIrsRevocation
// ============================================================================

describe('checkIrsRevocation', () => {
  it('returns validation error when ein missing', () => {
    const result = checkIrsRevocation(mockIrsClient(), { ein: '' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('required');
  });

  it('returns validation error when ein too long', () => {
    const result = checkIrsRevocation(mockIrsClient(), { ein: 'x'.repeat(21) });
    expect(result.success).toBe(false);
    expect(result.error).toContain('too long');
  });

  it('delegates to irsClient.check and wraps result', () => {
    const expected = makeCleanIrsResult();
    const client = mockIrsClient(expected);
    const result = checkIrsRevocation(client, { ein: '123456789' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual(expected);
    expect(client.check).toHaveBeenCalledWith('123456789');
  });

  it('catches thrown errors gracefully', () => {
    const client = { check: vi.fn().mockImplementation(() => { throw new Error('boom'); }) } as any;
    const result = checkIrsRevocation(client, { ein: '123456789' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('boom');
  });
});

// ============================================================================
// checkOfacSanctions
// ============================================================================

describe('checkOfacSanctions', () => {
  it('returns validation error when name missing', () => {
    const result = checkOfacSanctions(mockOfacClient(), { name: '' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('required');
  });

  it('returns validation error when name too long', () => {
    const result = checkOfacSanctions(mockOfacClient(), { name: 'x'.repeat(501) });
    expect(result.success).toBe(false);
  });

  it('delegates to ofacClient.check and wraps result', () => {
    const expected = makeMatchedOfacResult();
    const client = mockOfacClient(expected);
    const result = checkOfacSanctions(client, { name: 'Bad Org' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual(expected);
  });
});

// ============================================================================
// checkCourtRecords
// ============================================================================

describe('checkCourtRecords', () => {
  it('returns validation error when courtClient is null', async () => {
    const result = await checkCourtRecords(null, { name: 'Test' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not configured');
  });

  it('returns validation error when name missing', async () => {
    const result = await checkCourtRecords(mockCourtClient(), { name: '' });
    expect(result.success).toBe(false);
  });

  it('returns validation error when lookback_years out of range', async () => {
    const result = await checkCourtRecords(mockCourtClient(), { name: 'Test', lookback_years: 0 });
    expect(result.success).toBe(false);
    expect(result.error).toContain('between 1 and 10');
  });

  it('returns validation error when lookback_years > 10', async () => {
    const result = await checkCourtRecords(mockCourtClient(), { name: 'Test', lookback_years: 11 });
    expect(result.success).toBe(false);
  });

  it('defaults lookback_years to 1', async () => {
    const client = mockCourtClient();
    await checkCourtRecords(client, { name: 'Test' });
    expect(client.searchByOrgName).toHaveBeenCalledWith('Test', 1);
  });

  it('passes lookback_years through', async () => {
    const client = mockCourtClient();
    await checkCourtRecords(client, { name: 'Test', lookback_years: 5 });
    expect(client.searchByOrgName).toHaveBeenCalledWith('Test', 5);
  });

  it('delegates and wraps result on success', async () => {
    const expected = makeFlaggedCourtResult(2);
    const client = mockCourtClient(expected);
    const result = await checkCourtRecords(client, { name: 'Test' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual(expected);
  });
});

// ============================================================================
// refreshData
// ============================================================================

describe('refreshData', () => {
  it('defaults source to all', async () => {
    const store = makeMockStore();
    await refreshData(store as any, {});
    expect(store.refresh).toHaveBeenCalledWith('all');
  });

  it('passes source through', async () => {
    const store = makeMockStore();
    await refreshData(store as any, { source: 'irs' });
    expect(store.refresh).toHaveBeenCalledWith('irs');
  });

  it('wraps result on success', async () => {
    const store = makeMockStore();
    const result = await refreshData(store as any, { source: 'all' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ irs_refreshed: true, ofac_refreshed: true });
  });

  it('catches thrown errors', async () => {
    const store = makeMockStore();
    store.refresh.mockRejectedValue(new Error('network fail'));
    const result = await refreshData(store as any, {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('network fail');
  });
});
