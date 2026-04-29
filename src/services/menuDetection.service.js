const PRICE_REGEX = /\$?\d{1,3}(?:\.\d{2})?/g;
const PRICE_LINE_REGEX = /^\$?\d{1,3}(?:\.\d{2})?$/;

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

function isPriceLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) {
    return false;
  }
  return PRICE_LINE_REGEX.test(trimmed.replace(/[^\d$.]/g, ''));
}

function isLikelyItemLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) {
    return false;
  }

  if (isPriceLine(trimmed)) {
    return false;
  }

  if (/\b(scan|qr|download|app|order|pickup|wait|go2pik\.com)\b/i.test(trimmed)) {
    return false;
  }

  const hasLetters = /[A-Za-z]/.test(trimmed);
  const hasDigits = /\d/.test(trimmed);
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;

  return hasLetters && !hasDigits && wordCount >= 1;
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

function findLikelyMenuItemPairs(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const pairs = [];
  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index];
    const next = lines[index + 1] || '';

    if (hasLikelyCategoryItemPattern(current)) {
      pairs.push(current);
      continue;
    }

    if (isLikelyItemLine(current) && isPriceLine(next)) {
      pairs.push(`${current} ${next}`.trim());
    }
  }

  return Array.from(new Set(pairs));
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
  const likelyMenuItemLines = findLikelyMenuItemPairs(text);
  const negativeReasons = getNegativeSignals(text);
  const reasons = [];

  if (!text) {
    reasons.push('OCR text is empty');
  }

  if (priceCount < 1) {
    reasons.push('no price patterns found');
  }

  if (likelyMenuItemLines.length < 1) {
    reasons.push('no likely item-price lines found');
  }

  if (negativeReasons.length > 0) {
    reasons.push(...negativeReasons);
  }

  const strongPositiveEvidence = likelyMenuItemLines.length >= 1 && priceCount >= 1;
  const veryStrongPositiveEvidence = likelyMenuItemLines.length >= 2 || priceCount >= 2;
  const promoDominated =
    negativeReasons.length >= 2 &&
    !veryStrongPositiveEvidence &&
    priceCount < 2 &&
    likelyMenuItemLines.length < 2;

  const isMenu = text.length > 0 && strongPositiveEvidence && !promoDominated;

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
