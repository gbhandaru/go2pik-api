const crypto = require('crypto');

function normalizePrimitive(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  return value;
}

function normalizeItem(item = {}) {
  return {
    id: normalizePrimitive(item.id),
    sku: normalizePrimitive(item.sku),
    name: normalizePrimitive(item.name),
    quantity: Number(item.quantity || 0),
    price: Number(item.price || 0),
    lineTotal: Number(item.lineTotal || item.line_total || 0),
    notes: normalizePrimitive(item.notes || item.specialInstructions || item.special_instructions),
  };
}

function normalizeOrderRequest(draft = {}) {
  const customer = draft.customer || {};
  const items = (Array.isArray(draft.items) ? draft.items : [])
    .map(normalizeItem)
    .sort((left, right) => {
      const leftKey = [left.id, left.sku, left.name, left.quantity, left.price, left.lineTotal, left.notes]
        .map((value) => String(value ?? ''))
        .join('|');
      const rightKey = [right.id, right.sku, right.name, right.quantity, right.price, right.lineTotal, right.notes]
        .map((value) => String(value ?? ''))
        .join('|');
      return leftKey.localeCompare(rightKey);
    });

  return {
    restaurantId: normalizePrimitive(draft.restaurantId),
    promoCode: normalizePrimitive(draft.promoCode),
    pickupRequest: draft.pickupRequest || null,
    customer: {
      name: normalizePrimitive(customer.name),
      phone: normalizePrimitive(customer.phone),
      email: normalizePrimitive(customer.email),
      pickupType: normalizePrimitive(customer.pickupType || draft.pickupType),
      pickupTime: normalizePrimitive(customer.pickupTime || draft.pickupTime),
      notes: normalizePrimitive(customer.notes),
      paymentMode: normalizePrimitive(customer.paymentMode),
      smsConsent: Boolean(customer.smsConsent),
      smsConsentAt: normalizePrimitive(customer.smsConsentAt),
      smsConsentPhone: normalizePrimitive(customer.smsConsentPhone),
      smsConsentText: normalizePrimitive(customer.smsConsentText),
      smsConsentVersion: normalizePrimitive(customer.smsConsentVersion),
      smsOptInSource: normalizePrimitive(customer.smsOptInSource),
    },
    items,
  };
}

function stableStringify(value) {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function buildOrderRequestFingerprint(draft = {}) {
  return crypto
    .createHash('sha256')
    .update(stableStringify(normalizeOrderRequest(draft)))
    .digest('hex');
}

function createRecentResultCache() {
  const inFlight = new Map();

  async function run(key, fn) {
    if (inFlight.has(key)) {
      return inFlight.get(key);
    }
    const promise = Promise.resolve().then(fn);
    inFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      inFlight.delete(key);
    }
  }

  function clear() {
    inFlight.clear();
  }

  return {
    run,
    clear,
    normalizeOrderRequest,
    buildOrderRequestFingerprint,
    stableStringify,
  };
}

module.exports = {
  normalizeOrderRequest,
  stableStringify,
  buildOrderRequestFingerprint,
  createRecentResultCache,
};
