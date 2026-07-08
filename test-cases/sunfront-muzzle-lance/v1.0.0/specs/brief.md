# Sunfront Rail-Lance Muzzle Flash — particle brief

You are authoring the **rail-lance muzzle flash** for *Sunfront*, a real-time
tug-of-war of solar-powered war automatons — the thin, searing energy discharge
that flares from the tip of a **rail-lance**, the long-range piercing weapon of the
game's marksman unit. It is a **looping**, continuous effect: the lance discharges
in a sustained rhythm, so the flash **plays continuously** at the tip for as long as
the unit is firing, rather than as one isolated shot. You are authoring the *effect*
as a **system**, not a single frozen frame.

## The field

- A **20×20×44** volume, transparent background. `x` is across, `y` is **up**, `z`
  is depth; **forward is `+z`**. The discharge is **directional and thin**: author
  it firing **forward along `+z`** from a lance tip near the **rear (low `z`)** of
  the volume, so the bolt projects far out toward the front. The volume is narrow and
  deep — this is a focused bolt, not a wide blast. The game anchors this effect to
  the unit's lance tip and orients it along the lance, so it must read as an energy
  discharge from **any orbit angle**, not just one face.
- The effect **loops** (`loop = true`): it has **no decay to empty**. Over the
  seeded `duration_ms` it settles into a **steady state** — a repeating firing
  discharge — that reads the same at the start of the loop as at the end, so the
  loop is seamless.
- Keep the lance tip toward the back so the bolt has room to project forward without
  instantly clipping the front face. Keep the whole effect **thin and focused** — a
  lance, not an explosion.

## What the effect depicts

At a glance it reads as a **focused energy weapon firing**: a searing bright flash
at the lance tip, a thin, fast **forward bolt** of energy lancing out along the
barrel, and a flicker of small **crackle** motes around the tip. It is an **energy /
rail discharge** — clean, bright, and thin. It is **not** a fiery gun flash with
flame and smoke, **not** a fireball, and **not** an omnidirectional burst. There is
**no smoke and no flame** — this is light and energy, not combustion.

## Lifecycle — a continuous loop

Because this effect **loops**, describe its **steady state** rather than a one-shot
arc. Across the `duration_ms` the lance tip holds a repeating discharge cadence:

- **Each discharge** flares bright and sharp at the tip and dies fast (~50–110 ms),
  so the tip **pulses** rather than glowing steadily. Discharges recur over the loop.
- **The bolt** lances **forward** with each discharge — a thin, fast stream of
  bright energy fired straight out along `+z`, **velocity-stretched** into streaks so
  it reads as a lance line, fading as it travels.
- **Crackle** motes flicker briefly around the tip — a few small energy sparks that
  spark and wink out fast, giving the discharge a live, electric edge.

At every moment of the loop there is a flare at the tip, a thin forward bolt
mid-flight, and a flicker of crackle. There is no final frame where the volume
empties, and at no point is there smoke or a spreading fireball.

## The emitters (conceptual)

Author these as separate emitters so each layer reads distinctly. These are intent,
not exact flags — read the binary's `--help` for the real operations:

- **Discharge core** — a searing, white-hot flash at the lance tip. Emit it
  **continuously** at a rate (this is a looping, sustained effect, not a single
  burst) but with a **very short particle lifetime** (~50–110 ms) and a **small
  radius** so the tip flares bright-and-out, tight and focused, rather than glowing
  solid.
- **Energy bolt** — a thin stream of bright energy particles emitted continuously
  from the tip and fired **forward along `+z`** in a **very tight cone** (nearly a
  straight line), **fast**, with a short-to-medium lifetime so the bolt lances out
  and fades. Give it a **velocity stretch** so each particle reads as a streak, not a
  dot — the lance line.
- **Crackle motes** — a few small, short-lived energy sparks emitted at a **low**
  rate near the tip, scattering slightly and flickering out fast — the electric edge.
  Keep them sparse and small.

Use a **continuous rate** for all three (not one-shot bursts) — this is a sustained,
looping discharge. An optional fixed random seed gives a repeatable look, but the
effect should read well whether or not the draws are pinned.

## The forces (conceptual)

Shape the motion with forces, applied globally or scoped per emitter:

- **Forward projection** — the discharge and bolt launch **forward along `+z`** (via
  their emission direction and speed), so the effect lances out the tip rather than
  spreading. This is directional, **not** a radial explosion push.
- **Light drag** — a little air resistance so the bolt fades out with distance
  instead of flying forever, while still reading as a fast, clean line.
- **Little or no gravity** — this is energy, not physical debris: keep the bolt
  **roughly straight**. A whisper of gravity is fine; a heavy downward arc is wrong.
- **No buoyancy and no smoke** — there is no plume to lift.

Use a **velocity stretch** on the bolt so its particles elongate along their motion
and read as a lance streak.

## Color, opacity & size over life

Each particle's look changes over its **normalized life** (birth → death) via the
per-particle curves:

- **Discharge core:** starts a **searing white** and full-bright, shifts to **hot
  gold** as it fades; opacity eases out to zero fast; size may swell slightly on
  ignition then shrink as it dies. Very brief.
- **Energy bolt:** a bright **white-gold** at birth, streaking to **amber** as it
  travels; each particle is **thin**, **fades and shrinks** as it dies, so the bolt
  tapers and dims along its length rather than winking off abruptly.
- **Crackle motes:** **hot gold** flickering to a dim **amber**, opacity flickering
  out fast — small and sharp.

Ease the curves (rise/fall smoothly) rather than snapping between values.

## Palette

Use only these colors — stated as gradient stops over each particle's life, and as
the only hues allowed in the discharge (no smoke greys, no fire-orange, and no
blues, greens, or purples; this is a warm solar-energy discharge, not team-tinted):

| Role | Hex |
| --- | --- |
| Searing white core | `#fffdf5` |
| Hot gold energy | `#ffd24a` |
| Amber edge | `#ff9e2c` |
| Deep amber fade | `#d4661a` |

A natural read: the **discharge core** runs `#fffdf5` → `#ffd24a`; the **bolt** runs
`#ffd24a` → `#ff9e2c` → `#d4661a` as it travels and fades; the **crackle** runs
`#ffd24a` → `#d4661a`.

## Working the tool

The `particle-3d` binary on your `PATH` is the only way to shape the effect, and
you **author a system**, not individual particles — emitters, forces, and
per-particle size/opacity/color curves that the review UI and the game **simulate
live**. Build it up in sensible layers: add the discharge-core, energy-bolt, and
crackle-mote emitters; set the forces (forward projection via emission, light drag,
little-to-no gravity, and a velocity stretch on the bolt); then set each emitter's
color gradient, opacity curve, and size curve. Make sure the timeline is set to
**loop** so the effect sustains rather than decaying to empty.

Rendering is **on request**: run `particle-3d render` to simulate the whole system
over its duration, write the preview `effect.gif`, and **emit the `system.json`
your result is built from** — you **must** render before you finish or the system
is empty. Because the simulation is **live and stochastic**, the effect **varies
slightly from play to play**; judge its *character* — the read, the flare, the thin
forward bolt — across replays and from multiple orbit angles, not any single frame.
The field size, duration, and fps are already seeded in a config beside your
workspace, so no operation needs those flags. Run `particle-3d --help` for the
available operations (emitters, forces, per-particle curves, sub-emitters, the
timeline loop flag, and `render`) and `particle-3d <operation> --help` for each
one's exact flags.
