# Sunfront Heavy-Cannon Muzzle Flash — `v1.0.0`

An asset-generation test case (`asset_kind = "particle-3d"`): author the
Sunfront heavy-cannon muzzle flash as a volumetric, one-shot particle system,
simulated live.

Sunfront is a real-time tug-of-war of solar-powered war automatons, and this is
the big, smoky blast that belches from the barrel of a heavy cannon or mortar as
a unit fires: a big white-hot bloom at the muzzle, a forward gout of orange
flame and heavy embers, and a thick rolling smoke plume. It is a one-shot blast
that fires and decays to empty. The game replays it once per shot, in sync with
the firing unit's cadence, so the flash rate matches the unit's fire rate.

The model authors an emitter system with the `particle-3d` binary, one recorded
operation at a time, defining emitters, forces, and per-particle size, opacity,
and color curves. The review UI and the game simulate that system live, so the
effect varies slightly from one play to the next and the character of the blast
is what is judged.

This is one of Sunfront's shared muzzle-flash effects, the heavy-cannon blast
used by its artillery and capstone units. The small-arms and energy-lance
flashes are their own cases.

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
the operations contract, with no operations schema seeded.

## What is produced

The recorded `actions.json` operation log is the authoritative output. On
`particle-3d render`, core emits the authored `system.json` holding the
emitter, force, and curve definitions, plus a preview `effect.gif`. The effect
is simulated live from `system.json`, never baked. The case declares no
`[model]`, `[[reference]]`, `[build]`, or `[[check]]`, and is judged
subjectively against the brief.

## Details

- Field — 36×36×48 volume, transparent background, one-shot (`loop = false`),
  800 ms at 60 fps, one blast decaying to empty.
- Directionality — the blast fires forward along `+z` from a muzzle point near
  the rear of the volume, and the consuming game anchors and orients it to each
  unit's muzzle.
- Palette — white-hot blast (`#fff3d0`), hot-orange flame and embers
  (`#ff8a2a` → `#b83c10`), grey-black smoke (`#57534c` → `#201e1a`). Neutral
  gunfire, with no team tint.
- Difficulty — medium. Tags: asset-generation, particle, 3d, vfx, muzzle-flash.
- Variants — one, `base`.
