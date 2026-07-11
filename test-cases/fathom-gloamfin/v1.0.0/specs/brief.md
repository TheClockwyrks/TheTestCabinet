# Fathom Gloamfin — drawing brief

You are drawing the **Gloamfin**, a **sprite sheet** for a deep-sea maze-chase
game. In that game the Gloamfin is **the Listener**: a **non-playable
pursuer**, an eyeless predator that hunts the player by **sound** — it homes
in on sonar and emits its own sonar pulses. Everything below describes the
*enemy* — never the player character.

You are drawing the **creature** here: its eyeless body swimming in four
directions. The sonar pulse it emits — a wavefront that floods outward through
the corridors — covers a far larger area than this sprite and is **not** part of
this sheet; the game draws it itself, in code. Do not try to draw a sonar pulse
here; just the creature, with a faint sonar cue at its head.

## The frames

- Each frame is its own **32×32-pixel** image with a transparent background.
  Origin is the top-left of the frame; `x` increases to the right, `y`
  increases downward. Coordinates are **within the frame** (0–31) — there is no
  shared sheet to offset into.
- You choose which frame an operation draws into with `--frame <index>`. The
  sheet has **8 frames, numbered 0–7**. Keep a pixel or two of margin so the
  creature sits inside its frame, neither tiny in a corner nor clipped at the
  edge.

## What goes in each frame

The sheet holds **four-direction movement**, two frames per direction (a small
swim cycle):

| Frames | Contents |
| --- | --- |
| 0, 1 | **swim down** — two frames (the tail flicks between them) |
| 2, 3 | **swim up** — two frames |
| 4, 5 | **swim left** — two frames |
| 6, 7 | **swim right** — two frames |

In each **movement** frame the creature faces its direction of travel: the
**blunt head leads** (points the way it swims) and a **forked tail trails**
behind. Across the two frames of a direction, flick the tail (a small 1–2 px
change) so the pair reads as a swim cycle. The left frames are the mirror of
the right; up is the mirror of down.

## The form

The Gloamfin reads, at a glance, as an **eyeless predator that hunts blind**:

- **Body:** a rounded, tapering **teardrop** — a heavy blunt head with the
  body narrowing to a forked tail.
- **Head:** smooth and blunt, leading the direction of travel. It has **no
  eyes at all** — do not draw an eye, a socket, or a highlight where an eye
  would be. The eyelessness is the whole point of the creature.
- **Belly:** a lighter patch under the head.
- **Tail:** a swept, forked tail fin trailing behind the head.
- **Mouth:** a small, dark slit near the front of the head.
- **Sonar cue:** a small faint accent in the pale sonar color at the head — the
  sensory spot it listens and pulses from. Keep it small and on the body; the
  pulse itself is a separate effect, not drawn here.

## Palette

Use only these colors:

| Role | Hex |
| --- | --- |
| Body | `#c46bff` |
| Belly / lighter underside | `#e0b3ff` |
| Outline / mouth (darkest) | `#3a1a55` |
| Sonar accent (pale) | `#5ef2ff` |

## Working the tool

The `draw-sheet` binary is the only way to make a mark. You draw into the frame
you select with `--frame <index>`, using plain in-frame coordinates (0–31). Run
`draw-sheet --help` for the available operations (filling and stroking circles
and rectangles, lines, single pixels, flood fill, and a horizontal mirror) and
`draw-sheet <operation> --help` for each one's exact flags. Call `draw-sheet`
once per operation and read `frames/<index>.png` between calls to judge that
frame against this brief.
