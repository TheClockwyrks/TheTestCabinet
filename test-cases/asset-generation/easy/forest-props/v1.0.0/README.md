# forest-props

An **asset-generation** test case (single 96×96 **sprite**): draw a reusable
**forest prop set** — eight storybook woodland scenery decorations on one sheet,
built one recorded drawing operation at a time with the `draw` tool.

The sheet holds eight nature props laid out within the 96×96 canvas: a round leafy
tree, a pine tree, a leafy bush, a cluster of grass tufts, a mossy boulder, a red
mushroom cluster, a small flower patch, and a tree stump. They may be varied sizes
rather than a strict grid. The case is generic and reusable — it is not tied to any
particular game; it measures whether a model can draw a cohesive, cleanly framed
scenery pack in one matched storybook style on full transparency. There is no target
image — the sheet is regenerated from the recorded operations and reviewed
subjectively against the brief.

## What it is

- **Kind:** single sprite (`draw` binary), regenerated pixel-for-pixel from the
  recorded `actions.json`.
- **Canvas:** 96×96, transparent background.
- **Subject:** eight forest scenery props in one storybook style, softly shaded,
  with crisp silhouettes readable on transparency and nothing clipped to an edge.
- **Palette:** an explicit, fixed list (leaf greens, pine greens, grass, trunk
  browns, cut wood, rock greys, moss, flower pink and yellow, mushroom red, cream)
  — only those colors plus transparency are allowed.
- **Difficulty:** easy. **Variants:** one — `base`.

## Layout

```text
v1.0.0/
  test-case.toml      # manifest: type, canvas/tool/output, domain
  prompt.hbs          # the instruction rendered per run (NOT seeded)
  description.md      # site-facing blurb (NOT seeded)
  README.md           # this file (NOT seeded)
  changelog.md        # this version's changelog entry (NOT seeded)
  specs/brief.md      # the self-contained brief — SEEDED
  variants/base.toml  # the single default variant
```

A run receives the seeded brief (`specs/brief.md`), the `draw` binary on its
`PATH`, and a blank starting canvas with an empty `actions.json` log. There is **no
target image and no operations schema** — the binary's `--help` is the authoritative
contract, and the recorded operations are the scored output.

## Validate

From the repo root, both of these must exit 0:

```sh
tcab prompt --test-case forest-props --version v1.0.0 --variant base
tcab seed   --test-case forest-props --version v1.0.0 --variant base --out-dir <dir>
```

`prompt` renders the per-run instruction; `seed` stages the seeded brief and the
blank canvas into a fresh run directory.
