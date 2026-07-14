# Floe Dogsled — drawing brief

You are drawing the **dogsled**, a **single sprite** for an arctic crossing game.
It is a **hazard**: a team of sled dogs pulling a musher's sled at speed across
the
lanes the player must cross. It has to read as a **fast-moving sled team** — clearly
a vehicle racing across the ice that you must dodge — not a lone creature and
not a
safe platform. It is the quick, light counterpart to the big slow snow plow.

It is **two tiles wide**, so the canvas is **64×32** (two 32-pixel tiles side by
side).

## The canvas

- A single **64×32-pixel** image with a transparent background. Origin is the
  top-left; `x` increases to the right (0–63), `y` increases downward (0–31).
- The team **faces and runs to the right** (the game mirrors it to move left), so
  the **dogs lead at the right** and the **sled trails at the left**. Draw it
  filling most of the 64×32 canvas.
- Draw on full **transparency** — the only opaque pixels are the sled team itself
  (and its snow spray); do **not** fill the background.

## The form

A sled-dog team seen from **directly overhead (top-down)**, as in a top-down
crossing game, running right:

- **Dogs:** two **husky** dogs at the leading (right) half (about **x = 34–60**),
  seen from above — elongated bodies pointing right, a pointed head/snout at the
  front and a bushy tail trailing at the back, drawn in the light husky fur with the
  darker husky tone down the **back** and for the ears, tail, and markings. Their
  **legs splay out to the sides** (up and down in the frame) in a running stride;
  draw the legs as short **stocky** limbs a few pixels thick — not thin
  single-pixel twigs. They should read as two huskies pulling hard, not one animal.
- **Harness / gangline:** a taut **rope** line (harness color) running back from the
  dogs to the sled, so the team reads as connected and pulling.
- **Sled:** a small **sled** at the trailing (left) end (about **x = 2–26**) — from
  above, a low rectangular platform in the dark sled color with two parallel
  **runners** along its top and bottom edges, so it reads as a racing sled.
- **Musher:** a small figure standing on the sled, seen from the top — head and
  shoulders in a **warm parka** (the parka color) at the back of the sled — a person
  driving, which sells it as a vehicle.
- **Snow spray:** a few pale spray pixels kicked up around the dogs' feet and behind
  the runners, reading as speed.

Keep it reading as a **fast sled team in motion** seen from above — low, stretched,
and racing — clearly a moving hazard, and clearly different from the big blocky plow
and from the soft lone critter.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Husky fur — light | `#d8dde0` |
| Husky — dark (back, legs, markings) | `#3a4249` |
| Sled / runners (dark) | `#2a2f34` |
| Harness / gangline (rope) | `#c08a3a` |
| Musher parka (warm) | `#e0562f` |
| Snow spray | `#eef6fa` |

## Working the tool

Block in the two overhead huskies at the right first — light bodies with the dark
back, ears, tail, and markings, and short stocky legs splayed to the sides — then
the taut harness line back to the sled, the low sled with its two parallel runners
at the left, the top-down warm-parka musher standing on it, and a few pale
snow-spray pixels around the feet and behind the runners. Use the rectangle and
line operations for the bodies, sled, and runners, short thick bars for the legs,
lines for the harness, and single pixels for the ears, eyes, and spray. Run
`draw --help` for the available operations and `draw <operation> --help` for each
one's exact flags. Call `draw` once per operation and read `canvas.png` between
calls to judge it against this brief — it should read at a glance as a fast sled
team seen from above, racing right across the 64×32 canvas, on full transparency.
