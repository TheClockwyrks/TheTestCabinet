# arcane-nova

An **asset-generation** test case (`asset_kind = "particle-3d"`): author an **arcane
nova** as a volumetric, **one-shot** particle **system**, simulated live.

An arcane nova is a burst of magic cast once — the flash of energy that erupts when a
spell detonates at a point on the ground: a bright white flash at the center, a thin
ring of energy sweeping outward across the ground, a fountain of glowing rune-spark
motes launched upward, and a soft glow that blooms and fades. It is a **one-shot**
cast (one nova's worth) that bursts and decays to empty; the game replays it whole
each time the spell is cast. The model does **not** place particles: it authors an
emitter system (emitters, forces, and per-particle size/opacity/color curves) with
the `particle-3d` binary, one recorded operation at a time. The review UI and the
game **simulate that system live**, so the effect varies slightly from one play to
the next — the character of the nova is what is judged, not a frozen frame.

This is a generic, reusable magic-VFX effect: a stock spell nova with no ties to any
particular game, faction, or setting.

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

- **Field:** 48×48×48 volume, transparent background, **one-shot** (`loop = false`),
  800 ms at 60 fps (one cast, decaying to empty).
- **Geometry:** cast at the center of the ground plane (`y` is up); the ring sweeps
  outward radially across the ground while the rune sparks fountain up along `+y` and
  arc back under gravity. Radially symmetric — it reads from any orbit angle.
- **Palette:** cool arcane — white flash (`#f2ecff`), cyan-to-violet ring (`#4fe3ff`
  → `#8a4dff`), pale-violet sparks (`#cdb4ff` → `#3a1c78`), soft violet glow
  (`#5a3fa8`). No warm fire colors, no greens.
- **Difficulty:** medium. **Tags:** vfx, particle, 3d, magic.
- **Variants:** one — `base`.
