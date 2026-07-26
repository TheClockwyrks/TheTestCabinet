# Locomotivation — the trains

Trains are the hazard the whole game dances around. They are deterministic and
telegraphed, so a death is always the player's misread. This file defines the three
kinds, their scheduling, the telegraphing, lethal contact, the junction switches,
and the optional last-train bonus. Numbers are initial values; implement
them as named constants. Per-level train rosters and schedules are in
`specs/levels.md`.

## The three kinds

| Kind | Speed | Length | Reads as |
| --- | --- | --- | --- |
| Freight | `90` px/s | `12` tiles (`480` px): engine plus a long run of cars | Slow but occupies a crossing for a long time, the wall you wait behind. |
| Commuter | `190` px/s | `5` tiles (`200` px) | The workhorse hazard: medium speed, medium gap. |
| Bullet | `380` px/s | `3` tiles (`120` px) | Terrifyingly fast, tiny body, a small window that arrives now. |

Each is a distinct, readable ¾ body (`specs/assets.md`): the freight a chunky
engine plus flat-top and boxcar cars, the commuter sleek, the bullet needle-nosed.
A player reads which is coming from its silhouette and speed alone.

## Tracks and scheduling

A track is a straight run of Track and Bridge tiles (`specs/world.md`) with:

- an orientation: horizontal (train travels along a row) or vertical (along a
  column);
- a direction: which way trains travel (left-to-right, or top-to-bottom, and so on);
- a kind: freight, commuter, or bullet;
- a period `T` (seconds between successive trains entering) and a phase offset `φ`
  (seconds before the first train).

Train `n` on a track enters the level edge at time `φ + n*T` and travels at its
kind's constant speed until its tail leaves the far edge. This is fully
deterministic: given the level's fixed timestep (`specs/controls.md`), the same
inputs always produce the same train positions, which is what makes the schedules
learnable. Trains do not accelerate or stop; they run at speed end to end. There is
no randomness in train timing.

Two adjacent parallel tracks leave a safe gap between them (no train occupies it):
crossing a multi-track corridor is a hop-and-wait from safe gap to safe gap, timing
each lane against its schedule.

## Lethal contact

Any overlap of the worker's footprint (`specs/character.md`) with any part of any
car (the engine, a boxcar, a flat-top, or the flat side of any car) is instantly
lethal: the worker is squished, loses a life, and drops-and-destroys all carried
cargo (`specs/character.md`, `specs/flow.md`). There is no glancing hit and no safe
side. A train never slows, stops, or is blocked by the worker or by dropped freight;
it destroys cargo it runs over (`specs/cargo.md`) and passes on.

## Telegraphing

Every train is announced before it reaches a crossing, on a fixed lead so a
prepared player is never surprised:

- Crossing signals: a signal beside each track (`specs/world.md`) shows clear
  (green) normally, flips to warning (amber) when a train is approaching within the
  lead window `TELEGRAPH_LEAD = 1.6` s of travel from the crossing, and danger (red,
  flashing) as the train is upon the crossing.
- Headlight: each train casts a headlight glow ahead of it, visible before the body
  arrives.
- Audio: a horn sounds as a train approaches, and a rumble rises with the train's
  proximity (louder and closer as it nears), both produced sounds (`specs/assets.md`).

The lead time is generous enough that reading the signals and audio, plus knowing
the schedule, always affords a safe crossing. The difficulty is in routing under a
load and a clock, not in reaction time you cannot have.

## Junction switches (a supporting mechanic)

Some levels place a lever (`specs/world.md`) at a junction where a track splits into
two branches. The worker toggles the lever (the interact key, `specs/controls.md`,
when adjacent) to flip which branch the trains take, so throwing a switch changes
which of two tracks in a corridor is live and which is dormant, opening a safe path
or diverting a train off your route.

Switches are supporting texture rather than the core: a level uses at most one or
two, and no level requires a chain of switch-puzzles to solve. The lever's ¾ handle
shows its current setting, and the diverted branch's signals reflect the change.
Trains already on a branch are unaffected; the switch changes where subsequent
trains route. It stays obvious which branch is live after a throw.

## The last-train bonus (optional)

A level may define one last train, an optional, score-only capstone
(`specs/levels.md` says which levels have one and its path). It is the thematic
"catch the train home" beat, and it works like this:

- It runs a single fixed path across the level at its own speed, and its spawn time
  is derived so that its tail clears the map exactly as the shift clock reaches
  zero: with a path of pixel length `P`, a train body of length `L`, and speed `v`,
  it spawns at `t_spawn = T_shift − (P + L) / v`. The last seconds of the shift are
  the last train crossing the yard.
- Its consist is a mix of rideable and lethal cars:
  - Flat-top cars are rideable. Regular-length and half-length flat-tops are
    interspersed; they are visually unmistakable (open, flat deck) from the lethal
    cars (`specs/assets.md`). The half-length flat-tops are smaller targets, so a
    greedier board aims for a tighter car.
  - Engine and sealed boxcars are lethal, exactly like any train car: touching them
    squishes you.
- Boarding: stepping onto a flat-top car (the worker's footprint over a rideable
  car) boards it, so the worker attaches and rides. Boarding ends the level for the
  worker (they ride off with the train) and awards the last-train bonus
  (`specs/flow.md`); the simulation keeps running and rendering until the train
  fully leaves the screen, carrying the worker off.
- Risk and reward: mistiming the board (landing on the engine or a sealed car, or
  stepping onto the rails as a lethal car arrives) is a normal lethal hit (a life,
  and any carried cargo). Missing the train entirely costs nothing but the bonus:
  the level still resolves on the clock as normal (win if the quota is met,
  `specs/flow.md`). Boarding is pure opt-in: a leaderboard flourish, never a
  requirement, and never a fail condition.

Because catching it is optional and its risk is opt-in, the last train competes with
last-second optional deliveries for the same closing seconds of the shift: do you
spend them grabbing one more package, or positioning to catch the train?
