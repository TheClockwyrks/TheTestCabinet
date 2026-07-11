# Fathom Lanternjaw — drawing brief

You are drawing the **Lanternjaw**, a **sprite sheet** for a deep-sea maze-chase
game. In that game the Lanternjaw is a **non-playable pursuer**, an
anglerfish-style predator that hunts the player by **light** — but its whole trick
is that, until it fixes on you, it **hides as the harmless bonus drifter**, a
drifting amber jellyfish. Everything below describes the *enemy* — never the player
character.

The Lanternjaw has **two forms**, and this sheet holds both:

- a true **hunting** form — a dark predator with gaping **jaws** — that it wears
  while it is chasing you, and
- a **jellyfish disguise** it wears while **wandering**, so an undetected
  Lanternjaw looks exactly like a real bonus drifter.

**Both forms carry the same glowing amber bell** at the top of the sprite — the
"bulb" — and that shared bell is the point of the whole deception: it sits in the
**same place** and looks the **same** whichever form shows, and only what hangs
**beneath** it changes (jaws when hunting, tendrils when disguised). A reveal is
therefore **purely additive** — the bell never moves or changes; the jaws simply
appear around it.

## The frames

- Each frame is its own **32×32-pixel** image with a transparent background.
  Origin is the top-left of the frame; `x` increases to the right, `y`
  increases downward. Coordinates are **within the frame** (0–31) — there is no
  shared sheet to offset into.
- You choose which frame an operation draws into with `--frame <index>`. The
  sheet has **16 frames, numbered 0–15**. Keep a pixel or two of margin so the
  creature sits inside its frame, neither tiny in a corner nor clipped at the
  edge.

## What goes in each frame

The sheet holds the **hunting form** as a four-direction swim (two frames per
direction, a chomp) in frames 0–7, and the **jellyfish disguise** as an
eight-frame sway loop in frames 8–15:

| Frames | Contents |
| --- | --- |
| 0, 1 | **hunt down** — the amber bell over dark, gaping **jaws**; the two frames chomp (jaws close, then open) |
| 2, 3 | **hunt up** |
| 4, 5 | **hunt left** |
| 6, 7 | **hunt right** |
| 8–15 | the **jellyfish disguise** — an eight-frame tendril-sway loop, the harmless bonus drifter |

In each **hunting** frame the predator faces its direction of travel: the amber
**bell leads** (at the front, pointing the way it swims) with the dark **jaws
gaping** just beneath it, and a **forked tail trails** behind. Across the two
frames of a direction the jaws **chomp** — closed in the first frame, open in the
second — so the pair reads as a lunging predator. The left frames are the mirror of
the right; up is the mirror of down.

In the **disguise** frames (8–15) the creature reads as a **drifting jellyfish**:
the same amber bell up top, a **frilled skirt**, and a few **tendrils** hanging
below that ripple gently across the loop, so playing 8→15 reads as a jellyfish
drifting in place. It is directionless (a jellyfish reads the same whichever way it
drifts), so this is a single sway loop, not per-facing pairs.

> **These disguise frames are the bonus drifter.** Frames 8–15 must be drawn
> **pixel-identical to the separate bonus-drifter sprite** (the drifter's own
> eight-frame sway) so that, up close, a wandering Lanternjaw cannot be told from a
> real drifter. Author the jellyfish once and use the same marks here. The **amber
> bell** in the disguise is the very same bell baked into the hunting frames (0–7) —
> only the jaws-vs-tendrils below it differ.

## The two forms

### The hunting form (frames 0–7)

Reads, at a glance, as a **dark predator with a glowing amber bulb and gaping
jaws**:

- **Bell (bulb):** a rounded, glowing **amber bell** at the top/front of the
  sprite, with a **bright core** — the single brightest element, and the shared
  anchor of both forms. Draw it in the same size and place it will occupy in the
  disguise frames.
- **Jaws:** beneath the bell, a dark, **gaping maw** — an open predator's mouth
  lined with a couple of pale **tooth glints**. This is what the bell was hiding.
  The two frames of each direction close and open the jaws (the chomp).
- **Body:** a heavy, dark head narrowing to a **forked tail** behind, in a dark
  slate — the dark body is the point: unlit, only the amber bell gives it away.
- **Belly:** a slightly lighter patch on the underside.

### The jellyfish disguise (frames 8–15)

Reads, at a glance, as a **harmless drifting jellyfish** — the bonus drifter:

- **Bell (bulb):** the exact same **amber bell** with its **bright core**, in the
  same place as the hunting form — this is the shared anchor.
- **Skirt:** a **frilled amber skirt** around the rim of the bell.
- **Tendrils:** a few thin **tendrils** in dim amber hanging below the bell, which
  **sway** a pixel or two across the eight frames so the loop reads as a gentle
  drift. No jaws, no teeth — nothing predatory shows.

## Palette

Use only these colors:

| Role | Hex |
| --- | --- |
| Amber bell (bulb) | `#ffd166` |
| Bell core / highlight (bright) | `#fff3c4` |
| Tendrils & frilled skirt (dim amber) | `#d99a3a` |
| Dark jaws / head body (slate) | `#243042` |
| Belly / lighter underside | `#3a4a60` |
| Outline / jaw gape / tooth shadow (darkest) | `#0e1622` |
| Tooth glint (pale) | `#cdd8e4` |

The amber bell (`#ffd166` with a `#fff3c4` core) is shared by **both** forms and
must be drawn identically wherever it appears. The hunting form adds the dark jaws
(`#243042`) and their pale tooth glints (`#cdd8e4`) beneath it; the disguise adds
the dim-amber tendrils and skirt (`#d99a3a`) instead. Do not give the disguise any
jaw, tooth, or dark-slate body pixel, and do not give the hunting form tendrils — the
only thing the two forms share is the bell.

## Working the tool

The `draw-sheet` binary is the only way to make a mark. You draw into the frame
you select with `--frame <index>`, using plain in-frame coordinates (0–31). Run
`draw-sheet --help` for the available operations (filling and stroking circles
and rectangles, lines, single pixels, flood fill, and a horizontal mirror) and
`draw-sheet <operation> --help` for each one's exact flags. Call `draw-sheet`
once per operation and read `frames/<index>.png` between calls to judge that
frame against this brief.
