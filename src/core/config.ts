import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

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
const COURTLISTENER_BASE_URL = 'https://www.courtlistener.com/api/rest/v4';

export function loadConfig(): RedFlagConfig {
  const token = process.env.COURTLISTENER_API_TOKEN || undefined;

  return {
    courtlistenerApiToken: token,
    courtlistenerBaseUrl: COURTLISTENER_BASE_URL,
    courtlistenerRateLimitMs: parseInt(process.env.COURTLISTENER_RATE_LIMIT_MS || '500', 10),
    dataDir: path.resolve(__dirname, '../../data'),
    dataMaxAgeDays: parseInt(process.env.DATA_MAX_AGE_DAYS || '7', 10),
  };
}
