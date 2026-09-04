# Wireworm — The run

A run is one descent through twelve levels on one board. This file defines the
lives a run starts with, what a lost life costs and how a respawn goes, how a
level clears and the run advances, and how a run ends. The screens the run moves
between are in `specs/ui.md`, and the figures the run pays are in
`specs/scoring.md`.

## Starting a run

A new run opens on the `playing` screen with:

| Field | Value |
| --- | --- |
| Lives | `START_LIVES` (`3`) |
| Level | `1` |
| The level reached | `1` |
| Score | `0` |
| The node field | A fresh scatter, as `specs/nodes.md` states |
| Phase | `banner` |

## The three phases of play

The `playing` screen runs in one of three phases, each carrying a phase timer in
seconds that counts down against the delta time of each update.

| Phase | What it is | Timer |
| --- | --- | --- |
| `banner` | The level's banner is shown over the board before play begins. | `BANNER_TIME` (`1.3` s) |
| `active` | Live play. | Rests at `0`. |
| `respawn` | The pause after a life is lost, before play resumes. | `RESPAWN_TIME` (`1.4` s) |

When the `banner` phase's timer runs out, the phase becomes `active` and the
level's worm enters, as `specs/worm.md` states. The worm enters at that moment
and at no other.

Simulation time accumulates the delta of every update whatever the screen, and
the phase timers run against that same delta, so a run left alone gives way from
its banner to live play on the game's own clock.

## Losing a life

A worm segment or a foe reaching the cursor costs one life, as
`specs/cursor.md` states. On the contact, with lives to spare:

1. Lives falls by one.
2. Every worm, every foe, and every bolt in flight is removed from the board. The
   node field stands exactly as it was.
3. The cursor is placed at the band's center, `(640, 688)`.
4. The phase becomes `respawn`, with its timer at `RESPAWN_TIME`.

When that timer runs out, the phase becomes `active`, the cursor is given
`RESPAWN_INVULN` (`2.0` s) of spawn-in invulnerability, and the level's worm
enters afresh at the level's own length.

A contact that takes lives to `0` ends the run instead: the game moves to the
`gameover` screen, reporting `0` lives and the level the run reached.

## Clearing a level

A level clears on the step in which the last of its worm segments is removed. The
clear is that removal, so a board that holds no worm segments and has had none
removed is being played rather than cleared, and the level stands.

On a clear below level `TOTAL_LEVELS` (`12`):

1. The level-clear bonus is paid, as `specs/scoring.md` states.
2. The level goes up by one, and the level reached goes up with it.
3. Every foe and every bolt in flight is removed. The node field stands exactly
   as it was, at the charges it held.
4. The phase becomes `banner`, with its timer at `BANNER_TIME`, and the next
   level's worm enters when that timer runs out.

The level reached is the highest level the run has opened, and it is what the end
screens report.

## Winning and losing

| Outcome | Reached when | Result |
| --- | --- | --- |
| Victory | The last worm segment of level `12` is removed. | The victory bonus is paid and the game moves to the `victory` screen. |
| Game over | A contact takes lives to `0`. | The game moves to the `gameover` screen. |

A bonus life is granted as the score climbs, as `specs/scoring.md` states.
