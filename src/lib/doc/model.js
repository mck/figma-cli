/**
 * Figma Doc model: parse YAML/JSON, substitute knobs, assign stable keys,
 * validate. Pure Node; no Figma connection.
 */

import { readFileSync } from 'fs';
import { parse as parseYaml } from 'yaml';

export const DOC_PLUGIN_NS = 'figma-cli';
export const DOC_PLUGIN_KEY = 'docKey';
export const DOC_VERSION = 1;

export const NODE_TYPES = [
  'frame', 'text', 'rect', 'ellipse', 'icon', 'image', 'instance', 'component', 'group',
];

export const PAINT_FIELDS = new Set(['fill', 'stroke']);

export const KNOWN_NODE_KEYS = new Set([
  'name', 'type', 'key', 'id', 'children', 'visible', 'opacity', 'x', 'y',
  'width', 'height', 'fill', 'stroke', 'strokeWidth', 'radius', 'clip',
  'layout', 'gap', 'padding', 'align', 'justify', 'content', 'fontFamily',
  'fontWeight', 'fontSize', 'lineHeight', 'letterSpacing', 'icon', 'size',
  'src', 'scaleMode', 'component', 'variant',
]);

const LAYOUT_ALIAS = {
  col: 'vertical',
  column: 'vertical',
  row: 'horizontal',
};

export function slug(name) {
  return String(name || 'node')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'node';
}

export function substitute(value, knobs) {
  if (!knobs || typeof knobs !== 'object') return value;
  if (typeof value === 'string') {
    const exact = value.match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/);
    if (exact && Object.prototype.hasOwnProperty.call(knobs, exact[1])) {
      return knobs[exact[1]];
    }
    return value.replace(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (all, a, b) => {
      const k = a || b;
      return Object.prototype.hasOwnProperty.call(knobs, k) ? String(knobs[k]) : all;
    });
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, knobs));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = substitute(v, knobs);
    return out;
  }
  return value;
}

export function parseDocSource(source, filename = 'doc.yaml') {
  if (source == null) throw new Error('Empty document');
  const text = String(source);
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Empty document');
  let raw;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    raw = JSON.parse(trimmed);
  } else {
    raw = parseYaml(trimmed);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${filename}: document must be a mapping`);
  }
  return raw;
}

export function loadDocFile(path) {
  return parseDocSource(readFileSync(path, 'utf8'), path);
}

export function parsePaint(value) {
  if (value == null) return null;
  if (typeof value === 'object') {
    if (value.bind) return { kind: 'var', ref: String(value.bind).replace(/^var:/, '') };
    if (value.hex) return { kind: 'hex', hex: normalizeHex(value.hex) };
    throw new Error(`Invalid paint object`);
  }
  const s = String(value).trim();
  if (s.startsWith('var:')) return { kind: 'var', ref: s.slice(4) };
  if (s.startsWith('#')) return { kind: 'hex', hex: normalizeHex(s) };
  throw new Error(`Invalid paint: ${s}. Use #hex or var:name`);
}

export function normalizeHex(hex) {
  let h = String(hex).replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length === 4) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(h)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  return '#' + h.toLowerCase();
}

