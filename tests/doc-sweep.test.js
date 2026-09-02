import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadDocFile, normalizeDoc, toIr } from '../src/lib/doc/model.js';
import {
  buildSweepDoc,
  cartesian,
  parsePromote,
  parseSweepSource,
  promoteKnobs,
  variantCount,
} from '../src/lib/doc/sweep.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/doc');

describe('sweep', () => {
  it('expands 2 knobs x 3 values into 9 variants', () => {
    const sweep = parseSweepSource(readFileSync(join(FIX, 'sweep.yaml'), 'utf8'));
    assert.equal(variantCount(sweep), 9);
    const cells = cartesian(sweep.knobs);
    assert.equal(cells.length, 9);
    assert.ok(cells.some((c) => c.label === 'pad=16,intent=cozy'));
  });

  it('builds a labeled matrix doc without duplicating keys', () => {
    const base = loadDocFile(join(FIX, 'button.yaml'));
    const sweep = parseSweepSource(readFileSync(join(FIX, 'sweep.yaml'), 'utf8'));
    const matrix = buildSweepDoc(base, sweep);
    assert.equal(matrix.children[0].children.length, 9);
    const ir = toIr(normalizeDoc(matrix));
    const keys = ir.nodes.map((n) => n.key);
    assert.equal(keys.length, new Set(keys).size);
  });

  it('promote writes the winning knob set into the base doc', () => {
    const base = loadDocFile(join(FIX, 'button.yaml'));
    const set = parsePromote('pad=16,intent=cozy');
    const next = promoteKnobs(base, set);
    assert.equal(next.knobs.pad, 16);
    assert.equal(next.knobs.intent, 'cozy');
    assert.equal(next.knobs.radius, 10);
  });
});
