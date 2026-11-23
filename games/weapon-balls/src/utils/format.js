// Whole numbers stay whole, everything else gets one decimal place.
export function formatNumber(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// A fraction as a whole percentage: 0.4375 -> "44%".
export function percent(fraction) {
  return `${Math.round(fraction * 100)}%`;
}
