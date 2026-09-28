// Whole numbers stay whole, everything else gets one decimal place.
export function formatNumber(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