export function parseLength(value, field = 'length') {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object' && value.kind === 'var') return value;
  if (typeof value === 'string') {
    const s = value.trim();
    if (s.startsWith('var:')) return { kind: 'var', ref: s.slice(4) };
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  throw new Error(`Invalid ${field}: ${value}`);
}

export function parsePadding(value) {
  if (value == null) return null;
  if (typeof value === 'string' && value.startsWith('var:')) {
    const one = parseLength(value, 'padding');
    return { top: one, right: one, bottom: one, left: one };
  }
  if (typeof value === 'number') return { top: value, right: value, bottom: value, left: value };
  if (Array.isArray(value)) {
    if (value.length === 1) return parsePadding(value[0]);
    if (value.length === 2) {
      const v = parseLength(value[0], 'padding');
      const h = parseLength(value[1], 'padding');
      return { top: v, right: h, bottom: v, left: h };
    }
    if (value.length === 4) {
      return {
        top: parseLength(value[0], 'padding'),
        right: parseLength(value[1], 'padding'),
        bottom: parseLength(value[2], 'padding'),
        left: parseLength(value[3], 'padding'),
      };
    }
    throw new Error('padding array must be 1, 2, or 4 numbers');
  }
  if (typeof value === 'object') {
    return {
      top: parseLength(value.top ?? 0, 'padding'),
      right: parseLength(value.right ?? 0, 'padding'),
      bottom: parseLength(value.bottom ?? 0, 'padding'),
      left: parseLength(value.left ?? 0, 'padding'),
    };
  }
  throw new Error('Invalid padding');
}

export function weightToStyle(weight) {
  if (weight == null) return 'Regular';
  if (typeof weight === 'number') {
    if (weight <= 200) return 'Thin';
    if (weight <= 300) return 'Light';
    if (weight <= 400) return 'Regular';
    if (weight <= 500) return 'Medium';
    if (weight <= 600) return 'Semi Bold';
    if (weight <= 700) return 'Bold';
    if (weight <= 800) return 'Extra Bold';
    return 'Black';
  }
  const map = {
    thin: 'Thin', light: 'Light', regular: 'Regular', normal: 'Regular',
    medium: 'Medium', semibold: 'Semi Bold', 'semi bold': 'Semi Bold',
    bold: 'Bold', extrabold: 'Extra Bold', black: 'Black',
  };
  return map[String(weight).toLowerCase()] || 'Regular';
}

function assignKeys(node, parentKey, used) {
  const base = node.key ? String(node.key) : (parentKey ? `${parentKey}/${slug(node.name)}` : slug(node.name));
  let key = base;
  let n = 2;
  while (used.has(key)) {
    key = `${base}-${n}`;
    n += 1;
  }
  used.add(key);
  node.key = key;
  if (Array.isArray(node.children)) {
    for (const child of node.children) assignKeys(child, key, used);
  }
  return node;
}

export function validateNode(node, path) {
  const errors = [];
  if (!node || typeof node !== 'object') {
    errors.push(`${path}: node must be an object`);
    return errors;
  }
  if (node.id != null) {
    errors.push(`${path}: docs must not include Figma ids; use name + key`);
  }
  if (!node.name) errors.push(`${path}: missing name`);
  if (!node.type) errors.push(`${path}: missing type`);
  else if (!NODE_TYPES.includes(node.type)) {
    errors.push(`${path}: unknown type "${node.type}"`);
  }
  for (const field of PAINT_FIELDS) {
    if (node[field] != null) {
      try { parsePaint(node[field]); } catch (e) {
        errors.push(`${path}.${field}: ${e.message}`);
      }
    }
  }
  for (const numeric of ['width', 'height', 'strokeWidth', 'fontSize', 'size']) {
    const v = node[numeric];
    if (typeof v === 'string' && v.startsWith('var:')) {
      errors.push(`${path}.${numeric}: var: bindings are paint/gap/padding/radius only`);
    }
  }
  const extra = Object.keys(node).filter((k) => !KNOWN_NODE_KEYS.has(k));
  if (extra.length && node.type === 'text') {
    errors.push(`${path}: unquoted comma in content chopped the string. Quote content. Extra keys: ${extra.join(', ')}`);
  }
  if (node.type === 'icon' && !node.icon) {
    errors.push(`${path}: icon nodes require icon: set:name`);
  }
  if (node.type === 'image' && !node.src) {
    errors.push(`${path}: image nodes require src`);
  }
  if (node.type === 'text' && node.content == null) {
    errors.push(`${path}: text nodes require content`);
  }
  if (node.type === 'instance' && !node.component) {
    errors.push(`${path}: instance nodes require component`);
  }
  if (Array.isArray(node.children)) {
    node.children.forEach((child, i) => {
      errors.push(...validateNode(child, `${path}.children[${i}]`));
    });
  }
  return errors;
}

export function validateDoc(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object') return ['document must be an object'];
  if (raw.version !== DOC_VERSION) errors.push(`version must be ${DOC_VERSION}`);
  if (!raw.root && !Array.isArray(raw.children)) {
    errors.push('document needs root or children');
  }
  const roots = raw.root ? [raw.root] : (raw.children || []);
  roots.forEach((n, i) => errors.push(...validateNode(n, raw.root ? 'root' : `children[${i}]`)));
  return errors;
}

export function normalizeDoc(raw, { knobs: knobOverrides } = {}) {
  const errors = validateDoc(raw);
  if (errors.length) {
    const err = new Error('Invalid figma doc:\n' + errors.map((e) => `  - ${e}`).join('\n'));
    err.errors = errors;
    throw err;
  }
  const knobs = { ...(raw.knobs || {}), ...(knobOverrides || {}) };
  const substituted = substitute({
    version: raw.version,
    name: raw.name || 'doc',
    knobs,
    modes: raw.modes || {},
    collection: raw.collection,
    root: raw.root,
    children: raw.children,
  }, knobs);

  const roots = substituted.root ? [substituted.root] : substituted.children;
  const used = new Set();
  const children = roots.map((n) => assignKeys(structuredClone(n), '', used));
  return {
    version: DOC_VERSION,
    name: substituted.name,
    knobs,
    modes: substituted.modes || {},
    collection: substituted.collection,
    children,
  };
}

export function flattenNodes(doc) {
  const out = [];
  const walk = (node, parentKey, topLevel) => {
    const { children, ...rest } = node;
    out.push({ ...rest, parentKey: parentKey || null, topLevel: !!topLevel });
    if (Array.isArray(children)) {
      for (const child of children) walk(child, node.key, false);
    }
  };
  for (const child of doc.children) walk(child, null, true);
  return out;
}

export function parseLayout(layout) {
  if (!layout || layout === 'none') return { mode: 'NONE', wrap: false };
  const aliased = LAYOUT_ALIAS[layout] || layout;
  if (aliased === 'wrap-horizontal') return { mode: 'HORIZONTAL', wrap: true };
  if (aliased === 'wrap-vertical') return { mode: 'VERTICAL', wrap: true };
  if (aliased === 'horizontal') return { mode: 'HORIZONTAL', wrap: false };
  if (aliased === 'vertical') return { mode: 'VERTICAL', wrap: false };
  throw new Error(`Unknown layout: ${layout}`);
}

export function hexToRgb(hex) {
  const h = normalizeHex(hex).slice(1);
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
}

/**
 * Lower the tree into a JSON-serializable IR the plugin runtime consumes.
 */
export function toIr(doc) {
  const nodes = flattenNodes(doc).map((n) => {
    const ir = {
      key: n.key,
      name: n.name,
      type: n.type,
      parentKey: n.parentKey,
      topLevel: n.topLevel,
      visible: n.visible,
      opacity: n.opacity,
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
      clip: n.clip,
    };
    if (n.fill != null) ir.fill = parsePaint(n.fill);
    if (n.stroke != null) ir.stroke = parsePaint(n.stroke);
    if (n.strokeWidth != null) ir.strokeWidth = n.strokeWidth;
    if (n.radius != null) ir.radius = parseLength(n.radius, 'radius');
    if (n.layout) ir.layout = parseLayout(n.layout);
    if (n.gap != null) ir.gap = parseLength(n.gap, 'gap');
    if (n.padding != null) ir.padding = parsePadding(n.padding);
    if (n.align) ir.align = n.align;
    if (n.justify) ir.justify = n.justify;
    if (n.type === 'text') {
      ir.content = n.content;
      ir.fontFamily = n.fontFamily || 'Inter';
      ir.fontStyle = weightToStyle(n.fontWeight);
      ir.fontSize = n.fontSize ?? 16;
      ir.lineHeight = n.lineHeight;
      ir.letterSpacing = n.letterSpacing;
      ir.textAlign = n.align;
    }
    if (n.type === 'icon') {
      ir.icon = n.icon;
      ir.size = n.size ?? 24;
    }
    if (n.type === 'image') {
      ir.src = n.src;
      ir.scaleMode = n.scaleMode || 'FILL';
    }
    if (n.type === 'instance') {
      ir.component = n.component;
      ir.variant = n.variant || {};
    }
    return ir;
  });
  return {
    version: doc.version,
    name: doc.name,
    modes: doc.modes || {},
    collection: doc.collection || null,
    nodes,
  };
}

export function loadAndCompileIr(source, filename, knobOverrides) {
  const raw = typeof source === 'object' && source !== null && !Buffer.isBuffer(source)
    ? source
    : parseDocSource(source, filename);
  const doc = normalizeDoc(raw, { knobs: knobOverrides });
  return { doc, ir: toIr(doc) };
}
