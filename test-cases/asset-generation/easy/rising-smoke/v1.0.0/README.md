# rising-smoke

An **asset-generation** test case (`asset_kind = "particle-3d"`): author a **Rising
Smoke Column** as a volumetric, **continuously looping** particle **system**,
simulated live.

A steady column of soft grey smoke rises from a point source — the calm, ambient
plume that drifts up from a chimney or a smouldering ember: puffs billow upward,
expand and slow as they climb, curl turbulently with a slight sideways sway, and thin
to nothing near the top. It is a **continuous, seamless loop** — a stream already in
steady state, so the last frame flows back into the first with no visible seam. The
model does **not** place particles: it authors an emitter system (emitters, forces,
and per-particle size/opacity/color curves) with the `particle-3d` binary, one
recorded operation at a time. The review UI **simulates that system live**, so the
effect varies slightly from one play to the next — the character of the plume is what
is judged, not a frozen frame.

This is a generic, reusable ambient VFX case: a neutral smoke column with no ties to
any particular game, faction, or setting.

## Layout

```text
v1.0.0/
  test-case.toml      # manifest: type, asset_kind, [particle]/[tool]/[output], domain
  prompt.hbs          # the instruction rendered per run (NOT seeded)
  description.md      # site-facing blurb (NOT seeded)
  README.md           # this file (NOT seeded)
  specs/brief.md      # the self-contained brief — SEEDED
  variants/base.toml  # the single default variant
```

## What a run receives

Only the seeded brief (`specs/brief.md`) and, from the orchestrator, a
`particle-3d.config.json` carrying the `[particle]` field dimensions, the duration
and playback fps, and the log / preview / `system.json` paths. There is **no target
clip** and **no simulation seed** — the model authors a system to match the brief,
not to reproduce a supplied effect. The `particle-3d` binary is on the run's `PATH`;
its `--help` is the operations contract (no operations schema is seeded).

## What is produced

The recorded `actions.json` operation log is the authoritative output. On
`particle-3d render`, core emits the authored **`system.json`** (the
emitter/force/curve definition) and a preview `effect.gif`; the effect is
**simulated live** from `system.json`, never baked. The case declares **no
`[model]`**, **no `[[reference]]`**, no `[build]`, and no `[[check]]`: it is judged
subjectively against the brief.

## Details

- **Field:** 32×64×32 volume, transparent background, **continuous loop**
  (`loop = true`), 3000 ms at 60 fps (a steady stream that tiles seamlessly).
- **Directionality:** the smoke rises upward along `+y` from a point source near the
  bottom-center of the volume, widening as it climbs.
- **Palette:** neutral greys — light grey at the source (`#cfccc6`), through mid grey
  (`#908d87`), thinning to a faint dark grey (`#4c4a46`) near the top. No warm fire
  tint.
- **Difficulty:** easy. **Tags:** vfx, particle, 3d, smoke.
- **Variants:** one — `base`.
