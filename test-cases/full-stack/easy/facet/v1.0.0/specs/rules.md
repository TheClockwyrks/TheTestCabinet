# Facet — The ruleset

A move is a swap: two cells exchange the gems they hold. A run is a line of gems
of one kind, and a chain step is one pass of resolution over the board. The
rules below fall into two groups: the move rules, which decide whether a
requested swap is accepted, and the resolution rules, which decide what a chain
step does to the board. The board these rules run on, along with the seven
kinds, the four cuts, and strain, is defined in `specs/board.md`; how a player
takes hold of a gem and plays a move is in `specs/controls.md`.

## Move rules

A move rule is checked when a swap is requested, and all three hold of every
accepted swap.

### R1 Adjacency

A swap exchanges the gems in two orthogonally adjacent cells. The two cells
differ by `1` in column and `0` in row, or by `0` in column and `1` in row.

### R2 Settled board

A swap is accepted only while `phase` is `idle`, so a swap requested while one
is already in motion or while a chain is running is refused.

### R3 Productive

A swap is accepted only when the board it produces carries at least one maximal
run under R4, or when at least one of the two cells holds a `prism`.

## Resolution rules

A resolution rule is evaluated over the board during a chain step. The order the
step evaluates them in is under `## A chain step` below.

### R4 Runs

A run is `MATCH_MIN` (`3`) or more gems of one kind on consecutive cells of a
single row or a single column. A run is maximal when each of the two cells
immediately beyond its ends either lies off the board or holds a gem of another
kind, and only a maximal run counts. A `prism` belongs to no kind and joins no
run.

### R5 Seeding

A chain step's clear set is seeded with the union of every maximal run on the
board.

Step `1` of a chain begun by a swap that traded a `prism` against a gem is
seeded instead with that `prism` together with every gem on the board of that
gem's kind. Step `1` of a chain begun by a swap that traded a `prism` against a
`prism` is seeded with every cell on the board. Every step after step `1` of
either chain is seeded from the maximal runs.

### R6 Expansion

The clear set grows from its seed by three additions:

- for every `brilliant` in the set, each of the eight cells surrounding that
  `brilliant` that lies on the board;
- for every `star` in the set, every cell in that `star`'s row and every cell in
  its column;
- every flawed gem orthogonally adjacent to a cell in the set.

The clear set is the smallest set of cells that contains the seed and is closed
under all three additions. It is what the rest of the step reads.

Every cell of the clear set carries a **wave**. Each cell of the seed is at wave
`0`, and a cell an addition brings in from a cell at wave `k` is at wave `k + 1`,
taking the lowest wave any addition reaches it at. `waves` is the greatest wave
in the set, and it is `0` when the set is its seed alone.

A cell's wave changes nothing about which cells the set holds, what the set
scores, or what the step removes. It is what times the shattering, under
`## A chain step` below.

### R7 Strain

Every gem outside the clear set that is orthogonally adjacent to at least one
cell in the clear set gains `1` strain, capped at `MAX_STRAIN`. A gem gains at
most `1` strain in a step, however many of its neighbors the clear set holds.

### R8 Cuts

R8 reads the maximal runs that seeded the step under R5. A step seeded from a
`prism` swap has none of those, and creates nothing.

| Run or cell | Creates |
| --- | --- |
| A maximal run of exactly `4` | A `brilliant` |
| A maximal run of `5` or more | A `prism` |
| A cell lying in two intersecting maximal runs, one horizontal and one vertical | A `star` |

Where more than one row applies to one cell, `prism` wins over `star`, and
`star` wins over `brilliant`, and that cell takes one created gem. A created gem
carries strain `0` and the kind of the run that created it, a created `prism`
carrying no kind. It occupies the cell it is placed at, which the removal left
empty.

A `star` is placed at the cell its two runs intersect. For a run of length `n`,
index its cells `0` to `n - 1` from its lowest-column end for a horizontal run
and from its lowest-row end for a vertical run. The gem that run creates is
placed at whichever of the two cells the chain's swap exchanged lies in the run,
at the one of lower index when both lie in it, and at the run's cell at index
`floor((n - 1) / 2)` when neither does.

### R9 Settling

Within each column, every surviving gem falls to the lowest empty cell below it,
keeping the order its column held it in and carrying its strain and its cut.
Each cell still empty is then filled from the top of its column with a `plain`
gem at strain `0`, whose kind is drawn uniformly from `GEM_KINDS` off the game's
seeded random source.

Every gem the step leaves on the board carries `fell`, how far it traveled to
reach the cell it now holds, as a whole number of rows:

| Gem | `fell` |
| --- | --- |
| One R9 did not move | `0` |
| A surviving gem R9 moved down | Its new row less its old row |
| A gem the refill dealt into row `r` | At least `r + 1` |

A refilled gem comes from above the board's top row, so `r + 1` rows is the
least it can have traveled. Which figure at or above that each refilled gem
carries is the build's, and it is what decides the shape a column fills in.

`fall` is the greatest `fell` on the board R9 left.

## Enforcement

The two groups do different jobs, and neither does the other's.

| Rules | How they are used |
| --- | --- |
| R1, R2, R3 | Checked when a swap is requested. A swap that breaks one is refused and the board is unchanged. |
| R4, R5, R6, R7, R8, R9 | Evaluated during a chain step. They refuse nothing. |

