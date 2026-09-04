# Floe — The run

This file fixes the frame around a crossing: the lives, the crossing timer, the
three phases a crossing moves through, the eight-level run, and how it ends.
`specs/scoring.md` fixes every score figure and `specs/ui.md` fixes the screens.

## Starting a run

A run opens at level `1` with `lives` at `START_LIVES` (`3`), the score at `0`,
`reachedLevel` at `1`, the strait laid out for level `1`, all five bays open, no
bonus catch out, and a fresh crossing under way.

`lives` counts the critter currently crossing, so a run that has lost no life
reads `3`.

## The three phases

`phase` says what a crossing is doing, and `phaseTimer` is the seconds left in
the hold currently running, `0` whenever none is.

| `phase` | The game is | Its hold |
| --- | --- | --- |
| `crossing` | Playing the crossing, or holding after a bay was filled and before the next crossing begins. | `BAYFILL_PAUSE` (`0.5` s), after a bay is filled |
| `dying` | Holding after a life was lost. | `DEATH_PAUSE` (`0.9` s) |
| `clearing` | Holding after the level's last bay was filled. | `CLEAR_PAUSE` (`1.6` s) |

The strait keeps running through every hold: the lanes advance, the bonus catch
keeps its cadence, and any bear still on the strait travels.

## A fresh crossing

A fresh crossing puts the critter on the near shore at column `START_COL` (`20`),
facing `up`, with its hop cooldown at `0` and its `bestRow` at `ROW_NEAR` (`19`).
The crossing timer goes back to `timerMax`, the filled bays stay exactly as they
are, and `phase` is `crossing` with `phaseTimer` `0`.

## The crossing timer

Each crossing is under a timer. `timerMax` is the seconds a crossing at the
current level gets:

```
crossingTimer(level) = max(TIMER_MIN, TIMER_BASE - (level - 1) * TIMER_PER_LEVEL)
```

`TIMER_BASE` is `30`, `TIMER_PER_LEVEL` is `2`, and `TIMER_MIN` is `15`, so a
level-1 crossing gets `30` s and a level-8 crossing gets `16` s.

`timer` counts down while `phase` is `crossing` and no hold is running. On the
tick it reaches `0` the critter loses a life.

## Losing a life

Five things cost a life, each fixed by the file that owns it:

| Cost | Fixed by |
| --- | --- |
| A bear catches the critter | `specs/hunter.md` |
| A vehicle in a moving lane covers the critter's center | `specs/ice.md` |
| The critter stands on open water | `specs/water.md` |
| A floe carries the critter past a side edge | `specs/water.md` |
| The crossing timer reaches `0` | Above |

On the tick a life is lost: `lives` drops by exactly one, `phase` becomes
`dying`, `phaseTimer` becomes `DEATH_PAUSE`, the critter leaves the strait, and
every bear leaves with it. Through the whole hold the critter is out of play, so
nothing on the strait can reach it and no second life is lost.

When the hold expires the run continues or ends:

- `lives` above `0`: a fresh crossing begins, on the same level, with the filled
  bays kept.
- `lives` at `0`: the run is over and the screen becomes `gameover`, reporting
  `reachedLevel`.

## Levels

A run is `TOTAL_LEVELS` (`8`) levels. `level` fixes the lane speeds and gaps, as
`specs/ice.md` and `specs/water.md` state, the bear's two speeds and how many
bears hunt, as `specs/hunter.md` states, and `timerMax` above. `reachedLevel` is
the highest level the run has reached, and it follows `level` as the run climbs.

A level ends on the hop that fills its last open bay, as `specs/bays.md` states.

- Below `TOTAL_LEVELS`: `phase` becomes `clearing` for `CLEAR_PAUSE`. When the
  hold expires, `level` and `reachedLevel` rise by one, the strait is laid out
  for the new level with all five bays open and no bonus catch out, and a fresh
  crossing begins.
- At `TOTAL_LEVELS`: the run is won on that hop, and the screen becomes
  `victory`.

## Bonus lives

The score earns a life at every `BONUS_LIFE_EVERY` (`10,000`) points it crosses
through play: `lives` rises by one for each boundary the score passes, so a
single award that carries it over two boundaries earns two lives.

## What pausing suspends

The `paused` screen suspends the simulation. While it is showing, no lane item,
critter, bear, or bonus catch moves, the crossing timer does not drain, and no
hold advances. Leaving `paused` resumes from exactly the state pausing left, and
`simTime` is the one quantity that keeps accumulating while it shows.
