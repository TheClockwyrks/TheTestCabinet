# Fathom — The Lanternjaw: hunts your light (amber)

The Lanternjaw hunts your light. This file defines its sense, tell, patrol, counter,
and speed; the movement, den release, detection alert, and per-depth counts common to
every predator are in `specs/predators.md`. It cross-references the sensing and ink in
`specs/gameplay.md` and the art in `specs/assets.md`.

The Lanternjaw is drawn to your glow. The more recently you have eaten, the farther
it finds you.

- Sense. The Lanternjaw senses you when you are within its detection range and in its
  line of sight (its sensing is light, so a wall between you breaks it). Its detection
  range scales with your brightness `G` (see Brightness in `specs/gameplay.md`):
  `R = 128 + 192 * G`, about 4 tiles when you are dim, up to about 10 tiles when you
  are fully lit from eating. While it senses you, its fix is your current tile; when
  it loses sight of you (you round a corner, or a wall breaks its line) it keeps the
  fix on your last-known tile and paths to it, following you around the corner rather
  than pressing into the wall between you, for a linger of `2 s`, after which it gives
  up and returns to wandering. It may turn back toward you the instant it senses you.
- Tell: the always-visible bulb. The Lanternjaw carries a small bulb, a glowing amber
  point (drawn as a runtime glow, and, on the body sprite, as an amber bell; see
  `specs/assets.md`). Its bulb-light is the maze's always-visible amber tell: a single
  glowing amber point drifting in the dark, shown by the amber-light rule of the dive
  you are building (`specs/gameplay.md` governs exactly how far it reaches), even
  though the Lanternjaw's body stays hidden by the dark like any predator, drawn only
  where your light (or a flare) falls on it. A sonar pulse does not reveal it: the
  Lanternjaw is an amber-light entity, so a ping leaves only its bulb, unchanged, and
  never paints in its body, neither giving it away as the Lanternjaw nor mistaking it
  for a drifter (see `specs/gameplay.md`). So you can always see the light coming, but
  not the jaws behind it. The bulb is drawn identically to the bonus drifter's
  (`specs/gameplay.md`): the same amber glow, and, up close where your light reveals
  the body, the very same amber bell, in the same place. At a glance you cannot tell a
  harmless drifter from a lurking Lanternjaw, so every amber glimmer in the dark is a
  gamble, and the drifter is effectively bait. When your light does fall on it, the
  reveal is purely additive: the shared bulb does not move or change; only the rest of
  the body appears around it (the drifter's tendrils, or, once the Lanternjaw lunges,
  its jaws; see `specs/assets.md`).
- Patrol: indistinguishable from the drifter. Until it senses you, the Lanternjaw's
  wandering AI is identical to the bonus drifter's (`specs/gameplay.md`): it drifts the
  corridors at the drifter's speed (about `64 px/s`, half the forager's, not the
  ordinary predator speed), using the drifter's exact wander routing (a random open
  direction at each junction, avoiding an immediate reverse). Because only its bulb
  shows in the dark (its body obeys the fog), a wandering Lanternjaw looks exactly like
  a drifting amber mote, same glow, same pace, same drift, so you genuinely cannot tell
  a harmless drifter from a lurking Lanternjaw until it fixes on you and lunges. The
  instant it senses you it drops the disguise and hunts at its chase speed (below).
- Counter. Go dim (stop eating and let `G` decay) to shrink its range and slip out of
  its sight, or drop ink (it hunts by sight, so ink blinds it; see `specs/gameplay.md`).
  Eating a streak of plankton near the Lanternjaw lights you up and pulls it straight
  to you.
- Speed. While hunting it moves at `116 px/s`, slightly slower than the forager, so a
  clean straight run loses it once you are dim or behind a wall. While wandering it
  moves at the drifter's `64 px/s`, the disguise that makes its bulb pass for a
  drifter.
