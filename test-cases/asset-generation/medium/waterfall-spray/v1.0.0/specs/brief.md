# Waterfall Spray — particle brief

You are authoring a **looping waterfall**: a sheet of water falling from a ledge,
breaking into spray where it lands, with a low haze of mist drifting off. It is a
**steady-state** effect — the water is already falling and never stops. There is no
start and no end: the fall, the spray, and the mist are all in full flow from the
first frame to the last, and the effect **loops seamlessly** over its window. You are
authoring the *effect* as a **system**, not a single frozen frame.

## The field

- A **48×64×32** volume, transparent background. `x` is across, `y` is **up**, `z`
  is depth. The volume is **tall**: the height along `y` is the drop the water
  falls. Author the water **spawning at the top edge (high `y`)** and **falling
  downward toward `-y`**, breaking into spray as it nears the **base (low `y`)**. The
  effect is meant to be seen in the round — the water anchors to a ledge in a scene
  and is viewed from varied angles — so it must read as a waterfall from **any orbit
  angle**, not just one face.
- The water falls as a **sheet**, not a single thin stream: spread the emission
  across the width (`x`) and through the depth (`z`) near the top so a broad curtain
  of droplets pours down, filling the tall volume as it falls.
- The effect **loops** (`loop = true`): it is a continuous fall with **no fade-in,
  no fade-out, and no burst-and-die**. The tail of the seeded `duration_ms` window
  must flow continuously back into its head with no visible seam — no empty first
  frame, no moment where the water thins out or restarts.

## What the effect depicts

At a glance it reads as **falling water**: a broad sheet of blue droplets pouring
straight down, stretched into thin streaks by their speed, that break into a
billowing burst of **white spray** where they reach the base, with a faint **mist**
drifting low over the landing zone. It is **not** rain falling across the whole
frame, a fountain jetting upward, a splashing puddle, or an abstract blue wash — it
is a directed **downward** fall of water that shatters into spray at the bottom.

## The emitters (conceptual)

Author these as separate emitters so each layer reads distinctly. These are intent,
not exact flags — read the binary's `--help` for the real operations:

- **Falling sheet** — the water itself: a **continuous** stream of droplets spawned
  across the top edge (spread over `x`, and through `z`), given a downward initial
  velocity and left to accelerate under gravity, with a lifetime long enough to fall
  most of the height before they reach the base. This is the body of the waterfall,
  and it should be the densest layer.
- **Base spray** — where the falling water lands it shatters into froth: a
  **continuous** burst of small, fast, white spray particles near the base (low `y`),
  thrown **outward and up a little** so the spray billows off the landing line, with
  a short lifetime so it kicks up and fades quickly. You may spawn it as its own
  emitter sitting at the base, or as a **sub-emitter** that fires where the falling
  droplets die at the bottom — either way it must read as spray thrown up **by** the
  water hitting the base, present continuously in the steady-state loop.
- **Drifting mist** — the fine haze that hangs over a waterfall: a **sparse,
  continuous** emitter of slow, faint, pale mist particles low in the volume, with
  the **longest** lifetime of the three, drifting gently and thinning as it goes.
  Keep it dim and thin — a haze, not a cloud.

Emit at a continuous **rate** (not a one-shot burst) — this is a steady-state loop,
not a single splash. An optional fixed random seed gives a repeatable look, but the
effect should read well whether or not the draws are pinned.

## The forces (conceptual)

Shape the motion with forces, applied globally or scoped per emitter:

- **Gravity** — a strong **downward** pull along `-y` that accelerates the falling
  droplets so they speed up as they fall and stretch along their velocity, and that
  keeps the spray's arc reading as water rather than smoke. This is the dominant
  force on the fall.
- **Outward spray push** — where the base spray is born, a push **outward** (in `x`
  and `z`) and slightly up, so the froth billows off the landing line into a fan
  rather than falling straight back down. This is what makes the spray read as spray.
- **Drag** — mild air resistance that bleeds speed from the spray and mist over
  their life, so the billowing froth slows and settles and the mist drifts lazily,
  instead of flying off in straight lines. Keep it **light on the falling water** so
  the droplets still accelerate and streak.
- **A gentle drift** on the mist — a soft, slow sideways and upward wander scoped to the
  mist so the low haze breathes and disperses organically rather than sitting still.

## Motion & stretch

The falling droplets should read as **fast** and **stretched along their velocity**
— thin vertical streaks, not round drifting balls — because real falling water blurs
into lines. The spray at the base should **billow outward** in a brief fan and fade,
not linger. Because the whole thing loops, keep every layer in full, even flow across
the window: the fall never thins, the spray never stops kicking up, and the mist
always hangs low, so the loop point is invisible.

## Color, opacity & size over life

Each particle's look changes over its **normalized life** (birth → death) via the
per-particle curves:

- **Falling water:** a cool blue that catches light at the top and deepens as it
  falls — starts a **bright pale blue** and shifts toward a **deeper blue** over its
  life; stays fairly opaque as it falls, then eases out as it nears the base and
  becomes spray. It is stretched and thin.
- **Base spray:** bright **white foam** at birth — the brightest element — that
  **fades and shrinks** as it billows out, thinning toward a pale blue-white before
  it disappears. It should read as froth kicked up off the water, easing out rather
  than winking off.
- **Drifting mist:** a dim, faint **pale grey-blue** that grows a little as it
  drifts, thins toward nothing, and whose opacity **eases up briefly then fades all
  the way out** — it should never pop off at full opacity, and it stays the dimmest
  element throughout.

Ease the curves (rise/fall smoothly) rather than snapping between values.

## Palette

Use only these colors — stated as gradient stops over each particle's life, and as
the only hues allowed (cool water only: blues, white foam, and pale mist; no warm or
saturated colors, no greens or purples):

| Role | Hex |
| --- | --- |
| Falling water (bright) | `#a9d8f5` |
| Falling water (deep) | `#2f6ea6` |
| White foam / spray | `#f4fbff` |
| Spray (pale blue) | `#cfe8f8` |
| Drifting mist (pale) | `#b9ccd6` |
| Mist (thin, dim) | `#7f95a2` |

A natural read: the **falling water** runs `#a9d8f5` → `#2f6ea6` as it drops; the
**spray** runs `#f4fbff` → `#cfe8f8` as it billows and fades; the **mist** runs
`#b9ccd6` → `#7f95a2` as it thins away.

## Working the tool

The `particle-3d` binary on your `PATH` is the only way to shape the effect, and
you **author a system**, not individual particles — emitters, forces, and
per-particle size/opacity/color curves that the review UI and the game **simulate
live**. Build it up in sensible layers: add the falling-sheet, base-spray, and
drifting-mist emitters (as continuous rates); set the forces (gravity, the spray's
outward push, drag, and the mist's drift); then set each emitter's color gradient,
opacity curve, and size curve. Keep the timeline **looping** so the effect never
starts or ends and the loop point is invisible.

Rendering is **on request**: run `particle-3d render` to simulate the whole system
over its duration, write the preview `effect.gif`, and **emit the `system.json`
your result is built from** — you **must** render before you finish or the system
is empty. Because the simulation is **live and stochastic**, the effect **varies
slightly from play to play**; judge its *character* — the read, the falling sheet,
the billowing spray, the seamless loop — across replays and from multiple orbit
angles, not any single frame. The field size, duration, and fps are already seeded
in a config beside your workspace, so no operation needs those flags. Run
`particle-3d --help` for the available operations (emitters, forces, per-particle
curves, sub-emitters, the timeline loop flag, and `render`) and `particle-3d
<operation> --help` for each one's exact flags.
