# Foray Royal Jelly — drawing brief

You are drawing the **royal jelly** node, a **sprite sheet** for *Foray*, a
top-down ant-colony raiding game. Two colonies raid each other's territory for
seeds and royal jelly; a **jelly node is a bonus resource** that sits on the
board in **two states** — **active** (a glowing node, there to be eaten) and
**spent** (a dimmed husk, left behind once it has been consumed). You are drawing
both states. Royal jelly belongs to **neither colony** — it is a shared prize, so
it is *not* recolored (see **Palette**).

## The frames

- Each frame is its own **16×16-pixel** image with a transparent background.
  Origin is the top-left of the frame; `x` increases to the right, `y`
  increases downward. Coordinates are **within the frame** (0–15) — there is no
  shared sheet to offset into.
- You choose which frame an operation draws into with `--frame <index>`. The
  sheet has **2 frames, numbered 0–1**:

  | Frame | State |
  | --- | --- |
  | 0 | **active** — a glowing royal-jelly node |
  | 1 | **spent** — the dimmed husk left after it is eaten |

- The two frames are the **same node** in two states: frame 1 is what frame 0
  becomes once consumed — same size and place, drained of its glow. A reviewer
  plays 0→1 to see it deplete, so they must read as before/after of one node.
- The node is seen from directly above (top-down): draw it **centered and roughly
  symmetric**, filling most of the cell with about a pixel of margin.

## The form

### Frame 0 — active

Reads, at a glance, as a **glowing blob of royal jelly**:

- **Body:** a rounded, slightly irregular blob of green jelly filling most of the
  tile — soft and organic, not a hard geometric shape.
- **Glow core:** a **bright pale core** at the center, so it reads as
  *luminous* — lit from within, the freshest, most valuable thing on the board.
- **Sheen:** a lighter highlight on the body suggesting a wet, gel surface.

### Frame 1 — spent

Reads, at a glance, as the **same node drained and dimmed**:

- The same rounded shape and position, but in the **dull spent color** — no
  bright core, no luminous sheen. It is a flatter, darker husk: clearly the
  *leftover* of frame 0, obviously dead next to the glowing active node.

## Palette

Royal jelly is **shared and never recolored** — the same colors for both
colonies. Use only these colors:

| Role | Hex | Used in |
| --- | --- | --- |
| Jelly green (active body) | `#7be0a0` | frame 0 |
| Glow core / sheen (bright) | `#ffffff` | frame 0 |
| Spent husk (dull green-grey) | `#3c5a47` | frame 1 |
| Outline | `#0a0806` | both frames |

The active node is the green `#7be0a0` lit by a bright `#ffffff` core; the spent
node is the dull `#3c5a47` husk with no bright core. The `#0a0806` outline
defines both. Do not use any other color — in particular the spent frame must
**not** reuse the bright green or the white, so the two states read clearly apart.

## Working the tool

The `draw-sheet` binary is the only way to make a mark. You draw into the frame
you select with `--frame <index>`, using plain in-frame coordinates (0–15). Run
`draw-sheet --help` for the available operations (filling and stroking circles
and rectangles, lines, single pixels, flood fill, and a horizontal mirror) and
`draw-sheet <operation> --help` for each one's exact flags. Call `draw-sheet`
once per operation and read `frames/<index>.png` between calls to judge that
frame against this brief.
