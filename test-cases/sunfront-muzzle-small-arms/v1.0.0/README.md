# sunfront-muzzle-small-arms

An **asset-generation** test case (`asset_kind = "particle-3d"`): author the
*Sunfront* **small-arms muzzle flash** as a volumetric, **looping** particle
**system**, simulated live.

Sunfront is a real-time tug-of-war of solar-powered war automatons; this is the hot
flash that spits from the barrel of a rifle or light autocannon as a unit fires — a
stuttering white-hot bloom at the muzzle, a short forward spit of hot sparks, and a
faint smoke wisp. Unlike a one-shot explosion, the effect **loops**: it plays
continuously while a unit is firing. The model does **not** place particles: it
authors an emitter system (emitters, forces, and per-particle size/opacity/color
curves) with the `particle-3d` binary, one recorded operation at a time. The review
UI and the game **simulate that system live**, so the effect varies slightly from
one play to the next — the character of the flash is what is judged, not a frozen
frame.

This is one of Sunfront's shared muzzle-flash effects (the small-arms flash used by
its rifle and light-gun units); the heavy-cannon and energy-lance flashes are their
own cases.

## Layout

```text
v1.0.0/
  test-case.toml      # manifest: type, asset_kind, [particle]/[tool]/[output], domains, review
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

- **Field:** 24×24×32 volume, transparent background, **looping** (`loop = true`),
  600 ms loop window at 60 fps.
- **Directionality:** the flash fires forward along `+z` from a muzzle point near
  the rear of the volume; the consuming game anchors and orients it to each unit's
  muzzle.
- **Palette:** white-hot flash (`#fff3d0` → `#ffd873`), hot sparks (`#ff8a3a` →
  `#c24a12`), faint grey smoke (`#6a6660` → `#2a2824`). Neutral gunfire — no team
  tint.
- **Difficulty:** easy. **Tags:** asset-generation, particle, 3d, vfx,
  muzzle-flash.
- **Variants:** one — `base`.
