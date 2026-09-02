/**
 * FIGMA_FILE may be a tab title ("Untitled") or a file key / URL fragment
 * ("IMNnBKMNvtbOHLUcSgpyMz"). Match either.
 */

export function filePinMatches(want, title, url) {
  if (!want) return true;
  const w = String(want).toLowerCase();
  const t = String(title || '').toLowerCase();
  const u = String(url || '').toLowerCase();
  return t.includes(w) || u.includes(w);
}
