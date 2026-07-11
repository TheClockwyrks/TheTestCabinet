# Fathom — The predators

This file defines the three predators: how each one moves, how each senses and
hunts you, the tell each gives off, and how the den releases them. It builds on
the maze and den in `specs/playfield.md`, the sensing systems in
`specs/sensing.md`, the movement and ink in `specs/movement.md`, and the match
flow in `specs/flow.md`.

There are exactly **three** predators, each keyed to a different signal you give
off. None of them can be eaten — there is no power-up that turns them into prey.
The only ways to survive are to stay undetected, to break their fix, and to
out-maneuver them.

## Shared movement and states

All predators move on the tile grid, along corridor centers, choosing a direction
at each junction. They travel at their own speeds (below). A predator may
**reverse at any time** — it does not have to wait for a tile center to turn
around — and when a predator first detects you it is explicitly allowed to
**turn back toward you immediately** (called out per predator below), so it never
wastes a beat facing the wrong way at the moment it finds you.

Two shared ideas run under the per-predator behavior:

- **Wander (patrol)** — it does not know where you are. At junctions it picks an
  open direction at random, preferring not to immediately reverse, so its path is
  unpredictable. It moves at its patrol speed (below).
- **A fix** — a tile it believes you are at, set by its sense (below). While it
  holds a fix it **pursues**: it follows the **shortest corridor path** to the
  fixed tile, rounding walls to reach it. It must genuinely **path around
  obstacles** — a hunter that only ever steps in the direction that shortens the
  straight-line distance will **wedge in an L-corner** (it walks into the corner
  nearest you and can get no closer), which it must not do. When a predator loses
  track of you (see each one below), the fix holds at your **last-known tile** and
  it paths there — so it rounds the corner you slipped behind rather than pressing
  into the wall between you.

Predators move through wrap tunnels like the forager. **Contact** — a predator's
body overlapping the forager — costs a life (see `specs/flow.md`). Predators get
faster in deeper trenches (see Depth in `specs/flow.md`).

**Render each from its provided sprite** (`specs/assets.md`), facing its direction
of travel with its swim cycle: the Lanternjaw from `assets/lanternjaw/`, the
Gloamfin from `assets/gloamfin/`, the Flarefish from `assets/flarefish/`. Their
two signature effects — the sonar pulse and the flare bloom — are separate
provided effect sheets, called out where each appears below. Do not draw
substitute creatures or effects.

## Detecting you — the alert (required, anti-blindside)

Two of the predators can blindside you — the **Gloamfin**, which acquires you the
instant it takes a sound-fix **by any of its paths** (below), and the **Flarefish**,
which gives off no continuous tell and so can find you unseen: the moment its flare
catches you, **or** the moment it drifts up on you and its ordinary light-sense
fixes on you (below). The moment a predator acquires a fix in one of these ways,
play a clear **detection alert** so you always know you have been spotted:

- A sharp, bright **flash burst** in that predator's signature color, centered on
  the predator, that snaps outward and fades over about **`0.5 s`**, together with
  the predator itself shown **lit** for that window — even where your own light
  does not reach — so you can see *which* hunter found you and roughly where it is.

The alert is runtime art you draw in code (see `specs/assets.md` — it is not a
sprite sheet), and it must be **unmistakable** against the dark: an earlier build
left players unsure whether they had actually been detected, so the acquisition
has to read at a glance. (The Lanternjaw also hunts your light *continuously*, but
it has no discrete alert — its always-visible bulb, below, is its standing tell, so
you can already see it coming. The Flarefish senses you the same continuous way,
yet **shows nothing** between flares, so even a quiet light-sense acquisition must
fire the alert — otherwise its unseen jaws would be a pure blindside.)

## The den and release

All three predators begin each trench (and respawn after you lose a life) inside
the **den** (`specs/playfield.md`), and leave through the den gate on a schedule:

- **The Lanternjaw** leaves immediately (at release time `0`).
- **The Gloamfin** leaves **`5 s`** after release.
- **The Flarefish** leaves **`10 s`** after release.

When you lose a life, all surviving predators return to the den and re-release on
the same schedule, giving you a moment to reorient.

## The Lanternjaw — hunts your light (amber)

The Lanternjaw is drawn to your glow. The more recently you have eaten, the
farther it finds you.

