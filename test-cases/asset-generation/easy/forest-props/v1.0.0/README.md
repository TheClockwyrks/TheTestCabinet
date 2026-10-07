# Forest Prop Set — `v1.0.0`

An asset-generation test case (single 96×96 sprite): draw a reusable forest prop
set of eight storybook woodland scenery decorations on one sheet, built one
recorded drawing operation at a time with the `draw` tool. There is no target
image. The sheet is regenerated from the recorded operations and reviewed
subjectively against the brief.

## What it is

- Kind: single sprite (`draw` binary), regenerated pixel-for-pixel from the
  recorded `actions.json`.
- Canvas: 96×96, transparent background.
- Subject: eight forest scenery props in one storybook style, softly shaded,
  with crisp silhouettes readable on transparency and nothing clipped to an
  edge. They are a round leafy tree, a pine tree, a leafy bush, a cluster of
  grass tufts, a mossy boulder, a red mushroom cluster, a small flower patch,
  and a tree stump, laid out within the canvas. They may be varied sizes, and a
  loose arrangement is fine.
- Palette: an explicit, fixed list (leaf greens, pine greens, grass, trunk
  browns, cut wood, rock greys, moss, flower pink and yellow, mushroom red,
  cream); only those colors plus transparency are allowed.
- Difficulty: easy. Variants: one, `base`.

The case is generic and reusable. It measures whether a model can draw a
cohesive, cleanly framed scenery pack in one matched storybook style on full
transparency.

## Layout

```text
v1.0.0/
  test-case.toml      # manifest: type, canvas/tool/output, domain
  prompt.hbs          # the instruction rendered per run (not seeded)
  description.md      # site-facing blurb (not seeded)
  README.md           # this file (not seeded)
  changelog.md        # this version's changelog entry (not seeded)
  specs/brief.md      # the self-contained brief, seeded
  variants/base.toml  # the single default variant
```

A run receives the seeded brief (`specs/brief.md`), the `draw` binary on its
`PATH`, and a blank starting canvas with an empty `actions.json` log. No
operations schema is seeded: the binary's `--help` is the authoritative
contract, and the recorded operations are the scored output.

## Validate

From the repo root, both of these must exit 0:

```sh
tcab prompt --test-case forest-props --version v1.0.0 --variant base
tcab seed   --test-case forest-props --version v1.0.0 --variant base --out-dir <dir>
```

`prompt` renders the per-run instruction. `seed` stages the seeded brief and the
blank canvas into a fresh run directory.
