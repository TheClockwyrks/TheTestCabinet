# Rising Smoke Column — particle brief

You are authoring a **rising smoke column**: a steady stream of soft grey smoke
climbing from a single point source — the calm, ambient plume that drifts up from a
chimney, a smouldering ember, or a snuffed candle. It is a **continuous, seamless
loop**: a stream that has already reached a steady state and plays forever without a
visible seam. You are authoring the *effect* as a **system**, not a single frozen
frame.

## The field

- A **32×64×32** volume, transparent background. `x` is across, `y` is **up**, `z`
  is depth. The volume is **tall** so the column has room to climb. Author the smoke
  rising **upward along `+y`** from a **point source near the floor (low `y`)**,
  roughly centered in `x` and `z`, so the plume has the full height to rise, expand,
  and thin out before the top.
- The effect is a **continuous loop** (`loop = true`): it does **not** start from
  empty and it does **not** end. Author it as a steady stream that is already rising
  everywhere in the column, so the last frame of the seeded `duration_ms` flows back
  into the first with **no visible seam, gap, or pop**. There should never be a
  moment where the whole column appears at once or clears out.
- Keep the source small and near the bottom-center, and let the column **widen** as
  it rises — denser and tighter near the source, softer and broader higher up.

## What the effect depicts

At a glance it reads as a **calm rising column of grey smoke**: soft puffs billowing
up from a point, expanding and slowing as they climb, curling turbulently with a
gentle sideways sway, and growing more transparent until they dissipate near the top
of the volume. It is **not** a fire, a dust puff, a fog bank, a bursting cloud, or an
explosion — it is a **soft, wispy, continuous** plume, quiet and ambient.

## Lifecycle of a puff

Describe a single puff against its own **normalized life** (birth → death), from the
source to where it fades:

- **Birth (near the source):** a puff spawns small, **denser and brighter** (a
  light grey), tight to the source point, moving upward with the most speed it will
  have.
- **Rise (middle of life):** it **climbs and slows** — buoyancy carries it up but
  drag bleeds its speed, so it decelerates as it rises. It **expands**, curls and
  rolls turbulently, and **drifts sideways** a little, softening from a light grey
  toward a mid grey.
- **Dissipation (end of life):** high in the column it is **large, slow, and faint**
  — a thin dark grey that **fades all the way out** to nothing near the top, rather
  than winking off abruptly. By the top of the volume the smoke has thinned away.

## The emitters (conceptual)

Author the plume as a continuous emitter (you may add a second, sparser emitter for
soft outer wisps if it helps the read). These are intent, not exact flags — read the
binary's `--help` for the real operations:

- **Smoke column** — a small **point (or tiny disc)** source near the bottom-center
  emitting at a **steady rate** (not a burst), each particle with a **long lifetime**
  so the stream fills the whole height of the volume before particles die. Give it a
  modest upward birth speed; the forces do the rest. Enough particles that the column
  reads as a continuous plume, but keep it **soft and wispy**, not a solid mass.
- **Outer wisps (optional)** — a sparser, slower, even fainter set of particles that
  peel off the main column and thin out sooner, to soften its edges. Keep this
  subtle if you use it.

Emit at a continuous **rate** (not timed bursts) — this is a steady stream, and the
loop is seamless only if the column is emitting and rising the whole time. An
optional fixed random seed gives a repeatable look, but the effect should read well
whether or not the draws are pinned.

## The forces (conceptual)

Shape the motion with forces, applied globally or scoped per emitter:

- **Buoyancy** — a gentle, steady **upward** push (hot smoke rises), the main driver
  of the climb. Keep it calm; this is an ambient plume, not a jet.
- **Drag** — air resistance that bleeds speed over life, so a puff **rises fast at
  first and slows** as it climbs, settling near the top rather than shooting straight
  off.
- **Turbulence / curl noise** — a swirling force that makes the smoke **curl and
  roll** and gives it a slight **sideways sway** as it rises, so the column has soft,
  organic motion instead of a rigid straight line. Keep it gentle — enough to curl,
  not enough to scatter the column apart.

## Color, opacity & size over life

Each particle's look changes over its **normalized life** (birth → death) via the
per-particle curves:

- **Color:** starts a **light grey** near the source, drifts through a **mid grey**
  as it rises, and thins toward a **dark grey** as it dissipates. Stay neutral grey
  throughout — no warm fire tint, no brown, no color cast.
- **Opacity:** **eases up** from zero as the puff is born (so nothing pops in at full
  strength), holds through the rise, then **fades all the way out** to zero as it
  dissipates near the top. It should never wink off abruptly.
- **Size:** each puff **grows** as it climbs — small and tight at birth, large and
  soft near the top — so the column widens with height.

Ease the curves (rise/fall smoothly) rather than snapping between values.

## Palette

Use only these colors — stated as gradient stops over each particle's life, and as
the only hues allowed in the smoke (neutral grey only; no browns, blues, or warm
fire tints):

| Role | Hex |
| --- | --- |
| Smoke base (light grey) | `#cfccc6` |
| Smoke body (mid grey) | `#908d87` |
| Smoke tip (dark grey) | `#4c4a46` |

A natural read: each puff runs `#cfccc6` → `#908d87` → `#4c4a46` over its life as it
rises and thins, while its opacity eases up and then fades to nothing.

## Working the tool

The `particle-3d` binary on your `PATH` is the only way to shape the effect, and
you **author a system**, not individual particles — emitters, forces, and
per-particle size/opacity/color curves that the review UI **simulates live**. Build
it up in sensible layers: add the smoke-column emitter (a steady-rate point source
near the floor, with a long particle lifetime), set the forces (upward buoyancy,
drag, and gentle turbulence/curl for the sway), then set the color gradient, opacity
curve, and size curve. Keep the timeline **looping** so the stream reaches a steady
state and the column tiles seamlessly.

Rendering is **on request**: run `particle-3d render` to simulate the whole system
over its duration, write the preview `effect.gif`, and **emit the `system.json`
your result is built from** — you **must** render before you finish or the system
is empty. Because the simulation is **live and stochastic**, the effect **varies
slightly from play to play**; judge its *character* — the read, the steady rising
column, the seamless loop — across replays and from multiple orbit angles, not any
single frame. The field size, duration, and fps are already seeded in a config
beside your workspace, so no operation needs those flags. Run `particle-3d --help`
for the available operations (emitters, forces, per-particle curves, sub-emitters,
the timeline loop flag, and `render`) and `particle-3d <operation> --help` for each
one's exact flags.
