/**
 * Expand a doc + sweep spec into a labeled matrix of variant frames.
 */

import { parseDocSource, slug, substitute } from './model.js';

export function parseSweepSource(source, filename = 'sweep.yaml') {
  const raw = typeof source === 'object' && source !== null && !Buffer.isBuffer(source)
    ? source
    : parseDocSource(source, filename);
  if (!raw || typeof raw !== 'object') throw new Error(`${filename}: sweep must be a mapping`);
  const knobs = raw.knobs || {};
  const entries = Object.entries(knobs);
  if (!entries.length) throw new Error(`${filename}: sweep.knobs must list at least one knob`);
  for (const [k, v] of entries) {
    if (!Array.isArray(v) || v.length === 0) {
      throw new Error(`${filename}: knobs.${k} must be a non-empty array`);
    }
  }
  return {
    knobs,
    layout: raw.layout === 'row' ? 'horizontal' : (raw.layout || 'grid'),
    gap: raw.gap ?? 48,
  };
}

export function cartesian(knobs) {
  const keys = Object.keys(knobs);
  let rows = [{}];
  for (const key of keys) {
    const next = [];
    for (const row of rows) {
      for (const value of knobs[key]) {
        next.push({ ...row, [key]: value });
      }
    }
    rows = next;
  }
  return rows.map((combo) => {
    const label = keys.map((k) => `${k}=${combo[k]}`).join(',');
    const key = 'variant/' + keys.map((k) => `${slug(k)}-${slug(String(combo[k]))}`).join('/');
    return { knobs: combo, label, key };
  });
}

export function parsePromote(spec) {
  if (!spec) throw new Error('Missing --promote spec (example: pad=16,intent=cozy)');
  const out = {};
  for (const part of String(spec).split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) throw new Error(`Invalid --promote fragment: ${trimmed}`);
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if (/^-?\d+(\.\d+)?$/.test(v)) v = Number(v);
    out[k] = v;
  }
  if (!Object.keys(out).length) throw new Error('Empty --promote spec');
  return out;
}

export function promoteKnobs(doc, set) {
  const next = structuredClone(doc);
  next.knobs = { ...(next.knobs || {}), ...set };
  return next;
}

/**
 * Wrap the base doc's children in one matrix frame containing a labeled
 * variant per combination. Knob values are applied to each clone.
 */
export function buildSweepDoc(baseDoc, sweep) {
  const variants = cartesian(sweep.knobs);
  const layout = sweep.layout === 'horizontal' ? 'horizontal' : 'wrap-horizontal';
  const children = variants.map((v) => {
    const cloned = substitute(structuredClone({
      children: baseDoc.root ? [baseDoc.root] : (baseDoc.children || []),
    }), { ...(baseDoc.knobs || {}), ...v.knobs });
    return {
      name: v.label,
      type: 'frame',
      key: v.key,
      layout: 'vertical',
      gap: 12,
      padding: 16,
      fill: baseDoc.sweepFill || '#ffffff',
      children: [
        {
          name: v.label + ' label',
          type: 'text',
          key: v.key + '/label',
          content: v.label,
          fontSize: 12,
          fontWeight: 500,
          fill: '#111111',
        },
        ...(cloned.children || []),
      ],
    };
  });
  return {
    version: 1,
    name: (baseDoc.name || 'doc') + ' sweep',
    knobs: baseDoc.knobs || {},
    modes: baseDoc.modes || {},
    children: [
      {
        name: (baseDoc.name || 'doc') + ' matrix',
        type: 'frame',
        key: 'sweep-matrix',
        layout,
        gap: sweep.gap,
        padding: 24,
        fill: '#f4f4f5',
        children,
      },
    ],
  };
}

export function variantCount(sweep) {
  return Object.values(sweep.knobs).reduce((n, arr) => n * arr.length, 1);
}
