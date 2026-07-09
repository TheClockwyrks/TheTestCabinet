# Sunfront Heavy-Cannon Muzzle Flash — particle brief

You are authoring the **heavy-cannon muzzle flash** for *Sunfront*, a real-time
tug-of-war of solar-powered war automatons — the big, smoky blast that belches from
the barrel of a **heavy cannon or mortar** as one of the game's artillery and
capstone units fires. It is a **one-shot** effect: **one blast per shot**. The
game plays a fresh instance each time a unit fires, in sync with its firing cadence,
so the flash rate matches how fast the unit shoots. You are authoring the *effect* as
a **system**, not a single frozen frame.

## The field

- A **36×36×48** volume, transparent background. `x` is across, `y` is **up**, `z`
  is depth; **forward is `+z`**. The blast is **directional**: author it firing
  **forward along `+z`** from a muzzle point near the **rear (low `z`)** of the
  volume, so the flame, embers, and smoke have room to project out toward the front.
  The game anchors this effect to each firing unit's muzzle and orients it along the
  barrel, so it must read as a heavy-gun blast from **any orbit angle**, not just
  one face.
- The effect is a **one-shot** (`loop = false`): it **fires at the start and decays
  cleanly to empty** by the end of the seeded `duration_ms`. There is no steady state
  to settle into — this is a single shot's blast, which the game replays once per shot
  a unit fires.
- Keep the muzzle origin toward the back so the forward blast and its smoke plume
  have room to develop without instantly clipping the front face. This is a big gun
  flash, so it fills more of the volume than a small-arms flash — but it is still a
  muzzle blast, not an explosion centred in the volume.

## What the effect depicts

At a glance it reads as a **single heavy shot**: a big, bright bloom at the muzzle, a
forward **gout of orange flame and heavy embers** thrown out the barrel, and a
**thick, rolling grey-black smoke plume** that billows forward and up and lingers.
It is bigger and far smokier than a small-arms flash. It is **not** a ground
fireball, an airburst, or an omnidirectional explosion — it is a heavy,
**forward-directed** muzzle blast for one shot.

## Lifecycle over the duration

Describe the effect against real time over its `duration_ms`, as a single heavy shot
that decays to empty:

- **Ignition (0 – ~120 ms):** the **blast core** blooms big and bright at the muzzle
  — a heavy, hot bloom — and the **flame and embers** are thrown forward in the same
  instant. This is the brightest, heaviest moment.
- **Expansion (~120 – ~450 ms):** the blast dies away (the barrel does not glow after
  the shot), while the **flame and embers** arc **forward**, slow under drag, and
  fall under gravity as they burn out; the **smoke plume** rises and rolls, billowing
  forward and up.
- **Dissipation (~450 ms – end):** the embers are gone; the rolling **smoke plume**
  is the last thing left — it greys toward black, thins, and **fades to nothing**. By
  the end of `duration_ms` the volume is empty.

There is no steady state and no seamless loop: the blast fires once, hard, at the
start and the volume is empty by the end. The game supplies repetition by replaying
the whole effect once per shot.

## The emitters (conceptual)

Author these as separate emitters so each layer reads distinctly. These are intent,
not exact flags — read the binary's `--help` for the real operations:

- **Blast core** — a big, white-hot bloom at the muzzle: a **burst** of a few large
  particles at the shot instant (roughly the first frame) with a **short particle
  lifetime** (~80–180 ms), tight to the muzzle point, that flares big and dies. This
  is the blast itself.
- **Flame & embers** — a **burst** of a forward gout at the shot instant, fired
  **forward along `+z`** in a **moderate cone**: larger orange flame particles up
  close plus **heavier hot embers** thrown further, fast at birth, with a
  short-to-medium lifetime so they spit out, arc down, and burn away. These are the
  belch of fire and shrapnel.
