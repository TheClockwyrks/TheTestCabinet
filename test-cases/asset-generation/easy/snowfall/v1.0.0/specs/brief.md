# Ambient Snowfall — particle-effect brief

You are authoring **ambient snowfall**: a gentle, looping weather layer of soft
white flakes drifting down through the frame. It is the kind of calm, continuous
snow you would run behind or in front of a scene to make it feel wintry — soothing
and unhurried, never a storm. You are authoring a **single 2D particle effect**: a
**planar, screen-space** system that plays flat against the scene, with **no
depth**.

## The field

- **128×128 pixels**, planar. The effect plays in a flat 2D field; there is no `z`
  — positions, directions, and forces are all in the screen plane. `x` increases to
  the right, `y` increases **up**, so the snow falls in the **−y** direction.
- The snow fills the **whole frame** evenly. Flakes drift down across the entire
  width, so at any moment the field looks like a calm, continuous fall rather than a
  single stream or a sparse handful.
- **Duration is 3000 ms**, and the effect **loops**: it plays as a **continuous,
  seamless ambient layer**. The field is already full of snow at the very first
  frame and stays evenly populated to the last, with **no visible pop or gap** where
  the 3 s window repeats — no build-up at the start, no thinning at the end.
- It composites over a scene, so author the flakes to read as **soft snow** that
  would sit cleanly over either a light or a dark background; the preview clears to
  transparent.

## Palette

Author the effect in only these cool, wintry colors. A viewer judges the effect
against this list, so keep every emitter, gradient, and flake inside it:

| Role | Hex |
| --- | --- |
| Flake core / brightest | `#ffffff` |
| Cool white | `#eaf3ff` |
| Pale blue | `#bcd6f2` |

The snow reads as **soft white with a faint cool-blue tint** — the flakes are not
pure paper-white flat; a hint of pale blue in the shadows and edges keeps them
wintry. No warm hues, nothing harsh or saturated.

## The effect

The layer reads, at a glance, as **calm ambient snowfall**. It is built from soft
flakes with these qualities:

- **Soft flakes** — each flake is a **soft-edged, rounded** speck of light, not a
  hard square or a sharp streak. Flakes are small; think gentle dots of snow, with
  a soft falloff at the edge so they feel fuzzy rather than crisp.
- **Varied sizes** — the flakes come in a **range of sizes**, from tiny distant
  specks to a few larger, nearer flakes. The size spread is what sells the depth of
  the fall.
- **A gentle sparkle** — a **few** flakes slowly **twinkle or rotate** as they fall
  — a soft, unhurried shimmer, not a flashing strobe — so the snow feels alive
  rather than a uniform sheet. Most flakes just drift quietly.
- **Many flakes at once** — the field carries **many** flakes simultaneously so the
  fall reads as continuous, but stays **calm and airy**: this is a light, soothing
  snowfall, not a whiteout.

## Motion

Author the movement so it reads as snow settling gently on a light breeze:

- **Slow downward drift.** Flakes fall **slowly** in the −y direction — a lazy,
  floating descent, not a fast plummet and nothing like the straight vertical speed
  of rain.
- **Side-to-side sway.** As they fall, flakes **sway gently left and right**, as if
  on a **light breeze** — a soft horizontal wander rather than a straight vertical
  drop. The sway is unhurried and subtle.
- **Parallax.** **Smaller flakes fall slower** than larger ones, so the small,
  distant flakes drift lazily while the larger, nearer flakes fall a little faster.
  This difference in speed by size gives the layer **depth** — it should not move as
  one flat sheet.
- **Continuous and seamless.** Because the field is always full and the window
  loops, flakes are **entering at the top as others leave at the bottom** at all
  times, keeping the density steady with no visible seam at the loop point.

## Emitters and forces (conceptual)

You author a **system** — emitters, forces, and per-particle curves — not
individual flakes; think of it the way a real particle editor (Niagara, VFX Graph)
is authored. Shape it, conceptually, as:

- a **snow emitter** that spawns flakes **continuously across the top** (and, so the
  field is full from the first frame of the loop, across the whole field to begin
  with) at a steady rate, with a **range of sizes** and a range of downward speeds;
- flakes that live long enough to **fall the full height** of the field and are
  retired once they pass the bottom, keeping the population steady;

with forces that read as gentle weather: a light **downward pull** (a soft gravity,
much weaker than rain would need) and a gentle **side-to-side sway** — for example a
subtle horizontal wander or turbulence — so the flakes wander as they fall rather
than dropping straight. Keep the motion **slow and soft**. Author these as *intent*:
read `particle-2d --help` for the exact emitter, force, and curve flags.

## Color, opacity, and size curves

Over each flake's life:

- **Color:** flakes read **white `#ffffff`** at their brightest, with **cool white
  `#eaf3ff`** and a touch of **pale blue `#bcd6f2`** in the softer, dimmer flakes
  and edges — a soft, cool wintry white, never warm.
- **Opacity:** flakes **fade in** softly as they enter and **fade out** softly
  before they leave, so no flake pops in or snaps off abruptly at the field edges;
  most of their life they hold at a gentle, translucent brightness (this is airy
  snow, not opaque paint). The few twinkling flakes gently **pulse** their opacity.
- **Size:** each flake holds roughly its size through its life (snow does not grow
  or shrink as it falls); the **variety comes from flake to flake**, not from a
  single flake changing size. The rotating flakes turn slowly about their center.

## How the tool behaves

The `particle-2d` binary already on your `PATH` is the **only** channel for shaping
this effect — you build the system by calling it **one operation at a time**, and
the ordered list of operations you issue, recorded to `actions.json`, is the
**authoritative output**. You are authoring a **system** (emitters, forces,
per-particle curves), **not** placing individual flakes: the review UI and a game
**simulate it live** from the system you author.

Run `particle-2d --help` to list every operation and `particle-2d <operation>
--help` for one operation's exact flags — that help text is the authoritative
contract. When you are ready to see your progress — and, importantly, **before you
finish** — run `particle-2d render`: it simulates the system over the 3000 ms,
writes the preview GIF, and **emits the `system.json` the run's result is built
from**. An effect you never render leaves an empty system, which is recorded as
empty, so render before you stop. The field dimensions, duration, and fps are
already seeded alongside the workspace — no operation needs those flags.

Because the effect is **simulated live** and **loops**, it **varies slightly from
one play to the next** — the flakes fall in a slightly different arrangement each
time. That is correct for ambient snow: author it so the *character* — a calm,
continuous field of soft varied flakes drifting and swaying downward, in the cool
white-and-pale-blue palette — **reads the same across every replay** and **loops
seamlessly**, rather than depending on any one frozen arrangement of flakes.
