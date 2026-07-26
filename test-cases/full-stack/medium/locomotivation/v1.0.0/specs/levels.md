# Locomotivation — the campaign

The game is a six-level campaign, played in order. Each level is a compact
criss-cross layout: difficulty comes from being forced to re-cross the same live
corridors between a few dense zones, not from long-distance hauling, and each level
fits the fixed viewport with no scrolling. This file gives each level's terrain,
cargo, drop zones, train roster and schedule, shift clock, and quota.

These layouts and numbers are the design. They are deliberately concrete so the
game is fully specified. Implement the levels as data (a table or array per level)
so tuning is a data edit, not a code change. Every level must be winnable; a level
that cannot be completed within its clock and lives is a bug.

## Reading a level

Each level is given as:

- a terrain map: a `32 x 16` grid (`specs/world.md`), one character per tile, using
  the legend below;
- an elements table: spawn, dispensers, drop zones, unique and optional package
  spawns, levers, by tile `(col, row)`;
- a trains table: each track's row or column, kind, direction, period `T`, and phase
  `φ` (`specs/trains.md`);
- the shift line: clock (seconds), lives (always 3), the required quota, the
  optional score freight, and the last train (if any).

Terrain legend:

| Char | Tile |
| --- | --- |
| `.` | Ground (safe) |
| `=` | Track, horizontal (a train runs along this row) |
| `!` | Track, vertical (a train runs along this column) |
| `B` | Bridge (a track that is the only crossing over a gap) |
| `o` | Refuge bay (safe pocket beside or among tracks) |
| `~` | Gap (impassable) |
| `#` | Wall (impassable scenery) |

Drop-zone, dispenser, spawn, package, and lever tiles are ordinary safe tiles that
also carry an element from the elements table (a dispenser sits on Ground; a drop
zone is a marked Ground pad). Color codes: R = Red, B = Blue (in tables, never the
terrain `B`), G = Green, A = Amber. Weight classes: P = Parcel, C = Crate, L = Load
(`specs/cargo.md`).

Column ruler for the maps (tens then units):

```
          1111111111222222222233
0123456789012345678901234567890 1
```

---

## Level 1 — "First Shift" (tutorial)

One gentle corridor. A single commuter loops across the middle; carry a Red parcel
from the depot up to the yard office and back-and-forth until three are delivered.
No unique, no optional, a roomy clock: learn to read one train and cross.

```
................................  0
................................  1
...r............................  2   r = Red drop zone (4,2)
................................  3
................................  4
................................  5
................................  6
................................  7
================================  8   Track T0 (commuter →)
................................  9
................................ 10
................................ 11
................................ 12
...D............................ 13   D = Red dispenser (3,13)
...S............................ 14   S = Spawn (3,14)
................................ 15
```

Elements:

| Element | Tile | Detail |
| --- | --- | --- |
| Spawn | (3,14) | — |
| Dispenser | (3,13) | Red, Parcel (P) |
| Drop zone | (4,2) | Red |

Trains:

| Track | Line | Kind | Dir | `T` | `φ` |
| --- | --- | --- | --- | --- | --- |
| T0 | row 8 | Commuter | → | 5.0 s | 1.0 s |

Shift: clock 60 s, 3 lives. Quota: deliver 3 Red. No optional freight. No last
train.

---

## Level 2 — "The Yard" (two tracks, two colors)

A two-track corridor with a safe gap between the rails: a commuter runs one way, a
long freight the other. Red and Blue depots and zones sit on opposite corners, so
every haul is a diagonal criss-cross. A couple of Amber parcels are optional greed.

```
................................  0
.b............................r.  1   b = Blue zone (1,1)   r = Red zone (30,1)
................................  2
...............a................  3   a = Amber zone (15,3)
................................  4
................................  5
................................  6
================================  7   Track T0 (commuter →)
................................  8   safe gap
================================  9   Track T1 (freight ←)
................................ 10
................................ 11
..........o.........o........... 12   o = optional Amber parcels (10,12),(20,12)
...D....................E....... 13   D = Red disp (3,13)  E = Blue disp (24,13)
...S............................ 14   S = Spawn (3,14)
................................ 15
```

Elements:

