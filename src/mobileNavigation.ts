export function mobileNavigationIndexAtX(
  x: number,
  width: number,
  itemCount: number
): number {
  if (!Number.isFinite(x) || width <= 0 || itemCount <= 1) return 0;
  const normalized = Math.max(0, Math.min(width - Number.EPSILON, x));
  return Math.min(itemCount - 1, Math.floor(normalized / (width / itemCount)));
}
