# Sunfront Small-Arms Muzzle Flash — particle brief

You are authoring the **small-arms muzzle flash** for *Sunfront*, a real-time
tug-of-war of solar-powered war automatons — the hot flash that spits from the
barrel of a **rifle or light autocannon** as one of the game's infantry and
light-gunner units fires. It is a **looping**, continuous effect: the weapon fires
in a sustained stutter, so the flash **plays continuously** at the muzzle for as
long as the unit is shooting, rather than as one isolated pop. You are authoring
the *effect* as a **system**, not a single frozen frame.

## The field

- A **24×24×32** volume, transparent background. `x` is across, `y` is **up**, `z`
  is depth; **forward is `+z`**. The flash is **directional**: author it firing
  **forward along `+z`** from a muzzle point near the **rear (low `z`)** of the
  volume, so the flash and sparks have room to project out toward the front. The
  game anchors this effect to each firing unit's muzzle and orients it along the
  barrel, so it must read as a muzzle flash from **any orbit angle**, not just one
  face.
- The effect **loops** (`loop = true`): it has **no decay to empty**. Over the
  seeded `duration_ms` it settles into a **steady state** — a rapid, repeating
  stutter of muzzle flashes — that reads the same at the start of the loop as at
  the end, so the loop is seamless.
- Keep the muzzle origin toward the back so the forward spray does not immediately
  clip the front face, and keep the whole effect **compact** — this is a gun
  flash, not an explosion that fills the volume.

## What the effect depicts

At a glance it reads as a **gun firing**: a bright, hot flash blooming at the
muzzle in a rapid stutter, a short spit of small hot sparks thrown **forward** out
the barrel, and a thin, faint haze of smoke drifting off. It is **not** a big
explosion, a ground fireball, or an omnidirectional burst — it is a small, sharp,
**forward-directed** muzzle flash that keeps repeating while the trigger is held.

## Lifecycle — a continuous loop

Because this effect **loops**, describe its **steady state** rather than a one-shot
arc. Across the `duration_ms` the muzzle holds a repeating firing cadence:

- **Each flash** blooms fast and dies fast — a bright bloom at the muzzle that is
  gone within ~40–90 ms, so the barrel appears to **stutter** rather than glow
  steadily. Flashes recur several times over the loop.
- **Sparks** spit forward with each flash — small, fast, hot, thrown out in a
  **tight forward cone** — then slow, dim, and burn out within a short lifetime, so
  a light forward spray is always present but never piles up.
- **Smoke** is a faint, thin haze born at the muzzle that drifts slowly off and
  **thins to nothing**, keeping a soft wisp around the barrel without ever building
  into a cloud.

At every moment of the loop there is a flash mid-bloom or just fading, a little
forward spark spray, and a faint smoke wisp — the steady state of a firing gun.
There is no final frame where the volume empties.

## The emitters (conceptual)

Author these as separate emitters so each layer reads distinctly. These are intent,
not exact flags — read the binary's `--help` for the real operations:

- **Flash core** — a bright, white-hot bloom at the muzzle. Emit it **continuously**
  at a rate (this is a looping, sustained effect, not a single burst) but with a
  **very short particle lifetime** (~40–90 ms) so the muzzle stutters bright-and-out
  rather than glowing solid. A few particles per flash, tight to the muzzle point.
- **Forward sparks** — small hot sparks emitted continuously from the muzzle, fired
  **forward along `+z`** in a **tight cone**, fast at birth, with a short lifetime so
  they spit out, slow, and burn away. These are the light shrapnel of the shot.
- **Smoke wisp** — a small, slow, faint smoke particle emitted at a **low** rate at
  the muzzle, with the **longest** lifetime of the three, so a thin haze lingers and
  drifts off. Keep it sparse and dim — a wisp, not a plume.

Use a **continuous rate** for all three (not one-shot bursts) — this is a sustained,
looping muzzle flash. An optional fixed random seed gives a repeatable look, but the
effect should read well whether or not the draws are pinned.

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
smoke-wisp emitters; set the forces (forward projection via emission, drag, light
gravity, and the smoke's buoyancy); then set each emitter's color gradient, opacity
curve, and size curve. Make sure the timeline is set to **loop** so the effect
sustains rather than decaying to empty.

Rendering is **on request**: run `particle-3d render` to simulate the whole system
over its duration, write the preview `effect.gif`, and **emit the `system.json`
your result is built from** — you **must** render before you finish or the system
is empty. Because the simulation is **live and stochastic**, the effect **varies
slightly from play to play**; judge its *character* — the read, the stutter, the
forward spit — across replays and from multiple orbit angles, not any single frame.
The field size, duration, and fps are already seeded in a config beside your
workspace, so no operation needs those flags. Run `particle-3d --help` for the
available operations (emitters, forces, per-particle curves, sub-emitters, the
timeline loop flag, and `render`) and `particle-3d <operation> --help` for each
one's exact flags.
