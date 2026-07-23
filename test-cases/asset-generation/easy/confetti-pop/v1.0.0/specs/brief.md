# Confetti Pop — particle-effect brief

You are authoring a **confetti pop**, a celebratory confetti burst played once. It
is a party popper going off: a pop at the center throws a scatter of small, colorful
confetti pieces up and outward, they tumble and spin, and then they flutter down
under gravity and air drag before fading away. You are authoring a **single 2D
particle effect**: a **planar, screen-space** system that plays flat against the
host scene, with **no depth**.

## The field

- **128×128 pixels**, planar. The effect plays in a flat 2D field; there is no
  `z` — positions, directions, and forces are all in the screen plane. `x`
  increases to the right, `y` increases **up**.
- The pop is **centered** in the field — the popper goes off in place — and throws
  pieces **up and outward** in a wide fan, filling most of the frame without
  clipping the edges.
- **Duration is 1500 ms**, and the effect is a **one-shot**: it pops at the start,
  the pieces flutter down, and the field is **nearly empty** by the end. Nothing
  loops and nothing hangs frozen in the air past the duration.
- The preview clears to transparent; author the colors to read as **bright, cheerful
  confetti** over a plain scene.

## Palette

Author the confetti in this festive multi-color palette, mixed together across the
burst so it reads as bright, many-colored celebration. Spread the pieces roughly
evenly across all six colors:

| Role | Hex |
| --- | --- |
| Red | `#ff3b3b` |
| Blue | `#3b6bff` |
| Green | `#34d058` |
| Yellow | `#ffd23b` |
| Pink | `#ff5ec7` |
| Cyan | `#34e2ff` |

The point of the effect is the **cheerful mix** — no single color should dominate,
and the field should never read as one flat hue.

## The effect

The burst reads, at a glance, as a **joyful confetti pop** and is built from one
character of piece thrown in a colorful scatter:

- **Confetti pieces** — many **small colorful rectangles or ribbons** (little flecks
  of paper), not round dots or soft glowing sparks. They are **stretched along one
  axis** so they read as flat scraps, and they **tumble and spin** as they fly and
  fall so the light catches them at different angles.
- **The pop** — at t = 0 the pieces launch from the center **up and outward** in a
  wide fan, fast, with plenty of spread so no two follow the same path. This is the
  loud, bright moment.
- **The fall** — the pieces arc over and **flutter down under gravity**, slowed by
  **air drag** so they do not simply drop: the drag makes them **sway side to side**
  as they settle, drifting left and right the way real paper flutters. They **fade**
  near the end of their life so the field clears cleanly.

## Lifecycle over the 1500 ms

Author the timing so it reads as one celebratory pop, described here in real terms
against the duration:

- **0–200 ms — the pop.** All the confetti launches together from the center, up
  and outward in a wide fan, at its fastest and most tightly clustered. This is the
  burst.
- **200–800 ms — the spread.** The pieces fan out across the field, rising and then
  arcing over as gravity takes hold, tumbling and spinning, air drag bleeding off
  their speed and starting the side-to-side sway.
- **800–1500 ms — the flutter down.** The pieces flutter down, swaying left and
  right under drag, and fade out one by one until the field is **nearly empty**. The
  one-shot is over.

## Emitters and forces (conceptual)

You author a **system** — emitters, forces, and per-particle curves — not individual
particles; think of it the way a real particle editor (Niagara, VFX Graph) is
authored. Shape it, conceptually, as:

- a **confetti burst** at the center: a single short burst of many small stretched
  particles launched **up and outward** in a wide fan at high speed with lots of
  spread, their colors drawn across the full festive palette and their rotation
  varied so they tumble;

with forces that read as fluttering paper: **gravity** pulling the pieces down and
**drag** slowing them so they do not plummet — the drag is what lets them **sway
side to side** as they fall rather than dropping straight. Author these as *intent*:
read `particle-2d --help` for the exact emitter, force, and curve flags.

## Color, opacity, and size curves

Over each particle's normalized life:

- **Color:** each piece holds one of the six palette colors for its whole life;
  across the burst all six are represented so the scatter reads multi-colored.
- **Rotation:** each piece spins over its life (tumbling), with the spin rate and
  starting angle varied piece to piece so they do not turn in lockstep.
- **Opacity:** bright and solid through the pop and the spread, then an **ease-out
  fade** near the end of life so the pieces wink out and the field clears.
- **Size:** roughly constant — small confetti scraps — with the stretch along one
  axis kept so they always read as flat pieces, not dots.

## How the tool behaves

The `particle-2d` binary already on your `PATH` is the **only** channel for shaping
this effect — you build the system by calling it **one operation at a time**, and
the ordered list of operations you issue, recorded to `actions.json`, is the
**authoritative output**. You are authoring a **system** (emitters, forces,
per-particle curves), **not** placing individual particles: the review UI and a game
**simulate it live** from the system you author.

Run `particle-2d --help` to list every operation and `particle-2d <operation>
--help` for one operation's exact flags — that help text is the authoritative
contract. When you are ready to see your progress — and, importantly, **before you
finish** — run `particle-2d render`: it simulates the system over the 1500 ms,
writes the preview GIF, and **emits the `system.json` the run's result is built
from**. An effect you never render leaves an empty system, which is recorded as
empty, so render before you stop. The field dimensions, duration, and fps are
already seeded alongside the workspace — no operation needs those flags.

Because the effect is **simulated live**, it **varies slightly from one play to the
next** — the confetti scatters and lands differently each time. That is correct for
a confetti pop: author it so the *character* — the pop, the colorful spread, and the
fluttering fall — **reads the same across every replay**, rather than depending on
any one frozen arrangement of pieces.
