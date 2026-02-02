import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "../core/config.js";
import { logInfo, getErrorMessage } from "../core/logging.js";
import { CsvDataStore } from "../domain/red-flags/csv-loader.js";
import { IrsRevocationClient } from "../domain/red-flags/irs-revocation-client.js";
import { OfacSdnClient } from "../domain/red-flags/ofac-sdn-client.js";
import { CourtListenerClient } from "../domain/red-flags/courtlistener-client.js";
import * as tools from "../domain/red-flags/tools.js";
import { ToolResponse } from "../domain/red-flags/types.js";

const SERVER_NAME = "red-flag-vetting-mcp";
const SERVER_VERSION = "1.0.0";

function toMcpResponse(result: ToolResponse<unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    isError: !result.success,
  };
}

function parseString(
  args: Record<string, unknown> | undefined,
  key: string,
): string {
  const val = args?.[key];
  if (val === undefined || val === null) return "";
  if (typeof val !== "string") {
    throw new Error(`Invalid ${key}: expected string, got ${typeof val}`);
  }
  return val;
}

function parseOptionalNumber(
  args: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const val = args?.[key];
  if (val === undefined || val === null) return undefined;
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    if (val.trim() === "")
      throw new Error(`Invalid ${key}: empty string is not a number`);
    const parsed = Number(val);
    if (Number.isNaN(parsed))
      throw new Error(`Invalid ${key}: "${val}" is not a number`);
    return parsed;
  }
  throw new Error(`Invalid ${key}: expected number, got ${typeof val}`);
}

function parseOptionalEnum<T extends string>(
  args: Record<string, unknown> | undefined,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const val = args?.[key];
  if (val === undefined || val === null) return undefined;
  if (typeof val !== "string" || !allowed.includes(val as T)) {
    throw new Error(
      `Invalid ${key}: expected one of ${allowed.join(", ")}, got "${val}"`,
    );
  }
  return val as T;
}

export async function startServer(): Promise<void> {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "check_red_flags",
          description:
            "Run all red flag checks (IRS revocation, OFAC sanctions, federal court records) in parallel for a nonprofit. Returns composite report with severity-rated flags and CLEAN/FLAG/BLOCK recommendation. Data from IRS Auto-Revocation List, US Treasury OFAC SDN List, and CourtListener.",
          inputSchema: {
            type: "object",
            properties: {
              ein: {
                type: "string",
                description:
                  'Employer Identification Number. Accepts "12-3456789" or "123456789"',
              },
              name: {
                type: "string",
                description:
                  "Organization legal name (used for OFAC and court searches)",
              },
            },
            required: ["ein", "name"],
          },
        },
        {
          name: "check_irs_revocation",
          description:
            "Check if a nonprofit's tax-exempt status was auto-revoked by the IRS for failing to file Form 990 for 3 consecutive years. EIN exact-match lookup against ~600K revocation records. Data from IRS Auto-Revocation List.",
          inputSchema: {
            type: "object",
            properties: {
              ein: {
                type: "string",
                description:
                  'Employer Identification Number. Accepts "12-3456789" or "123456789"',
              },
            },
            required: ["ein"],
          },
        },
        {
          name: "check_ofac_sanctions",
          description:
            "Check if an organization name matches the US Treasury OFAC Specially Designated Nationals (SDN) list. Normalized name matching against primary names and aliases. A match indicates potential sanctions exposure. Data from US Treasury OFAC SDN List.",
          inputSchema: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "Organization name to check against OFAC SDN list",
              },
            },
            required: ["name"],
          },
        },
        {
          name: "check_court_records",
          description:
            "Search federal court records for lawsuits or regulatory actions involving a nonprofit. Uses CourtListener API with configurable lookback period. Data from CourtListener (Free Law Project).",
          inputSchema: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description:
                  "Organization name to search in federal court records",
              },
              lookback_years: {
                type: "number",
                description: "Years to look back (default: 1, max: 10)",
              },
            },
            required: ["name"],
          },
        },
        {
          name: "refresh_data",
          description:
            "Force re-download of cached CSV data files (IRS revocation list and/or OFAC SDN list). Use when data may be stale or after errors.",
          inputSchema: {
            type: "object",
            properties: {
              source: {
                type: "string",
                enum: ["irs", "ofac", "all"],
                description: "Which data source to refresh (default: all)",
              },
            },
          },
        },
      ],
    };
  });

  const config = loadConfig();

  logInfo("Initializing data stores...");
  const store = new CsvDataStore(config);
  await store.initialize();

  const irsClient = new IrsRevocationClient(store);
  const ofacClient = new OfacSdnClient(store);
  const courtClient = config.courtlistenerApiToken
    ? new CourtListenerClient(config)
    : null;

  if (!courtClient) {
    logInfo(
      "CourtListener token not configured — court record checks disabled",
    );
  }

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "check_red_flags":
          return toMcpResponse(
            await tools.checkRedFlags(irsClient, ofacClient, courtClient, {
              ein: parseString(args, "ein"),
              name: parseString(args, "name"),
            }),
          );

        case "check_irs_revocation":
          return toMcpResponse(
            tools.checkIrsRevocation(irsClient, {
              ein: parseString(args, "ein"),
            }),
          );

        case "check_ofac_sanctions":
          return toMcpResponse(
            tools.checkOfacSanctions(ofacClient, {
              name: parseString(args, "name"),
            }),
          );

        case "check_court_records":
          return toMcpResponse(
            await tools.checkCourtRecords(courtClient, {
              name: parseString(args, "name"),
              lookback_years: parseOptionalNumber(args, "lookback_years"),
            }),
          );

        case "refresh_data":
          return toMcpResponse(
            await tools.refreshData(store, {
              source: parseOptionalEnum(args, "source", [
                "irs",
                "ofac",
                "all",
              ] as const),
            }),
          );

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return {
        content: [
          { type: "text" as const, text: `Error: ${getErrorMessage(error)}` },
        ],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logInfo(`${SERVER_NAME} v${SERVER_VERSION} running on stdio`);

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      logInfo(`Received ${signal}, shutting down...`);
      process.exit(0);
    });
  }
}