- **Smoke plume** — a **burst** of larger, slow smoke particles at (or a hair after)
  the shot instant, with the **longest** lifetime of the three, so a thick plume
  billows and lingers as the last thing to fade. Make it prominent — a rolling plume,
  not a wisp. An optional curl-noise **turbulence** scoped to the smoke gives it a
  believable rolling billow.

Use timed **bursts** (not a continuous rate) — this is a one-shot blast the game
replays per shot. An optional fixed random seed gives a repeatable look, but the
effect should read well whether or not the draws are pinned.

## The forces (conceptual)

Shape the motion with forces, applied globally or scoped per emitter:

- **Forward projection** — the blast, flame, and embers launch **forward along
  `+z`** (via their emission direction and speed), so the effect belches out the
  barrel rather than expanding as a ball. This is directional, **not** a radial
  explosion push.
- **Drag** — air resistance that bleeds speed over life, so the fast forward gout
  slows and settles instead of flying off in straight lines forever.
- **Gravity** — a **downward** pull, stronger than the small-arms flash, so the
  **heavy embers arc and fall** noticeably as they die rather than hanging straight.
- **Buoyancy on the smoke** — a gentle **upward** drift scoped to the smoke plume so
  it rises, rolls, and spreads as hot gas would, while the embers fall.

## Color, opacity & size over life

Each particle's look changes over its **normalized life** (birth → death) via the
per-particle curves:

- **Blast core:** starts **white-hot** and full-bright, shifts to **orange** as it
  fades; opacity eases out to zero; size may swell on ignition then shrink as it
  dies.
- **Flame & embers:** **hot orange**, bright at birth; each **fades and shrinks** as
  it dies toward a **deep ember**, so the forward gout dims and thins over its life
  rather than winking off abruptly.
- **Smoke:** starts a dim **grey**, **grows** larger as it billows, **greys toward
  black**, and its opacity **eases up briefly then fades all the way out** to
  nothing — it should never pop off at full opacity. The smoke stays the dimmest
  element throughout.

Ease the curves (rise/fall smoothly) rather than snapping between values.

## Palette

Use only these colors — stated as gradient stops over each particle's life, and as
the only hues allowed in the blast (no blues, greens, or purples; this is neutral
gunfire, not team-tinted):

| Role | Hex |
| --- | --- |
| White-hot blast | `#fff3d0` |
| Muzzle flame (orange) | `#ff8a2a` |
| Ember (deep) | `#b83c10` |
| Smoke (grey) | `#57534c` |
| Smoke (black) | `#201e1a` |

A natural read: the **blast** runs `#fff3d0` → `#ff8a2a`; the **flame and embers**
run `#ff8a2a` → `#b83c10`; the **smoke** runs `#57534c` → `#201e1a` as it fades.

## Working the tool

The `particle-3d` binary on your `PATH` is the only way to shape the effect, and
you **author a system**, not individual particles — emitters, forces, and
per-particle size/opacity/color curves that the review UI and the game **simulate
live**. Build it up in sensible layers: add the blast-core, flame-and-ember, and
smoke-plume emitters (as timed bursts at the shot instant); set the forces (forward
projection via emission, drag, a downward gravity, and the smoke's buoyancy, plus
optional turbulence on the smoke); then set each emitter's color gradient, opacity
curve, and size curve. Keep the timeline a **one-shot** so the effect fires once and
decays to empty (the game replays it per shot).

Rendering is **on request**: run `particle-3d render` to simulate the whole system
over its duration, write the preview `effect.gif`, and **emit the `system.json`
your result is built from** — you **must** render before you finish or the system
is empty. Because the simulation is **live and stochastic**, the effect **varies
slightly from play to play**; judge its *character* — the read, the single big blast, the
forward gout, the rolling smoke — across replays and from multiple orbit angles, not
any single frame. The field size, duration, and fps are already seeded in a config
beside your workspace, so no operation needs those flags. Run `particle-3d --help`
for the available operations (emitters, forces, per-particle curves, sub-emitters,
the timeline loop flag, and `render`) and `particle-3d <operation> --help` for each
one's exact flags.
