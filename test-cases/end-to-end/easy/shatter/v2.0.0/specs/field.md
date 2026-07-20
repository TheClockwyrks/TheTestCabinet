# Shatter — The field and the star

This file defines the arena: the wrapping play area and the star fixed at its
center. All positions and sizes are in the logical-pixel coordinate system defined
in `specs/overview.md` (a fixed 1280 x 720 play area, origin top-left).

## The field and screen-wrap

- The field spans the full 1280 x 720 area. There are no solid outer walls.
- The field wraps on both axes, forming a torus. A body's position is kept in range
  by wrapping each coordinate: `x` modulo 1280 and `y` modulo 720. Leaving the right
  edge re-enters at the left, leaving the bottom re-enters at the top, and the
  reverse, carrying the same velocity across. The wrap applies to the ship, bullets,
  rocks, and the saucer.
- A body whose shape crosses a wrap boundary is drawn on both sides at once, its
  wrapped duplicate showing at the opposite edge, so it never visibly pops. Collision
  is resolved across the wrap seam as well, using the shortest wrapped distance
  between two bodies when testing whether they touch.

## The star

A single star is fixed at the center of the field, `(640, 360)`, for the entire
game. It never moves and is present in every state that shows the field.

- The star has a solid core of radius 30. The core is impassable but not lethal to
  the ship: a ship that reaches it slides along its surface rather than being
  destroyed, a bullet that reaches the core is absorbed and removed, and a rock that
  reaches the core is destroyed and recycled. These interactions are defined in
  `specs/simulation.md`, and rock recycling in `specs/hazards.md`.
- Around the core, the star exerts a gravitational pull on all bullets and all
  rocks. This is the signature mechanic, defined in full in `specs/simulation.md`.
  The ship and the saucer are the exceptions: both are powered craft and are never
  pulled.
- Draw the star as a bright core (radius 30, color `#ffd27a`) inside a larger,
  softer halo (color `#ff7b3d`) that fades outward to nothing by roughly radius 120,
  hinting at the region of strongest pull. The halo is decorative; only the core
  radius 30 is a physical boundary.
