# Waterfall Spray — `v1.0.0`

An asset-generation test case (`asset_kind = "particle-3d"`): author a
seamlessly looping waterfall as a volumetric, steady-state particle system,
simulated live. It is a generic, reusable water effect.

A sheet of blue water droplets pours down from the top edge of a tall volume,
stretched along its velocity into thin streaks, and breaks into a billowing
white spray where it reaches the base, with a faint pale mist drifting low over
the landing zone. The effect is steady-state, so the water is already falling
and never stops, and it loops seamlessly over its window with no start, no end,
and no visible seam.

The model authors an emitter system of emitters, forces, and per-particle
size/opacity/color curves with the `particle-3d` binary, one recorded operation
at a time. The review UI and a game simulate that system live, so the effect
varies slightly from one play to the next and the character of the waterfall is
what is judged.

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
`particle-3d.config.json` carrying the `[particle]` field dimensions, the
duration and playback fps, and the log / preview / `system.json` paths. There is
no target clip and no simulation seed; the model authors a system to match the
brief. The `particle-3d` binary is on the run's `PATH`, and its `--help` is the
operations contract, with no operations schema seeded.

## What is produced

The recorded `actions.json` operation log is the authoritative output. On
`particle-3d render`, core emits the authored `system.json` and a preview
`effect.gif`. The `system.json` is the emitter, force and curve definition, and
the effect is simulated live from it. The case declares no `[model]`, no
`[[reference]]`, no `[build]`, and no `[[check]]`: it is judged subjectively
against the brief.

## Details

- Field: 48×64×32 volume, transparent background, looping (`loop = true`),
  2000 ms at 60 fps.
- Directionality: the water spawns as a sheet across the top edge (high `y`) and
  falls downward toward `-y`, breaking into spray at the base (low `y`).
- Palette: falling water (`#a9d8f5` → `#2f6ea6`), white foam / spray
  (`#f4fbff` → `#cfe8f8`), pale drifting mist (`#b9ccd6` → `#7f95a2`). Cool
  water only, with no warm or saturated hues.
- Difficulty: medium. Tags: vfx, particle, 3d, water.
- Variants: one, `base`.
