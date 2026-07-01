# Shatter — Playfield, star, ship, rocks, bullets, and saucer

This file defines the geometry of the field and every object in it. All positions
and sizes are in the logical-pixel coordinate system defined in
`specs/overview.md` (a fixed `1280 x 720` play area, origin top-left). How these
objects move and collide is defined in `specs/physics.md`.

## Playfield and screen-wrap

- The field spans the full `1280 x 720` area. There are no solid outer walls.
- The field **wraps** on both axes (a torus). A body's position is kept in range
  by wrapping each coordinate: `x` modulo `1280` and `y` modulo `720`, so leaving
  the right edge re-enters at the left, and leaving the bottom re-enters at the
  top (and vice versa), carrying the same velocity. The wrap applies to the ship,
  bullets, rocks, and the saucer.
- Because a body can straddle an edge, draw a body whose shape crosses a wrap
  boundary on **both** sides (its wrapped duplicate showing at the opposite edge)
  so it never visibly pops, and resolve collisions across the wrap seam as
  well — two rocks touching across the left/right seam collide. Use the shortest
  wrapped distance between two bodies when testing their collision.

## The star (gravity well)

A single **star** is fixed at the center of the field, `(640, 360)`, for the
entire game. It never moves and is present in every state that shows the field.

- The star has a **solid core** of radius **30**. The core is lethal and
  impassable: the ship is destroyed if it touches the core (see `specs/flow.md`),
  a bullet that reaches the core is absorbed and removed, and a rock that reaches
  the core is destroyed and recycled (see Rocks below and `specs/physics.md`).
- Around the core, the star exerts a **gravitational pull** on the ship, all
  bullets, and all rocks — the signature mechanic, defined in full in
  `specs/physics.md`. The saucer is the sole exception and is never pulled.
- Draw the star as a bright core (radius `30`, color `#ffd27a`) inside a larger,
  softer halo (color `#ff7b3d`) that fades outward to nothing by roughly radius
  `120`, hinting at the region of strongest pull. The halo is decorative; only the
  core radius `30` is a physical boundary.

## The ship

- The ship is a triangle roughly **34 long** (nose to tail) and **26 wide** at the
  tail, drawn pointing in its current facing direction. Treat it as a **circle of
  radius 14** for all collisions.
- The ship has a **facing angle** it rotates freely, and a **velocity** it
  carries under momentum. It turns and thrusts as defined in `specs/physics.md`;
  it has no reverse and no brake — you kill speed by turning around and
  thrusting against your motion, or by letting the gentle drag bleed it off.
- The ship starts each life at rest. At game start and after each respawn it
  appears at the **safe point** `(640, 560)` — directly below the star, clear of
  its core — facing **up** (toward `270deg`, i.e. straight up the screen).
- While thrusting, draw a flickering **thrust flame** (color `#ffd166`) trailing
  from the tail.

## The rocks

Rocks are the drifting debris you shoot. Each rock is one of three **sizes**;
every size is drawn as an irregular angular polygon (see `specs/overview.md`) but
collides as a circle of the radius below.

| Size   | Collision radius | Base drift speed (px/s) | Score when destroyed |
| ------ | ---------------- | ----------------------- | -------------------- |
| Large  | 46               | 60–110                  | 20                   |
| Medium | 26               | 90–150                  | 50                   |
| Small  | 14               | 130–210                 | 100                  |

- A rock drifts under momentum, curved continuously by the star's gravity (see
  `specs/physics.md`), and wraps at the edges. Each rock also **rotates** slowly
  for visual life; the spin is cosmetic and does not affect collision.
- A rock's "base drift speed" is the speed it is **spawned** with (picked within
  the size's range); gravity then speeds it up and slows it down as it falls
  toward and climbs away from the star, so its instantaneous speed varies.
- **Splitting.** When a bullet destroys a rock (see `specs/physics.md`): a
  **Large** rock becomes **two Medium** rocks; a **Medium** becomes **two Small**;
  a **Small** is removed entirely. Splitting is the only way to reduce the number
  of rocks on the field.
- **Star recycling.** When a rock is pulled into the star and its circle reaches
  the core, that rock is **destroyed and immediately replaced** by a new rock of
  the **same size**. The replacement enters from **off-screen**: pick a random
  point just outside one of the four edges and place the rock there, moving
  **inward** into the field at that size's base drift speed (a fresh speed within
  the size's range). No points are scored, and the field's rock count is
  unchanged — the star churns the board but never empties it. (Contrast splitting,
  which is scored and does change the count.)

## The bullets

- The ship fires small round **bullets** of radius **3** (color `#f2f5f7`) from
  its nose.
- A bullet travels under momentum, is curved by the star's gravity like everything
  else, and wraps at the edges. It is removed when its **lifetime** expires, when
  it reaches the star core (absorbed), or when it destroys a rock. The exact
  muzzle velocity, lifetime, on-screen limit, and fire rate are in
  `specs/physics.md`.

## The saucer

- An enemy **saucer** periodically enters the field to hunt the ship. It is drawn
  as a flattened neon disc (a classic "flying saucer" silhouette) in color
  `#ff5c8a`, and collides as a **circle of radius 18**.
- The saucer is a **powered craft**: it is the one body the star does **not** pull
  (see `specs/physics.md`), and it steers to avoid the star's core. It crosses the
  field firing bullets aimed at the ship. Its full movement, firing, spawn cadence,
  and score are defined in `specs/flow.md`.
- Destroying the saucer with a bullet scores **200** points.
