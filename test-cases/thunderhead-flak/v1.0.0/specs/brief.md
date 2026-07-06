# Thunderhead Flak Burst — particle brief

You are authoring the **anti-air flak burst** for *Thunderhead*, a naval
fleet-command game — the mid-air puff a proximity shell makes when it detonates
near an aircraft. It is a **one-shot** volumetric effect: a brief fiery
detonation, an outward burst of hot sparks and shrapnel, and a lingering dark
smoke puff that drifts and dissipates. You are authoring the *effect* as a
**system**, not a single frozen frame.

## The field

- A **48×48×48** volume, transparent background. `x` is across, `y` is **up**, `z`
  is depth; forward is `+z`. The burst is centered in the volume so it reads from
  any orbit angle — the review UI and the game render it from an **orbiting 3D
  camera**, so it must read as a flak burst from every side, not just from one
  face.
- The effect runs for **~1500 ms** at **60 fps** and does **not loop**: it is a
  one-shot detonation that fires at the start and **decays cleanly to empty** by
  the end. There is no steady state to settle into.
- Center the detonation roughly at the middle of the volume so the spark burst has
  room to expand and the smoke has room to rise without immediately clipping the
  top.

## What the effect depicts

At a glance it reads as a **mid-air anti-air shell detonation**: a hard, bright
flash at the center, a spray of small hot sparks thrown outward in every
direction, and a soft, dark smoke puff that swells, rises, and thins away. It is
**not** a ground fireball, a muzzle flash, or an abstract glowing sphere — it is a
compact airburst hanging in open sky.

## Lifecycle over the 1.5 seconds

Describe the effect against real time over its `duration_ms`:

- **Detonation (0 – ~150 ms):** the **core** flashes on hard — a small, intense,
  white-hot burst at the center — and the **sparks** fire outward as a single
  radial burst in the same instant. This is the brightest, busiest moment.
- **Expansion (~150 – ~700 ms):** the core fades quickly from white-hot to orange
  and dies. The sparks arc outward and then **fall and slow** — thrown out by the
  detonation, dragged down by gravity and bled of speed by air drag, leaving short
  trailing streaks. The **smoke** puff, born at the detonation, begins to swell and
  drift.
- **Dissipation (~700 – 1500 ms):** the sparks have mostly burned out. The
  **smoke** is the last thing left — a grey-black puff that has risen a little on
  buoyancy, spread as it slowed, greyed toward black, and **fades to nothing**. By
  the end of the duration the volume is empty.

## The emitters (conceptual)

Author these as separate emitters so each stage reads distinctly. These are
intent, not exact flags — read the binary's `--help` for the real operations:

- **Core flash** — a small, short-lived central **burst** of a few particles at
  the detonation instant (roughly the first frame), white-hot, that flares and
  dies within ~150–250 ms. This is the ignition.
- **Spark burst** — a **burst** of many small sparks fired outward from the center
  in all directions (a wide, near-spherical cone) at the detonation instant, fast
  at first, with a short-to-medium lifetime so they arc out, fall, and burn away.
  These are the hot shrapnel.
- **Smoke puff** — a smaller **burst** of a few large, slow smoke particles at the
  center, born at (or a hair after) the detonation, with the **longest** lifetime
  so it lingers after the fire is gone and is the last thing to fade.

Use timed **bursts** (not a continuous rate) — this is a one-shot detonation, not
a sustained plume. An optional fixed random seed gives a repeatable look, but the
effect should read well whether or not the draws are pinned.

## The forces (conceptual)

Shape the motion with forces, applied globally or scoped per emitter:

- **Gravity** — pulls the sparks (and, weakly, the settling smoke) **down** so the
  burst arcs and falls rather than expanding forever.
- **Drag** — air resistance that bleeds particle speed over life, so the fast
  initial spray slows into a hanging puff instead of flying off in straight lines.
- **A radial push** — an outward explosion force from the detonation center that
  throws the sparks out hard at the start.
- **Buoyancy** — a gentle **upward** lift on the **smoke** (a negative or
  upward-directed gravity scoped to the smoke emitter) so the puff rises and
  spreads as hot gas would, while the sparks fall.

## Color, opacity & size over life

Each particle's look changes over its **normalized life** (birth → death) via the
per-particle curves:

- **Core:** starts **white-hot** and full-bright, then shifts to **orange** as it
  fades; opacity eases out to zero and size may swell slightly then shrink as it
  dies.
- **Sparks:** **hot orange**, bright at birth; each spark **fades and shrinks** as
  it dies, so the spray dims and thins over its short life rather than winking off
  abruptly.
- **Smoke:** starts a dim **grey**, **grows** larger as it drifts, **greys toward
  black**, and its opacity **eases up briefly then fades all the way out** to
  nothing — it should never pop off at full opacity. The smoke stays the dimmest
  element throughout.

Ease the curves (rise/fall smoothly) rather than snapping between values.

## Palette

Use only these colors — stated as gradient stops over each particle's life, and as
the only hues allowed in the burst (no blues, greens, or purples):

| Role | Hex |
| --- | --- |
| White-hot core | `#fff4d6` |
| Core burnout (orange) | `#ff8a2a` |
| Hot spark | `#ff6a1a` |
| Spark ember (deep) | `#c0300c` |
| Smoke (grey) | `#5a5a5e` |
| Smoke (black) | `#1a1a1c` |

A natural read: the **core** runs `#fff4d6` → `#ff8a2a`; the **sparks** run
`#ff6a1a` → `#c0300c`; the **smoke** runs `#5a5a5e` → `#1a1a1c` as it fades.

## Working the tool

The `particle-3d` binary on your `PATH` is the only way to shape the effect, and
you **author a system**, not individual particles — emitters, forces, and
per-particle size/opacity/color curves that the review UI and the game
**simulate live**. Build it up in sensible layers: add the core, spark, and smoke
emitters; set the forces (gravity, drag, radial push, and the smoke's buoyancy);
then set each emitter's color gradient, opacity curve, and size curve.

Rendering is **on request**: run `particle-3d render` to simulate the whole system
over its duration, write the preview `effect.gif`, and **emit the `system.json`
your result is built from** — you **must** render before you finish or the system
is empty. Because the simulation is **live and stochastic**, the effect **varies
slightly from play to play**; judge its *character* — the read, the timing, the
motion — across replays and from multiple orbit angles, not any single frame. The
field size, duration, and fps are already seeded in a config beside your
workspace, so no operation needs those flags. Run `particle-3d --help` for the
available operations (emitters, forces, per-particle curves, sub-emitters, the
timeline loop flag, and `render`) and `particle-3d <operation> --help` for each
one's exact flags.
