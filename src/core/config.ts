import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface RedFlagConfig {
  courtlistenerApiToken?: string;
  courtlistenerBaseUrl: string;
  courtlistenerRateLimitMs: number;
  dataDir: string;
  dataMaxAgeDays: number;
}

// Security: Only allow official endpoints
const COURTLISTENER_BASE_URL = "https://www.courtlistener.com/api/rest/v4";

function envInt(key: string, fallback: number): number {
  const val = process.env[key];
  if (val === undefined || val.trim() === "") return fallback;
  const parsed = Number(val);
  return Number.isInteger(parsed) ? parsed : fallback;
}

export function loadConfig(): RedFlagConfig {
  return {
    courtlistenerApiToken: process.env.COURTLISTENER_API_TOKEN || undefined,
    courtlistenerBaseUrl: COURTLISTENER_BASE_URL,
    courtlistenerRateLimitMs: Math.max(
      100,
      envInt("COURTLISTENER_RATE_LIMIT_MS", 500),
    ),
    dataDir: path.resolve(__dirname, "../../data"),
    dataMaxAgeDays: Math.max(1, envInt("DATA_MAX_AGE_DAYS", 7)),
  };
}
