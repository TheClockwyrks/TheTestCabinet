# Fathom — The Flarefish: hunts in its flare's light (orange)

The Flarefish hunts your light, but shows nothing of itself between the flares it
casts. This file defines its sense, its flare, its flare-lock, its chase, and its
counter; the movement, den release, detection alert, and per-depth counts common to
every predator are in `specs/predators.md`. It hunts exactly like the Lanternjaw
(`specs/predators/lanternjaw.md`) once it has a fix, and cross-references the sensing
in `specs/gameplay.md` and the art in `specs/assets.md`.

The Flarefish is a silent hunter: it gives off no tell of its own except the flare it
casts. It hunts your light just like the Lanternjaw
(`specs/predators/lanternjaw.md`); the only difference is that the Lanternjaw's bulb
marks it at all times, while the Flarefish is unseen between flares. So it finds you
in two ways: by drifting up on you and catching your light the way the Lanternjaw
does, or by its flare, which locks onto you at far greater range and straight through
walls.

- No tell but the flare. Unlike the Lanternjaw (its always-visible bulb) and the
  Gloamfin (its periodic ping), the Flarefish makes nothing that betrays its position
  on its own; its only signal is its flare (below), which is rarer than the Gloamfin's
  ping, so it warns you less often. It is not literally unseeable, though: like every
  other predator its body is revealed wherever your light falls on it or a sonar pulse
  catches it (`specs/gameplay.md`). It simply does not advertise itself between flares.
- Sense: your light, exactly like the Lanternjaw. Independently of the flare, the
  Flarefish senses you the way the Lanternjaw does: whenever you are within a
  light-range that grows with your brightness (`R = 128 + 192 * G`, about 4 tiles dim,
  up to about 10 tiles fully lit) and in its line of sight (a wall breaks it, and ink
  breaks it), it takes a fix on your current tile, fires the detection alert (it was
  unseen, so being found must announce itself), and chases. This runs all the time,
  wandering or chasing, so a Flarefish that simply drifts up next to you in your glow
  fixes on you at once and pursues, exactly as the Lanternjaw would; it does not sit
  idle waiting for its next flare. Between flares it makes no tell, but it is not blind.
- Flare. About every `7 s` the Flarefish emits a flare: a bright bloom lighting a
  radius of about `192 px` (6 tiles) around itself for `1 s`, preceded by a roughly
  `0.5 s` charge-up glow that telegraphs it and reveals the Flarefish's position. The
  bloom is a large radial light effect (charge-up, bloom, then fade), rendered from the
  provided flare-bloom effect sheet (`assets/flare-bloom/`, see `specs/assets.md`):
  play its charge, bloom, and fade frames as its own overlay centered on the Flarefish
  and scaled far larger than the creature's own sprite, not part of it.
  - The flare ignores walls. Its light is not blocked by rock: it fills the full
    `192 px` radius around the Flarefish regardless of any walls between.
  - The flare reveals that area to you, as a full-light window that follows the
    Flarefish. Every tile within the flare's radius, floor and wall alike, straight
    through walls, is revealed to you, and any predator or the drifter inside it is
    shown live during the bloom. For as long as the bloom burns, the whole disc reads
    as full light: every tile in it is drawn at full brightness, moving with the
    Flarefish, and it fades back to normal near the end of the flare (how it fades —
    to remembered dim, or to black beyond your vision circle — is governed per dive by
    `specs/gameplay.md`). A Flarefish flaring nearby is free reconnaissance: it is the
    one enemy effect that lights the maze for you (the Gloamfin's ping, by contrast,
    reveals nothing; see `specs/gameplay.md`).
- Flare lock: caught anywhere in the light, at any point in the bloom. Beyond the
  ordinary light-sense above, the flare is itself a far longer-range, wall-ignoring
  lock: a persistent light that stays attached to the Flarefish for the whole bloom,
  not a single instant of the flash. If the forager is within the flare's `192 px`
  radius at any moment while the bloom burns (walls do not save you, but ink does; see
  the counter), the Flarefish acquires a fix on your tile, the detection alert fires,
  and it immediately begins to chase, turning toward you at once. This means:
  - You are not safe just because you were clear when it first bloomed: drift into the
    still-lit disc before it fades and it still catches you.
  - Because the disc is stuck to the Flarefish, the Flarefish's own movement can sweep
    the light over you mid-bloom and acquire you.

  Only if you stay outside the flare for the entire bloom, and out of its ordinary
  light-sense range, does it learn nothing from the flare and keep wandering.
- Chase: exactly like the Lanternjaw. Once it has a fix the Flarefish stops flaring and
  pursues you just as the Lanternjaw does (`specs/predators/lanternjaw.md`): it senses
  you within a light-range that grows with your brightness (`R = 128 + 192 * G`) in
  line of sight, keeps its fix on your current tile while it can see you, and when it
  loses sight of you (you round a corner) it paths to your last-known tile and lingers
  `2 s` there before giving up. It is drawn wherever your light, a sonar mark, or a
  flare reaches it, exactly as at any other time, and while chasing it stops flaring,
  so during the chase it gives off no tell at all.
- Losing you, and re-arming the flare. If the Flarefish loses you (you break its line
  of sight, go dim out of range, or ink it) and its linger runs out, it returns to
  wandering (silent again but for its flare) and begins flaring again, but the flare
  does not fire instantly: on re-entering the wander state its flare is put on a fresh
  timer (a full `7 s` before the next flare), giving you a chance to get clear before it
  can catch you again.
- Tell. The charge-up glow before each flare telegraphs both the flare and the
  Flarefish's location, and the detection alert fires the instant a flare catches you.
- Counter. When you see a flare charging, break out of its radius before the bloom and
  stay out for the whole bloom so it cannot acquire you. The flare ignores walls, so a
  wall alone will not hide you; you must be outside the `192 px` circle, and mind that
  the circle moves with the Flarefish, so keep clear of where it is drifting, not just
  where it started. Or drop ink, which blinds it and breaks the acquisition even inside
  the flare. Once it is chasing, lose it exactly as you lose the Lanternjaw: get behind
  a wall, go dim, or ink it, then stay clear until its flare re-arms. Use its flares to
  map the maze, but never get caught standing in one.
- Speed. `116 px/s`, in both wander and chase, the Lanternjaw's pace.
