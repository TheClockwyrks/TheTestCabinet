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
  holds a fix it **pursues**: at each junction it takes the open direction that
  most reduces the grid distance to the fix — a steady, greedy chase.

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

Two of the predators acquire you in a single, discrete instant — the **Gloamfin**
when one of its sonar pings finds you, the **Flarefish** when its flare catches
you. The moment a predator acquires a fix this way, play a clear **detection
alert** so you always know you have been spotted:

- A sharp, bright **flash burst** in that predator's signature color, centered on
  the predator, that snaps outward and fades over about **`0.5 s`**, together with
  the predator itself shown **lit** for that window — even where your own light
  does not reach — so you can see *which* hunter found you and roughly where it is.

The alert is runtime art you draw in code (see `specs/assets.md` — it is not a
sprite sheet), and it must be **unmistakable** against the dark: an earlier build
left players unsure whether they had actually been detected, so the acquisition
has to read at a glance. (The Lanternjaw hunts your light *continuously* rather
than in one instant, so it has no discrete alert — its always-visible bulb, below,
is its tell.)

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
  its fix is your current tile; **linger** after losing you is **`2 s`**, after
  which it returns to wandering. It may turn back toward you the instant it senses
  you.
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
- **Counter.** Go **dim** — stop eating and let `G` decay — to shrink its range and
  slip out of its sight, or drop **ink** (it hunts by sight, so ink blinds it; see
  `specs/movement.md`). Eating a streak of plankton near the Lanternjaw lights you
  up and pulls it straight to you.
- **Speed.** `116 px/s`, slightly slower than the forager, so a clean straight run
  loses it once you are dim or behind a wall.

## The Gloamfin — hunts your sound (violet)

The Gloamfin is eyeless and hunts by sound, sweeping the trench with its own
sonar. It is the predator your **sonar** is waiting for.

- **Wander — ordinary speed, no wind-up.** By default the Gloamfin does not know
  where you are and **wanders at the ordinary predator speed, `116 px/s`** — the
  same pace as the other hunters. It does **not** creep and then ramp ever faster
  over time; there is no speed build-up. As it wanders it emits its own sonar pings
  (its tell, below).
- **Sense — its ping, or yours.** The Gloamfin takes a **fix** on you from sonar:
  - when **one of its own sonar pings** (below) floods over your tile, **or**
  - when **your** sonar pulse (`specs/sensing.md`) floods over the Gloamfin, **or**
  - by very-close **hearing** — within about **2 tiles**, in or out of line of
    sight, it knows your tile, so you cannot creep straight past it.

  The fix is the tile the ping caught you on. **Ink does not affect it** (it hunts
  by sound). The instant it takes a fix it may **turn around immediately** to face
  you.
- **Chase — faster than you, to where the ping found you.** On a fix the Gloamfin
  **chases**: it drives toward the fixed tile at **`168 px/s` — faster than the
  forager's `128`** — so it runs you down along the line the ping drew. It heads
  for the tile the ping actually found you on, not wherever you have since slipped
  away to.
- **Search — a delayed, guaranteed ping (your escape window).** When the Gloamfin
  **reaches that tile and you are not there**, it does not re-ping at once. It slows
  back to `116 px/s` and **casts back and forth around the spot**, and only after a
  short delay of about **`1.2 s`** does it emit a **guaranteed "lost you" sonar
  ping**. That ping always fires (regardless of the normal ping cadence) and
  **resets** the standard ping timer. The delay is deliberate — it is your chance
  to break away before the ping lands.
  - If the "lost you" ping (or any later ping) catches you, the Gloamfin takes a
    fresh fix and chases again.
  - If the search turns up nothing, it gives up after a handful of seconds — about
    **`5 s`** from reaching the empty tile — and returns to wandering.
- **Tell (anti-blindside).** The Gloamfin emits **its own sonar pulses** about
  every **`4 s`** — the **same large expanding sonar-ring effect** the forager's
  pulse uses (the provided `assets/sonar-pulse/` sheet, here tinted to the
  Gloamfin's violet rather than the forager's cyan — see `specs/sensing.md` and
  `specs/assets.md`), spreading well beyond the Gloamfin's own sprite. You **see the
  ring**, and it shows the Gloamfin's own position for that moment — so its hunting
  gives it away. But **its ping reveals nothing else to you**: unlike your sonar,
  the Gloamfin's ping does **not** light the maze or mark anything for you (see
  `specs/sensing.md`) — it is a warning you can see, not a map. And when a Gloamfin
  ping *catches you*, the **detection alert** (above) fires so you know you have
  been heard.
- **Counter — break the fix and run.** The Gloamfin outruns you in a straight
  chase, so you cannot simply sprint away down a corridor. You beat it by **using
  the escape window**: when it reaches where it last heard you and begins casting
  about, put distance and corners between you before its delayed "lost you" ping
  fires, so the ping comes up empty and it gives up. Keep **your own** sonar for
  when you truly need it — pinging near the Gloamfin hands it a fresh fix and feeds
  the chase. Ink is useless against it.

## The Flarefish — hunts in its flare's light (orange)

The Flarefish is a silent hunter: it gives off **no tell of its own except the
flare** it casts. Once it has you it hunts just like the Lanternjaw — but it has to
*find* you first, in a single flash.

- **No tell but the flare.** Unlike the Lanternjaw (its always-visible bulb) and the
  Gloamfin (its periodic ping), the Flarefish makes **nothing that betrays its
  position on its own** — its only signal is its **flare** (below), which is **rarer
  than the Gloamfin's ping**, so it warns you less often. It is **not literally
  unseeable**, though: like every other predator its body is **revealed wherever your
  light falls on it or a sonar pulse catches it** (`specs/sensing.md`). It simply
  does not advertise itself between flares.
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
  - **The flare reveals that area to you.** Every tile within the flare's radius —
    **floor and wall alike, straight through walls** — is revealed to you (for as
    long as `specs/sensing.md` keeps it revealed), and any predator or the drifter
    inside it is shown live during the bloom. A Flarefish flaring nearby is free
    reconnaissance — it is the one enemy effect that lights the maze *for* you (the
    Gloamfin's ping, by contrast, reveals nothing; see `specs/sensing.md`).
- **Sense — caught in the flash.** If the **forager is within the flare's `192 px`
  radius at the bloom** (walls do not save you — but **ink does**, see the counter),
  the Flarefish **acquires a fix on your tile**, the **detection alert** fires, and
  it **immediately begins to chase**, turning toward you at once. If you are **not**
  in the light at the bloom, it learns nothing and keeps wandering. Between flares
  it has no idea where you are.
- **Chase — exactly like the Lanternjaw.** Once it has a fix the Flarefish **stops
  flaring** and pursues you **just as the Lanternjaw does**: it senses you within a
  light-range that grows with your brightness (`R = 128 + 192 * G`) in line of
  sight, keeps its fix on your current tile while it can see you, and **lingers
  `2 s`** on your last tile when it loses you. It is drawn wherever your light, a
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
  bloom so it cannot acquire you — the flare ignores walls, so a wall alone will not
  hide you; you must be outside the `192 px` circle — **or drop ink**, which blinds
  it and breaks the acquisition even inside the flare. Once it is chasing, lose it
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
