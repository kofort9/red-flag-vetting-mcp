import { CsvDataStore } from './csv-loader.js';
import { IrsRevocationResult } from './types.js';

export class IrsRevocationClient {
  private store: CsvDataStore;

  constructor(store: CsvDataStore) {
    this.store = store;
  }

  check(ein: string): IrsRevocationResult {
    const normalized = ein.replace(/[-\s]/g, '');

    if (!/^\d{9}$/.test(normalized)) {
      return {
        found: false,
        revoked: false,
        detail: `Invalid EIN format: expected 9 digits, got "${ein}"`,
      };
    }

    const row = this.store.lookupEin(normalized);

    if (!row) {
      return {
        found: false,
        revoked: false,
        detail: 'EIN not found in IRS auto-revocation list (good — no revocation on record)',
      };
    }

    // Check if reinstated
    if (row.reinstatementDate && row.reinstatementDate.trim() !== '') {
      return {
        found: true,
        revoked: false,
        detail: `Was revoked on ${row.revocationDate} but reinstated on ${row.reinstatementDate}`,
        revocationDate: row.revocationDate,
        reinstatementDate: row.reinstatementDate,
        legalName: row.legalName,
      };
    }

    return {
      found: true,
      revoked: true,
      detail: `Tax-exempt status REVOKED on ${row.revocationDate} — failed to file Form 990 for 3 consecutive years`,
      revocationDate: row.revocationDate,
      legalName: row.legalName,
    };
  }
}
