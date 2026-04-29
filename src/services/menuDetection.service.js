const PRICE_REGEX = /\$?\d{1,3}(?:\.\d{2})?/g;

const NEGATIVE_PATTERNS = [
  /scan/i,
  /\bqr\b/i,
  /download\s+app/i,
  /skip\s+the\s+wait/i,
  /order\s+ahead/i,
  /pickup-?only/i,
  /no\s+hidden\s+fees/i,
  /go2pik\.com/i,
  /app\s+promotion/i,
  /promotional/i,
  /app\s+store/i,
  /google\s+play/i,
];

const PROMO_KEYWORDS = [
  'scan to order',
  'skip the wait',
  'download app',
  'order ahead',
  'pickup only',
  'no hidden fees',
  'go2pik.com',
];

function countPriceMatches(text) {
  const matches = String(text || '').match(PRICE_REGEX);
  return matches ? matches.length : 0;
}

function hasLikelyCategoryItemPattern(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) {
    return false;
  }

  const priceMatch = trimmed.match(/(\$?\d{1,3}(?:\.\d{2})?)\s*$/);
  if (!priceMatch) {
    return false;
  }

  const withoutPrice = trimmed.replace(/\$?\d{1,3}(?:\.\d{2})?\s*$/, '').trim();
  if (!withoutPrice) {
    return false;
  }

  const wordCount = withoutPrice.split(/\s+/).filter(Boolean).length;
  return wordCount >= 2;
}

function findLikelyMenuItemLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => hasLikelyCategoryItemPattern(line));
}

function getNegativeSignals(text) {
  const normalized = String(text || '').toLowerCase();
  const reasons = [];

  NEGATIVE_PATTERNS.forEach((pattern) => {
    if (pattern.test(normalized)) {
      reasons.push(`contains promotional or non-menu text matching ${pattern}`);
    }
  });

  PROMO_KEYWORDS.forEach((keyword) => {
    if (normalized.includes(keyword)) {
      reasons.push(`contains promotional keyword "${keyword}"`);
    }
  });

  return reasons;
}

function calculateConfidence({ priceCount, likelyMenuItemLines, negativeReasons }) {
  let confidence = 0;

  confidence += Math.min(priceCount, 8) * 0.1;
  confidence += Math.min(likelyMenuItemLines.length, 5) * 0.12;

  if (likelyMenuItemLines.length >= 3) {
    confidence += 0.15;
  }

  if (negativeReasons.length > 0) {
    confidence -= Math.min(negativeReasons.length, 4) * 0.18;
  }

  if (priceCount >= 3) {
    confidence += 0.1;
  }

  return Math.max(0, Math.min(1, Number(confidence.toFixed(2))));
}

function detectMenuContent(rawOcrText) {
  const text = String(rawOcrText || '').trim();
  const priceCount = countPriceMatches(text);
  const likelyMenuItemLines = findLikelyMenuItemLines(text);
  const negativeReasons = getNegativeSignals(text);
  const reasons = [];

  if (!text) {
    reasons.push('OCR text is empty');
  }

  if (priceCount < 2) {
    reasons.push('fewer than 2 price patterns found');
  }

  if (likelyMenuItemLines.length < 2) {
    reasons.push('fewer than 2 likely item-price lines found');
  }

  if (negativeReasons.length > 0) {
    reasons.push(...negativeReasons);
  }

  const isMenu =
    text.length > 0 &&
    likelyMenuItemLines.length >= 2 &&
    negativeReasons.length === 0 &&
    (priceCount >= 3 || likelyMenuItemLines.length >= 3);

  const confidence = calculateConfidence({
    priceCount,
    likelyMenuItemLines,
    negativeReasons,
  });

  return {
    isMenu,
    confidence,
    reasons,
    priceCount,
    likelyMenuItemLines,
  };
}

module.exports = {
  detectMenuContent,
};
