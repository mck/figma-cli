import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { axisSizing, textAutoResizeMode } from '../src/lib/doc/sizing.js';
import { paintFallbackRgb } from '../src/lib/doc/paint-fallback.js';
import { filePinMatches } from '../src/lib/file-pin.js';
import { validateDoc, parseDocSource, toIr, normalizeDoc } from '../src/lib/doc/model.js';

describe('omitted size is hug, not 100px', () => {
  it('axisSizing defaults to HUG when width/height is omitted', () => {
    assert.equal(axisSizing(undefined), 'HUG');
    assert.equal(axisSizing(null), 'HUG');
    assert.equal(axisSizing('hug'), 'HUG');
    assert.equal(axisSizing('fill'), 'FILL');
    assert.equal(axisSizing(1440), 'FIXED');
  });

  it('text without a width uses WIDTH_AND_HEIGHT auto-resize', () => {
    assert.equal(textAutoResizeMode(undefined), 'WIDTH_AND_HEIGHT');
    assert.equal(textAutoResizeMode(820), 'HEIGHT');
    assert.equal(textAutoResizeMode('fill'), 'HEIGHT');
  });
});

describe('bound-paint fallback is never 0.5 grey', () => {
  it('uses the resolved RGB when present', () => {
    assert.deepEqual(paintFallbackRgb({ r: 0.09, g: 0.09, b: 0.09 }), { r: 0.09, g: 0.09, b: 0.09 });
    assert.deepEqual(paintFallbackRgb({ r: 1, g: 1, b: 1 }), { r: 1, g: 1, b: 1 });
  });

  it('does not return the 0.5 dummy when resolution fails', () => {
    const fb = paintFallbackRgb(null);
    assert.notEqual(fb.r, 0.5);
    assert.notEqual(fb.g, 0.5);
    assert.notEqual(fb.b, 0.5);
  });
});

describe('file pin matches key or title', () => {
  const url = 'https://www.figma.com/design/IMNnBKMNvtbOHLUcSgpyMz/Untitled';
  it('matches a file key in the URL when the tab is Untitled', () => {
    assert.equal(filePinMatches('IMNnBKMNvtbOHLUcSgpyMz', 'Untitled – Figma', url), true);
  });
  it('matches a title substring', () => {
    assert.equal(filePinMatches('Untitled', 'Untitled – Figma', url), true);
  });
  it('does not match a different file', () => {
    assert.equal(filePinMatches('ShadCN', 'Untitled – Figma', url), false);
  });
});

describe('chopped YAML content is a hard error', () => {
  it('rejects flow-map leftovers after an unquoted comma in content', () => {
    const raw = parseDocSource(`
version: 1
children:
  - { name: t, type: text, content: Git SHAs, who shipped }
`);
    const errors = validateDoc(raw);
    assert.ok(errors.some((e) => /unquoted comma|quote content/i.test(e)), errors.join('; '));
  });
});

describe('var: on radius gap padding is allowed', () => {
  it('compiles radius/gap/padding var refs into the IR', () => {
    const doc = normalizeDoc(parseDocSource(`
version: 1
children:
  - name: Card
    type: frame
    layout: vertical
    gap: var:spacing/300
    padding: var:spacing/600
    radius: var:radius/lg
    children:
      - name: t
        type: text
        content: hi
`));
    const ir = toIr(doc).nodes[0];
    assert.equal(ir.gap.kind, 'var');
    assert.equal(ir.gap.ref, 'spacing/300');
    assert.equal(ir.radius.kind, 'var');
    assert.equal(ir.padding.top.kind, 'var');
  });
});
