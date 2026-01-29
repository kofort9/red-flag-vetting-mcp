import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import axios from 'axios';
import { parse } from 'csv-parse/sync';
import * as unzipper from 'unzipper';
import { RedFlagConfig } from '../../core/config.js';
import { logInfo, logError, logDebug, logWarn } from '../../core/logging.js';
import { IrsRevocationRow, OfacSdnRow, OfacAltRow, DataManifest } from './types.js';
import { normalizeName } from './name-normalizer.js';

// ============================================================================
// Constants
// ============================================================================

const IRS_REVOCATION_URL = 'https://apps.irs.gov/pub/epostcard/data-download-revocation.zip';
const OFAC_SDN_URL = 'https://www.treasury.gov/ofac/downloads/sdn.csv';
const OFAC_ALT_URL = 'https://www.treasury.gov/ofac/downloads/alt.csv';

const MANIFEST_FILE = 'data-manifest.json';

// ============================================================================
// CsvDataStore
// ============================================================================

export class CsvDataStore {
  private irsMap = new Map<string, IrsRevocationRow>();
  private ofacNameMap = new Map<string, OfacSdnRow[]>();
  private config: RedFlagConfig;
  private initialized = false;

  constructor(config: RedFlagConfig) {
    this.config = config;
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  get irsRowCount(): number {
    return this.irsMap.size;
  }

  get ofacEntryCount(): number {
    return this.ofacNameMap.size;
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  async initialize(): Promise<void> {
    await fsp.mkdir(this.config.dataDir, { recursive: true });
    const manifest = await this.loadManifest();

    const irsStale = this.isStale(manifest.irs_revocation?.downloaded_at);
    const ofacStale = this.isStale(manifest.ofac_sdn?.downloaded_at);

    if (irsStale) {
      await this.downloadAndParseIrs(manifest);
    } else {
      await this.parseIrsFromDisk();
    }

    if (ofacStale) {
      await this.downloadAndParseOfac(manifest);
    } else {
      await this.parseOfacFromDisk();
    }

    this.initialized = true;
    logInfo(
      `Data loaded: ${this.irsMap.size} IRS revocations, ${this.ofacNameMap.size} OFAC entries`
    );
  }

  async refresh(source?: 'irs' | 'ofac' | 'all'): Promise<{ irs_refreshed: boolean; ofac_refreshed: boolean }> {
    const manifest = await this.loadManifest();
    let irsRefreshed = false;
    let ofacRefreshed = false;

    if (source === 'irs' || source === 'all' || !source) {
      await this.downloadAndParseIrs(manifest);
      irsRefreshed = true;
    }

    if (source === 'ofac' || source === 'all' || !source) {
      await this.downloadAndParseOfac(manifest);
      ofacRefreshed = true;
    }

    return { irs_refreshed: irsRefreshed, ofac_refreshed: ofacRefreshed };
  }

  lookupEin(ein: string): IrsRevocationRow | undefined {
    const normalized = ein.replace(/[-\s]/g, '');
    return this.irsMap.get(normalized);
  }

  lookupName(name: string): OfacSdnRow[] {
    const normalized = normalizeName(name);
    return this.ofacNameMap.get(normalized) || [];
  }

  // --------------------------------------------------------------------------
  // IRS Revocation
  // --------------------------------------------------------------------------

  private async downloadAndParseIrs(manifest: DataManifest): Promise<void> {
    logInfo('Downloading IRS revocation list...');
    const zipPath = path.join(this.config.dataDir, 'irs-revocation.zip');
    const csvPath = path.join(this.config.dataDir, 'irs-revocation.csv');

    try {
      const response = await axios.get(IRS_REVOCATION_URL, {
        responseType: 'arraybuffer',
        timeout: 120000, // 2 min — file is ~15MB
      });

      await fsp.writeFile(zipPath, Buffer.from(response.data));

      // Extract ZIP
      const directory = await unzipper.Open.file(zipPath);
      if (directory.files.length === 0) {
        throw new Error('IRS ZIP file is empty');
      }

      const file = directory.files[0];
      const content = await file.buffer();
      await fsp.writeFile(csvPath, content);

      // Parse
      this.irsMap = this.parseIrsCsv(content.toString('utf-8'));

      // Update manifest
      manifest.irs_revocation = {
        downloaded_at: new Date().toISOString(),
        row_count: this.irsMap.size,
      };
      await this.saveManifest(manifest);

      logInfo(`IRS revocation list loaded: ${this.irsMap.size} entries`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logError('Failed to download IRS revocation list:', msg);
      // Fall back to disk if available
      if (fs.existsSync(csvPath)) {
        logWarn('Falling back to cached IRS data');
        await this.parseIrsFromDisk();
      } else {
        throw new Error(`Cannot load IRS revocation data: ${msg}`);
      }
    }
  }

  private async parseIrsFromDisk(): Promise<void> {
    const csvPath = path.join(this.config.dataDir, 'irs-revocation.csv');
    if (!fs.existsSync(csvPath)) {
      // No cached data — need to download
      const manifest = await this.loadManifest();
      await this.downloadAndParseIrs(manifest);
      return;
    }

    const content = await fsp.readFile(csvPath, 'utf-8');
    this.irsMap = this.parseIrsCsv(content);
    logDebug(`IRS data loaded from disk: ${this.irsMap.size} entries`);
  }

  private parseIrsCsv(content: string): Map<string, IrsRevocationRow> {
    const map = new Map<string, IrsRevocationRow>();
    const lines = content.split('\n');

    // Skip header line
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const fields = line.split('|');
      if (fields.length < 11) continue;

      const ein = fields[0].trim().replace(/[-\s]/g, '');
      if (!/^\d{9}$/.test(ein)) continue;

      const row: IrsRevocationRow = {
        ein,
        legalName: fields[1]?.trim() || '',
        dba: fields[2]?.trim() || '',
        city: fields[3]?.trim() || '',
        state: fields[4]?.trim() || '',
        zip: fields[5]?.trim() || '',
        country: fields[6]?.trim() || '',
        exemptionType: fields[7]?.trim() || '',
        revocationDate: fields[8]?.trim() || '',
        postingDate: fields[9]?.trim() || '',
        reinstatementDate: fields[10]?.trim() || '',
      };

      map.set(ein, row);
    }

    return map;
  }

  // --------------------------------------------------------------------------
  // OFAC SDN
  // --------------------------------------------------------------------------

  private async downloadAndParseOfac(manifest: DataManifest): Promise<void> {
    logInfo('Downloading OFAC SDN lists...');
    const sdnPath = path.join(this.config.dataDir, 'sdn.csv');
    const altPath = path.join(this.config.dataDir, 'alt.csv');

    try {
      const [sdnResponse, altResponse] = await Promise.all([
        axios.get(OFAC_SDN_URL, { responseType: 'text', timeout: 60000 }),
        axios.get(OFAC_ALT_URL, { responseType: 'text', timeout: 60000 }),
      ]);

      await Promise.all([
        fsp.writeFile(sdnPath, sdnResponse.data),
        fsp.writeFile(altPath, altResponse.data),
      ]);

      const sdnRows = this.parseSdnCsv(sdnResponse.data);
      const altRows = this.parseAltCsv(altResponse.data);

      this.ofacNameMap = this.buildOfacNameMap(sdnRows, altRows);

      manifest.ofac_sdn = {
        downloaded_at: new Date().toISOString(),
        sdn_count: sdnRows.length,
        alt_count: altRows.length,
      };
      await this.saveManifest(manifest);

      logInfo(`OFAC loaded: ${sdnRows.length} SDN entries, ${altRows.length} aliases`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logError('Failed to download OFAC lists:', msg);
      if (fs.existsSync(sdnPath) && fs.existsSync(altPath)) {
        logWarn('Falling back to cached OFAC data');
        await this.parseOfacFromDisk();
      } else {
        throw new Error(`Cannot load OFAC data: ${msg}`);
      }
    }
  }

  private async parseOfacFromDisk(): Promise<void> {
    const sdnPath = path.join(this.config.dataDir, 'sdn.csv');
    const altPath = path.join(this.config.dataDir, 'alt.csv');

    if (!fs.existsSync(sdnPath) || !fs.existsSync(altPath)) {
      const manifest = await this.loadManifest();
      await this.downloadAndParseOfac(manifest);
      return;
    }

    const [sdnContent, altContent] = await Promise.all([
      fsp.readFile(sdnPath, 'utf-8'),
      fsp.readFile(altPath, 'utf-8'),
    ]);

    const sdnRows = this.parseSdnCsv(sdnContent);
    const altRows = this.parseAltCsv(altContent);
    this.ofacNameMap = this.buildOfacNameMap(sdnRows, altRows);
    logDebug(`OFAC data loaded from disk: ${this.ofacNameMap.size} entries`);
  }

  private parseSdnCsv(content: string): OfacSdnRow[] {
    const rows: OfacSdnRow[] = [];

    // OFAC CSVs have no header row — fields are positional
    const records = parse(content, {
      relax_column_count: true,
      skip_empty_lines: true,
      quote: '"',
    }) as string[][];

    for (const record of records) {
      if (record.length < 6) continue;

      rows.push({
        entNum: record[0]?.trim() || '',
        name: record[1]?.trim() || '',
        sdnType: record[2]?.trim() || '',
        program: record[3]?.trim() || '',
        title: record[4]?.trim() || '',
        remarks: record[5]?.trim() || '',
      });
    }

    return rows;
  }

  private parseAltCsv(content: string): OfacAltRow[] {
    const rows: OfacAltRow[] = [];

    const records = parse(content, {
      relax_column_count: true,
      skip_empty_lines: true,
      quote: '"',
    }) as string[][];

    for (const record of records) {
      if (record.length < 5) continue;

      rows.push({
        entNum: record[0]?.trim() || '',
        altNum: record[1]?.trim() || '',
        altType: record[2]?.trim() || '',
        altName: record[3]?.trim() || '',
        altRemarks: record[4]?.trim() || '',
      });
    }

    return rows;
  }

  private buildOfacNameMap(
    sdnRows: OfacSdnRow[],
    altRows: OfacAltRow[]
  ): Map<string, OfacSdnRow[]> {
    const map = new Map<string, OfacSdnRow[]>();

    // Index SDN entries by entNum for alias lookups
    const sdnByEntNum = new Map<string, OfacSdnRow>();
    for (const row of sdnRows) {
      sdnByEntNum.set(row.entNum, row);

      // Index by normalized primary name
      const normalized = normalizeName(row.name);
      if (normalized) {
        const existing = map.get(normalized) || [];
        existing.push(row);
        map.set(normalized, existing);
      }
    }

    // Index aliases
    for (const alt of altRows) {
      const sdnRow = sdnByEntNum.get(alt.entNum);
      if (!sdnRow) continue;

      const normalized = normalizeName(alt.altName);
      if (normalized) {
        const existing = map.get(normalized) || [];
        if (!existing.some((r) => r.entNum === sdnRow.entNum)) {
          existing.push(sdnRow);
        }
        map.set(normalized, existing);
      }
    }

    return map;
  }

  // --------------------------------------------------------------------------
  // Manifest
  // --------------------------------------------------------------------------

  private async loadManifest(): Promise<DataManifest> {
    const manifestPath = path.join(this.config.dataDir, MANIFEST_FILE);
    try {
      const content = await fsp.readFile(manifestPath, 'utf-8');
      return JSON.parse(content) as DataManifest;
    } catch {
      return {};
    }
  }

  private async saveManifest(manifest: DataManifest): Promise<void> {
    const manifestPath = path.join(this.config.dataDir, MANIFEST_FILE);
    await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  }

  private isStale(downloadedAt: string | undefined): boolean {
    if (!downloadedAt) return true;
    const downloaded = new Date(downloadedAt);
    const now = new Date();
    const diffDays = (now.getTime() - downloaded.getTime()) / (1000 * 60 * 60 * 24);
    return diffDays > this.config.dataMaxAgeDays;
  }
}