- **Sense.** The Lanternjaw senses you when you are within its detection range and
  in its line of sight (its sensing is light, so a wall between you breaks it). Its
  **detection range** scales with your brightness `G` (see Brightness in
  `specs/sensing.md`): `R = 128 + 192 * G` — about **4 tiles** when you are dim, up
  to about **10 tiles** when you are fully lit from eating. While it senses you,
  its fix is your current tile; when it loses sight of you (you round a corner or a
  wall breaks its line) it keeps the fix on your **last-known tile and paths to
  it** — following you around the corner rather than pressing into the wall between
  you — for a **linger** of **`2 s`**, after which it gives up and returns to
  wandering. It may turn back toward you the instant it senses you.
- **Tell — the always-visible bulb (anti-blindside).** The Lanternjaw carries a
  small dangling **bulb** (it is on the Lanternjaw's sprite; its **bulb-bob** frames
  are the beckoning animation — see `assets/lanternjaw/` in `specs/assets.md`). Its
  **bulb-light is always visible to you, at any distance and even through walls** —
  a single glowing amber point drifting in the dark — even though the Lanternjaw's
  **body** stays hidden by the dark like any predator (drawn only where your light,
  a sonar mark, or a flare reveals it). So you can always see the light coming, but
  not the jaws behind it. Crucially, **the bulb looks almost identical to the bonus
  drifter** (`specs/playfield.md`): at a glance you cannot tell a harmless drifter
  from a lurking Lanternjaw, so every amber glimmer in the dark is a gamble — and
  the drifter is effectively bait.
- **Patrol — indistinguishable from the drifter (required).** Until it senses you,
  the Lanternjaw's wandering AI is **identical to the bonus drifter's**
  (`specs/playfield.md`): it drifts the corridors at the **drifter's speed** (about
  **`64 px/s`**, half the forager's — *not* the ordinary predator speed), using the
  drifter's exact wander routing (a random open direction at each junction, avoiding
  an immediate reverse), and it does **not** speed up with depth while it wanders.
  Because only its **bulb-light** shows in the dark (its body obeys the fog), a
  wandering Lanternjaw looks **exactly** like a drifting amber mote — same glow, same
  pace, same drift — so you genuinely cannot tell a harmless drifter from a lurking
  Lanternjaw until it fixes on you and lunges. The instant it senses you it drops the
  disguise and hunts at its chase speed (below).
- **Counter.** Go **dim** — stop eating and let `G` decay — to shrink its range and
  slip out of its sight, or drop **ink** (it hunts by sight, so ink blinds it; see
  `specs/movement.md`). Eating a streak of plankton near the Lanternjaw lights you
  up and pulls it straight to you.
- **Speed.** While **hunting** it moves at **`116 px/s`**, slightly slower than the
  forager, so a clean straight run loses it once you are dim or behind a wall. While
  **wandering** it moves at the **drifter's `64 px/s`** (above), the disguise that
  makes its bulb pass for a drifter.

## The Gloamfin — hunts your sound (violet)

The Gloamfin is eyeless and hunts by sound, sweeping the trench with its own
sonar. It is the predator your **sonar** is waiting for.

- **Wander — ordinary speed, no wind-up.** By default the Gloamfin does not know
  where you are and **wanders at the ordinary predator speed, `116 px/s`** — the
  same pace as the other hunters. It does **not** creep and then ramp ever faster
  over time; there is no speed build-up. As it wanders it emits its own sonar pings
  (its tell, below).
- **Sense — its ping, or yours.** The Gloamfin takes a **fix** on you from sonar by
  **three** paths, and **each one fires the detection alert** (above) — the alert is
  required on *every* Gloamfin acquisition, not only its own ping, so a fix from your
  sonar or from close hearing announces itself exactly the same way:
  - when **one of its own sonar pings** (below) floods over your tile, **or**
  - when **your** sonar pulse (`specs/sensing.md`) floods over the Gloamfin, **or**
  - by very-close **hearing** — within about **2 tiles**, in or out of line of
    sight, it knows your tile, so you cannot creep straight past it.

  The fix is the tile the ping caught you on. **Ink does not affect it** (it hunts
  by sound). The instant it takes a fix it may **turn around immediately** to face
  you, and the **detection alert fires** on that fresh acquisition however it came.
