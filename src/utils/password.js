const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;

async function hashPassword(plainText) {
  if (!plainText || typeof plainText !== 'string') {
    throw new Error('Password is required');
  }
  const salt = crypto.randomBytes(16);
  const derivedKey = await scrypt(plainText, salt, KEY_LENGTH);
  return `${salt.toString('hex')}:${Buffer.from(derivedKey).toString('hex')}`;
}

async function verifyPassword(plainText, storedHash) {
  if (!storedHash) {
    return false;
  }
  const [saltHex, hashHex] = storedHash.split(':');
  if (!saltHex || !hashHex) {
    return false;
  }
  const salt = Buffer.from(saltHex, 'hex');
  const hash = Buffer.from(hashHex, 'hex');
  const derivedKey = await scrypt(plainText, salt, hash.length);
  if (derivedKey.length !== hash.length) {
    return false;
  }
  try {
    return crypto.timingSafeEqual(Buffer.from(derivedKey), hash);
  } catch (error) {
    return false;
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
};
