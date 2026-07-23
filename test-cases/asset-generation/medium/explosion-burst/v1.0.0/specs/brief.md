# Explosion Burst — particle brief

You are authoring a **generic action-game explosion** — the burst an action game
plays whenever something detonates: a shell impact, a fuel barrel, a grenade, a
destroyed vehicle. It is a **one-shot** effect: **one burst per detonation**. The
game plays a fresh instance each time something blows up, so the effect fires hard
and then decays away. You are authoring the *effect* as a **system**, not a single
frozen frame.

This is a reusable, general-purpose explosion — a blinding flash, a ball of fire, a
spray of sparks, and a puff of smoke. It should read as *the* explosion, not tied to
any particular weapon or object.

## The field

- A **48×48×48** cubic volume, transparent background. `x` is across, `y` is **up**,
  `z` is depth. The explosion **detonates at the center** of the volume and throws
  particles **radially outward in every direction** — this is a spherical burst, not
  a directional jet or forward cone. It must read as an explosion from **any orbit
  angle**, so keep it centered and symmetric rather than aimed at one face.
- The effect is a **one-shot** (`loop = false`): it **fires at the start and decays
  cleanly to empty** by the end of the seeded `duration_ms`. There is no steady state
  to settle into — this is a single detonation, which the game replays once per hit.
- Keep the burst **contained**: the fireball and sparks should expand vigorously but
  mostly stay within the volume, so the effect reads as a compact explosion rather
  than clipping hard against every face on the first frame. Smoke may drift up toward
  the top as it lingers.

## What the effect depicts

At a glance it reads as a **single explosion going off**: a blinding, overexposed
white flash; a fast-expanding ball of fire that cools from bright orange toward dark
smoke as it grows; a radial spray of small hot sparks streaking outward in every
direction; and a dark puff of smoke that rises and fades as the last thing left. It
is **not** a muzzle flash, a directional jet, a small isolated spark, or a steady
campfire — it is a sharp, symmetric, **radial** detonation that happens once.

## Lifecycle over the duration

Describe the effect against real time over its `duration_ms`, as a single detonation
that decays to empty:

- **Detonation (0 – ~60 ms):** the **flash core** blooms on hard at the center — an
  instantaneous, **overexposed white** bloom — and the **fireball** and **sparks**
  burst outward in the same instant. This is the brightest moment, a hard hit with no
  ramp-in.
- **Bloom (~60 – ~400 ms):** the flash dies away fast, while the **fireball**
  expands, swelling as it **cools** from hot yellow through orange toward dark smoke;
  the **sparks** streak radially outward, slow under drag, and begin to arc down under
  gravity, burning out over their short life.
- **Dissipate (~400 ms – end):** the fireball has cooled into smoke and thinned out;
  the sparks are gone; the lingering **smoke puff** is the last thing left — a dark
  haze that **rises**, spreads, thins, and **fades to nothing**. By the end of
  `duration_ms` the volume is empty.

## The emitters (conceptual)

Author these as separate emitters so each layer reads distinctly. These are intent,
not exact flags — read the binary's `--help` for the real operations:

- **Flash core** — an instantaneous, **overexposed white** bloom at the center: a
  small **burst** of a few particles at the detonation instant (roughly the first
  frame) with a **very short lifetime** (~40–80 ms), tight to the center, that flares
  bright and dies almost immediately. This is the blinding flash.
- **Fireball** — a **burst** of fire particles at the detonation instant that expand
  **radially outward** and **cool** as they grow. Give them a medium lifetime so the
  ball has time to swell and cool from hot yellow through orange toward smoke before
  it thins out. This is the body of the explosion.
- **Spark streaks** — a **burst** of many small hot sparks at the detonation instant,
  thrown **radially outward in every direction**, fast at birth, **stretched along
  their velocity** into short streaks, with a short lifetime so they spit out, slow,
  and burn away. These are the shrapnel of the blast.
- **Smoke puff** — a **burst** of a few slow, dark smoke particles at (or a hair
  after) the detonation instant, with the **longest** lifetime of the four, so a dark
  haze lingers and is the last thing to fade. It should **rise** as it drifts. Keep it
  a compact puff, not a towering plume.

