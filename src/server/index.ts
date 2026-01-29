import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { loadConfig } from '../core/config.js';
import { logError, logInfo } from '../core/logging.js';
import { CsvDataStore } from '../domain/red-flags/csv-loader.js';
import { IrsRevocationClient } from '../domain/red-flags/irs-revocation-client.js';
import { OfacSdnClient } from '../domain/red-flags/ofac-sdn-client.js';
import { CourtListenerClient } from '../domain/red-flags/courtlistener-client.js';
import * as tools from '../domain/red-flags/tools.js';

const SERVER_NAME = 'red-flag-vetting-mcp';
const SERVER_VERSION = '1.0.0';

// Create MCP server instance
const server = new Server(
  {
    name: SERVER_NAME,
    version: SERVER_VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle list_tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'check_red_flags',
        description:
          'Run all red flag checks (IRS revocation, OFAC sanctions, federal court records) in parallel for a nonprofit. Returns composite report with severity-rated flags and CLEAN/FLAG/BLOCK recommendation. Data from IRS Auto-Revocation List, US Treasury OFAC SDN List, and CourtListener.',
        inputSchema: {
          type: 'object',
          properties: {
            ein: {
              type: 'string',
              description:
                'Employer Identification Number. Accepts "12-3456789" or "123456789"',
            },
            name: {
              type: 'string',
              description: 'Organization legal name (used for OFAC and court searches)',
            },
          },
          required: ['ein', 'name'],
        },
      },
      {
        name: 'check_irs_revocation',
        description:
          'Check if a nonprofit\'s tax-exempt status was auto-revoked by the IRS for failing to file Form 990 for 3 consecutive years. EIN exact-match lookup against ~600K revocation records. Data from IRS Auto-Revocation List.',
        inputSchema: {
          type: 'object',
          properties: {
            ein: {
              type: 'string',
              description:
                'Employer Identification Number. Accepts "12-3456789" or "123456789"',
            },
          },
          required: ['ein'],
        },
      },
      {
        name: 'check_ofac_sanctions',
        description:
          'Check if an organization name matches the US Treasury OFAC Specially Designated Nationals (SDN) list. Normalized name matching against primary names and aliases. A match indicates potential sanctions exposure. Data from US Treasury OFAC SDN List.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Organization name to check against OFAC SDN list',
            },
          },
          required: ['name'],
        },
      },
      {
        name: 'check_court_records',
        description:
          'Search federal court records for lawsuits or regulatory actions involving a nonprofit. Uses CourtListener API with configurable lookback period. Data from CourtListener (Free Law Project).',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Organization name to search in federal court records',
            },
            lookback_years: {
              type: 'number',
              description: 'Years to look back (default: 1, max: 10)',
            },
          },
          required: ['name'],
        },
      },
      {
        name: 'refresh_data',
        description:
          'Force re-download of cached CSV data files (IRS revocation list and/or OFAC SDN list). Use when data may be stale or after errors.',
        inputSchema: {
          type: 'object',
          properties: {
            source: {
              type: 'string',
              enum: ['irs', 'ofac', 'all'],
              description: 'Which data source to refresh (default: all)',
            },
          },
        },
      },
    ],
  };
});

export async function startServer(): Promise<void> {
  // Load config (validates COURTLISTENER_API_TOKEN)
  const config = loadConfig();

  // Initialize CSV data store (downloads if needed)
  logInfo('Initializing data stores...');
  const store = new CsvDataStore(config);
  await store.initialize();

  // Create clients
  const irsClient = new IrsRevocationClient(store);
  const ofacClient = new OfacSdnClient(store);
  const courtClient = new CourtListenerClient(config);

  // Handle call_tool request
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      if (name === 'check_red_flags') {
        const result = await tools.checkRedFlags(irsClient, ofacClient, courtClient, {
          ein: args?.ein as string,
          name: args?.name as string,
        });

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        };
      }

      if (name === 'check_irs_revocation') {
        const result = tools.checkIrsRevocation(irsClient, {
          ein: args?.ein as string,
        });

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        };
      }

      if (name === 'check_ofac_sanctions') {
        const result = tools.checkOfacSanctions(ofacClient, {
          name: args?.name as string,
        });

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        };
      }

      if (name === 'check_court_records') {
        const result = await tools.checkCourtRecords(courtClient, {
          name: args?.name as string,
          lookback_years: args?.lookback_years as number | undefined,
        });

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        };
      }

      if (name === 'refresh_data') {
        const result = await tools.refreshData(store, {
          source: args?.source as 'irs' | 'ofac' | 'all' | undefined,
        });

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        };
      }

      throw new Error(`Unknown tool: ${name}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: ${errorMessage}` }],
        isError: true,
      };
    }
  });

  // Connect transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logInfo(`${SERVER_NAME} v${SERVER_VERSION} running on stdio`);
}

// Graceful shutdown
process.on('SIGINT', () => {
  logInfo('Received SIGINT, shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logInfo('Received SIGTERM, shutting down...');
  process.exit(0);
});
