# Sunfront Small-Arms Muzzle Flash — `v1.0.0`

This is version `v1.0.0` of the **Sunfront Small-Arms Muzzle Flash** test case:
an asset-generation case (`asset_kind = "particle-3d"`) that asks a model to
author the _Sunfront_ small-arms muzzle flash as a volumetric, one-shot particle
system, simulated live.

Sunfront is a real-time tug-of-war of solar-powered war automatons. This is the
hot flash that spits from the barrel of a rifle or light autocannon as a unit
fires: a white-hot bloom at the muzzle, a short forward spit of hot sparks, and a
faint smoke wisp. It is a one-shot flash, one shot's worth, that fires and decays
to empty; the game replays it once per shot, in sync with the firing unit's
cadence, so the flash rate matches the unit's fire rate.

The model authors an emitter system with the `particle-3d` binary, one recorded
operation at a time: emitters, forces, and per-particle size, opacity, and color
curves. The review UI and the game simulate that system live, so the effect
varies slightly from one play to the next and the character of the flash is what
is judged.

This is one of Sunfront's shared muzzle-flash effects, the small-arms flash used
by its rifle and light-gun units. The heavy-cannon and energy-lance flashes are
their own cases.

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
is no target clip and no simulation seed: the model authors a system to match the
brief. The `particle-3d` binary is on the run's `PATH`, and its `--help` is the
operations contract; no operations schema is seeded.

## What is produced

The recorded `actions.json` operation log is the authoritative output. On
`particle-3d render`, core emits the authored `system.json` and a preview
`effect.gif`. The `system.json` is the emitter, force, and curve definition. The
effect is simulated live from `system.json` and never baked. The case declares no
`[model]`, no `[[reference]]`, no `[build]`, and no `[[check]]`: it is judged
subjectively against the brief.

## Details

- Field: 24×24×32 volume, transparent background, one-shot (`loop = false`),
  300 ms at 60 fps, one flash decaying to empty.
- Directionality: the flash fires forward along `+z` from a muzzle point near the
  rear of the volume; the consuming game anchors and orients it to each unit's
  muzzle.
- Palette: white-hot flash (`#fff3d0` → `#ffd873`), hot sparks (`#ff8a3a` →
  `#c24a12`), faint grey smoke (`#6a6660` → `#2a2824`). Neutral gunfire, with no
  team tint.
- Difficulty: easy. Tags: asset-generation, particle, 3d, vfx, muzzle-flash.
- Variants: one — `base`.