| Element | Tile | Detail |
| --- | --- | --- |
| Spawn | (3,14) | — |
| Dispenser | (3,13) | Red, Parcel |
| Dispenser | (24,13) | Blue, Parcel |
| Drop zone | (30,1) | Red |
| Drop zone | (1,1) | Blue |
| Drop zone | (15,3) | Amber |
| Optional package | (10,12) | Amber, Parcel |
| Optional package | (20,12) | Amber, Parcel |

Trains:

| Track | Line | Kind | Dir | `T` | `φ` |
| --- | --- | --- | --- | --- | --- |
| T0 | row 7 | Commuter | → | 4.5 s | 0.5 s |
| T1 | row 9 | Freight | ← | 8.0 s | 3.0 s |

Shift: clock 70 s, 3 lives. Quota: 3 Red + 3 Blue. Optional: 2 Amber (score). No
last train.

---

## Level 3 — "Trestle" (bridges, a unique, the first last train)

A river gap splits the yard; two bridges are the only crossings, an upper commuter
trestle and a lower freight trestle, each with refuge bays mid-span. The Red unique
waits across the gap and must be carried back over a bridge (the white-knuckle
haul). The lower freight lane's last service is the last train: board a flat-top for
the bonus as the shift ends.

```
................................  0
...r........~~~~~~~~.........b...  1   r = Red zone (3,1)  b = Blue zone (28,1)
................................  2   (gap cols 12-19)
...a........~~~~~~~~.............  3   a = Amber zone (3,3)
............BBBBBBBB.............  4   Bridge A row4 (commuter →)
...........o~~~~~~~~o............  5   refuge bays flank the approaches
................................  6
...........~~~~~~~~~.............  7
........S..~~~~~~~~~.............  8   S = Spawn (8,8)
...........~~~~~~~~~.............  9
...........~~~~~~~~~.............  10
............BBBBBBBB.............  11  Bridge B row11 (freight ←; last-train lane)
...........o~~~~~~~~o............  12  refuge bays flank
...D.......~~~~~~~~~.........U... 13   D = Blue disp (3,13)  U = Red UNIQUE (28,13)
...........~~~~~~~~~.........O... 14   O = optional Amber (28,14)
................................ 15
```

Refuge bays on the bridges (safe pockets a train never enters), reachable from the
bridge deck: (14,3) and (17,5) on Bridge A; (14,10) and (17,12) on Bridge B.

Elements:

| Element | Tile | Detail |
| --- | --- | --- |
| Spawn | (8,8) | — |
| Dispenser | (3,13) | Blue, Crate |
| Drop zone | (28,1) | Blue |
| Unique package | (28,13) | Red, Load — loss fails the level |
| Drop zone | (3,1) | Red |
| Optional package | (28,14) | Amber, Parcel |
| Drop zone | (3,3) | Amber |
| Refuge bays | (14,3),(17,5),(14,10),(17,12) | safe pockets |

Trains:

| Track | Line | Kind | Dir | `T` | `φ` |
| --- | --- | --- | --- | --- | --- |
| T0 (Bridge A) | row 4 | Commuter | → | 7.0 s | 1.0 s |
| T1 (Bridge B) | row 11 | Freight | ← | 9.0 s | 4.0 s |

Shift: clock 110 s, 3 lives. Quota: 1 Red (the unique) + 3 Blue. Optional: 1 Amber
(score).

Last train: on the Bridge B lane (row 11), ← (matching the freight direction).
Consist: engine plus alternating boxcar and flat-top (regular and half-length) cars
(`specs/trains.md`, `specs/assets.md`). Speed 90 px/s (freight). Its spawn time is
derived so its tail clears the map at the clock's end. Regular freight on T1 stops
being scheduled inside the final `(P+L)/v` window so the last train is the lane's
final service.

---

## Level 4 — "Interchange" (a bullet, a switch, two uniques)

A denser box: an upper commuter and bullet corridor, a lower freight corridor, and
a lever that diverts the bullet onto a siding to clear a path. Two uniques (Red,
Green) plus a Blue dispenser quota. Tighter clock.

