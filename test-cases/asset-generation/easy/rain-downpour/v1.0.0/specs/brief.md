# Rain Downpour — particle-effect brief

You are authoring a **looping heavy-rain effect**, a screen-space weather overlay:
a steady, driving downpour that can play over a scene for as long as it is on
screen. You are authoring a **single 2D particle effect**: a **planar,
screen-space** system that plays flat over the field, with **no depth**.

## The field

- **128×128 pixels**, planar. The effect plays in a flat 2D field; there is no
  `z` — positions, directions, and forces are all in the screen plane. `x`
  increases to the right, `y` increases **up**.
- Rain falls **from the top edge to the bottom edge**, covering the **whole width**
  of the frame evenly — this is a full-frame weather overlay, not a localized
  splash.
- **Duration is 1500 ms**, and the effect **loops**: it plays as a **steady,
  seamless downpour** that repeats with **no visible seam**. There is no moment
  where the field empties, restarts, or jumps — at every instant of the window the
  rain looks the same, a continuous fall already in progress.
- It composites over an arbitrary scene; the preview clears to transparent, so
  author the rain to read on its own as a translucent overlay.

## Palette

Author the effect in only these cool, desaturated colors — a muted, wet, cool-toned
rain. A viewer judges the effect against this list, so keep every emitter,
gradient, and streak inside it:

| Role | Hex |
| --- | --- |
| Rain streak | `#9fb3c6` |
| Bright streak highlight | `#c6d4e0` |
| Splash fleck (near-white) | `#eef4f9` |

The rain is **pale blue-grey** and slightly **translucent** — it reads as water
catching cool light, never a solid opaque line. The splash flecks are the
**brightest, near-white** touch, small and quick.

## The effect

The overlay reads, at a glance, as **heavy rain** and is built from **two
elements**:

- **Rain streaks** — **many** thin drops falling **fast** from the top of the frame
  to the bottom. Each drop is **stretched along its velocity** so it reads as a
  short **streak**, not a dot — think a thin near-vertical line a handful of pixels
  long. The fall is **near-vertical with a slight wind slant**: the streaks lean a
  little off vertical (a consistent, gentle diagonal, as if a light wind pushes the
  rain), all leaning the **same way**. Drops are spread **evenly across the full
  width** and fall continuously, so the frame always holds a dense field of streaks.
  A drop is born at (or just above) the top edge and travels until it reaches the
  bottom, where it dies.
- **Splash flecks** — small, **near-white** flecks that appear **where drops reach
  the bottom edge**. They kick up briefly — a tiny quick spatter at the point of
  impact — and fade almost immediately. They are **occasional**, not one per drop:
  a light scatter of impacts along the bottom that punctuates the fall. They should
  read as the rain hitting a surface, not as a second layer of particles.

## Motion over the 1500 ms

Author the timing so the downpour reads as **continuous and steady**, the same at
every instant:

- The rain **fills the frame from the first moment** — do not open on an empty field
  that fills in. At `t = 0` the screen already holds a full, dense field of streaks
  mid-fall, as though the storm has been going for a while.
- Drops fall at a **steady rate** across the whole window — **even density**, no
  bursts, no thinning, no gaps. New streaks enter at the top continuously as old
  ones exit at the bottom.
- The **loop is seamless**: because the effect repeats, the field at the end of the
  window must flow into the field at the start with no visible discontinuity — no
  empty frame, no sudden repopulation, no jump in density. A viewer watching it loop
  should not be able to tell where one cycle ends and the next begins.
- **Splash flecks** appear steadily along the bottom throughout — a light, even
  scatter of impacts, never a synchronized wave.

## Emitters and forces (conceptual)

You author a **system** — emitters, forces, and per-particle curves — not
individual particles; think of it the way a real particle editor (Niagara, VFX
Graph) is authored. Shape it, conceptually, as:

- a **rain emitter**: a continuous emitter spread **across the full width** at the
  **top** of the field, spawning many thin drops at a steady rate, each launched
  **downward** with a slight sideways lean (the wind slant) and stretched along its
  velocity so it reads as a streak;
- a **splash emitter**: small, short-lived near-white flecks born **along the bottom
  edge**, kicking up briefly and fading, scattered occasionally across the width;

with forces that read as falling rain: a steady **downward pull** (gravity) carrying
the drops down, and a light constant **sideways push** giving the whole field its
consistent wind slant. Keep the slant **gentle** — this is near-vertical rain, not a
sideways gale. Author these as *intent*: read `particle-2d --help` for the exact
emitter, force, and curve flags.

## Color, opacity, and size curves

Over each particle's normalized life:

- **Rain streaks:** color is the **pale blue-grey `#9fb3c6`**, optionally with a
  slightly **brighter `#c6d4e0`** highlight so the streaks catch a little light;
  opacity is **translucent** and roughly steady while falling, easing to zero as the
  drop reaches the bottom; size holds a thin streak along the fall (stretched by
  velocity), not a growing or shrinking blob.
- **Splash flecks:** color is the **near-white `#eef4f9`**; opacity snaps on at the
  impact and **fades out fast**; size is small and stays small — a quick tiny
  spatter, gone almost as soon as it appears.

## How the tool behaves

The `particle-2d` binary already on your `PATH` is the **only** channel for
shaping this effect — you build the system by calling it **one operation at a
time**, and the ordered list of operations you issue, recorded to `actions.json`,
is the **authoritative output**. You are authoring a **system** (emitters, forces,
per-particle curves), **not** placing individual particles: the review UI and a
game **simulate it live** from the system you author.

Run `particle-2d --help` to list every operation and `particle-2d <operation>
--help` for one operation's exact flags — that help text is the authoritative
contract. When you are ready to see your progress — and, importantly, **before you
finish** — run `particle-2d render`: it simulates the system over the 1500 ms,
writes the preview GIF, and **emits the `system.json` the run's result is built
from**. An effect you never render leaves an empty system, which is recorded as
empty, so render before you stop. The field dimensions, duration, and fps are
already seeded alongside the workspace — no operation needs those flags.

Because the effect is **simulated live**, it **varies slightly from one play to the
next** — individual drops fall on different paths each time. That is correct for
rain: author it so the *character* — a steady heavy downpour of thin slanted streaks
with splashes at the bottom, in the cool desaturated palette — **reads the same
across every replay** and **loops with no visible seam**, rather than depending on
any one frozen arrangement of particles.
