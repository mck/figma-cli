/**
 * Desired-state diff of two Figma Docs (or IRs). Used by apply --diff and tests.
 */

export function nodeIndex(nodes) {
  const map = new Map();
  for (const n of nodes) map.set(n.key, n);
  return map;
}

function comparable(node) {
  const { parentKey, topLevel, svg, ...rest } = node;
  return rest;
}

export function diffIr(desired, existing) {
  const want = nodeIndex(desired.nodes || []);
  const have = nodeIndex(existing.nodes || []);
  const ops = [];
  for (const [key, node] of want) {
    if (!have.has(key)) {
      ops.push({ op: 'create', key, name: node.name });
      continue;
    }
    const a = JSON.stringify(comparable(node));
    const b = JSON.stringify(comparable(have.get(key)));
    if (a !== b) ops.push({ op: 'update', key, name: node.name });
    else ops.push({ op: 'skip', key, name: node.name });
  }
  return {
    creates: ops.filter((o) => o.op === 'create').length,
    updates: ops.filter((o) => o.op === 'update').length,
    skips: ops.filter((o) => o.op === 'skip').length,
    extras: [...have.keys()].filter((k) => !want.has(k)).length,
    ops,
  };
}

export function wouldDuplicate(desired, existing) {
  const want = nodeIndex(desired.nodes || []);
  const have = nodeIndex(existing.nodes || []);
  for (const key of want.keys()) {
    if (!have.has(key)) continue;
  }
  return false;
}
