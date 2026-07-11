Fathom v1.1.0 reworks the case around its signature **sensing** system and
retunes the predators and their tells after playtesting v1.0. The two biggest
threads are a variant rework — the three mode variants are gone, replaced by two
dives that differ only in how you read the dark — and a predator pass that renames
the hunters, makes them path fairly, and rebalances the sound-hunter so it can
actually be escaped.

## Two dives replace the three modes

The Murk, Reserve, and Beam mode variants (and the always-present
`specs/modes/standard.md`) are dropped. The case now offers two dives that share
everything but how you read the dark, so the difference between them *is* the
sensing model rather than a bolt-on mechanic:

- **Base (Trench)** — a StarCraft-style remembered fog of war, line-of-sight
  passive light, and a corridor-flooding sonar pulse. What you explore stays drawn;
  only never-revealed ground is black.
- **Kindle** (new) — the same fog of war as base, plus an outer **vision circle**
  you carry: an actual circle (cut at the pixel), centered on the forager and
  growing as you eat, beyond which the trench is pitch black even where explored.
  The circle reveals nothing — it only limits what of the already-revealed map is
  shown — so eaten plankton stay eaten and hidden ground returns when you revisit
  it. It is *not* vision for predators (that stays the line-of-sight light circle).

Because the sensing model is now the thing that varies, `specs/sensing.md` is no
longer a common spec. It is split into `specs/sensing-trench.md` and
`specs/sensing-kindle.md`, and each variant seeds its own at the common
`specs/sensing.md` path every other spec references — so the model always sees a
single, self-contained sensing spec with no mention of any other model. The common
specs no longer mention "modes" or any variant, and the shared single-dive menu
(`DIVE`, then `HOW TO PLAY`) makes the `title` reference common to both variants.

## References are captured from the playable builds

The reference visuals are now **captured from the playable reference-impl builds**
(with Playwright) rather than from hand-authored HTML mockups. The `.html` mockups
and the shared `theme.css` are gone; the committed screenshots the manifest seeds
as `media` are stills of the real game. Each variant also declares a
`reference_implementation` build (`reference-impl/base`, `reference-impl/kindle`)
— the authored, correct static build shown on the case's "Reference" tab and never
seeded into a run. Two new reference views come with the change: a common `sonar`
view (the travelling wavefront mid-flight) and a Kindle-only `vision-circle` view
(the outer window at full glow). See `reference/README.md`.

## References are examples now, not targets to match

The references' role changed with their source. They are now framed as
**illustrative examples, not layouts to reproduce**: the prompt, `specs/overview.md`,
and `specs/proof.md` all tell the model to design its own menus and layout from the
specification and use the images only to gauge how the provided assets sit in the
scene. The only firm requirement is that every mandated menu and navigation path is
present in the specified palette and type. Accordingly, the reference-similarity
**title check is removed** — menus and screens are the model's own design and are
reviewed by a human rather than scored against a baseline (the automated load check
still runs).

## Predators renamed, and made to path fairly

The two sound/light hunters are named outright — the **Lanternjaw** (light) and the
**Gloamfin** (sound) — replacing the descriptive "Lure"/"Listener". Beyond the
rename, the shared movement rules were tightened for fairness: a predator that has
lost sight of you now holds its fix on your **last-known tile and paths there** —
following the **shortest corridor path** around the wall you slipped behind — rather
than only ever stepping in the direction that shortens the straight-line distance,
which used to **wedge it in an L-corner** where it could get no closer. Predators
may also **reverse at any time** (not only at a tile center) and are explicitly
allowed to **turn back toward you the instant they detect you**, so a hunter never
wastes a beat facing the wrong way at the moment it finds you.

## A detection alert when you are spotted

A **detection alert** now fires the instant a predator takes a fix: a sharp flash
burst in the acquiring predator's color, centered on it, that fades over about
`0.5 s` while the predator itself is shown **lit** for that window. An earlier build
left players unsure whether they had actually been detected; the two hunters that can
blindside you — the Gloamfin (eyeless, hunts sound) and the Flarefish (shows nothing
between flares) — now announce the moment they find you, so being spotted always
reads at a glance.

The alert is required on **every Gloamfin acquisition path**, not just its own ping:
whether the Gloamfin is caught by **one of its own pings**, by **your** sonar pulse
flooding over it, or by its **close-range hearing** (within ~2 tiles), the same
detection alert fires and it turns to chase. Earlier the cue was easy to read as
firing only when the Gloamfin's own violet ping landed; a fix handed to it by your
sonar or by hearing you up close is just as much a blindside and now announces
itself the same way.

