# Wireworm Node — drawing brief

You are drawing the **capacitor node**, a **sprite sheet** for a circuit-board
arcade game. The board is a dense field of these little nodes; a segmented
data-worm winds down through them, and each time the worm bumps a node the node
gains **charge**. A fully-charged node is a weapon — the player shoots it to set
off a discharge. So this sprite's whole job is to read, at a glance, as a small
electronic component whose **charge level** is unmistakable: dead and dark when
inert, glowing brighter as it charges, and clearly **critical** — loaded and
dangerous — at the top of the ramp.

You are drawing the node as a short **animation**: a **charge-up** ramp from
inert to critical, and a **critical pulse** that loops while it is loaded.

## Compositing — a component on transparency

The node is drawn on a fully **transparent** background so it composites onto the
dark circuit board.

- The only opaque pixels are the node itself (its casing, leads, core, and glow);
  do **not** fill the background.
- Keep everything in the **palette** below — no other colors.

## The frames

- Each frame is its own **32×32-pixel** image with a transparent background.
  Origin is the top-left; `x` increases to the right, `y` increases downward.
  Coordinates are **within the frame** (0–31). Build every frame around the same
  centered component so the frames line up when played in sequence.
- You choose which frame an operation draws into with `--frame <index>`. The
  sheet has **5 frames, numbered 0–4**.

### The component (identical geometry in every frame)

Draw the **same** small upright capacitor can, centered, in every frame — only
its **core** and **glow** change from frame to frame. Its geometry:

- **Can body:** an upright rounded rectangle from about **(9, 7)** to **(23, 25)**
  — roughly 14 px wide, 18 px tall, centered on **x = 16** with a ~4 px margin on
  the left and right. Outline it in the metal rim color; fill the casing with the
  casing color.
- **Top cap:** a thin band across the top of the can (about **y = 7–9**) in the
  metal rim color, reading as the sealed lid of the can.
- **Leads:** two short vertical pins dropping from the base of the can, at about
  **x = 12** and **x = 20**, from **y = 25** to **y = 29**, in the metal rim
  color — the legs that solder the component to the board.
- **Core window:** a vertical oval/bar down the center of the can, about
  **(13, 11)** to **(19, 23)**. This is the light pipe that shows the charge; it
  is what brightens across the frames.

## What goes in each frame

The node across its charge states:

| Frame | State | Core & glow |
| --- | --- | --- |
| 0 | **inert** (charge 0) | Core is the dark unlit color. No glow, no halo. Dead component. |
| 1 | **charging** (charge 1) | Core lit from the bottom in the low charge color, roughly its lower half; still no halo. |
| 2 | **charged** (charge 2) | Core filled in the mid charge color; a faint 1 px glow halo appears hugging the can's outline. |
| 3 | **critical** (charge 3) | Core white-hot; a bright glow halo rings the can; a few amber overcharge sparks flick off the top cap and leads — it reads as loaded and dangerous. |
| 4 | **critical — pulse peak** | The critical frame at its peak: the same white-hot core, but the halo swells one ring wider and the amber sparks are brighter and more numerous — the top of the pulse. |

Make the ramp read as a component **filling with charge**, not five unrelated
pictures:

- The can, top cap, and leads are pixel-identical in all five frames; only the
  **core** and the **glow/sparks** change.
- The core brightens **monotonically** — dark (0) → low fill from the bottom (1)
  → full mid fill (2) → white-hot (3, 4). Do not let a later frame look dimmer
  than an earlier one.
- The **halo** first appears at frame 2 (faint), grows bright at frame 3, and is
  widest at frame 4. It is a soft glow around the can's silhouette, not a hard
  ring far from it.
- **Amber overcharge sparks** appear **only** at critical (frames 3 and 4) — a
  handful of loose amber pixels near the top cap and jumping off the leads.
  Frame 4 has more of them than frame 3. They never appear on frames 0–2.
- Keep the component **centered** and the **same size** in every frame.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Casing (can body) | `#25303a` |
| Metal rim / top cap / leads | `#5a7183` |
| Core — inert (unlit) | `#20343d` |
| Charge glow — low | `#2f9e86` |
| Charge glow — mid | `#54e6bd` |
| Core — critical (white-hot) | `#e6fff7` |
| Overcharge spark (amber, critical only) | `#ffb43a` |

## Working the tool

Draw the shared component **once** and reuse it: a good order is to build the
inert node (frame 0) first — the can outline, casing fill, top cap, leads, and
the dark core — then copy that same geometry into the other four frames and only
change the core fill, halo, and sparks per the table above. Use the rectangle and
circle operations for the can body and core, single pixels or short lines for the
leads and the amber sparks, and a stroked outline for the glow halo, widening it
from frame 2 to frame 4. Run `draw-sheet --help` for the available operations and
`draw-sheet <operation> --help` for each one's exact flags. Call `draw-sheet`
once per operation and read `frames/<index>.png` between calls to judge that frame
against this brief. Play the frames in your head as two loops — **0→1→2→3** as the
charge climbs and **3↔4** as the loaded node pulses — and make sure both read
clearly.
