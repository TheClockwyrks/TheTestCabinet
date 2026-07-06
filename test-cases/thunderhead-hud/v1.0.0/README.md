# Thunderhead HUD — `v1.0.0`

This is version `v1.0.0` of the **Thunderhead HUD** test case: an
asset-generation case (`asset_kind = "ui"`) that asks a model to paint a
high-resolution fleet-command **interface kit** for *Thunderhead* — a naval
strategy game — using the `paint` and `ui` binaries, one recorded operation at a
time.

`thunderhead-hud` is the catalog slug for this case. There is no target image —
the model paints toward the seeded brief and is reviewed subjectively against it.
The interface is industrial and riveted-naval: a gunmetal-and-brass chassis with
cold tactical-cyan readouts and warning amber.

## The kit

The case declares a `[ui]` kit of five named elements, each its own document of
its own size:

- **`command-panel`** (512×512, nine-sliced) — the primary bezelled readout plate.
- **`health-bar-frame`** (512×96, nine-sliced) — a wide gauge housing.
- **`minimap-bezel`** (384×384, nine-sliced) — a square riveted radar surround.
- **`faction-crest`** (256×256, no nine-slice) — a fixed-size naval insignia.
- **`button-primary`** (256×72, nine-sliced) — a stretchable primary button.

The four stretchable elements carry fixed nine-slice insets in the manifest so
their corners, caps, and rivets hold when a game scales them; the crest is never
stretched. The brief fixes an exact named palette (gunmetal chassis, brass trim,
steel edge, tactical cyan and its deep glow, warning amber, readout black, rivet
highlight) with hex values.

## The tools

A run gets **two** binaries on its `PATH`, both baked into the single `ui`
run-container image: `paint` (the primary layered raster painter — shading, glow,
gradients, grime) and `ui` (the companion crisp-shape/text/nine-slice tool). They
share one workspace and one recorded operation log, and the brief directs the
model to both. There is no operations schema — each binary's `--help` is the
contract.

## Contents

| Path             | Seeded to run? | Purpose                                                       |
| ---------------- | -------------- | ------------------------------------------------------------- |
| `specs/brief.md` | **Yes**        | The self-contained painting brief (elements, palette, tools). |
| `prompt.hbs`     | No             | Rendered into the model's prompt; not seeded.                 |
| `test-case.toml` | No             | Manifest: canvas, ui kit, tool, output, domain, review.       |
| `variants/`      | No             | One TOML file per variant (listed in `variants`).             |
| `description.md` | No             | Site blurb.                                                   |
| `README.md`      | No             | This overview.                                                |

A run receives only the seeded brief, plus the `paint` and `ui` binaries, a
seeded `paint.config.json`, and a blank workspace per element. Core emits the
flattened per-element PNGs (`elements/{element}.png`) and `ui.json` (element sizes
and nine-slice insets) automatically — these are the authoritative output and are
not manifest-declared. There is no target image and no cheat-divergence check: the
emitted PNGs are what a reviewer evaluates.

## Variants

The HUD ships a single default variant — `base`, declared in `variants/base.toml`.
It seeds the common brief and is rated on the case's single `fidelity` scoring
domain; it adds no specs, review items, or domains of its own.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/thunderhead-hud/v1.0.0/`). Each version is self-contained and
immutable once a run references it; design revisions land as new version folders.
