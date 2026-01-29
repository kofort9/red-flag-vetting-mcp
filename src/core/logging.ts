/* eslint-disable no-console */
const LOG_PREFIX = '[RedFlagMCP]';
const DEBUG_ENABLED =
  process.env.DEBUG?.toLowerCase().includes('red-flag-mcp') ||
  process.env.RED_FLAG_MCP_DEBUG === 'true';

function format(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', message: string): string {
  return `${LOG_PREFIX} ${level} ${message}`;
}

export function logInfo(message: string, ...args: unknown[]): void {
  console.error(format('INFO', message), ...args);
}

export function logWarn(message: string, ...args: unknown[]): void {
  console.warn(format('WARN', message), ...args);
}

export function logError(message: string, ...args: unknown[]): void {
  console.error(format('ERROR', message), ...args);
}

export function logDebug(message: string, ...args: unknown[]): void {
  if (!DEBUG_ENABLED) return;
  console.error(format('DEBUG', message), ...args);
}
