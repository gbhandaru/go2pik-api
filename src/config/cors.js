const config = require('./env');

const defaultAllowedOrigins = [
  'http://localhost:5173',
  'https://go2pik-app.web.app',
  'https://www.go2pik.com',
  'https://go2pik.com',
  'https://go2pik-app--ui-preview-bwdknkqw.web.app',
];

function resolveAllowedOrigins() {
  return config.cors.origins && config.cors.origins.length > 0
    ? config.cors.origins
    : defaultAllowedOrigins;
}

function buildCorsOptions() {
  const origins = resolveAllowedOrigins();
  if (!origins || origins.length === 0) {
    return { credentials: true };
  }
  return {
    origin(origin, callback) {
      if (!origin || origins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  };
}

module.exports = buildCorsOptions;