## The Lanternjaw and the drifters — bait you cannot tell from jaws

The **bonus drifters** and the **Lanternjaw's bulb-light** are drawn to look almost
identical, so the drifters read as bait, and a wandering Lanternjaw now **copies the
drifter's AI exactly** — its `64 px/s` speed (half the forager's, *not* the ordinary
predator speed) and its wander routing — so until it detects you its bulb is
indistinguishable from a real drifter in both look *and* motion. On a fix it drops
the disguise and hunts at its `116 px/s` chase speed.

This is now backed by the art. The Lanternjaw has **two forms** — its true
anglerfish/jaws body while hunting, and a **jellyfish disguise** while wandering —
and a new `assets/drifter/` sprite sheet is added for the harmless jelly. The
Lanternjaw's frames `8`–`15` are the jellyfish disguise and must be
**pixel-identical to the drifter sheet's frames `0`–`7`** (the old lure-bob and idle
frames are gone). The always-visible amber **bulb** is no longer part of either
sprite; it is a **runtime amber glow** (`#ffd166`) drawn at the creature's center,
identical for the drifter and the Lanternjaw, shown even across unlit fog while the
bodies stay fog-gated.

**Drifters are now permanent and there can be two.** A drifter no longer times out or
fades — it wanders until you eat it — and the trench tops up to **two** at once,
making the amber motes genuinely hard to tell from the Lanternjaw's bulb.
**Kindle clips the amber lights to your vision circle:** there the drifters and the
Lanternjaw's bulb show **only inside your vision circle**, so a distant amber glimmer
is hidden until it drifts into your window (in Trench they still show at any
distance). The enemy effects — the flare and the Gloamfin's ping ring — still show
beyond it.

## The Gloamfin, retuned to be escapable

The Gloamfin no longer winds up ever faster over time. It wanders at ordinary speed
(`116 px/s`), and its whole chase was rebalanced because the old sprint-happy version
was inescapable once it drew close and unfair when it fixed on you at point-blank
range off its short-range hearing:

- **Chase is only a touch faster than you.** When a ping (yours or its own) catches
  you it drives toward that tile at a cap of `134 px/s` — about **5%** faster than
  the forager's `128` — so it *slowly* gains along the line the ping drew rather than
  blowing past you. It heads for the tile the ping actually found you on, not wherever
  you have since slipped away to.
- **Cornering costs it speed — this is your way out.** `134 px/s` is only a cap,
  reached on straight runs. The instant it turns a corner to keep following you it
  drops to about `115 px/s` — roughly **10%** *slower* than you — then ramps back to
  the cap over about `2 s`. A straight sprint alone will not shake it, but a player
  who **keeps cutting corners** gains a little at each turn and can gradually open the
  gap and escape. (This replaces the old juke, where the Listener overshot junctions
  above a speed threshold.)
