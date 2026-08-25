# Wick — Enemies

This file defines everything that hunts the lamplighter: the roster of common
enemies, the two elites, and the Dark, each with its stats; how each one moves;
how a common enemy's health scales through the night; what a death drops; and
the spawn director that decides what appears, when, and where, including the
night's scripted arrivals. How an enemy hurts the lamplighter on contact is in
`specs/world.md`, how a weapon hurts an enemy is in `specs/weapons.md`, and
what becomes of a dropped gem or chest is in `specs/world.md`. Every figure
below carries the name this specification gives it.

## The roster

An enemy is a circle of `radius` units centered on its position `(x, y)` in
world units, with `hp` health, a `speed` in units per second, and a contact
`damage`. `ENEMY_IDS` lists the thirteen ids in this order, and `ENEMIES` holds
each one's row by id. Every enemy has a rank, `common`, `elite`, or `dark`, and
a behavior, `chase`, `drift`, or `weave`.

### Common enemies

| Enemy | Id | HP | Speed | Damage | Radius | Gem | Behavior |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Moth | `moth` | 5 | 100 | 5 | 10 | small | chase |
| Bat | `bat` | 8 | 140 | 5 | 10 | small | chase |
| Rat | `rat` | 15 | 120 | 8 | 12 | small | chase |
| Gnat | `gnat` | 2 | 160 | 3 | 8 | small | drift |
| Beetle | `beetle` | 25 | 60 | 10 | 14 | medium | chase |
| Wisp | `wisp` | 12 | 90 | 6 | 10 | medium | weave |
| Spider | `spider` | 40 | 80 | 12 | 14 | medium | chase |
| Crow | `crow` | 30 | 150 | 10 | 12 | medium | chase |
| Shade | `shade` | 60 | 70 | 15 | 16 | medium | chase |
| Hound | `hound` | 120 | 110 | 20 | 18 | large | chase |

All ten are rank `common`. The HP column is the base the scaling below
multiplies at spawn.

### Elites and the Dark

| Enemy | Id | Rank | HP | Speed | Damage | Radius | Drops | Behavior |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mothwing | `mothwing` | `elite` | 600 | 90 | 20 | 28 | chest | chase |
| Owl | `owl` | `elite` | 2000 | 100 | 30 | 36 | chest | chase |
| The Dark | `dark` | `dark` | 10000 | 170 | 50 | 40 | nothing | chase |

The three share the rules that set them apart from the commons: each spawns
with exactly the HP in its row, each stands outside the spawn cap, and each
stays on the field however far the lamplighter travels, until it dies or the
run ends.

`FLARE_IMMUNE` lists the types a Flare burst leaves untouched, and it holds
`dark` alone: a Flare burst deals the Dark no damage. Every other weapon damages
the Dark exactly as it damages any enemy.

## The life of an enemy

An enemy spawns with the next id from `nextId`, so ids ascend in spawn order
and each is used once per run. It spawns at full health, with `age` `0`,
`contactCooldown` `0`, and the heading its behavior gives it below. `age` is
the seconds since it spawned: every tick adds `TICK_DT` (`1 / 60`) to it. Each
tick the enemy moves as its behavior states, then the weapons hit it, then
its contact with the lamplighter is resolved as `specs/world.md` states. An
enemy spawned on a tick sits at its spawn point for that tick and first moves
on the next.

A hit removes the weapon's damage from `hp`. On any tick that leaves `hp` at or
below `0` the enemy dies on that tick: it is removed, the kill count rises by
one, its drop appears at its center, and the `kill` cue plays as `specs/ui.md`
states. Kill count and drops apply to every rank alike.

## Movement

Every rate below is per second, integrated on the fixed tick, so one tick's
step is `speed * TICK_DT` units. The position an enemy is drawn at and the
position its circle is tested at are the same `(x, y)`.

### Chase

Each tick a chasing enemy recomputes its heading as the unit vector from its
center to the lamplighter's center and advances one step along it. The heading
is recomputed every tick, so a chaser turns with the lamplighter as it moves.
An enemy whose center coincides with the lamplighter's stays where it is that
tick.

### Drift

