# Campfire Flames — particle brief

You are authoring a **cozy campfire**: a small, warm fire already lit and burning
steadily, the kind that sits in a ring of stones on a quiet night. It is a
**steady-state, seamlessly looping** effect — the fire is always burning, with no
ignition and no dying-out — authored as a **system**, not a single frozen frame.

## The field

- A **32×32×32** volume, transparent background. `x` and `z` are across the fire bed
  (the ground plane); `y` is **up**, and **the fire rises toward `+y`**. Author it
  burning up from a small **hearth footprint near the floor (low `y`)**, centered in
  the `x`/`z` bed, so the flames have the full height of the volume to rise into.
- The effect **loops seamlessly** (`loop = true`): the fire is in **steady state**
  the whole time, so the end of the seeded `duration_ms` window must flow continuously
  back into its start — **no visible seam, no fade-in, no fade-out, no burst-and-die**.
  There must be no empty first frame and no dying-out at the end; particles are being
  born and dying continuously so the fire looks the same at the loop point as anywhere
  else.
- Keep the fire a **campfire**, not a bonfire — a modest column of flame rising off a
  small bed, leaving headroom above for embers and smoke. It should not fill or
  overflow the whole volume.

## What the effect depicts

At a glance it reads as a **cozy campfire**: licking flame tongues rising and
flickering off a low bed, small embers popping upward and drifting on the heat, and a
thin, faint wisp of smoke curling above the flames. It is **not** a torch, a
fireball, an explosion, a wall of fire, or an abstract orange glow — it is a small,
warm, inviting campfire that keeps burning.

## The layers (conceptual)

Author these as separate emitters so each layer reads distinctly. These are intent,
not exact flags — read the binary's `--help` for the real operations:

- **Flame tongues** — the body of the fire: a **continuous rate** of flame particles
  born across the small hearth footprint and rising **upward along `+y`**, with a
  **short-to-medium lifetime** so tongues lick up, flicker, and burn out within the
  lower-to-middle height of the volume. This is the main event — the licking flame.
- **Embers** — a **sparse continuous rate** of small, bright embers born in the hot
  core, riding the heat **upward** and drifting on a little turbulence, with a
  **longer, varied lifetime** so a few travel higher than the flame before they cool
  and wink out. Keep them small and occasional — glowing specks, not a fountain.
- **Smoke wisp** — a **thin, faint** stream of slow smoke particles born just above
  the flame tips, with the **longest** lifetime of the three, drifting up and curling
  as it thins to nothing near the top of the volume. Keep it sparse and dim — a wisp,
  not a plume that hides the fire.

Use **continuous-rate** emission (not one-off bursts) for every layer — this is a
steady-state fire, always burning, so births and deaths overlap and the loop has no
seam. An optional fixed random seed gives a repeatable look, but the effect should
read well whether or not the draws are pinned.

## The forces (conceptual)

Shape the motion with forces, applied globally or scoped per emitter:

- **Rise / buoyancy** — a gentle **upward** pull (hot gas rising) that carries the
  flames, embers, and smoke toward `+y`. This is the dominant motion; keep it smooth,
  not a hard launch.
- **Turbulence** — a light, wandering noise force so the flames **flicker and lick**
  and the embers **drift** on organic, irregular paths rather than rising in rigid,
  identical columns. This is what makes the fire feel alive; keep it gentle so the
  fire stays a cozy campfire, not a windstorm.
- **A little inward gather at the base** — an optional soft pull toward the center
  low down so the flame tongues taper together into a rounded fire shape rather than
  spreading flat. Keep it subtle.

## Color, opacity & size over life

Each particle's look changes over its **normalized life** (birth → death) via the
per-particle curves. The signature of fire is the **heat gradient** — hottest and
brightest at the base, cooling as it rises:

- **Flame tongues:** start **yellow-white** and full-bright at the base, cool to
  **orange** through the middle of their life, then to a **deep red** at the tips
  before fading out. Opacity is strong low down and **eases to zero** as the tongue
  cools and rises; size may swell a little then taper as the tongue licks up and dies.
- **Embers:** a bright warm **orange-gold** at birth, **dimming toward a deep ember
  red** as they cool and rise; each ember **shrinks and fades** over its life so it
  winks out softly rather than snapping off. They are the brightest small specks in
  the effect.
- **Smoke wisp:** a dim, faint **grey** that **grows** a little and thins toward a
  darker grey as it curls upward; its opacity **eases up briefly then fades all the
  way out** to nothing — it should never pop off at full opacity, and it stays the
  dimmest, most translucent element throughout.

Ease the curves (rise/fall smoothly) rather than snapping between values.

## Palette

Use only these colors — stated as gradient stops over each particle's life, and as
the only hues allowed in the flames (no blues, greens, or purples; this is warm
firelight):

| Role | Hex |
| --- | --- |
| Flame base (yellow-white) | `#fff2c4` |
| Flame mid (orange) | `#ff9a3c` |
| Flame tip (red) | `#d43a1e` |
| Ember (bright) | `#ffb545` |
| Ember (cooling) | `#b83410` |
| Smoke wisp (grey) | `#6f6a63` |
| Smoke (thin, dark) | `#2b2824` |

A natural read: the **flame** runs `#fff2c4` → `#ff9a3c` → `#d43a1e`; the **embers**
run `#ffb545` → `#b83410` as they cool; the **smoke** runs `#6f6a63` → `#2b2824` as
it thins.

## Working the tool

The `particle-3d` binary on your `PATH` is the only way to shape the effect, and you
**author a system**, not individual particles — emitters, forces, and per-particle
size/opacity/color curves that the review UI **simulates live**. Build it up in
sensible layers: add the flame-tongue, ember, and smoke-wisp emitters (as
continuous-rate emitters); set the forces (upward buoyancy, a light turbulence, and
the optional inward gather at the base); then set each emitter's color gradient,
opacity curve, and size curve. Keep the timeline **looping** so the fire burns in
steady state — no ignition, no dying-out, no seam at the loop point.

Rendering is **on request**: run `particle-3d render` to simulate the whole system
over its duration, write the preview `effect.gif`, and **emit the `system.json` your
result is built from** — you **must** render before you finish or the system is
empty. Because the simulation is **live and stochastic**, the effect **varies
slightly from play to play**; judge its *character* — the read as a cozy campfire,
the heat gradient, the seamless loop, the organic flicker — across replays and from
multiple orbit angles, not any single frame. The field size, duration, and fps are
already seeded in a config beside your workspace, so no operation needs those flags.
Run `particle-3d --help` for the available operations (emitters, forces, per-particle
curves, sub-emitters, the timeline loop flag, and `render`) and `particle-3d
<operation> --help` for each one's exact flags.