- **A delayed, guaranteed "lost you" ping gives you a window.** When it reaches the
  fixed tile and you are gone, it slows to `116 px/s`, casts about, and only after a
  delay of about `1.2 s` fires a guaranteed ping — your chance to break away before it
  lands. This "lost you" ping is now drawn a **distinct orange** wavefront (rather than
  the Gloamfin's ordinary violet), so you can *see* the escape window open: an orange
  crest sweeping out means it reached where it last heard you, found you gone, and is
  casting one last ping to re-find you. (Earlier it was identical to the routine violet
  ping, so the window was invisible.)
- **Pings are floored and it goes silent when it already has you.** Its own pings are
  now floored at about `3 s` apart, so re-finding you up close can no longer make it
  rapid-fire; and while you are inside its ~2-tile hearing range it holds a continuous
  lock and does **not ping at all**, pinging again only once you slip back out. An
  earlier build fired pings near-continuously the moment it closed within a couple of
  tiles down a straight corridor.
- **Its ping neither draws itself nor reveals the maze.** Its ordinary ping cadence is
  now about `4 s`, and the effect is the travelling wavefront (see below) tinted to its
  violet `#c46bff`. You see the ring — the warning — but the ping **no longer draws the
  Gloamfin itself** (so a ping is not a free fix on where it is) and reveals nothing
  else: unlike your sonar it does not light the maze or mark anything. The Gloamfin is
  still revealed by your light, your sonar, or the detection alert when a ping catches
  you.

## The Flarefish, a silent hunter with a wall-piercing flare

The Flarefish now gives off **no tell of its own but its flare** — no bulb, no ping.
Your light and sonar reveal it like any other predator; it simply does not advertise
itself between flares, and its flare is rarer than the Gloamfin's ping so it warns you
less often. Crucially it **hunts your light exactly like the Lanternjaw** — the same
`R = 128 + 192 * G` line-of-sight range — fixing on you whenever it drifts up within
range of your glow, so it no longer sits idle if it comes across you between flares.
Once it has you (either way) it chases exactly like the Lanternjaw, stops flaring, and
re-arms its flare on a fresh `7 s` timer only after it loses you.

Its **flare** is a second, far longer-range, wall-ignoring lock on top of that, now a
**persistent, moving light for the whole bloom**. It fills the full `192 px`
(6-tile) radius **through walls**, catches you at *any* moment you are in the disc
(not just the first instant), and stays attached to the Flarefish so its own drift can
sweep the light over you. Visually the whole disc is drawn at **full light**, fading
back to normal near the end — and in **Kindle** the flare acts as a **second vision
circle** that reveals the trench inside it in full, then vanishes when the flare dies,
leaving only the window you carry. (Ink still breaks the acquisition even inside the
flare.)

## The sonar pulse is now drawn in code

The provided `assets/sonar-pulse/` sprite sheet is removed. The sonar pulse is no
longer an expanding circle: it is a **travelling wavefront** that flows outward
through the corridors — bending around bends, reflecting off walls, revealing near
tiles before far ones — so it must be **rendered procedurally**, drawn as a glowing
crest of arcs that bulge the way the sound is moving, brightest at the leading edge.
It is used both for the forager's ping (tinted `#5ef2ff`) and, tinted violet, as the
Gloamfin's tell — except the Gloamfin's guaranteed "lost you" ping, tinted **orange**
to set it apart (see above). A ping now catches a target **when its front reaches
that tile**, not the instant it is cast.

## Maze self-checks — openness and corridor length

`specs/playfield.md` adds two computable aggregate targets to keep an authored board
reading like the corridors of `reference/gameplay.png` rather than a grid of rooms.
**Openness** (mean open neighbors per corridor tile) should sit at roughly `2.1`–`2.5`
and above ~`2.8` is too open; **corridor length ("mazing")**, the mean length of a
run of tiles with exactly two open neighbors, should be roughly `3`–`5`, with below
~`2` too grid-like. They are soft design targets, not hard validation, but a board far
outside them plays as a grid or a set of rooms rather than a tense maze.

## Audio is now required

Audio moves from recommended/optional to **required**: the build must synthesize the
cues (eating, sonar, ink, a predator's pulse or flare, getting caught, descending)
with the Web Audio API. The game must still remain fully playable muted and must never
fail to run or load if audio cannot start, and it still provides a mute toggle and
waits for a user interaction before starting.

## Scoring collapses to one domain

The two scoring domains, "Sensing & Fog" and "The Hunt", are merged into a single
`dive` domain that is the run's overall rating — reading the dark and evading the
predators are one inseparable experience. Every review item now rolls up to it
implicitly (none names a `domain`). The sensing review items (fog/memory,
line-of-sight light, brightness) move into each variant's own manifest because the
sensing model differs by dive; the sonar and predator items stay common, several now
carry `sub_items`, and new items cover the detection alert and the enemy-effects /
amber-look-alike behavior.

## Other changes

- Forager motion is clarified as **continuous** — it slides smoothly between corridor
  centers, which serve only as the points where it may change direction, rather than
  hopping tile-by-tile.
- The **sonar cooldown is halved**, from `3.5 s` to `1.75 s`. The pulse's real cost is
  being *heard*, not the wait, so you can ping a little more freely — just not near a
  Gloamfin.
- Brightness now **holds for a short delay** after your last pellet (resetting each
  time you eat) before decaying, rather than draining constantly; walls are revealed by
  your light, sonar, and the flare, but never the Gloamfin's ping.
- Losing a life no longer refills the trench: the plankton you have eaten **stay eaten**
  (how what you have sensed carries across a life is left to each dive's sensing spec).
- `specs/proof.md` and the manifest now speak of a "viewer" rather than a "reviewer";
  the sonar and hunt proof clips are reworded to the new wavefront and Gloamfin
  behavior.
