# Sunfront Heavy-Cannon Muzzle Flash — particle brief

You are authoring the **heavy-cannon muzzle flash** for *Sunfront*, a real-time
tug-of-war of solar-powered war automatons — the big, smoky blast that belches from
the barrel of a **heavy cannon or mortar** as one of the game's artillery and
capstone units fires. It is a **looping**, continuous effect: the gun works in a
sustained, heavy rhythm, so the blast **plays continuously** at the muzzle for as
long as the unit is firing, rather than as one isolated shot. You are authoring the
*effect* as a **system**, not a single frozen frame.

## The field

- A **36×36×48** volume, transparent background. `x` is across, `y` is **up**, `z`
  is depth; **forward is `+z`**. The blast is **directional**: author it firing
  **forward along `+z`** from a muzzle point near the **rear (low `z`)** of the
  volume, so the flame, embers, and smoke have room to project out toward the front.
  The game anchors this effect to each firing unit's muzzle and orients it along the
  barrel, so it must read as a heavy-gun blast from **any orbit angle**, not just
  one face.
- The effect **loops** (`loop = true`): it has **no decay to empty**. Over the
  seeded `duration_ms` it settles into a **steady state** — a heavy, repeating
  firing rhythm — that reads the same at the start of the loop as at the end, so the
  loop is seamless.
- Keep the muzzle origin toward the back so the forward blast and its smoke plume
  have room to develop without instantly clipping the front face. This is a big gun
  flash, so it fills more of the volume than a small-arms flash — but it is still a
  muzzle blast, not an explosion centred in the volume.

## What the effect depicts

At a glance it reads as a **heavy gun firing**: a big, bright bloom at the muzzle, a
forward **gout of orange flame and heavy embers** thrown out the barrel, and a
**thick, rolling grey-black smoke plume** that billows forward and up and lingers.
It is bigger and far smokier than a small-arms flash. It is **not** a ground
fireball, an airburst, or an omnidirectional explosion — it is a heavy,
**forward-directed** muzzle blast that keeps belching while the gun is engaged.

## Lifecycle — a continuous loop

Because this effect **loops**, describe its **steady state** rather than a one-shot
arc. Across the `duration_ms` the muzzle holds a heavy, repeating firing cadence:

- **Each blast** blooms big and bright at the muzzle, a little heavier and
  longer-lived than a small-arms flash (~80–180 ms), then dies — so the barrel
  **pulses** with weight rather than glowing steadily. Blasts recur over the loop.
- **Flame and embers** are thrown **forward** with each blast — a gout of orange
  flame and heavy hot embers projected out the barrel, fast at first, then dragged
  down and slowed so the embers **arc and fall** as they burn out.
- **Smoke** is a **thick, rolling plume** born at the muzzle that billows forward,
  rises, spreads, greys toward black, and **lingers** — the last and largest thing
  present. It should read as a real rolling smoke plume, not a faint wisp.

At every moment of the loop there is a blast mid-bloom or just fading, a forward
gout of flame and falling embers, and a rolling smoke plume. There is no final frame
where the volume empties.

## The emitters (conceptual)

Author these as separate emitters so each layer reads distinctly. These are intent,
not exact flags — read the binary's `--help` for the real operations:

- **Blast core** — a big, white-hot bloom at the muzzle. Emit it **continuously** at
  a rate (this is a looping, sustained effect, not a single burst) but with a
  **short particle lifetime** (~80–180 ms) so the muzzle pulses bright-and-out
  rather than glowing solid. A few large particles per blast, tight to the muzzle
  point.
- **Flame & embers** — a forward gout emitted continuously from the muzzle and fired
  **forward along `+z`** in a **moderate cone**: larger orange flame particles up
  close plus **heavier hot embers** thrown further, fast at birth, with a
  short-to-medium lifetime so they spit out, arc down, and burn away. These are the
  belch of fire and shrapnel.
- **Smoke plume** — larger, slow smoke particles emitted at a **steady** rate at the
  muzzle, with the **longest** lifetime of the three, so a thick plume billows and
  lingers. Make it prominent — a rolling plume, not a wisp. An optional curl-noise
  **turbulence** scoped to the smoke gives it a believable rolling billow.

Use a **continuous rate** for all three (not one-shot bursts) — this is a sustained,
looping muzzle blast. An optional fixed random seed gives a repeatable look, but the
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
smoke-plume emitters; set the forces (forward projection via emission, drag, a
downward gravity, and the smoke's buoyancy, plus optional turbulence on the smoke);
then set each emitter's color gradient, opacity curve, and size curve. Make sure the
timeline is set to **loop** so the effect sustains rather than decaying to empty.

Rendering is **on request**: run `particle-3d render` to simulate the whole system
over its duration, write the preview `effect.gif`, and **emit the `system.json`
your result is built from** — you **must** render before you finish or the system
is empty. Because the simulation is **live and stochastic**, the effect **varies
slightly from play to play**; judge its *character* — the read, the heavy pulse, the
forward gout, the rolling smoke — across replays and from multiple orbit angles, not
any single frame. The field size, duration, and fps are already seeded in a config
beside your workspace, so no operation needs those flags. Run `particle-3d --help`
for the available operations (emitters, forces, per-particle curves, sub-emitters,
the timeline loop flag, and `render`) and `particle-3d <operation> --help` for each
one's exact flags.