A drifting enemy keeps the heading it spawned with for its whole life and
advances one step along it every tick. Its heading is fixed at spawn: the unit
vector from its spawn position to the lamplighter's center, or the heading a
swarm gives it below. The lamplighter's later movement changes nothing about
it, so a drifter that misses flies on until it despawns.

### Weave

A weaving enemy chases with an anchor and is drawn beside it. The anchor is
what advances toward the lamplighter, and the position is the anchor plus a
perpendicular offset that swings with age:

```
offset(age) = WISP_AMPLITUDE * sin(2 * PI * age / WISP_PERIOD)
perp        = (-hy, hx)                 the heading (hx, hy) rotated +90 degrees
position    = anchor + perp * offset(age)
```

with `WISP_AMPLITUDE` (`40`) units and `WISP_PERIOD` (`1.0`) seconds. The state
carries the position and the heading, and the anchor is the position minus the
offset at the current age. One tick of a weaver is therefore:

```
anchor   = position - perp(heading) * offset(age)
heading  = unit(lamplighter - anchor)
anchor   = anchor + heading * speed * TICK_DT
age      = age + TICK_DT
position = anchor + perp(heading) * offset(age)
```

At spawn the offset is `0`, so the anchor is the spawn position and the heading
is the unit vector from it to the lamplighter's center. A weaver whose anchor
coincides with the lamplighter's center keeps its heading and stays where it
is that tick.

## Health scaling

A common enemy's health grows with the night. The multiplier steps once a
minute:

```
hpMul(time) = 1 + HP_SCALE_PER_MINUTE * floor(time / 60)
```

with `HP_SCALE_PER_MINUTE` (`0.15`) and `time` the run clock, in seconds, on
the tick the enemy spawns. A common enemy spawns with
`maxHp = hp * hpMul(time)` and `hp = maxHp`, and keeps that `maxHp` for its
life whatever the clock does afterward. `maxHp` is a real number. Elites and
the Dark spawn with their table HP as `maxHp`, unscaled.

## Drops

A death leaves its drop at the enemy's center on the tick it dies.

| Rank | Drop |
| --- | --- |
| `common` | One gem of the tier in its row: `small`, `medium`, or `large`. |
| `elite` | One chest. |
| `dark` | Nothing. |

The experience each gem tier carries, how a gem is attracted and collected,
and how a chest opens are in `specs/world.md`. A common kill also draws for
bread and for a draft, as that file states.

## The spawn director

The spawn director decides what enters the night. It runs on every tick of the
`playing` screen while `autoSpawn` is `true`, which is how a run starts, and
it holds still while `autoSpawn` is `false`. Everything it spawns takes the
spawn rules above, health scaling included. Its randomness, the spawn angle
and the type choice, is drawn from the game's seeded generator.

### The spawn ring

A spawn point is `SPAWN_DISTANCE` (`760`) units from the lamplighter's center
at an angle drawn uniformly from the seeded generator:

```
x = player.x + cos(angle) * SPAWN_DISTANCE
y = player.y + sin(angle) * SPAWN_DISTANCE
```

### Despawning

Each tick, every common enemy whose center is farther than `DESPAWN_DISTANCE`
(`1200`) units from the lamplighter's center is removed: no gem, no kill, no
cue. Gnats are common and despawn the same way. Elites and the Dark are outside
this rule and stay on the field at any distance.

### Windows

The night is divided into windows of `SPAWN_WINDOW` (`30`) seconds, and the
current window's index is `min(19, floor(time / SPAWN_WINDOW))`, from `0` to
`19`.
`SPAWN_WINDOWS` holds one row per window in this order, each with the types a
spawn chooses from, the seconds between spawns, and the most common enemies
that may be alive for the director to add another.

