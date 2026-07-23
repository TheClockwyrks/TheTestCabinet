# slime-bounce

An **asset-generation** test case (`asset_kind = "sprite-sheet"`): draw a cute
**green slime enemy** as a six-frame 32×32 sprite sheet — one squash-and-stretch
**hop loop** — using only the `draw-sheet` tool, one recorded operation at a time.

This is a generic, reusable creature asset, not tied to any particular game: a soft,
jelly-like green blob with two simple eyes that bounces along the ground. The six
frames walk through one hop — squashed wide on the ground, stretching tall as it
launches, rounded at the apex, stretching as it drops, and squashing on landing —
and play back as a looping `bounce` animation. There is no target image; the model
draws toward the seeded brief and is reviewed subjectively against it.

## What it is

A green slime enemy in a classic squash-and-stretch bounce. The brief fixes **what
the slime is** (a cute, translucent green jelly blob with a soft highlight and two
readable eyes), the **six phases of the hop**, and a small fixed **palette** on
transparency — and leaves the exact silhouette, proportions, and technique to the
model. The eyes ride the body through every frame, and the volume is meant to look
conserved: wider and shorter when it squashes, taller and narrower when it stretches.
Because it is drawn on full transparency, the slime composites onto any scene.

The case declares **no `[[reference]]`, no `[build]`, and no `[[check]]`**: an
asset-generation case has no target image and is human-reviewed. It carries no
reviewer checklist either: the sheet is judged as a whole against the brief — does
it read as a cute green slime, is the squash-and-stretch convincing, does the loop
run clean — as one overall rating, with the named `bounce` sequence playing back
as a live animation in the review UI.

## Layout

```text
v1.0.0/
  test-case.toml      # manifest: type, asset_kind, tables, domain
  prompt.hbs          # the instruction rendered per run (NOT seeded)
  description.md      # site-facing blurb (NOT seeded)
  README.md           # this file (NOT seeded)
  specs/brief.md      # the self-contained brief — SEEDED
  variants/base.toml  # the single default variant
```

## What a run receives

Only the seeded brief (`specs/brief.md`) and, from the orchestrator, a
`draw.config.json` per frame carrying the 32×32 canvas size, the transparent
background, and the log / preview paths, with six blank frames and empty action
logs pre-seeded. The `draw-sheet` binary is on the run's `PATH`; its `--help` is the
operations contract — there is no seeded operations schema. The recorded per-frame
`frames/{frame}.actions.json` logs are the authoritative output each frame's image
is regenerated from.

## Validate

```sh
tcab prompt --test-case slime-bounce --version v1.0.0 --variant base
tcab seed   --test-case slime-bounce --version v1.0.0 --variant base --out-dir <dir>
```

## Variants

This case ships a single variant, `base` (the standard 32×32, six-frame sheet). It
adds no specs or domains of its own and declares no `[canvas]` override, so the
frame size and sequence never vary.

## Versioning

This case follows semantic versioning per version folder
(`test-cases/asset-generation/easy/slime-bounce/v1.0.0/`). Each version is
self-contained and immutable once a run references it; design revisions land as new
version folders.
