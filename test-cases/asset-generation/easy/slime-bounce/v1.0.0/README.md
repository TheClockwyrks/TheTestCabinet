# Slime Enemy Bounce — `v1.0.0`

This is version `v1.0.0` of the **Slime Enemy Bounce** test case: an
asset-generation case (`asset_kind = "sprite-sheet"`) that asks a model to draw a
green slime enemy as a six-frame 32×32 sprite sheet, one squash-and-stretch hop
loop, using only the `draw-sheet` tool, one recorded operation at a time.

`slime-bounce` is the catalog slug for this case. It is a generic, reusable
creature asset any game could drop in. There is no target image: the model draws
toward the seeded brief and is reviewed subjectively against it.

## What the sheet is

A green slime enemy in a classic squash-and-stretch bounce. The brief fixes the
slime as a cute, translucent green jelly blob with a soft highlight and two
readable eyes. It also fixes the six phases of the hop and a small fixed palette
on transparency. The exact silhouette, proportions, and technique are the
model's.

The six frames walk through one hop: squashed wide on the ground, stretching tall
as it launches, rounded at the apex, stretching as it drops, and squashing on
landing. They play back as a looping `bounce` animation. The eyes ride the body
through every frame, and the volume reads as conserved: wider and shorter when it
squashes, taller and narrower when it stretches. Drawn on full transparency, the
slime composites onto any scene.

The case declares no `[[reference]]`, no `[build]`, and no `[[check]]`: an
asset-generation case has no target image and is human-reviewed. It carries no
reviewer checklist either. The sheet is judged as a whole against the brief as
one overall rating, with the named `bounce` sequence playing back as a live
animation in the review UI.

## Layout

```text
v1.0.0/
  test-case.toml      # manifest: type, asset_kind, tables, domain
  prompt.hbs          # the instruction rendered per run (not seeded)
  description.md      # site-facing blurb (not seeded)
  README.md           # this file (not seeded)
  specs/brief.md      # the self-contained brief — seeded
  variants/base.toml  # the single default variant
```

## What a run receives

Only the seeded brief (`specs/brief.md`) and, from the orchestrator, a
`draw.config.json` per frame carrying the 32×32 canvas size, the transparent
background, and the log and preview paths, with six blank frames and empty action
logs pre-seeded. The `draw-sheet` binary is on the run's `PATH`, and its `--help`
is the operations contract; no operations schema is seeded. The recorded
per-frame `frames/{frame}.actions.json` logs are the authoritative output each
frame's image is regenerated from.

## Validate

```sh
tcab prompt --test-case slime-bounce --version v1.0.0 --variant base
tcab seed   --test-case slime-bounce --version v1.0.0 --variant base --out-dir <dir>
```

## Variants

This case ships a single variant, `base`, the standard 32×32 six-frame sheet. It
adds no specs or domains of its own and declares no `[canvas]` override, so the
frame size and sequence are fixed for every run.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/asset-generation/easy/slime-bounce/v1.0.0/`). Each version is
self-contained and immutable once a run references it; design revisions land as
new version folders.
