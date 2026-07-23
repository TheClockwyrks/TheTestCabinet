# Arcane Nova — particle brief

You are authoring an **arcane nova**: the flash of energy that erupts when a spell
detonates at a point on the ground. It is a **one-shot** effect: **one cast**. A
fresh instance plays each time the spell fires, so you are authoring the *effect* as
a **system**, not a single frozen frame. Think of the burst of light and sparks that
punches out of the ground when a mage slams a staff down — a sharp flash, a ring of
force sweeping outward, a shower of glowing runic motes thrown into the air, and a
soft afterglow that settles and fades.

## The field

- A **48×48×48** volume, transparent background. `x` is across, `y` is **up**, `z`
  is depth. The nova is cast at the **center of the ground plane** — the middle of
  the low-`y` face — so author it originating there, with room above for the sparks
  to fountain up and room around for the ring to sweep out.
- The effect is a **one-shot** (`loop = false`): it **bursts at the start and decays
  cleanly to empty** by the end of the seeded `duration_ms`. There is no steady state
  to settle into — this is a single cast, replayed whole each time the spell fires.
- The nova is **radially symmetric** about its vertical axis: the ring and spark
  spray have no single front, so it must read as a nova from **any orbit angle**, not
  just one face. Keep the effect **contained** — a sharp burst that fills the volume
  and clears, not a slow fog that lingers past the duration.

## What the effect depicts

At a glance it reads as a **burst of magic cast once**: a bright flash at the center,
a thin ring or shockwave of energy sweeping outward across the ground, and a spray of
glowing motes thrown upward that arc back down. It is **not** a fireball, a smoke
plume, an explosion of debris, or a formless cloud — it is a clean, luminous, magical
**nova**: light and energy, not fire and soot.

## Lifecycle over the duration

Describe the effect against real time over its `duration_ms`, as a single cast that
decays to empty:

- **Detonation (0 – ~80 ms):** the **flash core** blooms on hard at the center — a
  bright white flash — the **ring** is born at the center and starts to sweep out,
  and the **rune sparks** launch upward in the same instant. This is the brightest
  moment.
- **Expansion (~80 – ~500 ms):** the flash dies away fast, while the **ring** sweeps
  **outward** across the ground, thinning and fading as it widens, and the **sparks**
  arc up, slow, and begin to fall back under gravity, fading and shrinking. A soft
  **glow** blooms behind them.
- **Settle (~500 ms – end):** the ring has swept past and faded; the last sparks fall
  and wink out; the soft **glow** is the last thing left — a gentle afterglow that
  eases down and **fades to nothing**. By the end of `duration_ms` the volume is
  empty.

## The emitters (conceptual)

Author these as separate emitters so each layer reads distinctly. These are intent,
not exact flags — read the binary's `--help` for the real operations:

- **Flash core** — a bright white bloom at the center: a small **burst** of a few
  particles at the cast instant (roughly the first frame) with a **very short
  lifetime** (~60–120 ms), tight to the center point, that flares and dies. This is
  the detonation flash itself.
- **Energy ring** — a **burst** emitted in a **flat ring or disc** on the ground
  plane at the cast instant, moving **outward** across the ground (radially in the
  `x`/`z` plane, with little vertical speed), fast at birth, with a short-to-medium
  lifetime so it sweeps out, widens, and thins. This is the shockwave sweeping along
  the floor.
- **Rune sparks** — a **burst** of small, glowing spark motes launched **upward**
  (along `+y`) with some outward spread, medium lifetime, so they fountain up and
  then arc back down under gravity. These are the runic motes the cast throws into
  the air.
- **Soft glow** — a small **burst** of a few large, dim, slow particles at the center
  that **bloom and fade**, with the **longest** lifetime of the four, so a gentle
  afterglow lingers and is the last thing to fade. Keep it soft and sparse — an
  afterglow, not a second flash.

Use timed **bursts** (not a continuous rate) — this is a one-shot cast, not a
sustained stream; the game replays the whole effect per cast. An optional fixed
random seed gives a repeatable look, but the effect should read well whether or not
the draws are pinned.

