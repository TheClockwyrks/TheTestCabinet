# Volute — The injector

This file defines the injector: where it sits, what its aim is, how it fires,
how its loaded and queued cores are filled, and how a fired core flies and
enters the train. The channel, the train, and how cores advance along it are in
`specs/channel.md`. The keys and buttons that steer the aim and raise a shot are
in `specs/controls.md`. What the train does once a core is seated is in
`specs/extraction.md`.

## Figures

| Figure             | Value                                 |
| ------------------ | ------------------------------------- |
| Injector center    | `(420, 330)`, fixed for the whole run |
| Injector radius    | 22 units                              |
| Opening aim        | 270 degrees                           |
| `FIRE_COOLDOWN`    | 0.18 s                                |
| `PROJECTILE_SPEED` | 620 units/s                           |
| Projectile radius  | 14 units                              |
| Strike distance    | 28 units                              |

The injector is drawn as a base centered on `(420, 330)` and a barrel that points
along the current aim angle. The injector never moves.

## The aim

The aim is one angle, held across frames and wrapping continuously through a full
turn, and the barrel points along it. It opens at 270 degrees, straight up the
field, and keeps its value through a pause, an interlude, and a level change.

## Firing

The injector carries one cooldown timer. A fire input is honored when the timer
has expired: a projectile appears with its center at the injector center, its
heading fixed at the current aim angle, and the loaded core's charge, and the
timer is set to `FIRE_COOLDOWN`. A fire input while the timer is unexpired
produces no projectile and leaves the timer alone. Any number of projectiles may
be in flight at once, each independent of the others.

## The loaded and queued cores

The injector holds a **loaded** core and a **queued** core, each carrying one
charge, and both are drawn by the rule `specs/channel.md` gives for an emitted
core's charge. Both are drawn when a level begins. Firing moves the queued charge
into the loaded slot and draws a new queued charge; a swap exchanges the two
charges, draws nothing, and is available whether or not the fire cooldown has
expired.

## Flight

A fired core is a projectile for as long as it flies. Each tick a projectile
advances `PROJECTILE_SPEED` multiplied by the tick's elapsed time along its
heading. The heading is fixed at firing and never turns, so a projectile travels
in a straight line and neither accelerates nor slows. A projectile whose center
leaves the field is discarded on that tick, changing nothing about the train.

## Striking a core

After it advances, a projectile is checked against every core on the channel, at
the positions the train holds after its own advance for that tick. A core
qualifies when the distance between its center and the projectile's center is at
most the strike distance of 28 units. The core with the smallest center distance
is struck, and a tie is broken toward the core with the larger arc position.
When several projectiles are in flight, they resolve oldest first, and a
projectile that strikes is removed before the next one is checked.

Let `c` be the struck core, `d` the projectile's center on the tick of the
strike, and `f` the channel's forward direction at `c`'s arc position. The core
enters **ahead** of `c` when `dot(d - c.position, f)` is greater than `0`, and
**behind** `c` otherwise, so a dot product of exactly `0` enters behind.

## Insertion

The insertion position `p` is `c`'s arc position when the core enters ahead of
`c`, and `c`'s arc position minus the channel spacing when it enters behind. The
inserted core takes arc position `p` and the charge the projectile carried. Every
core whose arc position before the strike is at most `p` shifts back by the
channel spacing. Cores ahead of `p` hold their arc positions, so the head never
moves forward on an insertion.

A shift that carries an arc position below `0` is kept as it stands, and the core
holding it is drawn at the inlet as `specs/channel.md` states.
