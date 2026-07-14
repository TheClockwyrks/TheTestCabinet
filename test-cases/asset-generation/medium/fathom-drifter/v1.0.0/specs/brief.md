# Fathom Drifter — drawing brief

You are drawing the **bonus drifter**, a **sprite sheet** for a deep-sea maze-chase
game. The drifter is a **harmless amber jellyfish** that wanders the flooded
corridors of a pitch-dark trench; the player grazes it for a burst of bonus points.
It is not a predator and not the player — just a drifting glow the player chases for
score.

You are drawing the jellyfish as a short **animation**: a single directionless
**sway loop** of a glowing amber bell with a frilled skirt and tendrils drifting
below it.

> **These frames double as the Lanternjaw's disguise.** In the game a wandering
> Lanternjaw predator wears this exact jellyfish as camouflage, so a lurking hunter
> cannot be told from a harmless drifter at a glance. The Lanternjaw's sprite sheet
> reuses these eight frames pixel-for-pixel — so draw a clean, generic amber
> jellyfish here, with nothing that hints at a predator (no jaws, no teeth, no dark
> body).

## The frames

- Each frame is its own **32×32-pixel** image with a transparent background.
  Origin is the top-left of the frame; `x` increases to the right, `y`
  increases downward. Coordinates are **within the frame** (0–31) — there is no
  shared sheet to offset into.
- You choose which frame an operation draws into with `--frame <index>`. The
  sheet has **8 frames, numbered 0–7**, played in order as one loop. Keep a pixel
  or two of margin so the jellyfish sits inside its frame, neither tiny in a corner
  nor clipped at the edge.

## What goes in each frame

One **sway loop** — the same drifting jellyfish in every frame, its skirt and
tendrils rippling a little from frame to frame so playing `0`→`7` reads as a gentle,
continuous drift:

| Frames | Contents |
| --- | --- |
| 0–7 | the amber jellyfish drifting — the bell steady up top, the frilled skirt and hanging tendrils swaying a pixel or two across the loop |

- The jellyfish is **directionless** — it reads the same whichever way it drifts —
  so this is a **single loop**, not four-direction swim pairs. Do not draw a leading
  head or a forked tail; a jellyfish has neither.
- Keep the **bell fixed** in place across all eight frames (a jellyfish's bell
  barely moves); animate only the **skirt and tendrils**, which ripple and sway
  gently. Nudging them a pixel or two per frame, and easing back, reads as drifting.

## The form

The drifter reads, at a glance, as a **glowing amber jellyfish**:

- **Bell (bulb):** a rounded, glowing **amber bell** at the top — the dome of the
  jellyfish, with a **bright core**. This is the brightest element and the
  drifter's signature; in the game it also reads as the always-visible "bulb."
- **Skirt:** a **frilled amber skirt** around the lower rim of the bell.
- **Tendrils:** a few thin **tendrils** in a dimmer amber hanging below the bell,
  trailing down and swaying as it drifts.
- No eyes, no mouth, no head, no tail — just a bell and its tendrils.

The always-visible amber **bulb-point** the game shows in the dark is a **runtime
glow** the game draws at the creature's center; it is **not** part of this sheet, so
do not add a separate bright halo or light rings — just draw the jellyfish (bell,
skirt, tendrils).

## Palette

Use only these colors:

| Role | Hex |
| --- | --- |
| Amber bell (bulb) | `#ffd166` |
| Bell core / highlight (bright) | `#fff3c4` |
| Tendrils & frilled skirt (dim amber) | `#d99a3a` |
| Outline / shadow (darkest) | `#0e1622` |

The bell (`#ffd166` with a `#fff3c4` core) is the bright anchor; the skirt and
tendrils are the dimmer amber (`#d99a3a`); a near-black (`#0e1622`) reads the shape
against the dark trench. Do not use any cold or predatory color — the drifter is
pure warm amber.

## Working the tool

The `draw-sheet` binary is the only way to make a mark. You draw into the frame
you select with `--frame <index>`, using plain in-frame coordinates (0–31). Run
`draw-sheet --help` for the available operations (filling and stroking circles
and rectangles, lines, single pixels, flood fill, and a horizontal mirror) and
`draw-sheet <operation> --help` for each one's exact flags. Call `draw-sheet`
once per operation and read `frames/<index>.png` between calls to judge that
frame against this brief.
