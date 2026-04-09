const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
});

function formatUsd(value = 0) {
  return usdFormatter.format(Number(value) || 0);
}

module.exports = { formatUsd };