## A chain step

`phase` is `idle`, `swapping`, or `resolving`.

### The swap

An accepted swap exchanges the two cells at once, sets `phase` to `swapping`,
sets `swapTimer` to `0`, and leaves `chainStep` at `0`. Nothing is cleared yet:
the two gems are in motion between their cells for `SWAP_SECONDS` (`0.18`) of
game time.

`swapTimer` holds `0` while `phase` is not `swapping`, and accumulates game time
while it is. When `swapTimer` reaches `SWAP_SECONDS` it returns to `0`, `phase`
becomes `resolving`, `chainStep` becomes `1`, and step `1` resolves.

A refused swap changes nothing on the board and leaves `phase` `idle`. It sets
`refusal` to the two cells it named, which stands for `REFUSAL_SECONDS` (`0.3`)
of game time and then clears.

### The step

A step resolves in this order:

1. R5 seeds the clear set.
2. R6 grows the seed to the clear set, and gives every cell of it a wave.
3. The clear set scores, as `## Scoring` below sets out.
4. R7 raises the strain of the gems around the clear set.
5. The clear set is removed, leaving its cells empty.
6. R8 creates the cut gems.
7. R9 settles each column, refills it, and gives every gem its `fell`.

The step then leaves two figures behind, and they are what its own timing runs
off:

| Figure | What it is |
| --- | --- |
| `lastWaves` | The `waves` R6 gave the step's clear set. |
| `lastFall` | The `fall` R9 left on the board. |

### The step's timing

`stepTimer` holds `0` while `phase` is not `resolving`, and accumulates game
time while it is, counting from `0` at the moment a step resolves. Three spans
run off it, with `WAVE_SECONDS` (`0.08`), `FALL_SECONDS_PER_ROW` (`0.05`), and
`STEP_SECONDS` (`0.25`):

| From | To | What runs |
| --- | --- | --- |
| `0` | `SHATTER_END = lastWaves * WAVE_SECONDS` | The clear set shatters, a cell at wave `w` shattering at `w * WAVE_SECONDS`. |
| `SHATTER_END` | `LAND_AT = SHATTER_END + lastFall * FALL_SECONDS_PER_ROW` | The gems fall, a gem that fell `n` rows taking `n * FALL_SECONDS_PER_ROW` to arrive. |
| `LAND_AT` | `STEP_HOLD = LAND_AT + STEP_SECONDS` | The board rests. |

When `stepTimer` reaches `STEP_HOLD` it returns to `0` and the board is read
again. When that board seeds a non-empty clear set under R5, `chainStep` rises
by `1` and that step resolves in the same order. Otherwise `phase` returns to
`idle`, `chainStep` returns to `0`, and the level and end conditions below are
evaluated.

## Scoring

A step's multiplier is `M = min(chainStep, MAX_MULTIPLIER)`, with
`MAX_MULTIPLIER` (`8`). Each gem in the clear set scores by the strain it
carried when the step scored it.

| Cleared gem | Points |
| --- | --- |
| Strain `0` to `2` | `BASE_SCORE` (`10`) x `M` |
| Strain `3` | `FLAWED_SCORE` (`20`) x `M` |

A step's points are the sum over its clear set, and they are added to `score`,
to `levelScore`, and to `moveScore`.

## What a level is measured by

A move is one accepted swap together with the whole chain it sets off. Three
figures follow it:

| Figure | What it holds |
| --- | --- |
| `moveScore` | The points every step of the move currently running has scored. It returns to `0` when a swap is accepted. |
| `bestMove` | The most points one move has scored in the current level, and `0` until a move has scored. When `phase` returns to `idle`, `bestMove` becomes the greater of itself and `moveScore`. |
| `bestChain` | The deepest `chainStep` any chain has reached in the current level, and `0` until a chain has run. Each step sets it to the greater of itself and `chainStep`. |

`bestMove` and `bestChain` return to `0` when a level is opened and when a round
starts, so each level is measured on its own.

## Levels and the end of a round

`level` counts from `1`. The level target is `LEVEL_TARGET_STEP` (`2000`) x
`level`, so level `1` asks for `2000` points and level `4` asks for `8000`.

When `phase` returns to `idle` and `levelScore` is at or past the target, the
level is over: `screen` becomes `levelclear` with `menuIndex` at `0`. The board
stands as the chain left it, and `level`, `levelScore`, `bestChain`, and
`bestMove` hold what the level left them at, which is what that screen reports.

Choosing `CONTINUE` there opens the next level: `level` rises by `1`,
`levelScore`, `bestChain`, and `bestMove` return to `0`, a fresh opening board is
dealt, and `screen` returns to `playing`. `score` carries across.

Otherwise, when `phase` returns to `idle` and no legal swap exists on the board,
`screen` becomes `gameover`. A legal swap is a pair of orthogonally adjacent
cells whose exchange R1 and R3 both accept.

## The opening board

An opening board has two properties: it holds no run under R4, and at least one
legal swap exists on it. Every gem on it is `plain` at strain `0`, with its kind
drawn from `GEM_KINDS` off the game's seeded random source.

The whole board is dealt in from above, so a gem dealt into row `r` carries a
`fell` of at least `r + 1`, exactly as a refilled gem does under R9. Which figure
at or above that each dealt gem carries is the build's.
