/**
 * Plugin-side apply / decompile. The exported functions are stringified into
 * one eval payload so the whole tree runs in a single plugin tick.
 *
 * These functions close over nothing: every helper lives inside the function
 * body so `.toString()` is a complete program.
 */

export const DOC_PLUGIN_NS = 'figma-cli';
export const DOC_PLUGIN_KEY = 'docKey';

export async function applyDoc(ir, opts) {
  const NS = 'figma-cli';
  const KEY = 'docKey';
  const ops = [];
  const names = {};
  const keys = {};
  const created = new Map();
  const hard = opts && opts.hard === false ? false : true;

  function fail(op, name, key, error) {
    ops.push({ op, name, key, status: 'failed', error: String(error) });
  }
  function ok(op, name, key) {
    ops.push({ op, name, key, status: 'applied' });
  }
  function skip(op, name, key) {
    ops.push({ op, name, key, status: 'skipped' });
  }

  function indexByKey(node, map) {
    try {
      const k = node.getPluginData(KEY);
      if (k) map.set(k, node);
    } catch (_) { /* plugin data not available on this node */ }
    if ('children' in node) {
      for (const c of node.children) indexByKey(c, map);
    }
  }

  function lookupVar(variables, collections, ref, pin) {
    const raw = String(ref);
    let collectionName = pin || null;
    let name = raw;
    const colNames = collections.map((c) => c.name.toLowerCase());
    if (raw.includes(':') && !raw.startsWith('http')) {
      const idx = raw.indexOf(':');
      collectionName = raw.slice(0, idx);
      name = raw.slice(idx + 1);
    } else if (raw.includes('/')) {
      const idx = raw.indexOf('/');
      const head = raw.slice(0, idx).toLowerCase();
      if (colNames.includes(head)) {
        collectionName = raw.slice(0, idx);
        name = raw.slice(idx + 1);
      }
    }
    let matches = variables.filter((v) => v.name === name || v.name.endsWith('/' + name));
    if (collectionName) {
      const col = collections.find((c) => c.name.toLowerCase() === collectionName.toLowerCase());
      if (!col) throw new Error('Unknown collection "' + collectionName + '" for var:' + raw);
      matches = matches.filter((v) => v.variableCollectionId === col.id);
    }
    if (matches.length === 0) throw new Error('Unknown variable var:' + raw);
    return matches[0];
  }

  function boundPaint(variable) {
    return figma.variables.setBoundVariableForPaint(
      { type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 } },
      'color',
      variable
    );
  }

  function solidPaint(hex) {
    const h = String(hex).replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    return {
      type: 'SOLID',
      color: {
        r: parseInt(full.slice(0, 2), 16) / 255,
        g: parseInt(full.slice(2, 4), 16) / 255,
        b: parseInt(full.slice(4, 6), 16) / 255,
      },
    };
  }

  function applyPaint(node, field, paint, variables, collections, pin) {
    if (!paint) return;
    let value;
    if (paint.kind === 'var') value = [boundPaint(lookupVar(variables, collections, paint.ref, pin))];
    else if (paint.kind === 'hex') value = [solidPaint(paint.hex)];
    else throw new Error('Invalid paint on ' + field);
    if (field === 'fill') {
      if (node.type === 'TEXT') node.fills = value;
      else if ('fills' in node) node.fills = value;
    } else if (field === 'stroke' && 'strokes' in node) {
      node.strokes = value;
    }
  }

  function colorizeVectors(node, paint, variables, collections, pin) {
    const apply = (n) => {
      if (n.fills && n.fills.length > 0) applyPaint(n, 'fill', paint, variables, collections, pin);
      if (n.strokes && n.strokes.length > 0) applyPaint(n, 'stroke', paint, variables, collections, pin);
      if ('children' in n) n.children.forEach(apply);
    };
    if ('children' in node) node.children.forEach(apply);
    else apply(node);
  }

  function applySize(node, irNode) {
    const w = irNode.width;
    const h = irNode.height;
    const isText = irNode.type === 'text' || node.type === 'TEXT';

    if (isText) {
      try {
        if (typeof w === 'number') {
          node.textAutoResize = 'HEIGHT';
          node.resize(Math.max(w, 1), Math.max(node.height || 1, 1));
          if ('layoutSizingHorizontal' in node) node.layoutSizingHorizontal = 'FIXED';
          if ('layoutSizingVertical' in node) node.layoutSizingVertical = 'HUG';
        } else if (w === 'fill') {
          node.textAutoResize = 'HEIGHT';
          if ('layoutSizingHorizontal' in node) node.layoutSizingHorizontal = 'FILL';
          if ('layoutSizingVertical' in node) node.layoutSizingVertical = 'HUG';
        } else {
          node.textAutoResize = 'WIDTH_AND_HEIGHT';
          if ('layoutSizingHorizontal' in node) node.layoutSizingHorizontal = 'HUG';
          if ('layoutSizingVertical' in node) node.layoutSizingVertical = 'HUG';
        }
        if (h === 'fill' && 'layoutSizingVertical' in node) node.layoutSizingVertical = 'FILL';
      } catch (_) { /* sizing not supported on this node */ }
      return;
    }

    if (typeof w === 'number' && typeof h === 'number' && 'resize' in node) {
      node.resize(Math.max(w, 0.01), Math.max(h, 0.01));
    } else if (typeof w === 'number' && 'resize' in node) {
      node.resize(Math.max(w, 0.01), Math.max(node.height || 1, 1));
    } else if (typeof h === 'number' && 'resize' in node) {
      node.resize(Math.max(node.width || 1, 1), Math.max(h, 0.01));
    }

    try {
      if ('layoutSizingHorizontal' in node) {
        if (w === 'fill') node.layoutSizingHorizontal = 'FILL';
        else if (typeof w === 'number') node.layoutSizingHorizontal = 'FIXED';
        else node.layoutSizingHorizontal = 'HUG';
      }
      if ('layoutSizingVertical' in node) {
        if (h === 'fill') node.layoutSizingVertical = 'FILL';
        else if (typeof h === 'number') node.layoutSizingVertical = 'FIXED';
        else node.layoutSizingVertical = 'HUG';
      }
    } catch (_) { /* parent is not auto-layout */ }

    if ('layoutMode' in node && node.layoutMode && node.layoutMode !== 'NONE') {
      const vertical = node.layoutMode === 'VERTICAL';
      try {
        if (vertical) {
          node.primaryAxisSizingMode = (h === 'fill' || typeof h === 'number') ? 'FIXED' : 'AUTO';
          node.counterAxisSizingMode = (typeof w === 'number' || w === 'fill') ? 'FIXED' : 'AUTO';
        } else {
          node.primaryAxisSizingMode = (w === 'fill' || typeof w === 'number') ? 'FIXED' : 'AUTO';
          node.counterAxisSizingMode = (typeof h === 'number' || h === 'fill') ? 'FIXED' : 'AUTO';
        }
      } catch (_) { /* */ }
    }
  }

  function applyLayout(node, irNode) {
    if (!irNode.layout || !('layoutMode' in node)) return;
    const layout = irNode.layout;
    node.layoutMode = layout.mode;
    if (layout.wrap && 'layoutWrap' in node) node.layoutWrap = 'WRAP';
    if (irNode.gap != null) node.itemSpacing = irNode.gap;
    if (irNode.padding) {
      node.paddingTop = irNode.padding.top;
      node.paddingRight = irNode.padding.right;
      node.paddingBottom = irNode.padding.bottom;
      node.paddingLeft = irNode.padding.left;
    }
    const alignMap = { start: 'MIN', center: 'CENTER', end: 'MAX', baseline: 'BASELINE' };
    const justifyMap = { start: 'MIN', center: 'CENTER', end: 'MAX', between: 'SPACE_BETWEEN' };
    if (irNode.align && alignMap[irNode.align]) node.counterAxisAlignItems = alignMap[irNode.align];
    if (irNode.justify && justifyMap[irNode.justify]) node.primaryAxisAlignItems = justifyMap[irNode.justify];
  }

  function applyRadius(node, radius) {
    if (radius == null || !('cornerRadius' in node)) return;
    if (typeof radius === 'number') node.cornerRadius = radius;
    else if (typeof radius === 'object') {
      if ('topLeftCornerRadius' in node) {
        node.topLeftCornerRadius = radius.tl ?? 0;
        node.topRightCornerRadius = radius.tr ?? 0;
        node.bottomRightCornerRadius = radius.br ?? 0;
        node.bottomLeftCornerRadius = radius.bl ?? 0;
      }
    }
  }

  const fontCache = new Map();
  async function loadFont(family, style) {
    const want = { family: family || 'Inter', style: style || 'Regular' };
    const key = want.family + '|' + want.style;
    if (fontCache.has(key)) return fontCache.get(key);
    const candidates = [want, { family: want.family, style: 'Regular' }, { family: 'Inter', style: 'Regular' }];
    let last = null;
    for (const font of candidates) {
      try {
        await figma.loadFontAsync(font);
        fontCache.set(key, font);
        return font;
      } catch (e) {
        last = e;
      }
    }
    throw new Error('Could not load a font' + (last ? ': ' + last.message : ''));
  }

  function pickMode(collection, overrideName) {
    if (overrideName) {
      const m = collection.modes.find((x) => x.name.toLowerCase() === String(overrideName).toLowerCase());
      if (!m) throw new Error('Unknown mode "' + overrideName + '" in collection "' + collection.name + '"');
      return m;
    }
    return collection.modes.find((x) => /^(default|light)$/i.test(x.name)) || collection.modes[0];
  }

  function stampModes(node, collections, modes) {
    if (!node || !('setExplicitVariableModeForCollection' in node)) return;
    for (const col of collections) {
      const override = modes && (modes[col.name] || modes[col.name.toLowerCase()]);
      const mode = pickMode(col, override);
      node.setExplicitVariableModeForCollection(col, mode.modeId);
    }
  }

  function findComponent(name) {
    const pages = [figma.currentPage, ...figma.root.children];
    for (const page of pages) {
      const stack = 'children' in page ? [...page.children] : [];
      while (stack.length) {
        const n = stack.pop();
        if ((n.type === 'COMPONENT' || n.type === 'COMPONENT_SET') && n.name === name) return n;
        if ('children' in n) for (const c of n.children) stack.push(c);
      }
    }
    return null;
  }

  async function createNode(irNode) {
    const t = irNode.type;
    if (t === 'frame' || t === 'component') {
      const node = t === 'component' ? figma.createComponent() : figma.createFrame();
      node.name = irNode.name;
      node.fills = [];
      return node;
    }
    if (t === 'rect') {
      const node = figma.createRectangle();
      node.name = irNode.name;
      return node;
    }
    if (t === 'ellipse') {
      const node = figma.createEllipse();
      node.name = irNode.name;
      return node;
    }
    if (t === 'text') {
      const node = figma.createText();
      node.name = irNode.name;
      return node;
    }
    if (t === 'group') {
      const node = figma.createFrame();
      node.name = irNode.name;
      node.fills = [];
      node.layoutMode = 'NONE';
      return node;
    }
    if (t === 'icon') {
      if (!irNode.svg) throw new Error('Icon "' + irNode.icon + '" has no SVG payload');
      const node = figma.createNodeFromSvg(irNode.svg);
      node.name = irNode.name || irNode.icon;
      node.fills = [];
      const size = irNode.size || 24;
      node.resize(size, size);
      return node;
    }
    if (t === 'image') {
      if (!irNode.src) throw new Error('Image "' + irNode.name + '" missing src');
      let image;
      try {
        image = await figma.createImageAsync(irNode.src);
      } catch (e) {
        throw new Error('create-image failed for "' + irNode.name + '": ' + e.message);
      }
      if (!image || !image.hash) throw new Error('create-image returned no hash for "' + irNode.name + '"');
      const node = figma.createRectangle();
      node.name = irNode.name;
      const size = await image.getSizeAsync();
      const w = typeof irNode.width === 'number' ? irNode.width : size.width;
      const h = typeof irNode.height === 'number' ? irNode.height : size.height;
      node.resize(w, h);
      node.fills = [{ type: 'IMAGE', scaleMode: irNode.scaleMode || 'FILL', imageHash: image.hash }];
      return node;
    }
    if (t === 'instance') {
      const comp = findComponent(irNode.component);
      if (!comp) throw new Error('Unknown component "' + irNode.component + '"');
      let target = comp;
      if (comp.type === 'COMPONENT_SET' && irNode.variant && Object.keys(irNode.variant).length) {
        const wanted = Object.entries(irNode.variant).map(([k, v]) => k + '=' + v).join(', ');
        const hit = comp.children.find((c) => c.name === wanted || c.name.includes(wanted));
        if (!hit) throw new Error('Unknown variant "' + wanted + '" on ' + irNode.component);
        target = hit;
      }
      if (target.type !== 'COMPONENT') {
        const first = target.type === 'COMPONENT_SET' ? target.defaultVariant : null;
        if (!first) throw new Error('Cannot instantiate ' + irNode.component);
        target = first;
      }
      const node = target.createInstance();
      node.name = irNode.name;
      return node;
    }
    throw new Error('Unknown type "' + t + '"');
  }

  async function applyProps(node, irNode, variables, collections, pin, isNew) {
    node.name = irNode.name;
    if (irNode.visible === false) node.visible = false;
    if (irNode.opacity != null && 'opacity' in node) node.opacity = irNode.opacity;
    if (irNode.x != null) node.x = irNode.x;
    if (irNode.y != null) node.y = irNode.y;
    if (irNode.clip && 'clipsContent' in node) node.clipsContent = true;
    applyLayout(node, irNode);
    if (irNode.type !== 'text') applySize(node, irNode);
    applyRadius(node, irNode.radius);
    if (irNode.strokeWidth != null && 'strokeWeight' in node) node.strokeWeight = irNode.strokeWidth;
    if (irNode.type === 'icon' && irNode.fill) {
      colorizeVectors(node, irNode.fill, variables, collections, pin);
    } else if (irNode.type !== 'image' && irNode.type !== 'text') {
      applyPaint(node, 'fill', irNode.fill, variables, collections, pin);
    }
    applyPaint(node, 'stroke', irNode.stroke, variables, collections, pin);
    if (irNode.type === 'text') {
      const font = await loadFont(irNode.fontFamily, irNode.fontStyle);
      node.fontName = font;
      if (irNode.fontSize) node.fontSize = irNode.fontSize;
      node.characters = irNode.content == null ? '' : String(irNode.content);
      if (irNode.lineHeight != null) {
        if (typeof irNode.lineHeight === 'number') node.lineHeight = { unit: 'PIXELS', value: irNode.lineHeight };
        else node.lineHeight = irNode.lineHeight;
      }
      if (irNode.letterSpacing != null) node.letterSpacing = { unit: 'PIXELS', value: irNode.letterSpacing };
      if (irNode.textAlign === 'center') node.textAlignHorizontal = 'CENTER';
      else if (irNode.textAlign === 'right') node.textAlignHorizontal = 'RIGHT';
      applyPaint(node, 'fill', irNode.fill, variables, collections, pin);
      applySize(node, irNode);
    }
    if (isNew && irNode.topLevel) stampModes(node, collections, ir.modes || {});
  }

  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const variables = await figma.variables.getLocalVariablesAsync();
  const pin = (opts && opts.collection) || ir.collection || null;
  const byKey = new Map();
  indexByKey(figma.currentPage, byKey);
  const diff = !!(opts && opts.diff);
  for (const style of ['Regular', 'Medium', 'Semi Bold', 'Bold']) {
    try {
      const font = { family: 'Inter', style };
      await figma.loadFontAsync(font);
      fontCache.set('Inter|' + style, font);
    } catch (_) { /* style not installed */ }
  }


  for (const irNode of ir.nodes) {
    try {
      let node = diff ? byKey.get(irNode.key) : null;
      const existed = !!node;
      if (!node) {
        node = await createNode(irNode);
        node.setPluginData(KEY, irNode.key);
        try { node.setSharedPluginData(NS, KEY, irNode.key); } catch (_) { /* not all node types */ }
        const parent = irNode.parentKey
          ? (created.get(irNode.parentKey) || byKey.get(irNode.parentKey))
          : null;
        if (irNode.parentKey && !parent) throw new Error('Parent missing for ' + irNode.key);
        if (parent && 'appendChild' in parent) parent.appendChild(node);
        else figma.currentPage.appendChild(node);
        await applyProps(node, irNode, variables, collections, pin, true);
        ok('create', irNode.name, irNode.key);
      } else {
        await applyProps(node, irNode, variables, collections, pin, false);
        ok('update', irNode.name, irNode.key);
      }
      created.set(irNode.key, node);
      byKey.set(irNode.key, node);
      names[irNode.name] = node.id;
      keys[irNode.key] = node.id;
    } catch (e) {
      fail(diff ? 'update' : 'create', irNode.name, irNode.key, e.message || e);
      if (hard) {
        return { ok: false, nodes: names, keys, ops };
      }
    }
  }

  const failed = ops.filter((o) => o.status === 'failed').length;
  return { ok: failed === 0, nodes: names, keys, ops, failed };
}

