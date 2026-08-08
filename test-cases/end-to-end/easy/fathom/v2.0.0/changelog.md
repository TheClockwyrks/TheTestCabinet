## Losing a fix is allowed to take the linger the spec grants it

Four items read a predator's state a fifth of a second after the thing that should have
broken its fix and required `wander` on the spot. That is only one of the two ways the
specs describe losing a fix, and both are theirs: `specs/gameplay.md` says a predator
blinded by ink "immediately loses any fix... Blinded, it falls back to wandering", while
`specs/predators/flarefish.md` says that if it loses you — by line of sight, by your going
dim, or by ink — "and its linger runs out, it returns to wandering", the linger being the
`2 s` it spends at your last-known tile after pathing there, exactly as
`specs/predators/lanternjaw.md` and `specs/predators.md` describe for every predator.

A run took the second reading and lost `flarefish/ink-breaks`,
`flarefish/chase-like-lanternjaw`, `lanternjaw/ink-shakes` and `lanternjaw/dim-shakes` for
it, on a build whose ink and dimming worked. The clips said so plainly and said it
backwards: the reference's hunter, already wandering, drifted on through the cloud as
though nothing had happened, while the build's walked to the stale fix and turned back.
`lanternjaw/dim-shakes` waited out a flat `2.1 s`, which covers the linger but not the nine
tiles of walking before it.

`lanternjaw/dim-shakes` needed more than that. Its slip tile was chosen by clearance
alone — the open tile furthest from the run the Lanternjaw would walk — which in a one-wide
maze is almost always around a corner, so LINE OF SIGHT broke the fix and the detection
range played no part at all. A mutant of the reference whose range never shrank traced
identically to the reference, tile for tile and state for state, and passed the item. The
hunter, its fix and the slip now sit on ONE straight corridor (`findDimStandoff`), with the
slip `192 px` from the stale fix — beyond the dim `R = 128` — and `256 px` from where the
hunter starts, inside the bright `R = 320`. Only the size of the range decides whether it
can sense the forager there, and the range-pinned mutant now fails. The scenario also asks
LESS of the maze than it used to: a `9`-tile straight run against the `10` its old sight
line needed.

The four now wait for the give-up over a window that covers either reading — the linger,
plus the ground the hunter has to cover to reach the stale fix — and ask only that it does
give up, which is the question both specs agree on.

Two of them needed their scenario repaired to ask it at all. A hunter that walks to the
tile it last saw the forager on walks into a forager that stayed there, so
`flarefish/chase-like-lanternjaw`, which parked the forager on the sight line for the whole
measurement, was grading how long it survived; it now uses the ink standoff's three-tile
retreat like the two ink items. And the retreat has to be bounded and pinned: the forager
outruns the hunter, so one left swimming leaves the `R = 128 + 192 G` a build that IGNORED
the ink would have to lose it by — a mutant with the blinding removed passed a first cut of
this exactly that way, and a second one passed by catching the forager, since a lost life
re-dens every predator and releases it again, wandering. The wait now ends on a caught
forager too, and reports it as the failure it is.

## A new item for the other half of the clock contract

`specs/instrumentation.md` fixes the `autoStep` flag in both directions — the game runs
itself for a player, and holds still once `reset()` has handed the clock to a driver, with
the control operations leaving it that way — but only the first half was graded, by
`controls/advances-in-real-time`. A build that re-armed `autoStep` in a later call
(`beginPlay()`) therefore kept running in real time through every check's `arrange`, and
the items that went red were whichever ones happened to be posed on something that moved:
the two down-key items, because the forager had swum off the tile with the opening in it,
and the eat cue, because the pellet under the forager had already been eaten. Each named a
mechanic the build had implemented correctly, and which of them failed depended on how fast
the host answering the driver's calls was.

`controls/manual-clock` grades that contract directly, so the violation is reported where
it happens rather than as a scatter of misattributed symptoms. It measures in `arrange`,
before the runtime sets the flag itself, and pairs the reading with a step of its own so a
build that never advances at all cannot pass on the strength of holding still.

This inserts one item into the Controls category; every item after it shifts by one.

## Movement, sonar-cue and fog checks that grade their own subject

Running the checklist against two real builds turned up four items whose verdicts were
about something other than the item's name.

The eight movement-key items posed the forager on any tile with an opening in the tested
direction and said nothing about the other three sides, so the pose only held while the
forager stayed put. It does not always: `specs/movement.md` lets a build keep swimming
with no key held, and a build that has not stopped its own clock (`specs/instrumentation.md`
— `reset()` re-arms manual stepping, and the control operations do not change `autoStep`)
keeps running in real time for the rest of `arrange`. Either way the forager drifts off
down the corridor, and a one-wide maze offers a turn only at junctions, so the held key
then has nowhere to go. One run failed `controls/move-down` and `controls/wasd-down` on a
build whose down key works. The forager is now stood against rock on a tile with an
opening in the tested direction — stopped under either reading, however long posing takes
— and it never starts facing the direction under test, so the heading assertion stays a real
question.

