#!/usr/bin/env node
import { startServer } from './server/index.js';
import { logError } from './core/logging.js';

const shouldAutoStart = process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test';

if (shouldAutoStart) {
  startServer().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    logError('Server error:', message);
    process.exit(1);
  });
}

export { startServer };