```
................................  0
.r..........g..............b....  1   r Red(1,1) g Green(12,1) b Blue(27,1)
................................  2
==============L=================  3   Track T0 (commuter →), lever L at (14,3)
................................  4   safe gap
================================  5   Track T1 (bullet ←)  [switchable to T1s row6]
................................  6   (T1s siding row6 dormant unless switched)
................................  7
................................  8   S spawn (16,8)
................................  9
================================ 10   Track T2 (freight →)
................................ 11
...D.......U...........V........ 12   D Blue disp(3,12) U Red unique(11,12) V Green unique(22,12)
...........o.......o............ 13   optional Amber (11,13),(18,13)
................................ 14
...............a................ 15   a Amber zone (15,15)
```

Use spawn (16,8). Row 6 is a dormant siding for the bullet (Track T1s): it is
Ground (safe to walk) until the lever diverts the bullet onto it, at which point row
6 becomes live and row 5 goes dormant.

Elements:

| Element | Tile | Detail |
| --- | --- | --- |
| Spawn | (16,8) | — |
| Dispenser | (3,12) | Blue, Crate |
| Unique package | (11,12) | Red, Crate — loss fails |
| Unique package | (22,12) | Green, Load — loss fails |
| Drop zone | (1,1) | Red |
| Drop zone | (12,1) | Green |
| Drop zone | (27,1) | Blue |
| Drop zone | (15,15) | Amber |
| Optional package | (11,13) | Amber, Parcel |
| Optional package | (18,13) | Amber, Parcel |
| Lever | (14,3) | Diverts the bullet (T1) between row 5 (default) and the row-6 siding |

Trains:

| Track | Line | Kind | Dir | `T` | `φ` |
| --- | --- | --- | --- | --- | --- |
| T0 | row 3 | Commuter | → | 4.0 s | 0.5 s |
| T1 | row 5 (or row 6 if switched) | Bullet | ← | 3.5 s | 2.0 s |
| T2 | row 10 | Freight | → | 8.5 s | 1.5 s |

Shift: clock 118 s, 3 lives. Quota: 1 Red + 1 Green (both unique) + 3 Blue.
Optional: 2 Amber. Last train: on T2 (row 10), →, freight consist with flat-tops;
spawn derived to clear at the clock's end.

---

## Level 5 — "Rush Hour" (all three kinds, tight)

Three live corridors, all kinds running, on a tight clock. Two uniques, a fat Blue
and Green dispenser quota, a lever to tame the middle. This one is meant to be hard.

```
................................  0
.r....................g........  1   r Red(1,1) g Green(22,1)
==============================..  2   T0 commuter →
................................  3
======L=========================  4   T1 freight ←, lever L (6,4)
................................  5
................................  6   S spawn (16,6)
================================  7   T2 bullet →
................................  8
..b..........................a.  9   b Blue zone(2,9)  a Amber zone(29,9)
................................ 10
================================ 11   T3 commuter ←
................................ 12
...D.....E.....U.......W....o... 13   D,E dispensers; U,W uniques; o optional
................................ 14
```

Use spawn (16,6). The lever (6,4) diverts the T1 freight onto a dormant upper siding
(toggling T1 between row 4 and a row-3 siding) to open a window through the top
corridor. Green has its own dispenser (E) and a unique (W).

Elements:

| Element | Tile | Detail |
| --- | --- | --- |
| Spawn | (16,6) | — |
| Dispenser | (3,13) | Blue, Parcel |
| Dispenser | (9,13) | Green, Crate |
| Unique package | (15,13) | Red, Load — loss fails |
| Unique package | (23,13) | Green, Load — loss fails |
| Drop zone | (1,1) | Red |
| Drop zone | (22,1) | Green |
| Drop zone | (2,9) | Blue |
| Drop zone | (29,9) | Amber |
| Optional package | (27,13) | Amber, Parcel |
| Lever | (6,4) | Diverts T1 (freight) between row 4 (default) and a row-3 siding |

Trains:

| Track | Line | Kind | Dir | `T` | `φ` |
| --- | --- | --- | --- | --- | --- |
| T0 | row 2 | Commuter | → | 4.0 s | 0.0 s |
| T1 | row 4 (or row 3 if switched) | Freight | ← | 8.0 s | 2.0 s |
| T2 | row 7 | Bullet | → | 3.0 s | 1.0 s |
| T3 | row 11 | Commuter | ← | 4.5 s | 2.5 s |

Shift: clock 80 s, 3 lives. Quota: 1 Red unique, 1 Green unique, 3 Blue, and 2
Green (dispenser). Optional: 1 Amber. Last train: on T3 (row 11), ←,
commuter-length consist with flat-tops (a faster, tighter board than a freight last
train); spawn derived to clear at the clock's end.

