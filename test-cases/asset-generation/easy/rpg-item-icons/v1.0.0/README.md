# rpg-item-icons

An **asset-generation** test case (single sprite, drawn with `draw`): author a
generic **RPG inventory icon set** as one 96×96 sprite — a 3×3 grid of 32×32
icons — produced one drawing operation at a time.

## What it is

A reusable, game-agnostic pack of nine fantasy item icons laid out on a clean
3×3 grid: a red health potion, a blue mana potion, a steel sword, a round wooden
shield, a gold coin, a treasure chest, a brass key, a gemmed ring, and a rolled
scroll. Each icon is chunky and boldly outlined, flat-shaded with one lit tone and
one shadow tone, and lit from the top-left; the nine together have to read as one
cohesive family on full transparency. The model does not write pixels directly: it
calls the `draw` binary one operation at a time, and the recorded `actions.json` is
regenerated into the sprite. There is no target image — the case is human-reviewed
against the brief for whether every item reads at a glance, whether the style stays
consistent across the set, the grid layout, and the palette.

## Layout

```text
v1.0.0/
  test-case.toml      # manifest: type, [canvas]/[tool]/[output], domains, review
  prompt.hbs          # the instruction rendered per run (NOT seeded)
  description.md      # site-facing blurb (NOT seeded)
  README.md           # this file (NOT seeded)
  specs/brief.md      # the self-contained drawing brief — SEEDED
  variants/base.toml  # the single default variant
```

## Details

- **Canvas:** 96×96, transparent background — a 3×3 grid of 32×32 cells, one icon
  centered per cell.
- **Tool:** `draw`, one operation at a time; `actions.json` is the authoritative
  output; `canvas.png` is the re-rendered preview.
- **Palette:** a shared dark outline plus lit/shadow tone pairs for red and blue
  glass, steel, gold/brass, and wood, plus a parchment tone — roughly a dozen hues
  for the varied items, on full transparency.
- **Difficulty:** easy. **Tags:** sprite, 2d, icons, rpg.
- **Variants:** one — `base`.

## Validate

From the repo root, render the prompt and seed a run into a scratch directory
(both should exit 0):

```sh
tcab prompt --test-case rpg-item-icons --version v1.0.0 --variant base
tcab seed   --test-case rpg-item-icons --version v1.0.0 --variant base --out-dir <dir>
```
