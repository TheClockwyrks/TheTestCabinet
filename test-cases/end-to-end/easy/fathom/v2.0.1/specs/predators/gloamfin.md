# Fathom — The Gloamfin: hunts your sound (violet)

The Gloamfin hunts your sound. This file defines its wander, sense, chase, search,
tell, and counter; the movement, den release, detection alert, and per-depth counts
common to every predator are in `specs/predators.md`. It cross-references the sensing
in `specs/gameplay.md` and the art in `specs/assets.md`.

The Gloamfin is eyeless and hunts by sound, sweeping the maze with its own sonar. It
is the predator your sonar is waiting for.

- Wander: ordinary speed, no wind-up. By default the Gloamfin does not know where you
  are and wanders at the ordinary predator speed, `116 px/s`, the same pace as the
  other hunters. It does not creep and then ramp ever faster over time; there is no
  speed build-up. As it wanders it emits its own sonar pings (its tell, below).
- Sense: its ping, or yours. The Gloamfin takes a fix on you from sonar by three
  paths, and each one fires the detection alert (`specs/predators.md`), so a fix from
  your sonar or from close hearing announces itself exactly the same way as its own
  ping:
  - when one of its own sonar pings (below) floods over your tile, or
  - when your sonar pulse (`specs/gameplay.md`) floods over the Gloamfin, or
  - by very-close hearing: within about 2 tiles, in or out of line of sight, it knows
    your tile, so you cannot creep straight past it.

  The fix is the tile the ping caught you on. Ink does not affect it (it hunts by
  sound). The instant it takes a fix it may turn around immediately to face you, and
  the detection alert fires on that fresh acquisition however it came.
- Chase: a touch faster than you, to where the ping found you. On a fix the Gloamfin
  chases, driving toward the fixed tile at up to `134 px/s`, only about 5% faster than
  the forager's `128`, so on a straight run it slowly gains along the line the ping
  drew rather than blowing past you. This stays gentle because the Gloamfin often
  fixes on you at close range off its short-range hearing, where a big speed jump would
  be an unfair blindside. It heads for the tile the ping actually found you on, not
  wherever you have since slipped away to.
  - Cornering costs it speed, and that is your way out. `134 px/s` is only a cap,
    reached on straight runs. The instant the Gloamfin turns a corner to keep following
    you (any perpendicular turn, not a straight run, and not a free reversal to face
    someone behind it), it drops to about `115 px/s`, roughly 10% slower than you, and
    then ramps back up to the `134` cap over about `2 s`. So a straight sprint alone
    will not shake it (it out-paces you on the straight), but a player who keeps
    cutting corners gains a little ground at each turn and can gradually open the gap
    and escape. Its wander stays the ordinary `116 px/s` throughout; the chase ramp is
    the only speed change.
- Search: a delayed, guaranteed ping, your escape window. When the Gloamfin reaches
  that tile and you are not there, it does not re-ping at once. It slows back to
  `116 px/s`, casts back and forth around the spot, and only after a short delay of
  about `1.2 s` does it emit a guaranteed "lost you" sonar ping. That ping always fires
  (it does not wait out the full normal cadence) and resets the standard ping timer.
  The delay is your chance to break away before the ping lands.
  - The "lost you" ping is drawn orange, a distinct tell. So you can see your escape
    window, the guaranteed "lost you" ping renders its traveling wavefront in orange,
    plainly distinct from the ordinary violet ping (the same procedural wavefront, only
    tinted orange). When an orange crest sweeps out of the Gloamfin, you know it has
    reached where it last heard you, found you gone, and is casting one last ping to
    re-find you: put corners between you before that orange front reaches your tile.
  - A floor on the ping rate. The Gloamfin never emits two pings closer than about
    `3 s` apart, not even the guaranteed "lost you" one. When it keeps re-finding you
    at close range (its hearing hands it a fix, it reaches the near tile in a beat, and
    it would ping again almost at once), this floor holds the next ping back until the
    gap has passed, so it cannot rapid-fire its ping.
  - Silent while it already has you. More strongly: while you are inside its hearing
    range (about 2 tiles), the Gloamfin already holds a continuous lock straight off
    its hearing and does not ping at all, no periodic ping and no "lost you" ping.
    Pinging there tells it nothing it does not already know and only floods you with
    wavefronts. It stays silent as long as it is on you, and the moment you slip back
    out of hearing range it pings again to re-find you (subject to the `3 s` floor
    above).
  - If the "lost you" ping (or any later ping) catches you, the Gloamfin takes a fresh
    fix and chases again.
  - If the search turns up nothing, it gives up after a handful of seconds, about `5 s`
    from reaching the empty tile, and returns to wandering.
- Tell. The Gloamfin emits its own sonar pings about every `4 s` (except when it
  already holds a close-range hearing lock, when it goes silent; see the anti-spam
  rules under Search above): the same traveling sonar wavefront the forager's pulse
  uses (rendered procedurally, here tinted to the Gloamfin's violet rather than the
  forager's cyan, except the guaranteed "lost you" ping, which is tinted orange to set
  it apart; see the Search rules above and `specs/gameplay.md` and `specs/assets.md`),
  sweeping outward through the corridors well beyond the Gloamfin's own sprite. You see
  the wavefront flow toward you, so you know a Gloamfin is near and hunting, and you
  can watch how far its hearing reaches, but the ping does not draw the Gloamfin
  itself, so you get the warning without a clean fix on where the source is. (It is
  still revealed the normal ways: by your light, by your sonar mark, or by the
  detection alert when a ping catches you.) And its ping reveals nothing else to you
  either: unlike your sonar, the Gloamfin's ping does not light the maze or mark
  anything for you (see `specs/gameplay.md`); it is a warning you can see, not a map.
  Because the wavefront travels, a ping catches you when its front reaches your tile,
  not the instant it is cast, a brief, readable moment as the violet crest sweeps over
  you. When a Gloamfin ping catches you, the detection alert (`specs/predators.md`)
  fires, and that alert does show it lit for its half-second, so you always learn which
  hunter found you the moment you are actually spotted.
- Counter: corner it and break the fix. The Gloamfin is a touch faster than you on a
  straight run, so simply sprinting away down a long, straight corridor slowly loses
  ground; you cannot just outrun it in the open. Instead keep cutting corners: every
  turn it makes to follow you costs it speed (above), so a cornered, weaving route
  gradually opens the gap. Combine that with the escape window: when it reaches where
  it last heard you and begins casting about, put more distance and corners between you
  before its delayed "lost you" ping fires, so the ping comes up empty and it gives up.
  Keep your own sonar for when you truly need it: pinging near the Gloamfin hands it a
  fresh fix and feeds the chase. Ink is useless against it.
