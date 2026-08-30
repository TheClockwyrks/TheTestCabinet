# Spectra — The stage

This file defines the geometry of the stage: the play field and the two HUD strips,
the ship's lane, the formation's slot grid and its sway, and where a drone or a
bullet crosses an edge. Every figure is in the logical units `specs/overview.md`
fixes, and every position is a center.

## The three regions

The stage is `STAGE_W x STAGE_H` (`1280 x 720`) and is divided into three
full-width horizontal regions.

| Region | Extent | Carries |
| --- | --- | --- |
| Top HUD strip | `y` in `[0, HUD_TOP_H]` (`[0, 64]`) | The score and the stage readout |
| Play field | `y` in `[FIELD_TOP, FIELD_BOTTOM]` (`[64, 656]`), `x` in `[FIELD_LEFT, FIELD_RIGHT]` (`[0, 1280]`) | Everything that moves |
| Bottom HUD strip | `y` in `[HUD_BOTTOM_TOP, STAGE_H]` (`[656, 720]`) | The lives, the resonance meter, the polarity indicator, and the mute indicator |

The ship, the drones, and the bullets are drawn inside the play field. A drone
crossing a HUD strip purely in transit is the one exception: a drone flying in from
above the field, and a diving drone wrapping down through the bottom, cross a strip
while they travel. `specs/swarm.md` states both paths.

`specs/ui.md` states what each readout shows.

## The ship's lane

The ship travels along a fixed horizontal lane. Its center `y` is `SHIP_Y` (`600`)
at all times, and its center `x` is clamped to `[SHIP_X_MIN, SHIP_X_MAX]`
(`[40, 1240]`), so the whole hull stays on the stage and the ship never wraps.
`specs/ship.md` states how it moves along that lane.

## The formation grid

A drone that has finished entering rests in a formation slot. The slots sit on a
grid `FORM_COLS` (`9`) columns across by `FORM_ROWS` (`5`) rows down, spaced
`SLOT_DX` (`64`) apart horizontally and `SLOT_DY` (`48`) apart vertically. The grid
is centered horizontally on `FORM_CENTER_X` (`640`), and its top row sits at
`FORM_ROW0_Y` (`140`).

| Function | Value |
| --- | --- |
| `slotX(col)` | `FORM_CENTER_X + SLOT_DX * (col - (FORM_COLS - 1) / 2)`, for `col` in `0..FORM_COLS - 1` |
| `slotY(row)` | `FORM_ROW0_Y + SLOT_DY * row`, for `row` in `0..FORM_ROWS - 1` |

The filled grid therefore spans `x` in `[384, 896]` and `y` in `[140, 332]`.

## The sway

The whole formation translates horizontally as one rigid body. At game time `t` the
block's offset is `swayOffset(t) = SWAY_AMP * sin(2 * PI * t / SWAY_PERIOD)`, with
`SWAY_AMP` (`20`) and `SWAY_PERIOD` (`5`) seconds. A drone resting in a slot sits at
`(slotX(col) + swayOffset(t), slotY(row))`, so every slotted drone carries the same
offset at the same instant and the block's shape never changes. The sway changes
nothing about which slots are filled.

`t` is the accumulated simulation time `specs/simulation.md` defines.

## Crossing the edges

- A drone enters from above the play field, crossing `FIELD_TOP` downward.
- A diving drone may leave below `FIELD_BOTTOM` and re-appear above `FIELD_TOP`.
  `specs/swarm.md` states when.
- A bullet that leaves the play field is removed: a player bullet whose center
  climbs above `FIELD_TOP`, and an enemy bullet whose center falls below
  `FIELD_BOTTOM`.

## The starfield

A starfield is drawn behind the play field, holding at least `STARFIELD_MIN` (`40`)
marks distinct from the field behind them. It sits behind everything the field
carries and never reads as bright as a drone of either band. Its layout, its motion
if it has any, and how a mark is drawn are yours.

## Where the readouts sit

| Readout | Region |
| --- | --- |
| Score | Top HUD strip |
| Stage | Top HUD strip |
| Lives | Bottom HUD strip |
| Resonance meter | Bottom HUD strip |
| Polarity indicator | Bottom HUD strip |
| Mute indicator | Bottom HUD strip |

How each is composed and placed within its strip is yours.
