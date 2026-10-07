# Campfire Flames — `v1.0.0`

An asset-generation test case (`asset_kind = "particle-3d"`): author a cozy,
seamlessly looping campfire as a volumetric particle system, simulated live.

A small campfire already lit and burning steadily, with licking flame tongues that
rise and flicker (yellow-white at the base, cooling to orange then red at the
tips), small embers popping upward and drifting on the heat, and a faint smoke
wisp curling above. It is a steady-state effect. The fire is always burning, so it
must loop seamlessly, with no start, no end, and no burst-and-die.

The model authors an emitter system rather than individual particles: emitters,
forces, and per-particle size, opacity, and color curves, built with the
`particle-3d` binary one recorded operation at a time. The review UI simulates
that system live, so the effect varies slightly from one play to the next and the
character of the fire is what is judged.

This is a generic, reusable fire effect: a stock campfire suitable for any warm,
cozy scene.

## Layout

```text
v1.0.0/
  test-case.toml      # manifest: type, asset_kind, [particle]/[tool]/[output], domain
  prompt.hbs          # the instruction rendered per run (not seeded)
  description.md      # site-facing blurb (not seeded)
  README.md           # this file (not seeded)
  specs/brief.md      # the self-contained brief — seeded
  variants/base.toml  # the single default variant
```

## What a run receives

Only the seeded brief (`specs/brief.md`) and, from the orchestrator, a
`particle-3d.config.json` carrying the `[particle]` field dimensions, the duration
and playback fps, and the log, preview, and `system.json` paths. There is no
target clip and no simulation seed: the model authors a system to match the brief.
The `particle-3d` binary is on the run's `PATH`, and its `--help` is the operations
contract, since no operations schema is seeded.

## What is produced

The recorded `actions.json` operation log is the authoritative output. On
`particle-3d render`, core emits the authored `system.json` (the emitter, force,
and curve definition) and a preview `effect.gif`. The effect is simulated live
from `system.json`, never baked. The case declares no `[model]`, no
`[[reference]]`, no `[build]`, and no `[[check]]`: it is judged subjectively
against the brief.

## Details

- Field — 32×32×32 volume, transparent background, looping (`loop = true`), 2000
  ms at 60 fps, a steady-state fire that loops seamlessly.
- Directionality — the fire burns upward along `+y` from a small hearth footprint
  near the floor, centered in the `x`/`z` bed.
- Palette — yellow-white flame base (`#fff2c4`) cooling to orange (`#ff9a3c`) then
  red (`#d43a1e`), warm embers (`#ffb545` → `#b83410`), and a faint grey smoke
  (`#6f6a63` → `#2b2824`). Warm firelight only, with no cool hues.
- Difficulty — medium. Tags — vfx, particle, 3d, fire.
- Variants — one, `base`.
