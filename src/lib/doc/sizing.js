/**
 * Sizing contract for the doc compiler. Omitted width/height is HUG, never
 * the Plugin API 100x100 default.
 */

export function axisSizing(value) {
  if (value === 'fill') return 'FILL';
  if (typeof value === 'number') return 'FIXED';
  return 'HUG';
}

export function textAutoResizeMode(width) {
  if (typeof width === 'number' || width === 'fill') return 'HEIGHT';
  return 'WIDTH_AND_HEIGHT';
}
