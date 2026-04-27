const config = require('./config/env');
const app = require('./app');
const { ensurePromotionSchema } = require('./repositories/promotions.repository');

const { port, host } = config.server;

async function start() {
  try {
    await ensurePromotionSchema();
    app.listen(port, host, () => {
      console.log(`Server running on http://${host}:${port}`);
    });
  } catch (error) {
    console.error('[server] failed to initialize schema', error);
    process.exit(1);
  }
}

start();
