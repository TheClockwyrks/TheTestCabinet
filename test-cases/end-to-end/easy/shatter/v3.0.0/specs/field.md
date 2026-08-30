# Shatter — The field and the star

This file defines the arena every other rule is written against: the wrapping play
area, the seam it wraps at, and the star fixed at its centre. Every figure below
carries the name this specification gives it here.

## The field

The field spans the full `FIELD_W x FIELD_H` (`1280 x 720`) area. It has no outer
walls, and nothing is ever removed for leaving it.

## The wrap

The field wraps on both axes, so it is a torus. A body's position is kept in range
by wrapping each coordinate: `x` modulo `FIELD_W` and `y` modulo `FIELD_H`. A body
leaving the right edge re-enters at the left, one leaving the bottom re-enters at
the top, and the reverse. The wrap applies to every body on the field, and a body
carries its velocity across unchanged.

A body whose shape crosses a seam is drawn on both sides at once, its wrapped
duplicate showing at the opposite edge, so it never visibly pops.

## The shortest wrapped separation

The separation between two positions is the shortest one across the seams. For
each axis, take the difference and bring it into `[-size / 2, +size / 2)` by adding
or subtracting that axis's field size, where `size` is `FIELD_W` for `x` and
`FIELD_H` for `y`. The distance between two positions is the length of that
separation. Every rule in this specification that measures a distance between two
bodies measures it this way, and `specs/collision.md` uses it for every pair.

## The star

A single star stands at `(STAR_X, STAR_Y)` = `(640, 360)`, the centre of the
field, for the whole game. It never moves, and it is present in every state that
shows the field.

- The star has a solid core of radius `CORE_R` (`30`). The core is the one
  physical boundary on the field: a shot that reaches it is absorbed, a rock that
  reaches it is recycled, and the ship slides along it. `specs/collision.md`
  resolves each of those.
- Around the core the star exerts the gravity well `specs/gravity.md` defines.
- The halo is decoration. It is drawn outward from `CORE_R`, its intensity falling
  as the distance from the star grows, and nothing of the star is drawn beyond
  `1.5 x HALO_R` (`HALO_R` is `120`, so nothing beyond `180`).

The star's pull uses the direct vector from the body to `(STAR_X, STAR_Y)` rather
than a wrapped one, as `specs/gravity.md` states.
