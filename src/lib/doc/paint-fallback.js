/**
 * RGB stuffed into setBoundVariableForPaint. Figma paints THIS color on the
 * canvas; the binding is extra. Never use 0.5 grey.
 */

export function paintFallbackRgb(resolved) {
  if (resolved && typeof resolved.r === 'number') {
    return { r: resolved.r, g: resolved.g, b: resolved.b };
  }
  return { r: 0.09, g: 0.09, b: 0.09 };
}
