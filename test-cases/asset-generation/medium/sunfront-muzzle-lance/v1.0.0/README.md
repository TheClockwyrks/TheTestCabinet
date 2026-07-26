# sunfront-muzzle-lance

An **asset-generation** test case (`asset_kind = "particle-3d"`): author the
*Sunfront* **rail-lance muzzle flash** as a volumetric, **one-shot** particle
**system**, simulated live.

Sunfront is a real-time tug-of-war of solar-powered war automatons; this is the
thin, searing energy discharge that flares from the tip of a rail-lance as the
marksman unit fires — a bright white-gold flash, a thin streaked forward bolt of
energy, and a flicker of crackle motes, with no smoke or flame. It is a **one-shot**
discharge (one shot's worth) that fires and decays to empty; the game replays it once
per shot, in sync with the firing unit's cadence, so the flash rate matches the
unit's fire rate. The model does **not** place particles: it authors an emitter
system (emitters, forces, and per-particle size/opacity/color curves) with the
`particle-3d` binary, one recorded operation at a time. The review UI and the game
**simulate that system live**, so the effect varies slightly from one play to the
next — the character of the discharge is what is judged, not a frozen frame.

This is one of Sunfront's shared muzzle-flash effects (the energy-lance discharge
used by its rail-lance marksman); the small-arms and heavy-cannon flashes are their
own cases.

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
and playback fps, and the log / preview / `system.json` paths. There is **no
target clip** and **no simulation seed** — the model authors a system to match the
brief, not to reproduce a supplied effect. The `particle-3d` binary is on the run's
`PATH`; its `--help` is the operations contract (no operations schema is seeded).

## What is produced

The recorded `actions.json` operation log is the authoritative output. On
`particle-3d render`, core emits the authored **`system.json`** (the
emitter/force/curve definition) and a preview `effect.gif`; the effect is
**simulated live** from `system.json`, never baked. The case declares **no
`[model]`**, **no `[[reference]]`**, no `[build]`, and no `[[check]]`: it is judged
subjectively against the brief.

## Details

- **Field:** 20×20×44 volume, transparent background, **one-shot** (`loop = false`),
  400 ms at 60 fps (one discharge, decaying to empty).
- **Directionality:** the bolt fires forward along `+z` from a lance tip near the
  rear of the volume; the consuming game anchors and orients it to the unit's lance.
- **Palette:** searing white core (`#fffdf5`), hot gold energy (`#ffd24a`), amber
  edge (`#ff9e2c`), deep amber fade (`#d4661a`). Warm solar-energy — no smoke, no
  fire-orange, no team tint.
- **Difficulty:** medium. **Tags:** asset-generation, particle, 3d, vfx,
  muzzle-flash.
- **Variants:** one — `base`.
