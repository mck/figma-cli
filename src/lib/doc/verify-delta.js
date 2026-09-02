/**
 * Numeric screenshot-vs-reference comparison. Agents inspect only regions
 * whose delta is above a threshold instead of vision-reading every PNG.
 */

import { PNG } from 'pngjs';

export function parseRegion(spec) {
  if (!spec) return null;
  const s = String(spec).trim();
  const named = s.match(/^([A-Za-z_][A-Za-z0-9_-]*):(.+)$/);
  const name = named ? named[1] : null;
  const body = named ? named[2] : s;
  const parts = body.split(',').map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`Invalid --region ${spec}. Use x,y,w,h or name:x,y,w,h`);
  }
  const [x, y, w, h] = parts;
  return { name, x, y, w, h };
}

function pixelAt(png, x, y) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return null;
  const idx = (png.width * y + x) << 2;
  return [png.data[idx], png.data[idx + 1], png.data[idx + 2], png.data[idx + 3]];
}

function absDiff(a, b) {
  return Math.abs(a - b);
}

/**
 * Mean channel-normalized absolute difference in [0, 1] over the region.
 * Size mismatch of the compared boxes is reported as delta 1.
 */
export function regionDelta(actualPng, refPng, region) {
  const box = region || { x: 0, y: 0, w: refPng.width, h: refPng.height };
  const w = Math.max(0, Math.floor(box.w));
  const h = Math.max(0, Math.floor(box.h));
  if (!w || !h) return { delta: 1, pixels: 0, reason: 'empty-region' };
  if (actualPng.width !== refPng.width || actualPng.height !== refPng.height) {
    // Still compare overlapping pixels; size drift is mixed into the score
    // via any out-of-bounds samples counting as max diff.
  }
  let sum = 0;
  let count = 0;
  const heat = region && region.heatmap ? Buffer.alloc(w * h * 4) : null;
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const ax = Math.floor(box.x) + col;
      const ay = Math.floor(box.y) + row;
      const a = pixelAt(actualPng, ax, ay);
      const r = pixelAt(refPng, ax, ay);
      let d;
      if (!a || !r) {
        d = 1;
      } else {
        d = (absDiff(a[0], r[0]) + absDiff(a[1], r[1]) + absDiff(a[2], r[2]) + absDiff(a[3], r[3])) / (255 * 4);
      }
      sum += d;
      count += 1;
      if (heat) {
        const hi = (row * w + col) << 2;
        const v = Math.min(255, Math.round(d * 255 * 4));
        heat[hi] = v;
        heat[hi + 1] = 0;
        heat[hi + 2] = 0;
        heat[hi + 3] = 200;
      }
    }
  }
  return { delta: count ? sum / count : 1, pixels: count, heat, width: w, height: h };
}

export function comparePngBuffers(actualBuf, refBuf, options = {}) {
  const actual = PNG.sync.read(Buffer.from(actualBuf));
  const ref = PNG.sync.read(Buffer.from(refBuf));
  const regions = options.regions && options.regions.length
    ? options.regions
    : [{ name: 'full', x: 0, y: 0, w: ref.width, h: ref.height }];
  const threshold = options.threshold == null ? 0.02 : Number(options.threshold);
  const results = regions.map((region) => {
    const r = regionDelta(actual, ref, { ...region, heatmap: !!options.heatmap });
    return {
      name: region.name || 'region',
      x: region.x,
      y: region.y,
      w: region.w,
      h: region.h,
      delta: Number(r.delta.toFixed(6)),
      pixels: r.pixels,
      above: r.delta > threshold,
      heat: r.heat,
      heatWidth: r.width,
      heatHeight: r.height,
    };
  });
  const maxDelta = results.reduce((m, r) => Math.max(m, r.delta), 0);
  let heatmap = null;
  if (options.heatmap) {
    const img = new PNG({ width: ref.width, height: ref.height });
    for (const r of results) {
      if (!r.heat) continue;
      for (let row = 0; row < r.heatHeight; row++) {
        for (let col = 0; col < r.heatWidth; col++) {
          const si = (row * r.heatWidth + col) << 2;
          const dx = r.x + col;
          const dy = r.y + row;
          if (dx < 0 || dy < 0 || dx >= img.width || dy >= img.height) continue;
          const di = (img.width * dy + dx) << 2;
          img.data[di] = r.heat[si];
          img.data[di + 1] = r.heat[si + 1];
          img.data[di + 2] = r.heat[si + 2];
          img.data[di + 3] = r.heat[si + 3];
        }
      }
    }
    heatmap = PNG.sync.write(img);
  }
  return {
    width: ref.width,
    height: ref.height,
    actualWidth: actual.width,
    actualHeight: actual.height,
    threshold,
    maxDelta: Number(maxDelta.toFixed(6)),
    above: results.some((r) => r.above),
    regions: results.map(({ heat, heatWidth, heatHeight, ...rest }) => rest),
    heatmap,
  };
}

export function writeHeatmap(pngBuffer, destPath, writeFileSync) {
  writeFileSync(destPath, pngBuffer);
}
