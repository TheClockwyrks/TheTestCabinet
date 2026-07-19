# Shatter — Warhead mode

This file states this build's ruleset for how rocks take damage and which weapons the
ship carries, the two things the common specification defers to `specs/mode.md`.
Everything not overridden here is exactly as the common specs describe it, the game in
`specs/overview.md`, `specs/field.md`, `specs/ship.md`, `specs/hazards.md`,
`specs/simulation.md`, and `specs/rules.md`.

The Warhead game is the standard Shatter game (inertial flight, the central gravity
well, escalating waves, the hunting saucer, lives and respawns, and the full state
machine) with three additions: rocks have health (armor), the ship gains a torpedo
secondary weapon, and a torpedo's detonation scatters a rock's fragments harder than a
bullet does.

The title screen and menu are unchanged (`PLAY` / `HOW TO PLAY`, `specs/rules.md`);
choosing `PLAY` starts the Warhead game.

## Armored rocks

Every rock has health determined by its size (`specs/hazards.md`):

| Size   | Health (bullet hits to destroy) |
| ------ | ------------------------------- |
| Large  | 3                               |
| Medium | 2                               |
| Small  | 1                               |

- A bullet that hits a rock lowers that rock's health by 1 and the bullet is removed
  (per the bullet-and-rock rule in `specs/simulation.md`). While the rock still has
  health remaining it is not destroyed and does not split. Only the hit that drops its
  health to 0 destroys it, at which point it splits and scores exactly as in the common
  specs (Large to two Medium, Medium to two Small, Small to nothing; per-size score
  from `specs/rules.md`).
- Damage feedback. Each non-destroying hit produces a brief bright hit-flash (about
  0.1 s) on the struck rock, and a rock renders progressively more damaged as its
  health falls, for example a brighter, more jagged or visibly cracked outline, so a
  player can judge how many hits a rock has left. A full-health rock looks normal.
- A rock created by a split enters at full health for its size (a Medium fragment
  starts at 2, a Small at 1).
- Star recycling preserves damage. A rock recycled by the star (`specs/hazards.md`) is
  the same rock relocated, not a fresh one: it re-enters from off-screen carrying
  exactly the remaining health it had when the star took it, so a Large already chipped
  to 1 HP comes back at 1 HP and a full-health rock comes back full. Because it keeps
  that remaining health, it re-enters still rendering its damaged state, the same
  brighter, more jagged or cracked look it had when the star took it, never redrawn as
  a pristine full-health rock. Its move speed is still reset to a fresh base drift
  speed for its size, exactly as recycling resets speed in the common spec
  (`specs/hazards.md`), so a rock repeatedly slung through the star and recycled does
  not keep getting faster.
- Health never regenerates. Recycling carries damage across unchanged rather than
  restoring it.

The torpedo below ignores armor: it destroys any rock in one hit regardless of its
remaining health. This matters because a Large now takes three bullets to break and
each fragment is armored in turn, so clearing a single Large with the primary gun
alone costs `3 + (2 x 2) + (4 x 1) = 11` hits.

## The torpedo (secondary fire)

The ship gains a secondary firing mode: a single, slow-recharging guided torpedo,
distinct from the primary bullets in `specs/ship.md`.

- Control. Fire the torpedo with `F`. The primary gun stays on `Space`
  (`specs/rules.md`); the torpedo is a separate weapon on its own key.
- One charge, long recharge. The ship holds a single torpedo charge, charged and ready
  at the start of a game. Firing it consumes the charge, and it then recharges over 10
  seconds, after which one torpedo is ready again. While it is recharging, pressing the
  secondary-fire key does nothing. Charges do not stack (at most one is stored), so at
  most one torpedo is in flight at a time. The recharge is a property of the weapon,
  not of the current ship: it keeps counting through a death and respawn (a fresh ship
  neither resets nor refills it), and it begins full only at the start of a new game.
- A powered, guided munition. The torpedo is self-propelled and travels at a constant
  420 px/s. It is one of the powered bodies the star does not pull
  (`specs/simulation.md`): it holds its own course through the gravity well rather than
  curving like a bullet. It wraps at the field edges like every body, and it is
  absorbed and removed if it reaches the star core. It collides as a circle of radius
  6.
