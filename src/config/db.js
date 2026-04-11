const { Pool } = require('pg');
const config = require('./env');


const instanceConnectionName = process.env.INSTANCE_CONNECTION_NAME;
const isCloudStage = ['production', 'preview'].includes(config.deploymentStage);

const poolConfig = isCloudStage && instanceConnectionName
  ? {
      host: `/cloudsql/${instanceConnectionName}`,
      port: 5432,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      ssl: config.db.ssl,
      max: config.db.max,
      idleTimeoutMillis: config.db.idleTimeoutMillis,
      connectionTimeoutMillis: config.db.connectionTimeoutMillis,
    }
  : config.db.connectionString
  ? { connectionString: config.db.connectionString, ssl: config.db.ssl }
  : {
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      ssl: config.db.ssl,
      max: config.db.max,
      idleTimeoutMillis: config.db.idleTimeoutMillis,
      connectionTimeoutMillis: config.db.connectionTimeoutMillis,
    };

const pool = new Pool(poolConfig);

pool.on('error', (error) => {
  console.error('[db] Unexpected error', error);
});

module.exports = pool;