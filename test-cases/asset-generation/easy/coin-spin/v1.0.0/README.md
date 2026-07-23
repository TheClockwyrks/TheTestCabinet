# Spinning Coin Pickup — `v1.0.0`

This is version `v1.0.0` of the **Spinning Coin Pickup** test case: an **animated**
asset-generation case (`asset_kind = "sprite-sheet"`) that asks a model to draw a
gold coin pickup spinning about its vertical axis as a **6-frame** 32×32 sprite
sheet, using only the `draw-sheet` tool, one recorded operation at a time. There is
**no target image** — the model draws toward the seeded brief and is reviewed
subjectively against it.

`coin-spin` is the catalog slug for this case. It is a generic, reusable
collectible asset, not tied to any specific game: a valuable rotating coin a game
can drop into any scene as a points pickup.

## What it is

The six frames are one continuous turn of the coin about its vertical (up–down)
axis: a full round face (0), a narrowing ellipse (1–2), a thin edge-on sliver (3),
a widening ellipse (4), and back toward the face (5). Played as the `spin` sequence
and looped, the coin appears to rotate forever. A bright white glint sweeps across
the face as the coin catches the light and drops out on the edge-on frame. The
brief fixes **what the coin is** — a shiny gold disc with a dark rim, a hint of an
inner face, and a sweeping glint — and the **gold palette on transparency**, and
leaves the exact silhouette and technique to the model.

The headline review item scores whether the frames read as one continuous rotation;
others score the clean loop, the read as a valuable gold coin, the sweeping glint,
and staying on-palette on full transparency.

## Layout

| Path | Seeded to run? | Purpose |
| --- | --- | --- |
| `specs/brief.md` | **Yes** | The self-contained brief (plain Markdown). |
| `prompt.hbs` | No | Rendered into the model's prompt; not seeded. |
| `test-case.toml` | No | Manifest: canvas, tool, sheet, domains, review. |
| `variants/` | No | One TOML file per variant (listed in `variants`). |
| `description.md` | No | Site blurb. |
| `changelog.md` | No | This version's changelog entry. |
| `README.md` | No | This overview. |

A run receives the seeded brief, the `draw-sheet` binary, and six pre-seeded blank
32×32 frames with empty action logs. There is **no target image and no operations
schema** — the binary's `--help` is the contract, and the recorded per-frame action
logs are the authoritative output.

## Validate

From the repo root, with the prebuilt CLI:

```
tcab prompt --test-case coin-spin --version v1.0.0 --variant base
tcab seed   --test-case coin-spin --version v1.0.0 --variant base --out-dir <dir>
```

Both should exit 0: `prompt` renders the run prompt, and `seed` stages the brief
and the blank frames a run starts from.

## Variants

This case ships a single variant, `base` (the case's 32×32 six-frame sheet). It
adds no specs, review items, or domains of its own, and declares no `[canvas]` or
`[sheet]` override, so the sheet never varies.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/asset-generation/easy/coin-spin/v1.0.0/`). Each version is
self-contained and immutable once a run references it; design revisions land as new
version folders.