export async function decompileNode(rootId, scope) {
  const KEY = 'docKey';
  const variables = await figma.variables.getLocalVariablesAsync();
  const byId = new Map(variables.map((v) => [v.id, v]));

  function varRefFromId(id) {
    if (!id) return null;
    const v = byId.get(id);
    return v ? 'var:' + v.name : null;
  }

  function paintOf(node, field) {
    const paints = field === 'stroke' ? node.strokes : node.fills;
    if (!paints || paints === figma.mixed || !paints.length) return undefined;
    const p = paints[0];
    try {
      const bound = node.boundVariables && (field === 'stroke' ? node.boundVariables.strokes : node.boundVariables.fills);
      const bid = bound && bound[0] && (bound[0].id || (bound[0].color && bound[0].color.id));
      const named = varRefFromId(bid);
      if (named) return named;
    } catch (_) { /* */ }
    try {
      const b = p.boundVariables && p.boundVariables.color;
      const named = varRefFromId(b && b.id);
      if (named) return named;
    } catch (_) { /* */ }
    if (p.type === 'SOLID' && p.color) {
      const hex = '#' + [p.color.r, p.color.g, p.color.b].map((c) => {
        const n = Math.round(c * 255).toString(16).padStart(2, '0');
        return n;
      }).join('');
      return hex;
    }
    return undefined;
  }

  function layoutOf(node) {
    if (!('layoutMode' in node) || node.layoutMode === 'NONE') return undefined;
    if (node.layoutWrap === 'WRAP') {
      return node.layoutMode === 'HORIZONTAL' ? 'wrap-horizontal' : 'wrap-vertical';
    }
    return node.layoutMode === 'HORIZONTAL' ? 'horizontal' : 'vertical';
  }

  function sizeOf(node, axis) {
    const sizing = axis === 'h' ? node.layoutSizingHorizontal : node.layoutSizingVertical;
    if (sizing === 'HUG') return 'hug';
    if (sizing === 'FILL') return 'fill';
    return axis === 'h' ? Math.round(node.width) : Math.round(node.height);
  }

  function typeOf(node) {
    if (node.type === 'FRAME' || node.type === 'SECTION') return 'frame';
    if (node.type === 'TEXT') return 'text';
    if (node.type === 'RECTANGLE') {
      const fills = node.fills;
      if (fills && fills !== figma.mixed && fills[0] && fills[0].type === 'IMAGE') return 'image';
      return 'rect';
    }
    if (node.type === 'ELLIPSE') return 'ellipse';
    if (node.type === 'COMPONENT') return 'component';
    if (node.type === 'INSTANCE') return 'instance';
    if (node.type === 'GROUP') return 'group';
    if (node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION') return 'icon';
    return 'frame';
  }

  function walk(node, parentKey) {
    let key = '';
    try { key = node.getPluginData(KEY) || ''; } catch (_) { key = ''; }
    if (!key) {
      const slug = String(node.name || 'node').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'node';
      key = parentKey ? parentKey + '/' + slug : slug;
    }
    const out = {
      name: node.name,
      type: typeOf(node),
      key,
    };
    const fill = paintOf(node, 'fill');
    const stroke = paintOf(node, 'stroke');
    if (fill) out.fill = fill;
    if (stroke) out.stroke = stroke;
    if ('strokeWeight' in node && node.strokeWeight) out.strokeWidth = node.strokeWeight;
    if ('cornerRadius' in node && typeof node.cornerRadius === 'number' && node.cornerRadius) out.radius = node.cornerRadius;
    const layout = layoutOf(node);
    if (layout) {
      out.layout = layout;
      if (node.itemSpacing) out.gap = node.itemSpacing;
      if (node.paddingTop || node.paddingRight || node.paddingBottom || node.paddingLeft) {
        out.padding = [node.paddingTop || 0, node.paddingRight || 0, node.paddingBottom || 0, node.paddingLeft || 0];
      }
    }
    if ('width' in node) out.width = sizeOf(node, 'h');
    if ('height' in node) out.height = sizeOf(node, 'v');
    if (node.type === 'TEXT') {
      out.content = node.characters;
      out.fontSize = node.fontSize === figma.mixed ? undefined : node.fontSize;
      if (node.fontName && node.fontName !== figma.mixed) {
        out.fontFamily = node.fontName.family;
        out.fontWeight = node.fontName.style;
      }
    }
    if (node.type === 'INSTANCE') {
      try { out.component = node.mainComponent ? node.mainComponent.name : undefined; } catch (_) { /* */ }
    }
    if ('children' in node && node.children && node.children.length) {
      out.children = node.children.map((c) => walk(c, key));
    }
    return out;
  }

  let root;
  if (scope === 'page' || (!rootId && scope !== 'selection')) {
    const kids = figma.currentPage.children;
    return {
      version: 1,
      name: figma.currentPage.name,
      children: kids.map((c) => walk(c, '')),
    };
  }
  if (scope === 'selection') {
    const sel = figma.currentPage.selection;
    if (!sel.length) throw new Error('Nothing selected');
    if (sel.length === 1) {
      return { version: 1, name: sel[0].name, root: walk(sel[0], '') };
    }
    return { version: 1, name: 'selection', children: sel.map((c) => walk(c, '')) };
  }
  root = await figma.getNodeByIdAsync(rootId);
  if (!root) throw new Error('Node not found: ' + rootId);
  return { version: 1, name: root.name, root: walk(root, '') };
}

export async function collectContext() {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const variables = await figma.variables.getLocalVariablesAsync();
  const cols = collections.map((c) => {
    const namedDefault = c.modes.find((m) => /^(default|light)$/i.test(m.name)) || c.modes[0];
    return {
      id: c.id,
      name: c.name,
      defaultModeId: c.defaultModeId,
      stampMode: namedDefault ? { id: namedDefault.modeId, name: namedDefault.name } : null,
      modes: c.modes.map((m) => ({
        id: m.modeId,
        name: m.name,
        isCollectionDefault: m.modeId === c.defaultModeId,
        isStampDefault: namedDefault ? m.modeId === namedDefault.modeId : false,
      })),
    };
  });
  const vars = variables.map((v) => {
    const col = collections.find((c) => c.id === v.variableCollectionId);
    return {
      id: v.id,
      name: v.name,
      path: (col ? col.name + '/' : '') + v.name,
      type: v.resolvedType,
      collection: col ? col.name : null,
      collectionId: v.variableCollectionId,
    };
  });
  const sel = figma.currentPage.selection.map((n) => ({
    id: n.id,
    name: n.name,
    type: n.type,
    width: 'width' in n ? n.width : null,
    height: 'height' in n ? n.height : null,
  }));
  return {
    collections: cols,
    variables: vars,
    binding: {
      syntax: ['var:name', 'var:collection/name', 'var:collection:name'],
      paintFields: ['fill', 'stroke'],
      notes: [
        'var:name resolves the first local variable with that name.',
        'var:collection/name and var:collection:name pin the collection.',
        'apply --collection <name> pins every unpinned var:name in the doc.',
        'New top-level frames stamp each collection to its stampMode (mode named default or light, else the first mode), overridden by doc.modes.',
      ],
    },
    page: {
      id: figma.currentPage.id,
      name: figma.currentPage.name,
      childCount: figma.currentPage.children.length,
    },
    selection: sel,
  };
}

export function buildApplyScript(ir, opts = {}) {
  return `(async () => {
    const ir = ${JSON.stringify(ir)};
    const opts = ${JSON.stringify(opts)};
    const applyDoc = ${applyDoc.toString()};
    return await applyDoc(ir, opts);
  })()`;
}

export function buildDecompileScript(rootId, scope) {
  return `(async () => {
    const decompileNode = ${decompileNode.toString()};
    return await decompileNode(${JSON.stringify(rootId || null)}, ${JSON.stringify(scope || 'selection')});
  })()`;
}

export function buildContextScript() {
  return `(async () => {
    const collectContext = ${collectContext.toString()};
    return await collectContext();
  })()`;
}
