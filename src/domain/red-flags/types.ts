// ============================================================================
// IRS Revocation Types
// ============================================================================

export interface IrsRevocationRow {
  ein: string;
  legalName: string;
  dba: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  exemptionType: string;
  revocationDate: string;
  postingDate: string;
  reinstatementDate: string;
}

export interface IrsRevocationResult {
  found: boolean;
  revoked: boolean;
  detail: string;
  revocationDate?: string;
  reinstatementDate?: string;
  legalName?: string;
}

// ============================================================================
// OFAC SDN Types
// ============================================================================

export interface OfacSdnRow {
  entNum: string;
  name: string;
  sdnType: string;
  program: string;
  title: string;
  remarks: string;
}

export interface OfacAltRow {
  entNum: string;
  altNum: string;
  altType: string;
  altName: string;
  altRemarks: string;
}

export interface OfacMatch {
  entNum: string;
  name: string;
  sdnType: string;
  program: string;
  matchedOn: string; // 'primary' | 'alias'
}

export interface OfacSanctionsResult {
  found: boolean;
  detail: string;
  matches: OfacMatch[];
}

// ============================================================================
// CourtListener Types
// ============================================================================

export interface CourtListenerCase {
  id: number;
  caseName: string;
  court: string;
  dateArgued: string | null;
  dateFiled: string | null;
  docketNumber: string;
  absoluteUrl: string;
}

export interface CourtRecordsResult {
  found: boolean;
  detail: string;
  caseCount: number;
  cases: CourtListenerCase[];
}

// ============================================================================
// Composite Red Flag Types
// ============================================================================

export type RedFlagSeverity = "CRITICAL" | "HIGH" | "MEDIUM";
export type RedFlagSource =
  | "irs_revocation"
  | "ofac_sanctions"
  | "court_records";
export type Recommendation = "CLEAN" | "FLAG" | "BLOCK";

export interface RedFlag {
  severity: RedFlagSeverity;
  source: RedFlagSource;
  type: string;
  detail: string;
}

export interface RedFlagChecks {
  irs_revocation: IrsRevocationResult;
  ofac_sanctions: OfacSanctionsResult;
  court_records: CourtRecordsResult;
}

export interface RedFlagSummary {
  headline: string;
  sources_checked: number;
  flags_found: number;
  recommendation: Recommendation;
}

export interface RedFlagReport {
  ein: string;
  name: string;
  checks: RedFlagChecks;
  flags: RedFlag[];
  clean: boolean;
  summary: RedFlagSummary;
}

// ============================================================================
// Data Manifest (tracks CSV freshness)
// ============================================================================

export interface DataManifest {
  irs_revocation?: {
    downloaded_at: string;
    row_count: number;
  };
  ofac_sdn?: {
    downloaded_at: string;
    sdn_count: number;
    alt_count: number;
  };
}

// ============================================================================
// Tool Response Wrapper
// ============================================================================

export interface ToolResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  attribution: string;
}

// ============================================================================
// Tool Input Types
// ============================================================================

export interface CheckRedFlagsInput {
  ein: string;
  name: string;
}

export interface CheckIrsRevocationInput {
  ein: string;
}

export interface CheckOfacSanctionsInput {
  name: string;
}

export interface CheckCourtRecordsInput {
  name: string;
  lookback_years?: number;
}

export interface RefreshDataInput {
  source?: "irs" | "ofac" | "all";
}
