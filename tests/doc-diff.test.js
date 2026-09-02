import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadDocFile, normalizeDoc, toIr } from '../src/lib/doc/model.js';
import { diffIr } from '../src/lib/doc/diff.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/doc');

describe('doc diff-apply', () => {
  it('skips unchanged keys so a re-apply does not duplicate', () => {
    const ir = toIr(normalizeDoc(loadDocFile(join(FIX, 'button.yaml'))));
    const diff = diffIr(ir, ir);
    assert.equal(diff.creates, 0);
    assert.equal(diff.updates, 0);
    assert.ok(diff.skips >= 1);
  });

  it('updates when padding changes and creates when a key is new', () => {
    const desired = toIr(normalizeDoc(loadDocFile(join(FIX, 'button.yaml')), { knobs: { pad: 32 } }));
    const existing = toIr(normalizeDoc(loadDocFile(join(FIX, 'button.yaml'))));
    const diff = diffIr(desired, existing);
    assert.ok(diff.updates >= 1);
    assert.equal(diff.creates, 0);

    const extra = structuredClone(desired);
    extra.nodes.push({
      key: 'ghost',
      name: 'Ghost',
      type: 'frame',
      parentKey: null,
      topLevel: true,
    });
    const created = diffIr(extra, existing);
    assert.equal(created.creates, 1);
  });
});
