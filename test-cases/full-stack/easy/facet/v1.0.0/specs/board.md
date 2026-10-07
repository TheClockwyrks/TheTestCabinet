# Facet — The board

This file defines what the board is made of and where everything sits: the grid
of cells, the geometry that places a cell on the stage, the seven gem kinds, the
four cuts, the strain a gem carries, and the notation a board is written in.

The rules a chain step obeys are in `specs/rules.md`. How a player operates the
board is in `specs/controls.md`. Every figure below carries the name this
specification gives it here.

## Cells

The board is a grid of `GRID_COLS` (`8`) columns by `GRID_ROWS` (`8`) rows. A
cell is addressed as `(col, row)`, both zero-indexed from the top-left, so `col`
runs `0` to `7` from the left edge to the right and `row` runs `0` to `7` from
the top edge to the bottom. Gravity pulls toward increasing `row`: a gem falls
down the screen, and an emptied cell is refilled from the top of its column.

Every cell holds exactly one gem while the board is settled. A cell stands empty
only between the removal of a chain step's clear set and the settling that ends
that step.

## Where a cell sits

Adjacent cell centers are `CELL_PITCH` (`72`) apart on both axes, and the grid
is centered on `(BOARD_CX, BOARD_CY)` (`640, 396`). The center of a cell is:

- `cellX(col) = BOARD_CX - (GRID_COLS - 1) * CELL_PITCH / 2 + col * CELL_PITCH`
- `cellY(row) = BOARD_CY - (GRID_ROWS - 1) * CELL_PITCH / 2 + row * CELL_PITCH`

Cell centers therefore run `x` `388..892` and `y` `144..648`. That leaves `144`
of stage above the topmost row of centers, where the readouts sit, and `72`
below the bottom row.

Two radii govern a gem.

| Constant    | Value | Governs                                                                                         |
| ----------- | ----- | ----------------------------------------------------------------------------------------------- |
| `GEM_R`     | `30`  | Every gem's drawn form fits inside this radius of its cell center.                              |
| `GEM_HIT_R` | `36`  | A cell is targeted by the pointer when the pointer is within this radius of that cell's center. |

## Kinds

`GEM_KINDS` holds the seven kinds in this order: `ruby`, `amber`, `citrine`,
`jade`, `beryl`, `sapphire`, `amethyst`. `GEM_KIND_COUNT` (`7`) is how many
there are. Each kind carries one appearance that reads apart from the other six
at a glance. The hues and the forms themselves are the build's to choose.

Kind is what a run is made of. Two gems of the same kind match whatever their
cuts and whatever their strain.

## Cuts

`CUTS` holds the four cuts in this order: `plain`, `brilliant`, `star`, `prism`.
Every gem carries exactly one cut, and `plain` is the ordinary one. A `plain`,
`brilliant`, or `star` gem carries one of the seven kinds; a `prism` carries no
kind at all.

Each cut reads as a treatment distinct from the other three, and a cut sits with
its gem's kind rather than replacing it, so a player reads a gem's kind and its
cut in the same glance. `specs/rules.md` says what creates each cut and what
each one does when it clears.

A cut gem is never still. `specs/assets.md` gives the produced effect that runs
continuously at every `brilliant`, `star`, and `prism` standing on the board, so
the three a chain earns are picked out by motion as well as by their treatment.
A gem's strain raises no such effect: damage is read off the stone itself.

## Strain

Strain is a whole number from `0` to `MAX_STRAIN` (`3`). Every gem carries one,
and a gem at `MAX_STRAIN` is flawed. A flawed gem reads apart from a gem at any
strain below it without a second look, and the four strain states are told apart
from one another. `specs/rules.md` says what raises strain and what a flawed gem
does.

## Presentation is yours

Facet pins the geometry above, the seven kinds, the four cuts, the four strain
states, and the notation below. It leaves the palette, the fonts, the gem
artwork, the board frame, the background, and the animation to the build.

What the look must deliver:

1. The seven kinds are told apart at a glance, at every strain and under every
   cut.
2. The four cuts are told apart at a glance, and a `prism` reads as belonging to
   no kind.
3. A gem's strain is readable without counting slowly, and a flawed gem is
   unmistakable.
4. Every gem's drawn form fits inside `GEM_R` (`30`) of its cell center once it
   is resting in that cell, so neighboring gems never collide. A gem drawn
   mid-fall or mid-swap is between cells, as `specs/rules.md` times it.
5. The board reads as an `8` by `8` grid, with each gem clearly sitting in one
   cell.
6. Text is legible against whatever it is drawn on at the logical stage size.

## Notation

<!-- cspell:ignoreRegExp /\b[RACJBSMX][0-3][bs]?\b/g -->

A board is written as `GRID_ROWS` lines of `GRID_COLS` space-separated cell
tokens, read from the top-left to the bottom-right. Each line is one row, and
the tokens within a line run in column order. A token is a kind letter, then a
strain digit, then an optional cut letter.

| Letter | Kind                                                              |
| ------ | ----------------------------------------------------------------- |
| `R`    | `ruby`                                                            |
| `A`    | `amber`                                                           |
| `C`    | `citrine`                                                         |
| `J`    | `jade`                                                            |
| `B`    | `beryl`                                                           |
| `S`    | `sapphire`                                                        |
| `M`    | `amethyst`                                                        |
| `X`    | A `prism`, which carries no kind. Its strain digit still applies. |

| Cut letter | Cut         |
| ---------- | ----------- |
| (none)     | `plain`     |
| `b`        | `brilliant` |
| `s`        | `star`      |

The strain digit is `0`, `1`, `2`, or `3`, and `3` is flawed. So `R0` is a plain
ruby at strain `0`, `J3` is a flawed jade, `S1b` is a sapphire brilliant at
strain `1`, `C0s` is a citrine star at strain `0`, and `X0` is a prism at strain
`0`.

A full board is eight such lines:

```
R0 A0 C0 J0 B0 S0 M0 R0
C0 J1 B0 S0 M0 R0 A0 C0
B0 S0 M2 R1 A0 C0 J0 B0
M0 R0 A0 C0 J0 B0b S0 M0
A0 C0 J0 B0 S1 M0 R3 A0
J0 B0 S2s M0 R0 A0 C0 J0
S0 M0 R0 A0 X0 J0 B0 S0
R0 A0 C0 J0 B0 S0 M0 R0
```

The notation carries the board and nothing else. It records no score, no level,
no selection, and no `fell`: every gem of a board written in it is standing
still in the cell it is written at, so it carries a `fell` of `0`.
