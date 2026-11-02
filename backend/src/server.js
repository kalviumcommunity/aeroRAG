import config from './config/env.js';
import connectDB from './config/db.js';
import logger from './utils/logger.js';
import app from './app.js';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PORT = config.PORT;

const startServer = async () => {
  await connectDB();

  const server = app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
    logger.info(config.DEMO_MODE
      ? 'DEMO MODE enabled: mock embeddings and answer generation are active.'
      : 'Live Google Generative AI provider configured.');
  });
  return server;
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startServer().catch(error => {
    logger.error(`Server failed to start: ${error.message}`);
    process.exitCode = 1;
  });
}

export { startServer };
