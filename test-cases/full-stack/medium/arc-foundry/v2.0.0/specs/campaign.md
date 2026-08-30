# Arc Foundry — The campaign

A run is one campaign: a fixed sequence of waves on the map and at the difficulty the
player chose, ending in victory or in defeat. This file fixes the shape of a run, what
begins and ends a wave, the milestone waves, and the finale that produces the run's only
score. Charge and Grid Integrity are in `specs/economy.md`, and the difficulties are in
`specs/difficulty.md`.

## Starting a run

A run begins with a map and a difficulty chosen from the menus of `specs/ui.md`. It then
opens on its first build phase, with `START_CHARGE` Charge, `START_INTEGRITY` Grid
Integrity, refinement at `R0`, an empty yard, and the wave counter at `0`.

Nothing about a run is overridden by the choices made at the menus beyond the map's
topology, the wave count, and the enemy health scaling.

## Levels

A run is a sequence of `N` levels, one per wave, where `N` is the chosen difficulty's
wave count. Waves are numbered `1` through `N`. A level is one build phase followed by
the wave it launches.

### The build phase

The build phase is untimed. It shows no countdown, it never starts a wave on its own, and
the Load waits.

- The stamp allowance refreshes to `5`.
- Rocks are placed, candidates are compared, and structures are dismantled.
- The phase ends when the player commits the level's harvest, as `specs/scrap-press.md`
  states. That harvest launches the wave.

The build phase before wave `1` works the same way, and the first harvest launches wave
`1`.

### The wave

During a wave the Load spawns from the map's entry over time. Building is unavailable; a
plain combine, refining the press, upgrading a combination tower, and changing a
targeting priority stay available.

A wave is cleared when every unit it released has died or leaked. Clearing it pays the
wave-clear bonus and opens the next build phase.

### Milestone waves

Wave `round(N / 2)` and wave `N` each carry one Dynamo. On a `50`-wave run those are
waves `25` and `50`.

## Ending a run

| Outcome | When | What follows |
| --- | --- | --- |
| Victory | Wave `N` is cleared with Grid Integrity remaining. | The finale runs, then the victory screen. |
| Defeat | Grid Integrity reaches `0`, at any point, including mid-wave. | The defeat screen, immediately. |

A defeat never reaches the finale, so a defeated run has no Maze Rating.

## The finale and the Maze Rating

The run keeps no running score. Its one end-of-run figure is the Maze Rating, produced by
a finale that runs after wave `N` is cleared and before the victory screen. The run is
already won when the finale starts; the finale measures the maze rather than deciding the
outcome.

1. A single Overload Dynamo spawns at the entry and walks the chain to the collector,
   taking the open route of least length exactly as any ground unit does.
2. It cannot be killed. Every point of damage dealt to it, direct hits and burn ticks
   alike, is added to the Maze Rating instead of removing health. It takes slow and burn
   like any other unit.
3. When it grounds out at the collector it costs no Grid Integrity, and the game advances
   to the victory screen.

The Maze Rating is that total damage. It shows on the victory screen and is not persisted
between sessions.
