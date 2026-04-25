const crypto = require('crypto');
const config = require('../config/env');

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function getBasicCredentials(req) {
  const header = req.headers.authorization || '';
  if (!header.toLowerCase().startsWith('basic ')) {
    return null;
  }
  const encoded = header.slice(6).trim();
  if (!encoded) {
    return null;
  }
  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex < 0) {
      return null;
    }
    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch (error) {
    return null;
  }
}

function requireAdminDocsAuth(req, res, next) {
  const { adminUsername, adminPassword } = config.docs || {};
  if (!adminUsername || !adminPassword) {
    return res.status(503).json({
      message: 'Admin docs access is not configured',
    });
  }

  const credentials = getBasicCredentials(req);
  if (!credentials) {
    res.set('WWW-Authenticate', 'Basic realm="Go2Pik Admin Docs"');
    return res.status(401).json({
      message: 'Authentication required',
    });
  }

  const usernameMatches = timingSafeEqualString(credentials.username, adminUsername);
  const passwordMatches = timingSafeEqualString(credentials.password, adminPassword);
  if (!usernameMatches || !passwordMatches) {
    res.set('WWW-Authenticate', 'Basic realm="Go2Pik Admin Docs"');
    return res.status(401).json({
      message: 'Invalid admin credentials',
    });
  }

  return next();
}

module.exports = requireAdminDocsAuth;
