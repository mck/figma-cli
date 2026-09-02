# Figma Doc schema

A Figma Doc is a declarative YAML or JSON tree of **named** nodes. There are
no Figma node ids in the file. Hierarchy is the tree. The compiler (`figma-cli
apply`) resolves the tree in one plugin execution, stamps variable modes on
new top-level frames, persists a stable key on every node via
`setPluginData`, and returns a name-to-id map.

This is the canvas's textual projection, not an HTML importer. The same
format is written by `apply`, read back by `read`, and parameterized by
`sweep`.

Machine-readable copy: `src/lib/doc/schema.json`.

## Document

```yaml
version: 1
name: kitchen-sink
knobs:
  pad: 24
  intent: default
modes:
  theme: default
  colorMode: light
children:
  - name: Page
    type: frame
    layout: vertical
    width: 1440
    fill: var:background
    padding: $pad
    children:
      - name: Title
        type: text
        content: shadcn-demo-app
        fontSize: 24
        fontWeight: 700
        fill: var:foreground
```

| Field | Required | Meaning |
|---|---|---|
| `version` | yes | Currently `1`. |
| `name` | no | Document label. Used in sweep frame titles. |
| `knobs` | no | Named parameters. A value of `$knob` or `{{knob}}` is substituted before compile. |
| `modes` | no | Map of variable-collection name to mode name. Overrides the compiler's default-mode stamp (`default` or `light`, else the collection's first mode). |
| `root` | one of root/children | A single root node. |
| `children` | one of root/children | Top-level nodes (usually one page frame). |

Do not put Figma `id` fields in the doc. Identity is `name` plus a stable
`key` (see below).

## Node

Every node:

| Field | Meaning |
|---|---|
| `name` | Required. Human name, also the default key segment. |
| `type` | `frame`, `text`, `rect`, `ellipse`, `icon`, `image`, `instance`, `component`, `group`. |
| `key` | Optional stable key. Default: parent key + `/` + slug(name). Persisted as plugin data (`figma-cli` / `docKey`). |
| `children` | Nested nodes (frame, component, group). |
| `visible` | Boolean. |
| `opacity` | 0..1. |
| `x`, `y` | Absolute offset when the parent is not auto-layout, or absolute-positioned children. |
| `width`, `height` | Number (px), `hug`, or `fill`. |
| `fill` | Paint. Hex (`#fff`), `var:name`, `var:collection/name`, or `var:collection:name`. |
| `stroke` | Paint, same binding syntax. |
| `strokeWidth` | Number. |
| `radius` | Number, or `{tl, tr, br, bl}`. |
| `clip` | Boolean. Clip content. |

Unknown types are **hard errors** at compile time. The compiler never
silently skips a node.

### Auto-layout (`type: frame` or `component`)

| Field | Meaning |
|---|---|
| `layout` | `vertical`, `horizontal`, `none`, `wrap-vertical`, `wrap-horizontal`. Aliases: `col`, `row`. |
| `gap` | Item spacing (px). |
| `padding` | Number, `[v, h]`, `[t, r, b, l]`, or `{top, right, bottom, left}`. |
| `align` | Cross-axis: `start`, `center`, `end`, `baseline`. |
| `justify` | Main-axis: `start`, `center`, `end`, `between`, `around`. |

### Text

| Field | Meaning |
|---|---|
| `content` | String. |
| `fontFamily` | Default `Inter`. |
| `fontWeight` | Number (400, 600, 700) or name (`regular`, `medium`, `semibold`, `bold`). |
| `fontSize` | px. |
| `lineHeight` | px or `{value, unit}` where unit is `PIXELS` or `PERCENT`. |
| `letterSpacing` | px. |
| `align` | `left`, `center`, `right`. |
| `fill` | Text color (hex or `var:`). |

### Icon

| Field | Meaning |
|---|---|
| `icon` | Iconify name, `set:id` (example: `lucide:home`). |
| `size` | px, default 24. |
| `fill` | Hex or `var:`. Bound onto vector fills inside the SVG, not a wrapper rectangle. |

The CLI prefetches the SVG and embeds it in the plugin payload so several
icons with variable-bound fills compile in one execution. A missing icon is
a hard error, not a placeholder.

### Image

| Field | Meaning |
|---|---|
| `src` | `https://` URL or `data:image/...;base64,...`. |
| `scaleMode` | `FILL`, `FIT`, `CROP`, `TILE`. |

`figma.createImageAsync` failure is a hard error. The compiler never reports
success for an image that was not created.

### Instance

| Field | Meaning |
|---|---|
| `component` | Component name to instantiate (current file). |
| `variant` | Optional map of variant axis to value. |

A missing component is a hard error.

## Binding syntax

Same contract `render` / `set-batch` already use:

- `var:foreground` : first match by variable name (collection pin via `apply --collection`).
- `var:theme/foreground` or `var:theme:foreground` : name inside that collection.

`figma-cli context` returns the collections, modes (including which mode is
the stamp default), variable paths, and this syntax block so a fresh agent
does not have to reconstruct it.

`gap`, `padding`, and `radius` accept `var:` (FLOAT variables, e.g.
`var:spacing/600`, `var:radius/lg`) via `setBoundVariable`. Width, height,
and fontSize stay numeric or hug/fill in this version.

## Stable keys

On apply, every node gets `node.setPluginData('figma-cli', 'docKey', key)`.
`read` emits the same keys. Re-applying a doc with `apply` (desired-state)
looks up those keys, patches what changed, and does not duplicate.

If you omit `key`, the compiler assigns `slug(name)` at the root and
`parent/slug(name)` below, de-duplicating sibling collisions with `-2`, `-3`.

## Knobs and sweeps

Knobs are the parameters of the doc. They are substituted before compile:

```yaml
knobs:
  pad: 16
  intent: default
# ...
padding: $pad
```

A sweep file lists discrete values per knob. `figma-cli sweep doc.yaml
sweep.yaml` compiles one labeled variant frame per combination, in one
apply.

```yaml
knobs:
  pad: [8, 16, 24]
  intent: [default, compact, cozy]
layout: grid
gap: 48
```

`figma-cli sweep doc.yaml sweep.yaml --promote pad=16,intent=cozy` writes
that parameter set back into the base doc's `knobs`.

## Apply result

The plugin returns JSON:

```json
{
  "ok": true,
  "nodes": { "Page": "12:3", "Title": "12:4" },
  "keys": { "page": "12:3", "page/title": "12:4" },
  "ops": [
    { "op": "create", "name": "Page", "key": "page", "status": "applied" },
    { "op": "create", "name": "Title", "key": "page/title", "status": "applied" }
  ]
}
```

Any `status: "failed"` makes `ok` false and the CLI exits non-zero. Capability
gaps (unknown type, missing icon, failed image, missing component, unknown
variable) are failures, never silent success.

## Commands

| Command | Role |
|---|---|
| `figma-cli apply <doc>` | Compile the tree in one plugin execution. |
| `figma-cli read [node\|page\|selection]` | Decompile canvas to the same format. |
| `figma-cli context` | One JSON payload: collections, modes, variables, binding contract, page/selection. |
| `figma-cli verify <node> --ref <png> [--region]` | Numeric per-region delta against a reference PNG. |
| `figma-cli sweep <doc> <sweep.yaml>` | Variant matrix. `--promote` lifts a cell into the base doc. |
