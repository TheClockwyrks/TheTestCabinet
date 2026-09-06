# Volute — The channel and the train

This file defines the channel cores ride from the inlet to the intake, how a
position on it is measured, how the train of cores advances and merges, how the
inlet emits, the pressure that drives the feed, and the order a tick resolves
in. What an insertion does to the train is in `specs/injector.md`, and what
removes cores from it is in `specs/extraction.md`.

## The channel

The channel is a polyline of twelve vertices, listed here from the inlet. Each
row gives the vertex, the arc distance at it, and the length of the leg running
from it to the next vertex.

| # | Point | Arc distance | Leg length |
| --- | --- | --- | --- |
| 0 | `(40, 40)` | `0` | `880` |
| 1 | `(920, 40)` | `880` | `460` |
| 2 | `(920, 500)` | `1340` | `800` |
| 3 | `(120, 500)` | `2140` | `380` |
| 4 | `(120, 120)` | `2520` | `720` |
| 5 | `(840, 120)` | `3240` | `300` |
| 6 | `(840, 420)` | `3540` | `620` |
| 7 | `(220, 420)` | `4160` | `200` |
| 8 | `(220, 220)` | `4360` | `400` |
| 9 | `(620, 220)` | `4760` | `100` |
| 10 | `(620, 320)` | `4860` | `140` |
| 11 | `(480, 320)` | `5000` | — |

`PATH_LENGTH` (`5000`) is the channel's total arc length. Vertex `0` is the
inlet, at arc distance `0`, and vertex `11` is the intake, at `PATH_LENGTH`.
The channel is drawn as a continuous plate along this polyline, wide enough to
carry a core, with the inlet and the intake each marked so the direction of
travel reads at a glance. The line style, plate width, and every other aspect of
the look are yours.

### Arc positions

A core's position on the channel is one number, its arc distance `s` from the
inlet walked along the polyline. The leg an arc position lies on is the one
whose starting vertex carries the greatest arc distance that does not exceed
`s`, and the point for that position is that vertex plus the leg's unit
direction times the remainder:

```
leg    = the leg whose start arc distance a is greatest with a <= s
point  = leg.start + leg.direction × (s - a)
```

`forward(s)` is the unit direction of the leg that same rule selects, so at a
vertex it is the direction of the leg beginning there, and at `PATH_LENGTH` it
is the direction of the final leg. An arc position below `0` selects the first
leg as well: its point is the inlet and its `forward` is the first leg's
direction, so a core carrying one is drawn at the inlet until the train carries
it past `0`. Cores are drawn at the point their arc position gives, and every
rule below reads and writes arc positions rather than points.

## The train

The train is the ordered list of cores on the channel, head first. The head is
the core with the greatest arc position and the tail the core with the least.
Each core is drawn as a disc of `CORE_RADIUS` (`14` units) centered on the point
its arc position gives.

A **segment** is a maximal run of consecutive cores in the train whose arc
positions differ by exactly `SPACING` (`28` units). Every core belongs to
exactly one segment, a lone core forms a segment of one, and the lead segment is
the one containing the head. Which cores a segment covers follows from the arc
positions; the hold a removal leaves on a segment is in `specs/extraction.md`.

### Advance

| Group | Advances at |
| --- | --- |
| The lead segment | the effective feed speed |
| Every other segment | `180` units/s |
| A segment whose recoil hold has not expired | it does not advance |

Each tick a segment's rate times the tick's elapsed time is added to the arc
position of every core in it, so a segment keeps its spacing as it moves.
Segments advance in order from the lead segment back toward the tail, so a
segment tests the merge below against the position the segment ahead of it holds
after its own advance on that tick. The effective feed speed is defined under
Pressure below; the catch-up rate of `180` units/s is fixed, and pressure and
machinery leave it alone.

### Merging

A segment merges with the segment ahead of it when its head reaches the arc
position `SPACING` behind that segment's tail. On the tick its advance would
carry its head past that position, the head is clamped to exactly that position
and every core behind the head moves by the same amount, so the arc positions
across the join differ by exactly `SPACING` and the two segments become one. The
merged segment carries the recoil hold of the segment ahead. An extraction the
join produces is in `specs/extraction.md`.

### Emission

While the level's quota is not exhausted, the inlet emits a core at `s = 0` on a
tick where the tail core's arc position is at least `SPACING`, one core at most
per tick. A channel carrying no core satisfies that condition, so an emission
follows at once. Each emission decrements the level's quota by one. An emitted
core stands exactly `SPACING` behind a tail sitting at `SPACING`, and so joins
the trailing segment; a tail further out leaves the emitted core a segment of
its own, closing at the catch-up rate.

An emitted core's charge is drawn at random, uniformly over the set of distinct
charges on the channel at the moment of emission, and uniformly over the level's
charge set when the channel carries no core. The debug surface
`specs/instrumentation.md` fixes poses the charge of the next emission through
`setNextEmitted`, and an emission carrying a posed charge makes no draw. The
level's charge set and quota are in `specs/progression.md`. Whether an emitted
core carries a machinery mark is in `specs/machinery.md`.

### The seeded cores

A level starts with `12` cores already on the channel, the head
at `s = 308` and the tail at `s = 0`, spaced by `SPACING`. Each seeded core's
charge is drawn at random, uniformly over the level's charge set, and each
decrements the level's quota exactly as an emission does. The twelve
enter in order from the head, so the seeded core at `s = 0` is the twelfth core
of the level.

## Pressure

`pressure` is a real number held between `0` and `100` inclusive, clamped at
both ends, and it is `0` when a level starts.

| Figure | Value |
| --- | --- |
| Cores the channel carries before pressure rises (`PRESSURE_FREE`) | `24` |
| Rise per second for each core above `PRESSURE_FREE` | `0.05` |
| Bleed per second while the channel is not over `PRESSURE_FREE` | `2.0` |
| Fall for each core a removal takes off the channel | `0.8` |

Each tick, with `coreCount` the number of cores on the channel:

```
rise  = max(0, coreCount - 24) × 0.05
bleed = 2.0 when coreCount <= 24, otherwise 0
pressure = clamp(pressure + (rise - bleed) × dt, 0, 100)
```

Every core a removal takes off the channel lowers `pressure` by `0.8` at the
moment of the removal, clamped the same way. The gauge that shows
`pressure` is in `specs/ui.md`.

### The effective feed speed

The lead segment advances at the effective feed speed:

```
effective feed speed = level feed speed × (1 + pressure / 100) × choke factor
```

The level feed speed is in `specs/progression.md`. The choke factor is `1` while
no choke is active and takes the value `specs/machinery.md` gives while one is.

## The order of a tick

A tick of the `playing` screen resolves in this order, and each step reads the
positions the step before it left.

1. Every running timer falls by the tick's elapsed time.
2. Every segment advances, from the lead segment back toward the tail, and a
   segment reaching the one ahead of it merges with it. A merge that completes a
   same-charge run extracts that run. The pass walks the segments in the order
   they stood in when the step began, and it carries on from the next segment of
   that order against the positions an extraction left.
3. Every projectile advances along its heading, oldest first. A projectile that
   strikes a core seats it, and an insertion that completes a same-charge run
   extracts that run.
4. Every removal grants the machinery the marks among the cores it took carry,
   and a `bore` granted resolves against the positions that removal left.
5. Pressure rises or bleeds.
6. A core standing at the intake spends a cell. Otherwise a level whose quota is
   exhausted and whose channel carries no core is cleared.
7. The inlet emits.
