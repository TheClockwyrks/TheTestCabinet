# explosion-sheet

An **asset-generation** test case (`asset_kind = "sprite-sheet"`): draw a classic
hand-drawn cartoon **explosion** as a 7-frame, 48×48 sprite sheet that plays once.

The explosion is one blast told across seven stages — an ignition spark, a
white-hot flash core, an expanding orange fireball with jagged flame tongues, a
smoke-and-debris peak, then grey smoke thinning to a nearly empty final frame. It
runs **hot-to-cool** frame to frame and is drawn on full transparency in a fixed
fire palette. The model does not write pixels directly: it issues `draw-sheet`
operations, one at a time, each targeting a frame; the recorded per-frame action
logs are the authoritative output, regenerated into each frame and judged against
the brief. The named sequence plays back as a live one-shot animation in the review
UI. This case is generic and reusable — a stock VFX explosion, not tied to any
particular game.

## Layout

```text
v1.0.0/
  test-case.toml      # manifest: type, asset_kind, tables, domains, review items
  prompt.hbs          # the instruction rendered per run (NOT seeded)
  description.md      # site-facing blurb (NOT seeded)
  README.md           # this file (NOT seeded)
  specs/brief.md      # the self-contained brief — SEEDED
  variants/base.toml  # the single default variant
```

## What a run receives

Only the seeded brief (`specs/brief.md`) and, from the orchestrator, blank starting
frames plus empty per-frame action logs at the workspace. There is **no target
image** — the model draws to match the brief, not to reproduce a supplied picture.
The `draw-sheet` binary is on the run's `PATH`; its `--help` is the operations
contract (no operations schema is seeded).

## What is produced

The recorded `frames/{frame}.actions.json` operation logs are the authoritative
output. After each operation, core re-renders that frame to `frames/{frame}.png`.
The case declares **no `[[reference]]`**, no `[build]`, and no `[[check]]`: it is
judged subjectively against the brief.

## Details

- **Frames:** seven separate 48×48 transparent frames (0–6), one blast stage each.
- **Sequence:** one — `explode` (frames 0–6 at 15 fps), a one-shot boom.
- **Palette:** flash `#fffdf2`, hot yellow `#ffe14a`, orange `#ff9c1a`, deep orange
  `#e5541a`, ember `#8f2414`, smoke greys `#a2a2a8` / `#4c4c52`.
- **Difficulty:** medium. **Tags:** sprite-sheet, 2d, animation, vfx.
- **Variants:** one — `base`.

## Validate

```sh
tcab prompt --test-case explosion-sheet --version v1.0.0 --variant base
tcab seed   --test-case explosion-sheet --version v1.0.0 --variant base --out-dir <dir>
```