---

## Level 6 — "Last Train Out" (finale)

Everything at once, the hardest shift, built around the last-train finale: a bridge
over a gap, all three train kinds, a lever, three uniques, and a big optional payout
for the greedy. The lower freight lane's last service is a long rideable last train,
the thematic capstone.

```
................................  0
.r........g..........u.........  1   r Red(1,1) g Green(10,1) u Blue(21,1)
==============================..  2   T0 bullet →
................................  3
......L.........................  4   lever L (6,4) for T1
=========================~~~~~~=  5   T1 commuter ←  (gap cols 25-30 except bridge)
................................  6
................................  7
........S.......................  8   S spawn (8,8)
................................  9
===================BBBBB========  10  T2 freight →, BRIDGE segment cols 18-22
...........~~~~~~~~.....~~~~~~~..  11  gap bands flank the bridge
..b.......~~~~~~~~~....~~~~~~~..  12  b Blue zone(2,12)
...D...E...~~~~~...G...U...W...a 13  D,E dispensers; G,U,W uniques; a Amber zone
...........o....o....o.......... 14  optional Amber (11,14),(16,14),(21,14)
................................ 15
```

The finale's geometry is the busiest: a gap band in the lower third crossed by the
bridge on T2 (row 10, cols 18-22) with refuge bays, forcing the lower hauls over the
freight bridge. Refuge bays on the T2 bridge: (19,9) and (21,11).

Elements:

| Element | Tile | Detail |
| --- | --- | --- |
| Spawn | (8,8) | — |
| Dispenser | (3,13) | Blue, Parcel |
| Dispenser | (6,13) | Green, Crate |
| Unique package | (15,13) | Green, Load — loss fails |
| Unique package | (19,13) | Red, Load — loss fails |
| Unique package | (23,13) | Blue, Crate — loss fails |
| Drop zone | (1,1) | Red |
| Drop zone | (10,1) | Green |
| Drop zone | (21,1) | Blue |
| Drop zone | (2,12) | Blue |
| Drop zone | (31,13) | Amber |
| Optional package | (11,14),(16,14),(21,14) | Amber, Parcel (score) |
| Lever | (6,4) | Diverts T1 (commuter) between row 5 (default) and a row-4 siding |
| Refuge bays | (19,9),(21,11) | on the T2 bridge |

Trains:

| Track | Line | Kind | Dir | `T` | `φ` |
| --- | --- | --- | --- | --- | --- |
| T0 | row 2 | Bullet | → | 3.0 s | 0.0 s |
| T1 | row 5 (or row 4 if switched) | Commuter | ← | 4.0 s | 1.0 s |
| T2 (with bridge) | row 10 | Freight | → | 9.0 s | 3.0 s |

Shift: clock 64 s, 3 lives. Quota: 1 Green + 1 Red + 1 Blue (all unique) + 2 Blue
(dispenser) + 1 Green (dispenser). Optional: 3 Amber (a big score payout). Last
train: the long freight last train on T2 (row 10), →, its consist rich in flat-tops
(regular and half-length) so the finale rewards a confident board; spawn derived so
its tail clears the map exactly as the 64 s clock ends.

---

## Campaign notes

- Progression: winning a level advances to the next; the final level's win is the
  campaign Victory (`specs/flow.md`). A fail offers retry of the same level.
- Difficulty ramp: Level 1 is a tutorial (one train, roomy clock); Levels 2 and 3
  add colors, a second train, bridges, and the first unique and last train; Levels 4
  and 5 add the bullet, switches, multiple uniques, and tighten the clock; Level 6
  is the dense finale. Some levels are clearly harder than others. A competent route
  should clear each level with a shrinking margin from L1 to L6, measured as the
  shift clock still on the board the moment the quota is met: roughly L1 ~54 s, L2
  ~32 s, L3 ~21 s, L4 ~19 s, L5 ~12 s, L6 ~6 s, so the finale is the tightest shift
  while every level stays beatable with room to spare. Balance the level data so
  those goals hold: each level clears within its clock and 3 lives with a competent
  route, a reckless route that ignores the schedules dies to the trains, and a
  greedy route that overloads past the sprint threshold runs out of time.
