function normalizePhoneNumber(phone) {
  if (!phone) {
    return '';
  }
  const raw = String(phone).trim();
  if (!raw) {
    return '';
  }
  if (raw.startsWith('+')) {
    return raw.replace(/[^\d+]/g, '');
  }
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  return raw;
}

function maskPhoneNumber(phone) {
  const normalized = normalizePhoneNumber(phone);
  if (!normalized) {
    return '';
  }
  const digits = normalized.replace(/\D/g, '');
  if (digits.length <= 4) {
    return normalized;
  }
  return `***${digits.slice(-4)}`;
}

module.exports = {
  normalizePhoneNumber,
  maskPhoneNumber,
};