- Launch. The torpedo leaves the ship's nose along the ship's current facing and, at
  first, flies straight on that heading. It does not inherit the ship's drift: being
  self-propelled, its heading is exactly the ship's facing at the moment of launch.
- Homing within a forward cone. Every simulation step the torpedo looks for a target:
  any rock or the saucer whose bearing from the torpedo lies within a ±15 degree cone
  (30 degrees total) centered on the torpedo's current heading. Among the bodies inside
  that forward cone it picks the nearest (by shortest wrapped distance,
  `specs/simulation.md`) and turns its heading toward that target's current position at
  up to 160 degrees/second, keeping its 420 px/s speed. If no body is in the cone this
  step, it flies straight. It re-evaluates every step, so it can acquire, lose, and
  re-acquire a target, but because the cone only looks forward, it never doubles back
  on something behind it.
- Lifetime. A torpedo that hits nothing is removed 3.5 seconds after launch; it is also
  removed on impact and at the star core.
- Appearance. Draw the torpedo as a small elongated munition in `#b8ff5c` (an
  acid-green clearly distinct from the white bullets), with a short exhaust trail
  pointing opposite its heading and a soft neon glow, so it reads at a glance as the
  heavy weapon rather than a bullet.

## Torpedo impacts

- Torpedo and rock. The rock is destroyed instantly, regardless of its size or
  remaining health, and the torpedo is removed. It splits and scores exactly as a
  bullet kill would (Large to two Medium, Medium to two Small, Small to nothing; same
  per-size score from `specs/rules.md`). A torpedo destroys only the rock it strikes
  (it does not chain), and the fragments it produces are ordinary armored rocks at full
  health for their size.
- Harder scatter. Fragments from a torpedo kill are launched with more force than from
  a bullet shatter: each fragment takes the parent's velocity plus an outward kick of
  about 240 px/s (versus the roughly 90 px/s perpendicular split kick a bullet gives in
  `specs/simulation.md`), directed radially outward from the destroyed rock's center so
  the pieces blast apart. Fragments then obey gravity like any rock.
- Torpedo and saucer. The saucer is destroyed (score 200, `specs/rules.md`) and the
  torpedo is removed.
- A torpedo never harms the player's own ship and is unaffected by saucer bullets.

## HUD

In addition to the score and remaining-lives glyphs (`specs/rules.md`), the HUD shows
a torpedo-charge indicator just below the lives row, near `(44, 140)`: a small torpedo
glyph in `#b8ff5c` with a slim charge bar beneath it. When a torpedo is ready, the
glyph is lit and the bar full; while it is recharging, the glyph is dimmed and the bar
fills smoothly from empty to full across the 10-second recharge, so the player can see
when the next torpedo will be available. The rest of the HUD is unchanged.

## How to play

The how-to-play screen (`specs/rules.md`) additionally explains, for this build: that
larger rocks are armored and take several bullet hits to break (shown by their visible
damage), and that the torpedo secondary weapon (`F`) fires a single guided munition on
a 10-second recharge that homes onto the nearest target within a narrow forward cone,
flies true through the gravity well, and destroys any rock outright while blasting its
fragments outward.

## Controls (addition)

Everything under Controls in `specs/rules.md` still applies, plus:

- Fire torpedo (secondary): `F`.

## Proof of implementation (this mode)

In addition to the common proofs in `specs/proof.md`, capture from the built Warhead
game, using the project-local Playwright and framed like the references (the full 1280
x 720 field, fitted and centered), a screenshot and a short clip at exactly these
paths relative to the repository root:

| Path | What it must show |
| --- | --- |
| `proof/warhead.png` | A live Warhead frame: an armored Large rock showing visible damage (a hit or two already taken), a torpedo in flight with its exhaust homing toward a rock in its forward cone, and the HUD torpedo-charge indicator. |
| `proof/torpedo.webm` | A short clip of a torpedo run: the torpedo launches straight, acquires a rock in its forward cone and curves onto it, and detonates it, the fragments blasting outward harder than a bullet shatter. |

Same rules as `specs/proof.md`: a PNG for the still and a `.webm` for the clip, written
to exactly those paths from the built game (not hand-edited); create the `proof/`
directory if it does not exist.
