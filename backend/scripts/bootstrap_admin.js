import mongoose from 'mongoose';
import config from '../src/config/env.js';
import User from '../src/models/User.js';
import logger from '../src/utils/logger.js';

const { ADMIN_BOOTSTRAP_CONFIRM, ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD } = process.env;

async function main() {
  if (ADMIN_BOOTSTRAP_CONFIRM !== 'I_UNDERSTAND') {
    throw new Error('Set ADMIN_BOOTSTRAP_CONFIRM=I_UNDERSTAND to confirm this local admin operation');
  }
  if (!ADMIN_EMAIL || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ADMIN_EMAIL)) {
    throw new Error('A valid ADMIN_EMAIL is required');
  }
  if (typeof ADMIN_PASSWORD !== 'string' || ADMIN_PASSWORD.length < 12 || ADMIN_PASSWORD.length > 128) {
    throw new Error('ADMIN_PASSWORD must be between 12 and 128 characters');
  }

  await mongoose.connect(config.MONGO_URI);
  const email = ADMIN_EMAIL.trim().toLowerCase();
  let user = await User.findOne({ email });
  if (user) {
    user.role = 'admin';
    await user.save();
    logger.info(`Administrator role assigned to ${email}`);
    return;
  }

  const name = typeof ADMIN_NAME === 'string' && ADMIN_NAME.trim().length >= 2
    ? ADMIN_NAME.trim()
    : 'AeroRAG Administrator';
  user = await User.create({ name, email, password: ADMIN_PASSWORD, role: 'admin' });
  logger.info(`Administrator account created for ${user.email}`);
}

main()
  .catch(error => {
    logger.error(`Admin provisioning failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
