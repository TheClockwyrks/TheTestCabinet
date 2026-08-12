---
title: UI cases
---

A `ui` case produces a
[high-resolution interface asset](/testing/asset-generation/overview/#interface-assets),
either one full-canvas image or a kit of named elements, painted with the
[`paint` and `ui` binaries](/testing/asset-generation/ui-binaries/). It reuses
`[canvas]` for the base element size and adds an optional `[ui]` table declaring
the kit's elements.

Everything on the
[Manifests overview](/testing/asset-generation/manifests/overview/) applies
unchanged.

```toml
asset_kind = "ui"

# The base element size (and single-image size) and initial background.
[canvas]
width  = 512
height = 512
background = "transparent"

# `binary` names the PRIMARY tool (`paint`); the companion `ui` binary (vector shapes,
# text, nine-slice) ships in the SAME run-container image and is on PATH. `preview` is
# an {element} template for a kit, a single file for a single-image case.
[tool]
binary  = "paint"
preview = "elements/{element}.png"   # or "canvas.png" for a single-element case

# A SINGLE interleaved record for the whole asset (each op carries --element).
[output]
actions = "actions.json"

# OPTIONAL: a KIT of named elements (omit for a single full-canvas image). Each
# element is its own document of its own size.
[ui]

[[ui.element]]                 # >=1 when [ui] is present; a declared element
name   = "panel"               # stable, unique name (draw with --element panel)
width  = 512                   # element width in pixels (required)
height = 320                   # element height in pixels (required)
nine_slice = { left = 24, right = 24, top = 24, bottom = 24 }  # OPTIONAL fixed insets

[[ui.element]]
name   = "button-primary"
width  = 256
height = 72
```

## The ui table

The `[ui]` table is optional and valid only for `asset_kind = "ui"`. When present
it declares one or more `[[ui.element]]` entries, each a unique `name` and its
`width`/`height`. A `nine_slice` of `left`/`right`/`top`/`bottom` insets may fix
the stretchable region; otherwise the model authors it with
[`ui set-nine-slice`](/testing/asset-generation/ui-binaries/#ui--crisp-shapes-text-and-nine-slice).

When `[ui]` is absent the case has a single implicit element covering the whole
`[canvas]`. Resolution validates that element names are unique and that any fixed
`nine_slice` insets fit within the element's bounds.

## Tool and output paths

`[tool].binary` names the primary painter, `paint`. The companion `ui` binary is
baked into the same image and available on `PATH`, and the brief directs the
model to both.

`[tool].preview` carries the `{element}` token when `[ui]` declares elements and
is a single file otherwise. Resolution rejects a kit whose preview omits the
token and a single-element case whose preview carries it.

`[output].actions` is a single interleaved operation log and must not carry
`{element}`, because the two binaries share one recorded stream. The flattened
per-element PNGs and the `ui.json` carrying element sizes, nine-slice insets, and
atlas rectangles are emitted by core to paths it provides, so neither is
manifest-declared. See
[the output contract](/testing/asset-generation/ui-binaries/#the-output-contract).
