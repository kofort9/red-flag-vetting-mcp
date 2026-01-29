import { IrsRevocationClient } from './irs-revocation-client.js';
import { OfacSdnClient } from './ofac-sdn-client.js';
import { CourtListenerClient } from './courtlistener-client.js';
import { CsvDataStore } from './csv-loader.js';
import { aggregateFlags, getRecommendation } from './scoring.js';
import { generateSummary } from './messages.js';
import { logDebug, logError } from '../../core/logging.js';
import {
  ToolResponse,
  RedFlagReport,
  IrsRevocationResult,
  OfacSanctionsResult,
  CourtRecordsResult,
  CheckRedFlagsInput,
  CheckIrsRevocationInput,
  CheckOfacSanctionsInput,
  CheckCourtRecordsInput,
  RefreshDataInput,
} from './types.js';

const ATTRIBUTION =
  'Data from IRS Auto-Revocation List, US Treasury OFAC SDN List, and CourtListener (Free Law Project)';

// Security: Input length limits
const MAX_NAME_LENGTH = 500;
const MAX_EIN_LENGTH = 20;

// ============================================================================
// Tool: check_red_flags (composite)
// ============================================================================

export async function checkRedFlags(
  irsClient: IrsRevocationClient,
  ofacClient: OfacSdnClient,
  courtClient: CourtListenerClient,
  input: CheckRedFlagsInput
): Promise<ToolResponse<RedFlagReport>> {
  try {
    if (!input.ein || !input.name) {
      return {
        success: false,
        error: 'Both ein and name are required',
        attribution: ATTRIBUTION,
      };
    }

    if (input.ein.length > MAX_EIN_LENGTH) {
      return {
        success: false,
        error: `EIN too long (max ${MAX_EIN_LENGTH} characters)`,
        attribution: ATTRIBUTION,
      };
    }

    if (input.name.length > MAX_NAME_LENGTH) {
      return {
        success: false,
        error: `Name too long (max ${MAX_NAME_LENGTH} characters)`,
        attribution: ATTRIBUTION,
      };
    }

    logDebug(`Checking red flags for ${input.name} (EIN: ${input.ein})`);

    // Run all 3 checks in parallel
    // IRS + OFAC are instant Map lookups; CourtListener is ~500ms
    const [irsResult, ofacResult, courtResult] = await Promise.all([
      Promise.resolve(irsClient.check(input.ein)),
      Promise.resolve(ofacClient.check(input.name)),
      courtClient.searchByOrgName(input.name),
    ]);

    const flags = aggregateFlags(irsResult, ofacResult, courtResult);
    const recommendation = getRecommendation(flags);
    const summary = generateSummary(flags, recommendation, 3);

    const report: RedFlagReport = {
      ein: input.ein,
      name: input.name,
      checks: {
        irs_revocation: irsResult,
        ofac_sanctions: ofacResult,
        court_records: courtResult,
      },
      flags,
      clean: flags.length === 0,
      summary,
    };

    return {
      success: true,
      data: report,
      attribution: ATTRIBUTION,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError('checkRedFlags failed:', message);
    return {
      success: false,
      error: `Red flag check failed: ${message}`,
      attribution: ATTRIBUTION,
    };
  }
}

// ============================================================================
// Tool: check_irs_revocation
// ============================================================================

export function checkIrsRevocation(
  irsClient: IrsRevocationClient,
  input: CheckIrsRevocationInput
): ToolResponse<IrsRevocationResult> {
  try {
    if (!input.ein) {
      return {
        success: false,
        error: 'EIN is required',
        attribution: ATTRIBUTION,
      };
    }

    if (input.ein.length > MAX_EIN_LENGTH) {
      return {
        success: false,
        error: `EIN too long (max ${MAX_EIN_LENGTH} characters)`,
        attribution: ATTRIBUTION,
      };
    }

    const result = irsClient.check(input.ein);

    return {
      success: true,
      data: result,
      attribution: ATTRIBUTION,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError('checkIrsRevocation failed:', message);
    return {
      success: false,
      error: `IRS revocation check failed: ${message}`,
      attribution: ATTRIBUTION,
    };
  }
}

// ============================================================================
// Tool: check_ofac_sanctions
// ============================================================================

export function checkOfacSanctions(
  ofacClient: OfacSdnClient,
  input: CheckOfacSanctionsInput
): ToolResponse<OfacSanctionsResult> {
  try {
    if (!input.name) {
      return {
        success: false,
        error: 'Name is required',
        attribution: ATTRIBUTION,
      };
    }

    if (input.name.length > MAX_NAME_LENGTH) {
      return {
        success: false,
        error: `Name too long (max ${MAX_NAME_LENGTH} characters)`,
        attribution: ATTRIBUTION,
      };
    }

    const result = ofacClient.check(input.name);

    return {
      success: true,
      data: result,
      attribution: ATTRIBUTION,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError('checkOfacSanctions failed:', message);
    return {
      success: false,
      error: `OFAC sanctions check failed: ${message}`,
      attribution: ATTRIBUTION,
    };
  }
}

// ============================================================================
// Tool: check_court_records
// ============================================================================

export async function checkCourtRecords(
  courtClient: CourtListenerClient,
  input: CheckCourtRecordsInput
): Promise<ToolResponse<CourtRecordsResult>> {
  try {
    if (!input.name) {
      return {
        success: false,
        error: 'Name is required',
        attribution: ATTRIBUTION,
      };
    }

    if (input.name.length > MAX_NAME_LENGTH) {
      return {
        success: false,
        error: `Name too long (max ${MAX_NAME_LENGTH} characters)`,
        attribution: ATTRIBUTION,
      };
    }

    const lookbackYears = input.lookback_years ?? 1;
    if (lookbackYears < 1 || lookbackYears > 10) {
      return {
        success: false,
        error: 'lookback_years must be between 1 and 10',
        attribution: ATTRIBUTION,
      };
    }

    const result = await courtClient.searchByOrgName(input.name, lookbackYears);

    return {
      success: true,
      data: result,
      attribution: ATTRIBUTION,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError('checkCourtRecords failed:', message);
    return {
      success: false,
      error: `Court records check failed: ${message}`,
      attribution: ATTRIBUTION,
    };
  }
}

// ============================================================================
// Tool: refresh_data
// ============================================================================

export async function refreshData(
  store: CsvDataStore,
  input: RefreshDataInput
): Promise<ToolResponse<{ irs_refreshed: boolean; ofac_refreshed: boolean }>> {
  try {
    const source = input.source || 'all';
    logDebug(`Refreshing data: ${source}`);

    const result = await store.refresh(source);

    return {
      success: true,
      data: result,
      attribution: ATTRIBUTION,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError('refreshData failed:', message);
    return {
      success: false,
      error: `Data refresh failed: ${message}`,
      attribution: ATTRIBUTION,
    };
  }
}