`audio/eat` had the same shape and the same failure: it stood the forager on a fresh
corridor tile and stepped six ticks for the eat underneath it, which a build that travels
during `arrange` had already eaten (with the cue that went with it) before the measurement
began. The item now holds a direction key and sweeps for the eat the forager swims into,
so what happened to the pellet it was standing on no longer decides the verdict.

`maze-movement/wrap-tunnel` failed "nothing stops at the edge" if any tick between the
start of the approach and the far side covered less than half a step. The approach is
ordinary corridor, so that made the item a general movement check wearing the tunnel's
name: a build that hitched for a single tick at each tile centre, everywhere in the maze,
went red over two ticks in the approach while its wrap was textbook. The seam is now
compared with the same build's ordinary swimming a moment earlier, on both halves of the
spec's sentence: the stall it introduces, and the pace it holds across it.

`fog/light-reveals-walls` passed if a single wall tile anywhere had been revealed. A build
that lights only the two rock faces it is directly sandwiched between cleared that with
room to spare. The item now stands the forager at the mouth of a short corridor that ends
in rock and asks for that rock specifically — an axial sight line no tracer can disagree
about, unlike the grazing angles alongside a corridor — plus the other half of the same
spec sentence, that the light stops there and the tile behind stays black.

## Every build must expose a `window.__fathom` debug API and overlay

A new common spec, `specs/instrumentation.md`, requires a `window.__fathom`
debugging and automation surface — core operations, control operations that pose a
scenario through the game's real systems, injected keyboard input, and a read-only
overlay — backed by a render-free, seedable core with an `autoStep` flag so a
driver's clock can be the sole source of time. A new mandatory deliverable, hence
the major bump.

## The checklist is validated automatically

Every mechanical checklist item now carries a validation script that drives the
deterministic simulation through the debug handle and decides its verdict, capturing
side-by-side media; feel, art, audio, and layout stay human review, and any
auto-verdict is overridable. The checklist moves to the categories grammar
(`[review] format = 2`) and expands well past the v1 list.

## Specs reorganized and made self-contained

The specs are now fully authoritative: historical and "earlier build" framing is
gone, opinionated targets and rationale asides are removed, and no spec leans on the
reference screenshots for any required detail. The specification is reorganized by
concern — `specs/playfield.md` becomes `specs/maze.md`, a new `specs/gameplay.md`
gathers the plankton, drifters, ink defense, and sensing model (folding in the old
`specs/sensing.md`), a new `specs/ui.md` gathers the menus, states, and HUD, the
predators split into a common `specs/predators.md` plus one file per kind, and
`specs/flow.md` becomes `specs/progression.md`.

## Deeper mazes add predators instead of speeding them up

Each depth past the first adds one hunter, cycling Gloamfin, Lanternjaw, Flarefish,
capped at two of each (six total) by `DEPTH 4`; predator speeds no longer scale with
depth. The sonar range still shrinks one tile per depth.

## Other changes

- Terminology: the map is called the **maze** throughout (rather than "the trench"),
  and the base dive is now **Standard** (HUD label `STANDARD`).
- Edge-case call-outs are removed; where an edge case needs particular behavior the
  rule is stated plainly, otherwise handling it is the build's job.
- The prompt no longer prescribes a verification routine — it states that Playwright
  and Chromium are installed and leaves validation to the build.
- `setPredator(kind, { mode: "den" })` now **holds** the predator in the den: the
  staggered release schedule is suspended for a predator posed that way until a later
  `setPredator` poses it out. Previously the mode said only "returned to the den",
  which left a build free to release it on the very next step — so the op could not
  actually establish the precondition it exists for.
- The den release schedule is stated to be timed from **live play**: release time `0`
  is when the dive countdown ends, the countdown does not count against the schedule,
  and no predator leaves the den while it runs. Previously only the order and the `5 s`
  spacing were fixed, which left two readings of where the clock starts — one of them
  spending the reorientation moment the respawn schedule exists to give you.
- The debug API gains `setCreatureAI(enabled)`: with it off, every predator and drifter
  holds the tile, facing, and state it was posed with — it senses nothing, decides
  nothing, and does not move — while the forager, the light, cooldowns, waves, ink,
  eating, scoring, and contact all run normally. `reset` restores it. Without it, a
  scenario that poses a creature and then swims at it is betting on where that creature's
  own wander happens to take it through a maze the build invented.
- The mute key is stated in the controls: `M` toggles the game's sound. Audio already
  required a mute toggle and the debug API already listed `KeyM` among the keys it can
  inject, but no spec said which key muted, so the binding was only ever implied.
- The wrap tunnel's two mouths are stated to be **adjacent tiles**, with the handover
  at the border: crossing covers one tile, position is carried across rather than
  snapped to the far mouth's center, and a character is never carried out past the
  maze frame. The neighbor rule already counted the far mouth as a neighbor; the
  movement consequence is now spelled out where the tunnel is defined.