- **Chase — a touch faster than you, to where the ping found you.** On a fix the
  Gloamfin **chases**: it drives toward the fixed tile at up to **`134 px/s` — only
  about **5%** faster than the forager's `128`** — so on a straight run it **slowly
  gains** along the line the ping drew rather than blowing past you. (This
  deliberately stays gentle because the Gloamfin often fixes on you at **close
  range** off its short-range hearing; a big speed jump there would be an unfair
  blindside.) It heads for the tile the ping actually found you on, not wherever you
  have since slipped away to.
  - **Cornering costs it speed (your way out).** `134 px/s` is only a **cap**,
    reached on straight runs. The instant the Gloamfin **turns a corner** to keep
    following you (any perpendicular turn — not a straight run, and not a free
    reversal to face someone behind it), it **drops to about `115 px/s` — roughly
    **10%** *slower* than you** — and then **ramps back up to the `134` cap over
    about `2 s`**. So a straight sprint alone won't shake it (it out-paces you on
    the straight), but a player who **keeps cutting corners** gains a little ground
    at each turn and can gradually open the gap and **escape** — without this the
    Gloamfin was inescapable once it drew close. Its **wander** stays the ordinary
    `116 px/s` throughout; the chase ramp is the only speed change.
- **Search — a delayed, guaranteed ping (your escape window).** When the Gloamfin
  **reaches that tile and you are not there**, it does not re-ping at once. It slows
  back to `116 px/s` and **casts back and forth around the spot**, and only after a
  short delay of about **`1.2 s`** does it emit a **guaranteed "lost you" sonar
  ping**. That ping always fires (it does not wait out the full normal cadence) and
  **resets** the standard ping timer. The delay is deliberate — it is your chance
  to break away before the ping lands.
  - **The "lost you" ping is drawn ORANGE (required, a distinct tell).** So you can
    *see* your escape window, the guaranteed "lost you" ping renders its travelling
    wavefront in **orange**, plainly **distinct from the ordinary violet ping** — the
    same procedural wavefront, only tinted orange. When an orange crest sweeps out
    of the Gloamfin, you know it has reached where it last heard you, found you gone,
    and is casting one last ping to re-find you: put corners between you before that
    orange front reaches your tile. (An earlier build drew it identical to the routine
    violet ping, so a reviewer could not tell the "lost you" ping apart at all.)
  - **A floor on the ping rate (required, anti-spam).** The Gloamfin never emits two
    pings closer than about **`3 s`** apart — not even the guaranteed "lost you" one.
    When it keeps re-finding you at close range (its hearing hands it a fix, it
    reaches the near tile in a beat, and it would ping again almost at once), this
    floor holds the next ping back until the gap has passed, so it **cannot
    rapid-fire its ping**. An earlier build let this loop spin and the Gloamfin
    stuttered pings on top of each other whenever it got close.
  - **Silent while it already has you (required, anti-spam).** More strongly: while
    you are **inside its hearing range** (about **2 tiles**), the Gloamfin already
    holds a **continuous lock** straight off its hearing and does **not ping at
    all** — no periodic ping, no "lost you" ping. Pinging there tells it nothing it
    does not already know and only floods you with wavefronts; an earlier
    build did exactly that, firing pings near-continuously the moment it closed
    within a couple of tiles down a straight corridor. It **stays silent as long as
    it is on you**, and the moment you slip back **out** of hearing range it pings
    again to re-find you (subject to the `3 s` floor above).
  - If the "lost you" ping (or any later ping) catches you, the Gloamfin takes a
    fresh fix and chases again.
  - If the search turns up nothing, it gives up after a handful of seconds — about
    **`5 s`** from reaching the empty tile — and returns to wandering.
