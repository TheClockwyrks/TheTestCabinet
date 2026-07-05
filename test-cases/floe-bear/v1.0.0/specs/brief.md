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
directions**, a **swim in four directions** (seen from above, mostly submerged),
and a **lunge** (its strike). Every frame — run, swim, and lunge alike — is drawn
from the **same overhead (top-down) camera**: the view looks straight down on the
bear and **never rotates to a side/profile**, not even for left/right movement.

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
  sheet has **18 frames, numbered 0–17**.

## What goes in each frame

The bear is seen from **directly overhead (top-down)** in **every** frame (as in a
top-down crossing game) — the same animal throughout; only its facing and pose
change. **The camera never rotates to a side view**: when the bear faces left or
right you are still looking straight down on its **back**, with its body simply
turned across the frame — a side/profile silhouette is wrong for any frame.

| Frames | Pose | Contents |
| --- | --- | --- |
| 0, 1 | **run — down** (toward the viewer) | Seen from above, head toward the bottom of the frame, a two-frame run: legs swap between the frames (front-left/back-right forward, then the opposite). Small dark eyes and nose on the low head. |
| 2, 3 | **run — up** (away) | Seen from above, head toward the top (you see its back and haunches), two-frame run, legs swapping. |
| 4, 5 | **run — left** | **Still seen from directly above** — the bear turned so its head points **left** and its spine runs left-to-right across the frame; you look down on its **back**, NOT a side profile. Two-frame run: the legs to either side reach and gather for a lumbering gallop. |
| 6, 7 | **run — right** | The left run **mirrored** — head points **right**, still overhead (not a profile), two-frame run. |
| 8, 9 | **swim — down** | Seen from above, **mostly under water**, heading **down** the screen: a muted, cool submerged silhouette (darker than the fur), only the top of the head/back breaking the surface in fur-white, and a pale **wake** (a couple of curved ripple lines) trailing **behind** it (up-screen). Two frames: shift the wake and paddle. |
| 10, 11 | **swim — up** | The same submerged overhead read, heading **up** the screen; the wake trails behind it (down-screen). Two frames. |
| 12, 13 | **swim — left** | The same submerged overhead read, heading **left** (still top-down, NOT a profile); the wake trails behind it (to the right). Two frames. |
| 14, 15 | **swim — right** | The left swim **mirrored** — heading **right**, wake trailing to the left. Two frames. |
| 16, 17 | **lunge** | The strike, still overhead: the bear **lunging forward** with its **maw open** (a red mouth) and front paws thrown forward with dark claws — unmistakably attacking. Two frames: wind-up, then the open-maw lunge. |

Make it read as **one big animal**:

- **Every frame uses the same overhead (top-down) camera.** Even for left and
  right you are looking straight down on the bear's **back** — its body just points
  that way across the frame. **Never** switch to a side/profile view for lateral
  movement; a profile silhouette (seeing the bear from the side, its legs hanging
  below a horizontal spine) is wrong.
- The bear is the **same size, bulk, and coloring** in every frame — a heavy body
  with a low, broad head; it never changes size between frames.
- Its **legs are thick and powerful** — short, heavy, blocky limbs at least a
  couple of pixels wide, the broad legs of a big bear. Never draw them as thin
  single-pixel sticks or twigs.
- Keep the **dark outline** on the body in every frame, and shade the underside/
  far side with the **cool fur shadow** so the white body has form and doesn't
  read as a flat blob.
- The **run** frames animate as a two-frame gait (legs swap); keep the body
  centered so it runs in place. The **swim** frames are mostly the submerged
  silhouette + wake, one heading per pair (down/up/left/right); the **lunge**
  frames are the only ones with the open red maw and raised clawed paws.
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

Build one run frame first — block the heavy body as a rounded mass in fur-light
seen from **directly above**, outline it in the dark color, shade the far side and
underside with the cool fur shadow, then add the head with its dark eyes and nose
and the four thick, stocky legs. Reuse that same overhead body for every other
frame: swap the legs for each run pose, and **mirror the left run to make the
right** and the left swim to make the right — keeping the camera overhead, so left
and right are the bear turned sideways *as seen from above*, never a profile. For
the **swim** headings mute the body to a submerged silhouette with a pale wake
trailing behind its heading (down, up, left, right). For the **lunge** throw the
forepaws forward with dark claws and open the red maw. Use the filled-circle and
rectangle operations for the body mass, head, and thick legs, single pixels or
short lines for claws, eyes, nose, and the wake, and the horizontal mirror to turn
each left frame into its right. Run `draw-sheet --help` for the available
operations and `draw-sheet <operation> --help` for each one's exact flags. Call
`draw-sheet` once per operation and read `frames/<index>.png` between calls.
Picture each two-frame loop as you go — the four runs galloping in place, each swim
heading paddling with its wake, the lunge snapping its maw open — and keep the
animal the same heavy bear, seen from above, throughout.
