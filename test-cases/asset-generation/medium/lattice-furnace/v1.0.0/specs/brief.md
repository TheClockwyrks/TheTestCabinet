# Lattice Furnace — drawing brief

You are drawing the **Lattice furnace**, a **sprite sheet** for a top-down factory
simulation. The furnace is the factory's **smelter**: fed raw ore and burning
**coal** for fuel, it melts the ore down into metal plates. Without coal it cannot
burn, so it sits cold and idle. The renderer draws this sprite wherever a scenario
places a furnace. Everything below describes that furnace, seen from directly above.

It must read as a compact **coal-fired smelting furnace** — a heavy hearth with a
burning firebox — and **not** as a length of belt, a crate, or the boxy domed
assembler. It has a **small footprint**: it covers a **2×2 block** of tiles and
fills a **64×64** frame, plainly smaller and simpler than the 3×3 assembler.

## Draw the fuel, not the ore

The furnace burns **coal**, and coal is drawn: a load of dark coal chunks packed
around or inside the firebox is part of the machine — it is the fuel that makes the
fire, and the sprite should show it.

But do **not** draw the **ore or plate** being smelted. A furnace smelts **whatever**
ore a scenario feeds it — iron ore into iron plate, copper ore into copper plate — and
the **renderer draws those items** arriving and leaving at run time. A fixed lump of
iron or copper baked into the sprite would show the *same* cargo in every frame no
matter what the furnace is actually processing, which is wrong. So you draw the
furnace, its coal fuel, and its fire — never a specific ore or plate.

## The style — flat, top-down 2D

Lattice is drawn **flat**: you are looking straight down at the furnace, and it is a
clean **2D shape on the grid** — crisp outline, flat areas of color, shading used to
give the body a little inset depth and to make the firebox read as a recess, rather
than to fake real height. No beveled block standing off the floor, no cast shadow, no
side view.

## Orientation — non-directional

The furnace is **non-directional**: draw it **symmetric**, with no front, back, or
facing, so it reads correctly however the factory places it. The renderer never
rotates it. Keep the body and the firebox four-way symmetric — the firebox centered,
the fuel and detailing arranged the same on every side — so no edge reads as "the
front".

## The frames

- Each frame is its own **64×64-pixel** image with a transparent background — the
  furnace's 2×2 footprint at the game's normal tile resolution. Origin is the
  top-left of the frame; `x` increases to the right, `y` increases downward.
  Coordinates are **within the frame** (0–63).
- You choose which frame an operation draws into with `--frame <index>`. The sheet
  has **12 frames, numbered 0–11**, forming **two** animation loops:

| Frames | State | What it shows |
| --- | --- | --- |
| **0–3** | **Off (idle)** | The furnace **cold** — a dark, unlit firebox, no flames. A four-frame low idle. |
| **4–11** | **Smelting** | The firebox **blazing** — a glowing fire that roils around a pulsing white-hot core. An eight-frame burn loop. |

- Keep a small **even margin** (about 3–4 px) so the hearth sits inside its frame,
  centered, neither tiny in a corner nor clipped at the edge.

## The body (the same in every frame)

The furnace is a heavy square **hearth** with a firebox cut into its middle. These
parts do **not** change between frames — only the fire inside does:

- **Casing:** a grey-blue **steel** body filling most of the 64×64 frame, built from
  the steel mid tone as the main fill with the steel light tone as an upper-left edge
  highlight and the steel dark tone as a lower-right inset shade, outlined all around
  with the dark outline tone so it reads as a solid machine sitting on the ground.
- **Firebox:** a **centered square combustion chamber** cut into the casing — a
  smaller square framed by the dark outline and a **dark refractory rim** (the steel
  dark tone), so it reads as a **recess/pit** in the body, not a panel painted on
  top. This is where the fire burns; it is the machine's unmistakable central
  feature. Its frame keeps the same dark rim in every frame so the pit never turns
  into a sticker when it lights up.
- **Coal fuel:** dark **coal chunks** lining the firebox — a band of fuel packed
  around the inside of the chamber (or across its floor). Draw it in the coal tones
  (a near-black charcoal with a cool sheen), present in **every** frame. When the
  furnace smelts, the coal glows/embers between the lumps; when off, it sits unlit
  and dark.
- **Detailing** in the steel tones is welcome to sell the heavy-hearth reading —
  corner bolts, plating seams, or short flue vents — as long as it stays symmetric,
  stays in palette, and reads as part of the machine.

## The two states

### Off (frames 0–3)

The furnace is **cold** — it has no ore to smelt, so the fire is out. The firebox is
a **dark, unlit pit**: no flames, no bright glow, the coal dark and unlit. So the
four frames are not a dead-frozen image, let the furnace **idle** subtly — for
example a **faint, dull banked ember** at the very center that slowly breathes up and
back down over the four frames — but keep it clearly **cold**: nothing in an off
frame is as bright as the smelting fire, and a viewer reads "not working" instantly.
Frame 3 must ease back toward frame 0 so the idle loops seamlessly.

### Smelting (frames 4–11)

The firebox is **alight**: the furnace is smelting. Fill the chamber with a **hot
glow** built from the heat ramp — a dark ember at the rim through red and orange to a
**bright yellow-to-white core** — so the pit reads as looking down into a fire. Over
the eight frames the fire **roils and pulses**: the hot core throbs (brighter/larger
then dimmer/smaller), flame flicker plays around it, and the coal embers glow. Vary
the fire across all eight frames so it reads as a live burn rather than two frames
alternating, and make frame 11 return to where frame 4 began so the burn loops
seamlessly.

In **both** states the heavy chassis holds **perfectly still** in exactly the same
place — the animation is the fire inside the firebox, never the machine moving or
shaking.

## Heat is the working accent — firebox only

The heat ramp (ember, red, orange, yellow, white) is the furnace's **working
signal**, exactly as it burns. Use it **only inside the firebox**. It must never
appear on the steel casing, the bolts, or the detailing, so that a glow always means
"the fire is lit" and a glance at the body's edges never lies about whether the
furnace is smelting. The steel body stays grey-blue in every frame.

## Palette

Use only these colors:

| Role | Hex |
| --- | --- |
| Dark outline / shadow | `#1b1d21` |
| Steel light (grey-blue) | `#828c9b` |
| Steel mid (grey-blue) | `#5a6472` |
| Steel dark (grey-blue) | `#3a404b` |
| Coal (unlit fuel) | `#33363d` |
| Coal sheen | `#6b7a86` |
| Heat — ember (dark) | `#7a2d16` |
| Heat — red | `#d6473a` |
| Heat — orange | `#f0894a` |
| Heat — yellow | `#ffcf5c` |
| Heat — white core | `#fff3cf` |

The steel tones are the same grey-blue chassis the other Lattice machine icons use,
so the furnace reads as one of the family. The heat ramp is the fire and belongs only
in the firebox.

## Working the tool

The `draw-sheet` binary is the only way to make a mark. You draw into the frame you
select with `--frame <index>`, using plain in-frame coordinates (0–63). Run
`draw-sheet --help` for the available operations (filling and stroking circles and
rectangles, lines, single pixels, and flood fill) and `draw-sheet <operation>
--help` for each one's exact flags. Call `draw-sheet` once per operation and read
`frames/<index>.png` between calls to judge that frame against this brief.