- **Tell (anti-blindside).** The Gloamfin emits **its own sonar pings** about
  every **`4 s`** (except when it already holds a close-range hearing lock, when it
  goes silent — see the anti-spam rules under Search above) — the **same travelling
  sonar wavefront** the forager's pulse uses (rendered procedurally, here tinted to
  the Gloamfin's violet rather than the forager's cyan — except the guaranteed "lost
  you" ping, which is tinted **orange** to set it apart, see the Search rules above
  and `specs/sensing.md` and `specs/assets.md`), sweeping outward through the
  corridors well beyond the Gloamfin's own sprite. You **see the wavefront** flow toward you — so you know a
  Gloamfin is near and hunting, and you can watch how far its hearing reaches — but
  the **ping does not draw the Gloamfin itself**: unlike an earlier build, its own
  ping no longer shows its body, so you get the warning without a clean fix on where
  the source is. (It is still revealed the normal ways — by your light, by *your*
  sonar mark, or by the detection alert when a ping catches you.) And **its ping
  reveals nothing else to you** either: unlike your sonar, the Gloamfin's ping does
  **not** light the maze or mark anything for you (see `specs/sensing.md`) — it is a
  warning you can see, not a map. Because the wavefront travels, a ping **catches you
  when its front reaches your tile**, not the instant it is cast — a brief, readable
  moment as the violet crest sweeps over you. When a Gloamfin ping *catches you*, the
  **detection alert** (above) fires —
  and that alert *does* show it lit for its half-second, so you always learn which
  hunter found you the moment you are actually spotted.
- **Counter — corner it and break the fix.** The Gloamfin is a touch faster than
  you on a **straight** run, so simply sprinting away down a long, straight corridor
  slowly loses ground — you cannot just outrun it in the open. Instead **keep cutting
  corners**: every turn it makes to follow you costs it speed (above), so a cornered,
  weaving route gradually opens the gap. Combine that with the **escape window** —
  when it reaches where it last heard you and begins casting about, put more distance
  and corners between you before its delayed "lost you" ping fires, so the ping comes
  up empty and it gives up. Keep **your own** sonar for when you truly need it —
  pinging near the Gloamfin hands it a fresh fix and feeds the chase. Ink is useless
  against it.

## The Flarefish — hunts in its flare's light (orange)

The Flarefish is a silent hunter: it gives off **no tell of its own except the
flare** it casts. It hunts your light **just like the Lanternjaw** — the only
difference is that the Lanternjaw's bulb marks it at all times, while the Flarefish
is unseen between flares. So it finds you in **two** ways: by drifting up on you and
catching your light the way the Lanternjaw does, **or** by its **flare**, which
locks onto you at far greater range and straight through walls.

- **No tell but the flare.** Unlike the Lanternjaw (its always-visible bulb) and the
  Gloamfin (its periodic ping), the Flarefish makes **nothing that betrays its
  position on its own** — its only signal is its **flare** (below), which is **rarer
  than the Gloamfin's ping**, so it warns you less often. It is **not literally
  unseeable**, though: like every other predator its body is **revealed wherever your
  light falls on it or a sonar pulse catches it** (`specs/sensing.md`). It simply
  does not advertise itself between flares.
- **Sense — your light, exactly like the Lanternjaw.** Independently of the flare,
  the Flarefish senses you the way the Lanternjaw does: whenever you are within a
  light-range that grows with your brightness (`R = 128 + 192 * G` — about **4
  tiles** dim, up to about **10 tiles** fully lit) **and** in its line of sight (a
  wall breaks it, and **ink** breaks it), it takes a **fix on your current tile**,
  fires the **detection alert** (it was unseen, so being found must announce
  itself), and chases. This runs **all the time**, wandering or chasing — so a
  Flarefish that simply drifts up next to you in your glow **fixes on you at once**
  and pursues, exactly as the Lanternjaw would; it does **not** sit idle waiting for
  its next flare. Between flares it makes no tell, but it is **not blind**.
