# Sunfront Small-Arms Muzzle Flash — particle brief

You are authoring the **small-arms muzzle flash** for *Sunfront*, a real-time
tug-of-war of solar-powered war automatons — the hot flash that spits from the
barrel of a **rifle or light autocannon** as one of the game's infantry and
light-gunner units fires. It is a **one-shot** effect: **one flash per shot**. The
game plays a fresh instance each time a unit fires, in sync with its firing cadence,
so the flash rate matches how fast the unit shoots. You are authoring the *effect* as
a **system**, not a single frozen frame.

## The field

- A **24×24×32** volume, transparent background. `x` is across, `y` is **up**, `z`
  is depth; **forward is `+z`**. The flash is **directional**: author it firing
  **forward along `+z`** from a muzzle point near the **rear (low `z`)** of the
  volume, so the flash and sparks have room to project out toward the front. The
  game anchors this effect to each firing unit's muzzle and orients it along the
  barrel, so it must read as a muzzle flash from **any orbit angle**, not just one
  face.
- The effect is a **one-shot** (`loop = false`): it **fires at the start and decays
  cleanly to empty** by the end of the seeded `duration_ms`. There is no steady state
  to settle into — this is a single shot's flash, which the game replays once per shot
  a unit fires.
- Keep the muzzle origin toward the back so the forward spray does not immediately
  clip the front face, and keep the whole effect **compact** — this is a gun flash,
  not an explosion that fills the volume.

## What the effect depicts

At a glance it reads as a **single gunshot**: a bright, hot flash blooming at the
muzzle, a short spit of small hot sparks thrown **forward** out the barrel, and a
thin, faint wisp of smoke drifting off. It is **not** a big explosion, a ground
fireball, or an omnidirectional burst — it is a small, sharp, **forward-directed**
muzzle flash for one shot.

## Lifecycle over the duration

Describe the effect against real time over its `duration_ms`, as a single shot that
decays to empty:

- **Ignition (0 – ~40 ms):** the **flash core** blooms on hard at the muzzle — a
  bright, hot bloom — and the **sparks** spit forward in the same instant. This is
  the brightest moment.
- **Spit (~40 – ~200 ms):** the flash dies away fast (the barrel does not glow after
  the shot), while the sparks arc **forward**, slow under drag, and burn out, leaving
  a brief forward spray.
- **Settle (~200 ms – end):** the sparks are gone; the faint **smoke wisp** is the
  last thing left — a thin haze that drifts off, thins, and **fades to nothing**. By
  the end of `duration_ms` the volume is empty.

## The emitters (conceptual)

Author these as separate emitters so each layer reads distinctly. These are intent,
not exact flags — read the binary's `--help` for the real operations:

- **Flash core** — a bright, white-hot bloom at the muzzle: a small **burst** of a
  few particles at the shot instant (roughly the first frame) with a **very short
  lifetime** (~40–90 ms), tight to the muzzle point, that flares and dies. This is
  the flash itself.
- **Forward sparks** — a **burst** of small hot sparks at the shot instant, fired
  **forward along `+z`** in a **tight cone**, fast at birth, with a short lifetime so
  they spit out, slow, and burn away. These are the light shrapnel of the shot.
- **Smoke wisp** — a small **burst** of a few slow, faint smoke particles at (or a
  hair after) the shot instant, with the **longest** lifetime of the three, so a thin
  haze lingers and is the last thing to fade. Keep it sparse and dim — a wisp, not a
  plume.

Use timed **bursts** (not a continuous rate) — this is a one-shot flash, not a
sustained stream; the game replays the whole effect per shot. An optional fixed
random seed gives a repeatable look, but the effect should read well whether or not
the draws are pinned.

## The forces (conceptual)

Shape the motion with forces, applied globally or scoped per emitter:

- **Forward projection** — the flash and sparks launch **forward along `+z`** (via
  their emission direction and speed), so the effect spits out the barrel rather
  than expanding as a ball. This is directional, **not** a radial explosion push.
- **Drag** — air resistance that bleeds spark speed over life, so the fast forward
  spit slows and settles instead of flying off in straight lines forever.
- **A light gravity** — a gentle **downward** pull so the spent sparks droop a
  little as they die, rather than hanging perfectly straight. Keep it weak; these
  are fast and short-lived.
- **Buoyancy on the smoke** — a gentle **upward** drift scoped to the smoke wisp so
  the haze rises and thins as hot gas would, while the sparks fall.

## Color, opacity & size over life

Each particle's look changes over its **normalized life** (birth → death) via the
per-particle curves:

- **Flash core:** starts **white-hot** and full-bright, shifts to a **hot yellow**
  as it fades; opacity eases out to zero fast; size may swell slightly on ignition
  then shrink as it dies. Very brief.
- **Sparks:** **hot orange**, bright at birth; each spark **fades and shrinks** as
  it dies, so the forward spray dims and thins over its short life rather than
  winking off abruptly.
- **Smoke wisp:** a dim, faint **grey** that **grows** a little as it drifts, thins
  toward a darker grey, and its opacity **eases up briefly then fades all the way
  out** to nothing — it should never pop off at full opacity. The smoke stays the
  dimmest element throughout.

Ease the curves (rise/fall smoothly) rather than snapping between values.

## Palette

Use only these colors — stated as gradient stops over each particle's life, and as
the only hues allowed in the flash (no blues, greens, or purples; this is neutral
gunfire, not team-tinted):

| Role | Hex |
| --- | --- |
| White-hot flash | `#fff3d0` |
| Flash edge (yellow) | `#ffd873` |
| Hot spark (orange) | `#ff8a3a` |
| Spark ember (deep) | `#c24a12` |
| Smoke wisp (grey) | `#6a6660` |
| Smoke (thin, dark) | `#2a2824` |

A natural read: the **flash** runs `#fff3d0` → `#ffd873`; the **sparks** run
`#ff8a3a` → `#c24a12`; the **smoke** runs `#6a6660` → `#2a2824` as it fades.

## Working the tool

The `particle-3d` binary on your `PATH` is the only way to shape the effect, and
you **author a system**, not individual particles — emitters, forces, and
per-particle size/opacity/color curves that the review UI and the game **simulate
live**. Build it up in sensible layers: add the flash-core, forward-spark, and
smoke-wisp emitters (as timed bursts at the shot instant); set the forces (forward
projection via emission, drag, light gravity, and the smoke's buoyancy); then set
each emitter's color gradient, opacity curve, and size curve. Keep the timeline a
**one-shot** so the effect fires once and decays to empty (the game replays it per
shot).

Rendering is **on request**: run `particle-3d render` to simulate the whole system
over its duration, write the preview `effect.gif`, and **emit the `system.json`
your result is built from** — you **must** render before you finish or the system
is empty. Because the simulation is **live and stochastic**, the effect **varies
slightly from play to play**; judge its *character* — the read, the single bright
flash, the forward spit — across replays and from multiple orbit angles, not any
single frame. The field size, duration, and fps are already seeded in a config
beside your workspace, so no operation needs those flags. Run `particle-3d --help`
for the available operations (emitters, forces, per-particle curves, sub-emitters,
the timeline loop flag, and `render`) and `particle-3d <operation> --help` for each
one's exact flags.
