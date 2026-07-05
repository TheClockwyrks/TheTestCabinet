# Floe Bear — drawing brief

You are drawing the **ice bear**, a **sprite sheet** for an arctic crossing
game. It is the **hunter**: a huge white predator that stalks the player across
a
frozen strait — running them down on the pack ice and swimming after them through
the open water. It has to read, at a glance and from any facing, as a **big,
heavy, dangerous animal** — bulky and deliberate, never cute — and it has to stay
**readable against pale ice** (a dark outline and cool shadow) and **as a
silhouette under water**.

You are drawing the bear as its full movement set: a **run cycle in four
directions**, a **swim** (seen from above, mostly submerged), and a **lunge**
(its strike).

## Compositing — a creature on transparency

Every frame is drawn on a fully **transparent** background so it composites onto
the ice and the dark water.

- The only opaque pixels are the bear itself (plus, in the swim frames, its wake);
  do **not** fill the background.
- Keep everything in the **palette** below — no other colors.
- Because the bear is nearly white and the game's ice is pale, always carry the
  **dark outline** around the body so it never disappears against the ice.

## The frames

- Each frame is its own **32×32-pixel** image with a transparent background.
  Origin is the top-left; `x` increases to the right, `y` increases downward
  (0–31). The bear is a big animal — it fills most of the frame, with only a
  couple of pixels of margin.
- You choose which frame an operation draws into with `--frame <index>`. The
  sheet has **12 frames, numbered 0–11**.

## What goes in each frame

The bear from a **top-down three-quarter** view (as in a top-down crossing game),
the same animal in every frame — only its facing and pose change:

| Frames | Pose | Contents |
| --- | --- | --- |
| 0, 1 | **run — down** (toward the viewer) | The bear facing down the screen, a two-frame run: legs swap between the frames (front-left/back-right forward, then the opposite). Head low, small dark eyes and nose visible. |
| 2, 3 | **run — up** (away) | Facing up the screen (you see its back and haunches), two-frame run, legs swapping. |
| 4, 5 | **run — left** | In profile facing left, a two-frame run: the legs reach and gather so it reads as a lumbering gallop. |
| 6, 7 | **run — right** | The left run mirrored — in profile facing right, two-frame run. |
| 8, 9 | **swim** (submerged) | Seen from above, the bear **mostly under water**: draw its body as a muted, cool submerged silhouette (darker than the fur), with only the top of the head/back breaking the surface in fur-white, and a pale **wake** (a couple of curved ripple lines) trailing behind it. Two frames: shift the wake and paddle so it reads as swimming. |
| 10, 11 | **lunge** | The strike telegraph: the bear **rearing / lunging forward** with its **maw open** (a red mouth), front paws raised with dark claws — unmistakably attacking. Two frames: wind-up, then the open-maw lunge. |

Make it read as **one big animal**:

- The bear is the **same size, bulk, and coloring** in every frame — a heavy body
  with a low, broad head; it never changes size between frames.
- Keep the **dark outline** on the body in every frame, and shade the underside/
  far side with the **cool fur shadow** so the white body has form and doesn't
  read as a flat blob.
- The **run** frames animate as a two-frame gait (legs swap); keep the body
  centered so it runs in place. The **swim** frames are mostly the submerged
  silhouette + wake; the **lunge** frames are the only ones with the open red maw
  and raised clawed paws.
- Small dark **eyes and nose** read on the head in every land/lunge frame; the
  face is low and forward, predatory — not big-eyed or friendly.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Fur — light (body) | `#eef1ef` |
| Fur — cool shadow (underside/far side) | `#aebfc7` |
| Outline / eyes / nose / claws | `#26323a` |
| Submerged silhouette (swim frames) | `#5b6f7a` |
| Wake / surface ripple (swim frames) | `#cfe6f2` |
| Open maw (lunge frames) | `#c0473f` |

## Working the tool

Build one run frame first — block the heavy body as a rounded mass in fur-light,
outline it in the dark color, shade the far side and underside with the cool fur
shadow, then add the head with its dark eyes and nose and the four legs — then
reuse that body for the other frames, swapping the legs for each run pose,
mirroring the left run to make the right, muting the body to a submerged
silhouette with a wake for the swim, and adding the raised clawed paws and open
red
maw for the lunge. Use the filled-circle and rectangle operations for the body
mass and head, single pixels or short lines for legs, claws, eyes, nose, and the
wake, and the horizontal mirror to turn the left run into the right. Run
`draw-sheet --help` for the available operations and `draw-sheet <operation>
--help` for each one's exact flags. Call `draw-sheet` once per operation and read
`frames/<index>.png` between calls. Picture each two-frame loop as you go — the
four runs galloping in place, the swim paddling with its wake, the lunge snapping
its maw open — and keep the animal the same heavy bear throughout.
