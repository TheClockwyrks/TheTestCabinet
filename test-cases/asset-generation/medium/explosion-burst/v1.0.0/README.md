# Explosion Burst — `v1.0.0`

An asset-generation test case (`asset_kind = "particle-3d"`): author a generic
action-game explosion as a volumetric, one-shot particle system, simulated live.

This is the burst a game plays whenever something detonates: a shell impact, a
fuel barrel, a grenade. It is a blinding overexposed white flash, a
fast-expanding fireball that cools from hot orange toward dark smoke, a radial
spray of hot sparks thrown out in every direction, and a dark smoke puff that
rises and fades. The burst fires hard and decays to empty, and the game plays a
fresh instance once per detonation. It is a reusable, general-purpose explosion
tied to no particular game, weapon, or object.

The model authors an emitter system with the `particle-3d` binary, one recorded
operation at a time: emitters, forces, and per-particle size, opacity, and color
curves. The review UI and the game simulate that system live, so the effect
varies slightly from one play to the next, and the character of the explosion is
what a reviewer judges.

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
duration and playback fps, and the log, preview, and `system.json` paths. There
is no target clip and no simulation seed; the model authors a system to match
the brief. The `particle-3d` binary is on the run's `PATH`, and its `--help` is
the operations contract. No operations schema is seeded.

## What is produced

The recorded `actions.json` operation log is the authoritative output. On
`particle-3d render`, core emits the authored `system.json` and a preview
`effect.gif`. The `system.json` is the emitter, force, and curve definition, and
the effect is simulated live from it. The case declares no `[model]`, no
`[[reference]]`, no `[build]`, and no `[[check]]`; it is judged subjectively
against the brief.

## Details

- Field: 48×48×48 cubic volume, transparent background, one-shot
  (`loop = false`), 900 ms at 60 fps.
- Directionality: the explosion detonates at the center and throws particles
  radially outward in every direction, a spherical burst legible from any orbit
  angle.
- Palette: overexposed white flash (`#fff6e6` → `#ffd24a`), fireball cooling
  (`#ffd24a` → `#ff6a14` → `#211e1a`), hot sparks (`#ffa338` → `#a2320b`), dark
  smoke (`#4c4740` → `#211e1a`). Every tone is warm fire.
- Difficulty: medium. Tags: vfx, particle, 3d, explosion.
- Variants: one — `base`.
