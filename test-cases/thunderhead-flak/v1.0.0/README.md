# thunderhead-flak

An **asset-generation** test case (`asset_kind = "particle-3d"`): author the
*Thunderhead* **anti-air flak burst** as a volumetric particle **system**,
simulated live.

Thunderhead is a naval fleet-command game; this is the mid-air puff a proximity
shell makes when it detonates near an aircraft — a brief white-hot core, an
outward burst of hot sparks, and a lingering dark smoke puff that drifts and
dissipates. The model does **not** place particles: it authors an emitter system
(emitters, forces, and per-particle size/opacity/color curves) with the
`particle-3d` binary, one recorded operation at a time. The review UI and the game
**simulate that system live**, so the effect varies slightly from one play to the
next — the character of the burst is what is judged, not a frozen frame.

## Layout

```text
v1.0.0/
  test-case.toml      # manifest: type, asset_kind, [particle], [tool], [output], domains, review items
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

- **Field:** 48×48×48 volume, transparent background, one-shot (`loop = false`),
  ~1500 ms at 60 fps.
- **Palette:** white-hot core (`#fff4d6` → `#ff8a2a`), hot sparks (`#ff6a1a` →
  `#c0300c`), grey-black smoke (`#5a5a5e` → `#1a1a1c`).
- **Difficulty:** medium. **Tags:** asset-generation, particle, vfx, 3d.
- **Variants:** one — `base`.
