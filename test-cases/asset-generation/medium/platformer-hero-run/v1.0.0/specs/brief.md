# Platformer Hero Run Cycle — drawing brief

You are drawing a **platformer hero run cycle**, a **sprite sheet** of a side-view
mascot character running to the right. It is a friendly platformer hero: a
**rounded body**, a **big friendly head**, and **boots** — the kind of springy,
appealing mascot a 2D side-scroller is built around. You are drawing it in one full
**run cycle**, six frames, all facing **right**.

The frames play back as a looping run: over the six poses the **legs and arms swing
through a complete stride** and the body **bobs slightly** as it takes and releases
its weight, so it reads as a believable run rather than a stiff shuffle. Every frame
is the **same character at the same scale** — only the pose changes.

## Compositing — a character on transparency

Every frame is drawn on a fully **transparent** background so it composites onto a
level.

- The only opaque pixels are the hero itself; do **not** fill the background.
- Keep everything in the **palette** below — no other colors.

## The frames

- Each frame is its own **48×48-pixel** image with a transparent background. Origin
  is the top-left; `x` increases to the right, `y` increases downward (0–47). The
  hero sits within the frame with a few pixels of margin, centered, reading clearly
  as a whole figure — not clipping the edges, not lost in the middle.
- You choose which frame an operation draws into with `--frame <index>`. The sheet
  has **6 frames, numbered 0–5**, played in order and looping (frame 5 flows back
  into frame 0).

## What goes in each frame

The same hero facing **right**, stepped through the key poses of a run. Read the
whole thing as one stride: the body is **lowest** when it takes weight (contact and
recoil) and **highest** when it pushes off (passing into the high point), and the
arms swing in **counter-time** to the legs — as the right leg drives forward the
right arm swings back, and vice versa.

| Frame | Pose | What it looks like |
| --- | --- | --- |
| 0 | **Contact** | Lead leg reaches forward and plants; trailing leg stretched back. Body at mid height. Arms opposed — the arm opposite the lead leg swings forward. |
| 1 | **Recoil / down** | Body at its **lowest** — the support leg bends to absorb the landing, the free leg lifts and folds up behind. A little squash through the body. |
| 2 | **Passing** | The free leg swings **forward under the body**; the figure is roughly upright and **rising**, weight rolling onto the support foot. |
| 3 | **High point / up** | **Push-off** — body at its **highest**, briefly airborne, legs stretched apart front and back, arms at full swing. A little stretch through the body. |
| 4 | **Return (descending)** | Coming back down — the opposite foot now reaches forward toward the next contact, mirroring frame 0's leg action, body dropping from the high point. |
| 5 | **Return (settle)** | The reaching foot plants and the body dips again, the tail of the stride that carries momentum straight back into the **contact** of frame 0 for a seamless loop. |

Make it read as **one appealing hero**:

- A **rounded, friendly body** with a **big head**, a simple readable face (eyes,
  and enough of a nose/mouth to give it life), **hair**, a **shirt** over the torso,
  **pants** on the legs, and chunky **boots** on the feet.
- A **bold, consistent outline** wraps the figure so it has a clean silhouette on
  transparency in every pose. Shade with the darker tones (skin shadow, shirt dark,
  pants dark) to give the character a little form and weight, but keep it crisp and
  readable at this small size.
- Keep the character **on model**: the head, body, and limbs hold the **same size,
  proportions, and volume** in all six frames. Arms and legs keep their length and
  thickness as they swing — nothing swells, shrinks, or drifts frame to frame.
- Sell the **motion**: swing the near and far legs convincingly (the near leg reads
  slightly bolder, the far leg a touch darker or set behind), swing the arms in
  counter-time, and let the body **bob** up and down through the stride so weight
  reads through each step.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Outline | `#2a2118` |
| Skin | `#f2c290` |
| Skin — shadow | `#c98f5a` |
| Shirt | `#e5533b` |
| Shirt — dark | `#a8321f` |
| Pants | `#3b6ea5` |
| Pants — dark | `#274a70` |
| Boots | `#4b3a2a` |
| Hair | `#8a5a2c` |

## Working the tool

Build one clean pose first — the **contact** frame (frame 0): a rounded body and big
head, the face and hair, the shirt over the torso, pants and boots on the legs, arms
opposed, all wrapped in the bold outline — then reuse that figure for the other
frames, re-posing the arms and legs and shifting the body up or down for each pose so
the six read as a stride. Use the filled-circle and rectangle operations for the
round head and body, lines or thin rectangles for the swinging arms and legs, single
pixels for the eyes and small details, and the outline color to keep a crisp
silhouette. Run `draw-sheet --help` for the available operations and `draw-sheet
<operation> --help` for each one's exact flags. Call `draw-sheet` once per operation
and read `frames/<index>.png` between calls. Play the six frames as a loop in your
head — contact, down, passing, up, and back — and keep it the same appealing,
booted hero at the same size in every frame.