| Window | Starts | Types | Interval | Cap |
| --- | --- | --- | --- | --- |
| 0 | 0:00 | moth | 1.00 | 20 |
| 1 | 0:30 | moth, bat | 0.80 | 30 |
| 2 | 1:00 | moth, bat, rat | 0.60 | 40 |
| 3 | 1:30 | bat, rat, beetle | 0.50 | 50 |
| 4 | 2:00 | bat, rat, beetle | 0.50 | 60 |
| 5 | 2:30 | rat, beetle, wisp | 0.40 | 70 |
| 6 | 3:00 | beetle, wisp, spider | 0.40 | 80 |
| 7 | 3:30 | wisp, spider, crow | 0.35 | 90 |
| 8 | 4:00 | spider, crow, shade | 0.30 | 100 |
| 9 | 4:30 | crow, shade, moth | 0.30 | 110 |
| 10 | 5:00 | shade, crow, hound | 0.25 | 120 |
| 11 | 5:30 | bat, shade, hound | 0.25 | 130 |
| 12 | 6:00 | rat, spider, hound | 0.20 | 140 |
| 13 | 6:30 | beetle, crow, hound | 0.20 | 150 |
| 14 | 7:00 | wisp, shade, hound | 0.20 | 160 |
| 15 | 7:30 | spider, crow, hound | 0.15 | 170 |
| 16 | 8:00 | crow, shade, hound | 0.15 | 180 |
| 17 | 8:30 | shade, hound, bat | 0.15 | 190 |
| 18 | 9:00 | shade, hound, crow | 0.10 | 200 |
| 19 | 9:30 | hound, shade, spider | 0.10 | 200 |

A window's row applies from its start until the next window starts; window
`19` is the last and runs until dawn.

### The spawn timer

`spawnTimer` is a timer as `specs/world.md` defines one. It is set to `0` when
a run starts and to `0` on every tick whose window index differs from the
previous tick's. On every tick the director runs, in this order:

```
spawnTimer counts down
if spawnTimer is due and aliveCommons < cap:
  spawn one enemy of a type chosen uniformly from the window's types,
  at a spawn point
  spawnTimer = interval
```

`interval` and `cap` are the current window's. A spawn therefore lands on the
first tick of a run, on the first tick of every window, and every `interval`
seconds between. When the cap is full the timer rests at `0`, and the next
spawn lands on the first tick that has room.

### The cap

`aliveCommons` is the number of live enemies of rank `common` other than
gnats. Gnats, the elites, and the Dark stand outside the cap: they are never
counted against it, and they spawn whether or not it is full. The cap governs
the timer's spawns alone; a scripted event spawns regardless of it.

### Scripted events

`EVENTS` lists the night's scripted spawns in time order. Each fires once per
run, on exactly the tick the run clock equals its time (`tick == time * 60`,
read after the tick's clock has risen), and only while the director is
running. `firedEvents` records the times that have fired.

| Time | Seconds | Event |
| --- | --- | --- |
| 1:00 | 60 | Gnat swarm |
| 2:00 | 120 | Mothwing spawns at a spawn point |
| 4:00 | 240 | Gnat swarm |
| 5:00 | 300 | Mothwing spawns at a spawn point |
| 7:00 | 420 | Gnat swarm |
| 7:30 | 450 | Owl spawns at a spawn point |
| 9:00 | 540 | The Dark spawns at a spawn point |

A gnat swarm spawns `SWARM_SIZE` (`24`) gnats on the same tick along a line
perpendicular to a direction `d`, a unit vector at an angle drawn uniformly from
the seeded generator. The line is `SWARM_LINE` (`720`) units long, centered
`SPAWN_DISTANCE` from the lamplighter along `d`, and the gnats are evenly spaced
along it with one at each end:

```
center  = player + d * SPAWN_DISTANCE
perp    = (-dy, dx)
spacing = SWARM_LINE / (SWARM_SIZE - 1)
gnat i  = center + perp * (i - (SWARM_SIZE - 1) / 2) * spacing
```

for `i` from `0` to `SWARM_SIZE - 1`. Every gnat in the swarm spawns with
heading `-d`, so the whole line drifts across the lamplighter's position and
on past it. Swarm gnats take health scaling like any common enemy and despawn
by distance like any common enemy.

The second Mothwing spawns whether or not the first is still alive, so two can
be on the field at once.

## Dawn

On the tick the run clock reaches `DAWN_TIME` (`600`), tick `36000`, the night
is over: the run ends with `screen = "dawn"`, whatever is alive and whatever
the director had due. Dawn takes precedence over falling on the same tick, as
`specs/world.md` states.

## Presentation

Each of the thirteen types is told apart from every other at a glance, an
enemy reads at about the size of its collision circle, and the elites and the
Dark read as larger than any common enemy. The Dark is unmistakable when it
arrives. The sprites and their animation are the build's, as `specs/assets.md`
states.
