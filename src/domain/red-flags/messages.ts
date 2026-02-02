import { RedFlag, Recommendation, RedFlagSummary } from "./types.js";

const HEADLINES: Record<Recommendation, string> = {
  CLEAN: "No Red Flags Detected",
  FLAG: "Red Flags Found — Manual Review Required",
  BLOCK: "CRITICAL Red Flags — Do Not Proceed",
};

export function generateSummary(
  flags: RedFlag[],
  recommendation: Recommendation,
  sourcesChecked: number,
): RedFlagSummary {
  return {
    headline: HEADLINES[recommendation],
    sources_checked: sourcesChecked,
    flags_found: flags.length,
    recommendation,
  };
}
