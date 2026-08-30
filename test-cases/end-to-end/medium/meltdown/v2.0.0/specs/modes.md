# Meltdown — Modes and difficulty

A run is played on one of five modes, and Containment is played at one of three
difficulties. This file gives the figures each of them fixes. The menus that
choose them are in `specs/screens.md`.

Every mode plays the same game: the same floor, the same mazing and re-pathing,
the same heat model and trip, the same tower roster and upgrades, the same surge,
the same controls, and the same economy. A mode changes only the figures its own
row below states.

## The derived figures

Starting money, the wave count, the starting lives, whether interest is paid,
whether there are build phases between waves, and the build zone all follow the
mode and difficulty and nothing else.

| Mode | Starting money | Waves | Lives | Interest | Build phases | Build zone |
| --- | --- | --- | --- | --- | --- | --- |
| Containment, Easy | 350 | 15 | 20 | yes | yes | The whole floor |
| Containment, Medium | 250 | 20 | 20 | yes | yes | The whole floor |
| Containment, Hard | 200 | 26 | 20 | yes | yes | The whole floor |
| The Hundred | 600 | 1 | 20 | no | no | The whole floor |
| Deep Pockets | 10000 | 20 | 20 | no | yes | The whole floor |
| Bottleneck | 300 | 20 | 20 | yes | yes | Columns 13 to 36, rows 8 to 27 |
| Sudden Death | 300 | 20 | 1 | yes | yes | The whole floor |

A run that has just started is in the `opening` phase on Wave 1, with its money
at that row's starting money and its lives at that row's starting lives.

## Containment

Containment is the standard mode: hold the floor through every wave of the
progression in `specs/waves.md` until the final one is cleared or the lives run
out. It is the only mode with a difficulty.

A difficulty changes the starting money and the wave count, and nothing else. The
starting lives are `20` at all three, interest is paid at all three, the whole
floor is buildable at all three, and the per-wave hp scaling is the same at all
three.

## The Hundred

The Hundred replaces the wave progression with one onslaught.

- It runs a single wave of exactly `HUNDRED_UNITS` (`100`) units, released at the
  same `WAVE_SPAWN_INTERVAL` cadence every wave uses.
- That wave cycles the types of `WAVE_CYCLE` one unit at a time, so the first
  unit is a Mote, the second a Sprint, the third a Swarm, the fourth a Drift, the
  fifth a Hulk, the sixth a Mote again, and so on to the hundredth. It is the one
  wave in the game that fields more than one type.
- Every unit's maximum hp is its base hp times `HUNDRED_HP_SCALE` (`6.0`),
  wherever in the onslaught it arrives, in place of the per-wave scaling.
- There is one untimed opening phase and no build phase between waves, because
  there is one wave.
- The run is won when the onslaught is cleared with at least one life left.

## Deep Pockets

Deep Pockets opens on `10000` money and pays no interest on entering a build
phase. It runs the standard 20-wave progression otherwise.

## Bottleneck

Bottleneck restricts building to a marked central zone, `BOTTLENECK_ZONE`:
columns `13` through `36` and rows `8` through `27`, both ends included. Every
tile of a footprint must lie inside that zone, so a footprint with a single tile
outside it is invalid and builds nothing.

The floor outside the zone stays open for the surge to walk, and the zone spans
both straight vent-to-exhaust corridors. It runs the standard 20-wave
progression otherwise.

## Sudden Death

Sudden Death opens on `1` life, so a single leak of any unit takes the lives to
`0` and ends the run. It runs the standard 20-wave progression otherwise.
