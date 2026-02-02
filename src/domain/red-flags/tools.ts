import { IrsRevocationClient } from "./irs-revocation-client.js";
import { OfacSdnClient } from "./ofac-sdn-client.js";
import { CourtListenerClient } from "./courtlistener-client.js";
import { CsvDataStore } from "./csv-loader.js";
import { aggregateFlags, getRecommendation } from "./scoring.js";
import { generateSummary } from "./messages.js";
import { logDebug, logError, getErrorMessage } from "../../core/logging.js";
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
} from "./types.js";

const ATTRIBUTION =
  "Data from IRS Auto-Revocation List, US Treasury OFAC SDN List, and CourtListener (Free Law Project)";

const MAX_NAME_LENGTH = 500;
const MAX_EIN_LENGTH = 20;

function validationError<T>(message: string): ToolResponse<T> {
  return { success: false, error: message, attribution: ATTRIBUTION };
}

export async function checkRedFlags(
  irsClient: IrsRevocationClient,
  ofacClient: OfacSdnClient,
  courtClient: CourtListenerClient | null,
  input: CheckRedFlagsInput,
): Promise<ToolResponse<RedFlagReport>> {
  try {
    const ein = input.ein?.trim();
    const name = input.name?.trim();
    if (!ein || !name) {
      return validationError("Both ein and name are required");
    }
    if (ein.length > MAX_EIN_LENGTH) {
      return validationError(`EIN too long (max ${MAX_EIN_LENGTH} characters)`);
    }
    if (name.length > MAX_NAME_LENGTH) {
      return validationError(
        `Name too long (max ${MAX_NAME_LENGTH} characters)`,
      );
    }

    logDebug(`Checking red flags for ${name} (EIN: ${ein})`);

    const irsResult = irsClient.check(ein);
    const ofacResult = ofacClient.check(name);
    const courtResult = courtClient
      ? await courtClient.searchByOrgName(name)
      : {
          found: false,
          detail:
            "Court record checks not configured (no CourtListener API token)",
          caseCount: 0,
          cases: [],
        };

    const flags = aggregateFlags(irsResult, ofacResult, courtResult);
    const recommendation = getRecommendation(flags);
    const summary = generateSummary(flags, recommendation, 3);

    const report: RedFlagReport = {
      ein,
      name,
      checks: {
        irs_revocation: irsResult,
        ofac_sanctions: ofacResult,
        court_records: courtResult,
      },
      flags,
      clean: flags.length === 0,
      summary,
    };

    return { success: true, data: report, attribution: ATTRIBUTION };
  } catch (error) {
    const message = getErrorMessage(error);
    logError("checkRedFlags failed:", message);
    return validationError(`Red flag check failed: ${message}`);
  }
}

export function checkIrsRevocation(
  irsClient: IrsRevocationClient,
  input: CheckIrsRevocationInput,
): ToolResponse<IrsRevocationResult> {
  try {
    const ein = input.ein?.trim();
    if (!ein) {
      return validationError("EIN is required");
    }
    if (ein.length > MAX_EIN_LENGTH) {
      return validationError(`EIN too long (max ${MAX_EIN_LENGTH} characters)`);
    }

    const result = irsClient.check(ein);
    return { success: true, data: result, attribution: ATTRIBUTION };
  } catch (error) {
    const message = getErrorMessage(error);
    logError("checkIrsRevocation failed:", message);
    return validationError(`IRS revocation check failed: ${message}`);
  }
}

export function checkOfacSanctions(
  ofacClient: OfacSdnClient,
  input: CheckOfacSanctionsInput,
): ToolResponse<OfacSanctionsResult> {
  try {
    const name = input.name?.trim();
    if (!name) {
      return validationError("Name is required");
    }
    if (name.length > MAX_NAME_LENGTH) {
      return validationError(
        `Name too long (max ${MAX_NAME_LENGTH} characters)`,
      );
    }

    const result = ofacClient.check(name);
    return { success: true, data: result, attribution: ATTRIBUTION };
  } catch (error) {
    const message = getErrorMessage(error);
    logError("checkOfacSanctions failed:", message);
    return validationError(`OFAC sanctions check failed: ${message}`);
  }
}

export async function checkCourtRecords(
  courtClient: CourtListenerClient | null,
  input: CheckCourtRecordsInput,
): Promise<ToolResponse<CourtRecordsResult>> {
  try {
    if (!courtClient) {
      return validationError(
        "Court record checks not configured (no CourtListener API token)",
      );
    }
    const name = input.name?.trim();
    if (!name) {
      return validationError("Name is required");
    }
    if (name.length > MAX_NAME_LENGTH) {
      return validationError(
        `Name too long (max ${MAX_NAME_LENGTH} characters)`,
      );
    }

    const lookbackYears = Math.floor(input.lookback_years ?? 1);
    if (lookbackYears < 1 || lookbackYears > 10) {
      return validationError("lookback_years must be between 1 and 10");
    }

    const result = await courtClient.searchByOrgName(name, lookbackYears);
    return { success: true, data: result, attribution: ATTRIBUTION };
  } catch (error) {
    const message = getErrorMessage(error);
    logError("checkCourtRecords failed:", message);
    return validationError(`Court records check failed: ${message}`);
  }
}

export async function refreshData(
  store: CsvDataStore,
  input: RefreshDataInput,
): Promise<ToolResponse<{ irs_refreshed: boolean; ofac_refreshed: boolean }>> {
  try {
    const source = input.source || "all";
    logDebug(`Refreshing data: ${source}`);

    const result = await store.refresh(source);
    return { success: true, data: result, attribution: ATTRIBUTION };
  } catch (error) {
    const message = getErrorMessage(error);
    logError("refreshData failed:", message);
    return validationError(`Data refresh failed: ${message}`);
  }
}
