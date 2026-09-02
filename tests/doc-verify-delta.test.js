import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { comparePngBuffers, parseRegion } from '../src/lib/doc/verify-delta.js';

function solidPng(width, height, rgb) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (width * y + x) << 2;
      png.data[i] = rgb[0];
      png.data[i + 1] = rgb[1];
      png.data[i + 2] = rgb[2];
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

describe('verify --ref delta', () => {
  it('parses named and bare regions', () => {
    assert.deepEqual(parseRegion('10,20,30,40'), { name: null, x: 10, y: 20, w: 30, h: 40 });
    assert.deepEqual(parseRegion('header:0,0,1440,80'), { name: 'header', x: 0, y: 0, w: 1440, h: 80 });
  });

  it('returns zero delta for identical images', () => {
    const buf = solidPng(4, 4, [10, 20, 30]);
    const result = comparePngBuffers(buf, buf);
    assert.equal(result.maxDelta, 0);
    assert.equal(result.above, false);
    assert.equal(result.regions[0].name, 'full');
  });

  it('flags a region whose pixels differ above threshold', () => {
    const a = new PNG({ width: 4, height: 4 });
    const b = new PNG({ width: 4, height: 4 });
    a.data.fill(0);
    b.data.fill(0);
    for (let i = 3; i < a.data.length; i += 4) {
      a.data[i] = 255;
      b.data[i] = 255;
    }
    for (let x = 0; x < 4; x++) {
      const i = x << 2;
      a.data[i] = 255;
    }
    const result = comparePngBuffers(PNG.sync.write(a), PNG.sync.write(b), {
      regions: [
        { name: 'top', x: 0, y: 0, w: 4, h: 1 },
        { name: 'bottom', x: 0, y: 2, w: 4, h: 2 },
      ],
      threshold: 0.02,
      heatmap: true,
    });
    assert.equal(result.regions.find((r) => r.name === 'top').above, true);
    assert.equal(result.regions.find((r) => r.name === 'bottom').above, false);
    assert.ok(result.heatmap);
  });
});