## The forces (conceptual)

Shape the motion with forces, applied globally or scoped per emitter:

- **Outward sweep** — the ring launches **outward across the ground** (via its
  emission shape and direction and speed), so it expands as a widening ring rather
  than rising or collapsing. This is a radial, ground-plane spread — **not** a
  spherical explosion in every direction.
- **Gravity** — a **downward** pull on the rune sparks so they fountain up, slow at
  the top, and **arc back down** rather than flying straight up forever. Tune it so
  the sparks fall back within the duration.
- **Drag** — air resistance that bleeds speed over life, so the fast ring and sparks
  slow and settle instead of shooting off in straight lines forever.
- **A gentle lift on the glow** — an optional soft upward or outward drift scoped to
  the glow so the afterglow breathes and spreads a little as it fades, staying dim.

## Color, opacity & size over life

Each particle's look changes over its **normalized life** (birth → death) via the
per-particle curves:

- **Flash core:** starts **white** and full-bright, shifts toward **violet** as it
  fades; opacity eases out to zero fast; size may swell slightly on detonation then
  shrink as it dies. Very brief.
- **Energy ring:** **cyan** and bright at birth, shifting to **violet** as it sweeps
  out; each ring particle **fades and thins** as it widens, so the ring dims and
  softens over its short life rather than winking off abruptly.
- **Rune sparks:** a glowing **pale violet**, bright at birth; each spark **fades and
  shrinks** as it arcs and falls, thinning toward a **deep violet** so the shower dims
  as it settles rather than snapping off.
- **Soft glow:** a dim **violet** that **grows** a little as it blooms, and whose
  opacity **eases up briefly then fades all the way out** to nothing — it should
  never pop off at full opacity. The glow stays the dimmest element throughout.

Ease the curves (rise/fall smoothly) rather than snapping between values.

## Palette

Use only these colors — stated as gradient stops over each particle's life, and as
the only hues allowed (a **cool arcane** palette: white, violet, cyan, pale violet —
no warm fire colors, no greens):

| Role | Hex |
| --- | --- |
| White flash | `#f2ecff` |
| Arcane cyan (ring) | `#4fe3ff` |
| Arcane violet | `#8a4dff` |
| Pale-violet spark | `#cdb4ff` |
| Deep violet (fade) | `#3a1c78` |
| Soft glow (dim) | `#5a3fa8` |

A natural read: the **flash** runs `#f2ecff` → `#8a4dff`; the **ring** runs
`#4fe3ff` → `#8a4dff`; the **sparks** run `#cdb4ff` → `#3a1c78` as they fall; the
**glow** sits at a dim `#5a3fa8` and fades out.

## Working the tool

The `particle-3d` binary on your `PATH` is the only way to shape the effect, and
you **author a system**, not individual particles — emitters, forces, and
per-particle size/opacity/color curves that the review UI and the game **simulate
live**. Build it up in sensible layers: add the flash-core, energy-ring,
rune-spark, and soft-glow emitters (as timed bursts at the cast instant); set the
forces (outward sweep on the ring, gravity and drag on the sparks, a gentle lift on
the glow); then set each emitter's color gradient, opacity curve, and size curve.
Keep the timeline a **one-shot** so the effect bursts once and decays to empty (the
game replays it per cast).

Rendering is **on request**: run `particle-3d render` to simulate the whole system
over its duration, write the preview `effect.gif`, and **emit the `system.json`
your result is built from** — you **must** render before you finish or the system
is empty. Because the simulation is **live and stochastic**, the effect **varies
slightly from play to play**; judge its *character* — the read, the single bright
flash, the outward ring, the upward spark arc — across replays and from multiple
orbit angles, not any single frame. The field size, duration, and fps are already
seeded in a config beside your workspace, so no operation needs those flags. Run
`particle-3d --help` for the available operations (emitters, forces, per-particle
curves, sub-emitters, the timeline loop flag, and `render`) and `particle-3d
<operation> --help` for each one's exact flags.