Use timed **bursts** (not a continuous rate) — this is a one-shot detonation, not a
sustained fire; the game replays the whole effect per hit. An optional fixed random
seed gives a repeatable look, but the effect should read well whether or not the
draws are pinned.

## The forces (conceptual)

Shape the motion with forces, applied globally or scoped per emitter:

- **Radial burst** — the fireball and sparks launch **outward from the center in
  every direction** (via their emission shape/direction and speed), so the effect
  expands as a ball rather than shooting one way. This is **radial**, not a
  directional push.
- **Drag** — air resistance that bleeds speed over life, so the fast outward
  expansion slows and settles instead of flying off in straight lines forever.
- **A light gravity** — a gentle **downward** pull so the spent sparks and cooling
  fire droop and arc down as they die, rather than hanging in a perfect sphere. Keep
  it modest; the sparks are fast and short-lived.
- **Buoyancy on the smoke** — a gentle **upward** drift scoped to the smoke puff so
  the hot haze rises and spreads as it thins, while the sparks fall.

## Color, opacity & size over life

Each particle's look changes over its **normalized life** (birth → death) via the
per-particle curves:

- **Flash core:** starts **overexposed white** and full-bright, shifts to a **hot
  yellow** as it fades; opacity eases out to zero fast; size may swell slightly on
  detonation then shrink as it dies. Very brief.
- **Fireball:** starts **hot yellow**, cools through **orange** and on toward **dark
  smoke** as it ages; it **grows** as it expands while its opacity **fades out**, so
  the ball visibly cools into smoke rather than simply winking off.
- **Sparks:** **hot orange**, bright at birth, cooling toward **deep ember**; each
  spark **fades and shrinks** as it dies, so the radial spray dims and thins over its
  short life rather than winking off abruptly.
- **Smoke puff:** a dim, **dark grey** that **grows** as it rises and spreads, thins
  toward a darker grey, and its opacity **eases up briefly then fades all the way
  out** to nothing — it should never pop off at full opacity. The smoke stays the
  dimmest element throughout.

Ease the curves (rise/fall smoothly) rather than snapping between values.

## Palette

Use only these colors — stated as gradient stops over each particle's life, and as
the only hues allowed in the effect (no blues, greens, or purples; this is a warm
fire explosion):

| Role | Hex |
| --- | --- |
| Flash (overexposed white) | `#fff6e6` |
| Hot yellow | `#ffd24a` |
| Fireball orange | `#ff6a14` |
| Hot spark | `#ffa338` |
| Ember (deep) | `#a2320b` |
| Smoke (mid grey) | `#4c4740` |
| Smoke (dark) | `#211e1a` |

A natural read: the **flash** runs `#fff6e6` → `#ffd24a`; the **fireball** runs
`#ffd24a` → `#ff6a14` → `#211e1a` as it cools to smoke; the **sparks** run `#ffa338`
→ `#a2320b`; the **smoke** runs `#4c4740` → `#211e1a` as it thins and fades.

## Working the tool

The `particle-3d` binary on your `PATH` is the only way to shape the effect, and you
**author a system**, not individual particles — emitters, forces, and per-particle
size/opacity/color curves that the review UI and the game **simulate live**. Build it
up in sensible layers: add the flash-core, fireball, spark, and smoke emitters (as
timed bursts at the detonation instant); set the forces (the radial outward burst via
emission, drag, a light gravity, and the smoke's buoyancy); then set each emitter's
color gradient, opacity curve, and size curve, and stretch the sparks along their
velocity. Keep the timeline a **one-shot** so the effect fires once and decays to
empty (the game replays it per hit).

Rendering is **on request**: run `particle-3d render` to simulate the whole system
over its duration, write the preview `effect.gif`, and **emit the `system.json` your
result is built from** — you **must** render before you finish or the system is
empty. Because the simulation is **live and stochastic**, the effect **varies
slightly from play to play**; judge its *character* — the read, the single blinding
flash, the expanding fireball, the radial spark spray, the rising smoke — across
replays and from multiple orbit angles, not any single frame. The field size,
duration, and fps are already seeded in a config beside your workspace, so no
operation needs those flags. Run `particle-3d --help` for the available operations
(emitters, forces, per-particle curves, sub-emitters, the timeline loop flag, and
`render`) and `particle-3d <operation> --help` for each one's exact flags.
