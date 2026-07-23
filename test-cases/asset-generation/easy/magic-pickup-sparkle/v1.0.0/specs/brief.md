# Magic Pickup Sparkle — particle-effect brief

You are authoring a **magic pickup sparkle**: the small, gentle marker that hovers
over a collectible item to catch the player's eye and say *pick me up*. It is a
soft, enchanting shimmer — a glowing point that pulses and twinkles, never harsh,
never loud — the kind of effect that sits over a treasure, a power-up, or a magic
trinket in a game and loops forever. You are authoring a **single 2D particle
effect**: a **planar, screen-space** system that plays flat, with **no depth**, and
**loops seamlessly**.

## The field

- **64×64 pixels**, planar. The effect plays in a flat 2D field; there is no `z` —
  positions, directions, and forces are all in the screen plane. `x` increases to
  the right, `y` increases **up**.
- The sparkle is **centered** in the field — it marks a point — and its glow,
  stars, and motes stay comfortably **within the frame** without clipping the
  edges. It is a small, tidy marker, not a full-frame effect.
- **Duration is 1000 ms (one second)**, and the effect **loops**: the state at the
  end of the second must flow **seamlessly** back into the start, with no pop, jump,
  or empty gap. Author it as a continuous, always-alive shimmer.
- It composites over whatever is behind the pickup in the game; the preview clears
  to transparent, so author the colors to read as **bright, soft light** that would
  glow over a darker scene.

## Palette

Author the effect in only these colors — a cool magical palette. A viewer judges
the effect against this list, so keep every emitter, gradient, and glow inside it:

| Role | Hex |
| --- | --- |
| Soft cyan glow | `#6fe4ff` |
| Sparkle hot core / white | `#ffffff` |
| Gold star accent | `#ffd66b` |
| Violet mote accent | `#b08cff` |

The look is **enchanting and gentle**: a cool cyan glow at heart, white-hot sparkle
points tipped with a warm gold accent, and a faint violet in the drifting motes.
Keep it soft — nothing garish, nothing saturated to the point of harshness.

## The effect

The sparkle reads, at a glance, as a **twinkling magic marker** and is built from
**three overlaid elements**, all centered on the same point:

- **Central glow** — a soft, round **cyan** bloom at the center that **pulses**
  gently: it swells and brightens, then eases back down, over and over across the
  loop. It is the steady heart of the marker — always present, always breathing.
  Its hot center reads near **white**, softening to cyan at its edges. It never
  fully vanishes.
- **Four-point star sparkles** — small **white** twinkles, each shaped as a
  **four-point star** (a bright core with short thin rays along the vertical and
  horizontal), that **twinkle in and out** at **varying positions** around the
  glow. Each pops on, flares to a bright point, and fades away within a short
  moment; new ones appear at fresh spots, so at any instant a few are visible in
  different places and different phases. Their tips carry a warm **gold** accent.
- **Rising motes** — a **few** tiny **violet** specks that drift **slowly upward**
  from around the marker and fade as they rise, like flecks of enchantment lifting
  off. They are sparse and calm — a gentle upward drift, not a stream.

## Lifecycle over the one-second loop

This effect does **not** burst and die — it is a **continuous loop**. Author the
timing so the whole second reads as one smooth cycle that repeats forever:

- **The glow** pulses on a gentle cycle across the second — swelling and easing back
  at least once — timed so the pulse at the end of the loop hands off cleanly to the
  pulse at the start.
- **The star sparkles** twinkle in and out continuously throughout, staggered so
  they never all appear or vanish together; at every moment a few are mid-twinkle at
  scattered positions.
- **The motes** rise and fade steadily, with new ones appearing as old ones fade, so
  the upward drift never stops and never gaps.

The key constraint: at the loop boundary there must be **no visible reset** — no
sudden pop-in, no blank frame, no snap. The marker looks alive and unbroken as it
repeats.

## Emitters and forces (conceptual)

You author a **system** — emitters, forces, and per-particle curves — not
individual particles; think of it the way a real particle editor (Niagara, VFX
Graph) is authored. Shape it, conceptually, as:

- a **glow emitter**: one or a few large, soft, long-lived particles at the center
  whose size and brightness pulse over the loop (or a steady emitter whose particles
  swell and ease), reading as the breathing central bloom;
- a **sparkle emitter**: a continuous, staggered emission of small short-lived
  white star particles scattered at varying positions around the center, each
  twinkling on and off;
- a **mote emitter**: a slow, sparse emission of small violet particles near the
  center given a gentle **upward drift** so they rise and fade;

with forces kept **gentle** — a light upward drift on the motes, little or nothing
on the rest. This is a calm marker, not an explosion: no hard radial blast, no
strong gravity. Author these as *intent*: read `particle-2d --help` for the exact
emitter, force, and curve flags.

## Color, opacity, and size curves

Over each particle's normalized life:

- **Glow:** color runs **white `#ffffff` → cyan `#6fe4ff`** (hot center softening to
  cyan at the edge); opacity and size **pulse** — easing up to a bright, larger
  swell and back down — rather than fading out to nothing.
- **Star sparkles:** color **white `#ffffff`** with a **gold `#ffd66b`** accent on
  the ray tips; opacity eases up from zero to a bright flash and back to zero (a
  twinkle); size grows to a small point and shrinks as it dies.
- **Motes:** color **violet `#b08cff`**; opacity holds faint then fades out as they
  rise; size stays small, shrinking slightly as they die.

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
finish** — run `particle-2d render`: it simulates the system over the 1000 ms,
writes the preview GIF, and **emits the `system.json` the run's result is built
from**. An effect you never render leaves an empty system, which is recorded as
empty, so render before you stop. The field dimensions, duration, and fps are
already seeded alongside the workspace — no operation needs those flags.

Because the effect is **simulated live**, it **varies slightly from one play to the
next** — the sparkles twinkle at different spots each time. That is correct for a
shimmer: author it so the *character* — the pulsing glow, twinkling stars, and
rising motes, in the cool magical palette — **reads the same across every replay**
and **loops seamlessly**, rather than depending on any one frozen arrangement of
particles.
