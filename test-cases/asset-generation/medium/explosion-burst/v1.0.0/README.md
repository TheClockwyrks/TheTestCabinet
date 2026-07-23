# explosion-burst

An **asset-generation** test case (`asset_kind = "particle-3d"`): author a generic
action-game **explosion** as a volumetric, **one-shot** particle **system**,
simulated live.

This is the burst a game plays whenever something detonates — a shell impact, a fuel
barrel, a grenade: a blinding overexposed white flash, a fast-expanding fireball that
cools from hot orange toward dark smoke, a radial spray of hot sparks thrown out in
every direction, and a dark smoke puff that rises and fades. It is a **one-shot**
burst that fires hard and decays to empty; the game plays a fresh instance once per
detonation. The model does **not** place particles: it authors an emitter system
(emitters, forces, and per-particle size/opacity/color curves) with the `particle-3d`
binary, one recorded operation at a time. The review UI and the game **simulate that
system live**, so the effect varies slightly from one play to the next — the
character of the explosion is what is judged, not a frozen frame.

This is a reusable, general-purpose explosion, not tied to any particular game,
weapon, or object.

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

- **Field:** 48×48×48 cubic volume, transparent background, **one-shot**
  (`loop = false`), 900 ms at 60 fps (one burst, decaying to empty).
- **Directionality:** the explosion detonates at the **center** and throws particles
  **radially outward** in every direction — a spherical burst, legible from any orbit
  angle.
- **Palette:** overexposed white flash (`#fff6e6` → `#ffd24a`), fireball cooling
  (`#ffd24a` → `#ff6a14` → `#211e1a`), hot sparks (`#ffa338` → `#a2320b`), dark smoke
  (`#4c4740` → `#211e1a`). Warm fire — no cool hues.
- **Difficulty:** medium. **Tags:** vfx, particle, 3d, explosion.
- **Variants:** one — `base`.