- **Flare.** About every **`7 s`** the Flarefish emits a **flare**: a bright bloom
  lighting a radius of about **`192 px`** (6 tiles) around itself for **`1 s`**,
  preceded by a roughly **`0.5 s`** charge-up glow that telegraphs it and reveals
  the Flarefish's position. The bloom is a **large radial light effect** — charge-up,
  bloom, then fade — rendered from the provided **flare-bloom** effect sheet
  (`assets/flare-bloom/`, see `specs/assets.md`): play its charge/bloom/fade frames
  as its own overlay centered on the Flarefish and scaled far larger than the
  creature's own sprite, not part of it.
  - **The flare ignores walls.** Its light is not blocked by rock: it fills the full
    **`192 px` radius** around the Flarefish regardless of any walls between.
  - **The flare reveals that area to you — as a full-light window that follows the
    Flarefish.** Every tile within the flare's radius — **floor and wall alike,
    straight through walls** — is revealed to you, and any predator or the drifter
    inside it is shown live during the bloom. For as long as the bloom burns, the
    **whole disc reads as full light**: every tile in it is drawn at **full
    brightness**, moving with the Flarefish, and it **fades back to normal near the
    end of the flare** — to remembered-dim in Trench, or to **pitch black** beyond
    your own vision circle in Kindle (see `specs/sensing.md` for each mode). In
    **Kindle** in particular the flare is effectively a **second vision circle**: a
    full-vision disc that shows you the trench inside it even out beyond the little
    window you carry, and that vanishes when the flare dies. A Flarefish flaring
    nearby is free reconnaissance — it is the one enemy effect that lights the maze
    *for* you (the Gloamfin's ping, by contrast, reveals nothing; see
    `specs/sensing.md`).
- **Flare lock — caught anywhere in the light, at any point in the bloom.** Beyond
  the ordinary light-sense above, the flare is itself a **far longer-range,
  wall-ignoring lock**: a **persistent light that stays attached to the Flarefish for
  the whole bloom**, not a single instant of the flash. If the **forager is within
  the flare's `192 px` radius at *any* moment while the bloom burns** (walls do not
  save you — but **ink does**, see the counter), the Flarefish **acquires a fix on
  your tile**, the **detection alert** fires, and it **immediately begins to chase**,
  turning toward you at once. This means:
  - You are not safe just because you were clear when it first bloomed: **drift into
    the still-lit disc before it fades and it still catches you.**
  - Because the disc is **stuck to the Flarefish**, the Flarefish's own movement can
    **sweep the light over you** mid-bloom and acquire you.

  Only if you stay **outside the flare for the entire bloom** — and out of its
  ordinary light-sense range — does it learn nothing from the flare and keep
  wandering.
- **Chase — exactly like the Lanternjaw.** Once it has a fix the Flarefish **stops
  flaring** and pursues you **just as the Lanternjaw does**: it senses you within a
  light-range that grows with your brightness (`R = 128 + 192 * G`) in line of
  sight, keeps its fix on your current tile while it can see you, and when it loses
  sight of you (you round a corner) it **paths to your last-known tile** and
  **lingers `2 s`** there before giving up. It is drawn wherever your light, a
  sonar mark, or a flare reaches it — exactly as at any other time — and while
  chasing it **stops flaring**, so during the chase it gives off no tell at all.
- **Losing you — and re-arming the flare.** If the Flarefish loses you (you break
  its line of sight, go dim out of range, or ink it) and its linger runs out, it
  **returns to wandering — silent again but for its flare — and begins flaring
  again** — but the
  flare does **not** fire instantly: on re-entering the wander state its flare is
  put on a fresh timer (a full **`7 s`** before the next flare), giving you a chance
  to get clear before it can catch you again.
- **Tell (anti-blindside).** The **charge-up glow** before each flare telegraphs
  both the flare and the Flarefish's location; and the **detection alert** fires the
  instant a flare catches you.
- **Counter.** When you see a flare charging, **break out of its radius** before the
  bloom and **stay out for the whole bloom** so it cannot acquire you — the flare
  ignores walls, so a wall alone will not hide you; you must be outside the `192 px`
  circle, and mind that the circle **moves with the Flarefish**, so keep clear of
  where it is drifting, not just where it started — **or drop ink**, which blinds it
  and breaks the acquisition even inside the flare. Once it is chasing, lose it
  exactly as you lose the Lanternjaw: get behind a wall, go dim, or ink it, then
  stay clear until its flare re-arms. Use its flares to map the trench, but never
  get caught standing in one.
- **Speed.** `116 px/s`, in both wander and chase — the Lanternjaw's pace.

## Reading the three at once

Each predator answers to a different one of your signals — **light** (Lanternjaw),
**sound** (Gloamfin), **flare-light** (Flarefish) — and each has a distinct tell
and a distinct counter. That is the puzzle of the dark: eat to progress but go dim
near the Lanternjaw, ping to see but not near the Gloamfin, exploit the Flarefish's
light without standing in it, and keep ink for the two that see. And read the amber
glimmers carefully — a drifter is points, but the one that looks just like it may
be the Lanternjaw's bulb.
