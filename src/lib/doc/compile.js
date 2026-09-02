/**
 * Compile a Figma Doc into one plugin eval payload.
 * Icon SVGs are prefetched on the CLI side so N icons with var-bound fills
 * land in a single plugin execution.
 */

import { loadAndCompileIr, loadDocFile, parseDocSource } from './model.js';
import { buildApplyScript } from './runtime.js';

export async function prefetchIcons(ir, fetchImpl = globalThis.fetch.bind(globalThis)) {
  const icons = ir.nodes.filter((n) => n.type === 'icon');
  if (!icons.length) return ir;
  const cache = new Map();
  for (const node of icons) {
    const spec = node.icon;
    if (!spec || !spec.includes(':')) {
      throw new Error(`Icon "${node.name}" needs icon: set:name (got ${spec})`);
    }
    const size = node.size || 24;
    const cacheKey = spec + '@' + size;
    if (cache.has(cacheKey)) {
      node.svg = cache.get(cacheKey);
      continue;
    }
    const [prefix, name] = spec.split(':');
    const url = `https://api.iconify.design/${prefix}/${name}.svg?width=${size}&height=${size}`;
    let res;
    try {
      res = await fetchImpl(url);
    } catch (e) {
      throw new Error(`Icon fetch failed for ${spec}: ${e.message}`);
    }
    if (!res.ok) throw new Error(`Icon fetch failed for ${spec}: HTTP ${res.status}`);
    const svg = await res.text();
    if (!svg || !svg.includes('<svg')) {
      throw new Error(`Icon not found: ${spec}`);
    }
    cache.set(cacheKey, svg);
    node.svg = svg;
  }
  return ir;
}

export async function compileDoc(source, options = {}) {
  const filename = options.filename || 'doc.yaml';
  const raw = typeof source === 'string' || Buffer.isBuffer(source)
    ? parseDocSource(source, filename)
    : source;
  const { doc, ir } = loadAndCompileIr(raw, filename, options.knobs);
  await prefetchIcons(ir, options.fetch);
  const script = buildApplyScript(ir, {
    diff: options.diff !== false,
    hard: options.hard !== false,
    collection: options.collection || doc.collection || null,
  });
  return { doc, ir, script };
}

export async function compileDocFile(path, options = {}) {
  const raw = loadDocFile(path);
  return compileDoc(raw, { ...options, filename: path });
}
