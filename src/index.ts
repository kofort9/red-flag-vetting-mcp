#!/usr/bin/env node
import { startServer } from './server/index.js';
import { logError, getErrorMessage } from './core/logging.js';

const shouldAutoStart = process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test';

if (shouldAutoStart) {
  startServer().catch((error) => {
    logError('Server error:', getErrorMessage(error));
    process.exit(1);
  });
}

export { startServer };
