## What `startGame()` promises, said the same way in both specs

`specs/instrumentation.md` said `startGame()` "enters the in-game state and spawns the
first wave"; `specs/gameplay.md` put the `WAVE N` banner before the spawn and kept the
field clear for the whole of it. Read together they described a field that is both
populated and empty at the same instant, and builds split on which sentence to believe —
the reference implementations spawn wave 1 at once, while model builds opened on a
banner. Both openings are legitimate and both specs now say so: the call guarantees a
game that has STARTED, not one with rocks on the field, and `snapshot().waveBanner` says
which opening a build chose. What stays fixed is the order *within* a banner, which is
`waves/banner`'s subject.

`newGame` settles that opening banner before posing anything, which is what the whole
validation set was quietly assuming it did not have to. A build that opened play on a
banner handed every scripted item a scenario posed into a beat with no rocks in it — one
run failed twelve items on it, reporting the same setup fault under the names of gravity,
splitting, recycling, scoring, wrapping and audio, none of which were broken. The settle
is `skipUntil`, instant in both passes, so a build that spawns with `startGame` waits no
time and no clip or verdict changes shape.

`saucer/avoids-star` and `gravity/saucer-free` now park a bystander rock, as the rock and
scoring items already did. `newGame` leaves the field empty and neither item puts a rock
on it, so the first step of each cleared a wave and raised a banner of its own — the
saucer then sat still for the whole sweep and both items reported a steering or gravity
fault that had not happened. `saucer-free` identifies its control rock by the index
`addRock` returns rather than as `rocks[0]`, which the bystander now occupies.

## The banner is a breather from rocks, not a pause

`specs/gameplay.md` said the field stays clear for the banner and the ship keeps flying
through it, which a build can read as permission to stop simulating for a second and a
half. Nothing catches that, because a banner has no rocks on it by definition — except
that the saucer's cadence is its own and owes nothing to wave boundaries, so it is
routinely still hunting when the last rock dies. One build froze it: for the whole banner
the saucer hung motionless and could not be shot down, its bullets passed through the
ship, and then it snapped back into motion. That is an ordinary end of wave, not an
artefact of being driven.

The spec now separates the two ideas — the field is clear of ROCKS, and everything else
carries on — and says outright that a saucer already on the field keeps hunting, keeps
firing, and can still be shot down. A new item, `waves/plays-through-banner`, grades it:
it clears a wave with a saucer up, then inside the banner confirms the ship still flies,
the saucer still travels, and a round put in front of it still connects.

## Validation: three items graded something other than their subject

- `controls/advances-in-real-time` required rocks on the field the instant play began,
  which is the reading of `startGame` the specs have now settled the other way — it
  reported a build that boots correctly as having no scenario to grade. It waits for the
  wave, and takes its second witness from the furthest of a posed coasting ship and the
  drifting rocks, so a build that opens on a banner and one that ignores `setShip`'s
  velocity each still leave one witness standing. The ship is deliberately not made
  invulnerable: builds blink an invulnerable ship, which erased it from the stills.
- `audio/thrust` asked only whether Web Audio sources were started across the hold, which
  marks a silent build correctly and a sustained one wrongly — the idiomatic way to hold
  a sound is one voice started once and left running with its gain ramped, and that
  starts nothing during the thrust at all. It now accepts either sources started over the
  thrust in excess of an identical idle window, or silence in both windows with a voice
  brought up by the arming gesture. Reading the arming step specifically, rather than
  every source since page load, keeps a start-of-game cue from satisfying it.
- `wrap/saucer` bounded the run-up from above only, so a build whose saucer ran off the
  field satisfied "it was near that edge before wrapping" at 400 px PAST it — an `ok`
  line inside the same verdict that was failing for never having wrapped. Both edge
  readings are now gaps measured from inside the field, which is where
  `specs/playfield.md` keeps every coordinate. No verdict moves; the failure just names
  itself.

## The fire interval is a whole number of ticks

`specs/ship.md` asked for shots "at least 0.18 seconds apart", which is 21.6 ticks at the
120 Hz `specs/simulation.md` fixes — a threshold no build can land on, and the only
duration in the case that was not a whole tick count. The same bullet then bounded the
rate at "roughly 5 to 6 shots per second", which admits any interval from 0.167 to 0.2 s,
so the spec named a precise figure and immediately widened it into a band that did not
contain it. The gate is now stated once, as 22 ticks (22/120 of a second, about 0.183 s,
so about 5.5 shots per second), and `specs/instrumentation.md` calls the held-fire cadence
by the same number.

`bullets/max-four` was failing correct builds on the back of that band. It spaced its five
taps 24 ticks apart — exactly 0.2 s, the slow end of what the old wording allowed — so a
build that chose that end rejected every second tap, fired three shots instead of five,
peaked at three, and was reported as having too tight a cap. A build accumulating its
cooldown in floating point failed even at exactly 0.2 s, because 24 steps of 1/120 sum to
0.19999999999999998. The taps are now 30 ticks apart, eight clear of the 22-tick gate.

`bullets/fire-rate` needed no change to its probes — it rejects at 7 ticks and accepts at
38, either side of the gate with room to spare — but its rationale cited the band that no
longer exists. The reference implementations count the cooldown down in whole ticks rather
than subtracting `dt` each step, so they land on the boundary exactly.

The bullet motion trail was the other duration off the tick grid: `specs/ship.md` put its
span "on the order of 0.12 to 0.18 s", and neither end is a whole tick (14.4 and 21.6). A
band of unreachable figures leaves a build free to pick a length nothing can be checked
against, so the trail now spans a stated 18 ticks (0.15 s) and the reference
implementations cap the history at that many samples rather than dividing a duration by
`dt`. Every duration the case states is now a whole number of ticks.

## Validation: four items now fail for their own reasons

Each of these was reporting a fault that belonged to a different item, so a single build
defect took down a check about something else and the real fault went unnamed.

- `bullets/max-four` flew its volley up-left from (200, 200), which sent it diagonally
  into the top-left corner about half a second in — inside the volley. A build that
  dropped bullets on that corner reported a peak of two, and the item called it a cap
  fault. The volley now runs a clear lane low on the left, 260 px below the star's row
  and only halfway across the field when it ends, so nothing can take a bullet off the
  field and a count below four can only mean the cap.
- `wrap/bullet` drives a second crossing, leftward, along the star's own ROW. A wrap
  moves a body the width of the field in one step, so a build's swept-path test for the
  star core reads a line straight across the middle unless it is written to understand
  the seam — and on the row that line runs through the core, so the bullet is deleted as
  absorbed on the tick it wraps. Every wrap this item used to drive was 200 px clear of
  the row, where the same false line misses. The row is used rather than a corner
  because a corner only produces the field's diagonal if both axes cross on the same
  tick, and gravity pulls a diagonal shot unequally in x and y.
- `gravity/saucer-free` measures the saucer's own cruise instead of imposing one: it
  asks for a heading, steps a tick to let the build's steering answer, reads back what
  the saucer actually flies, and asserts that is UNCHANGED after crossing the star's
  row. It used to pose `vx` and assert that exact number came back, which failed a build
  flying a dead-straight line at a constant speed — the very thing the item exists to
  confirm — because it had overwritten the posed value.
- `wrap/saucer` keeps the `setSaucer` question, which is genuinely its own: it asks the
  saucer to fly the opposite way from the one it entered on, and a heading given to
  `setSaucer` has to survive the next step. That reading also picks the seam this item
  watches, so the saucer is stood off whichever edge its ACTUAL velocity carries it
  toward and the crossing is short and certain on every build. Previously a build that
  discarded the heading spent the whole budget sailing away from the edge the sweep was
  waiting at, reported as "the saucer never wrapped".

`actWrapAcross` gained a `dir` for a caller that cannot choose its body's heading, and
now reports `lost` for a body that stopped existing at the seam — a build deleting
something it should have moved, which is worth saying plainly and is not the same as a
body that simply never got there.

## The banner runs on a clear field, and `waves/banner` now says so

`specs/gameplay.md` already put the two in order — "show a brief `WAVE N` banner
(about 1.5 s ...) ... then spawn the next wave" — but every model build read it as a
description of the transition rather than a timing constraint and spawned all five
Large rocks under the banner. The spec now says the order matters and why: the banner
is a breather, the field stays clear for the whole of it, the ship keeps flying so the
player gets that beat to reposition, and a banner captioning five rocks already
bearing down is not what is being asked for.

`waves/banner` grades it, reading the field at the instant the banner is raised (it
must still be empty) and waiting for the spawn separately. The latitude that item
already gives the wave NUMBER — a build may turn it over with the banner or with the
spawn, because the spec never says which — is deliberately not extended to the spawn,
which the spec does fix.

## Validation: three items no longer race the next wave onto the field

`rocks/split-small`, `scoring/monotonic` and `audio/shatter` each isolated their
subject by emptying the field and posing one rock on it — which arranges for the game
to refill the field at the exact moment they read their result, because destroying the
last rock clears the wave and the next one spawns five Large rocks. `split-small` and
`audio/shatter` measured "the rock is destroyed" as an empty field and read five;
`monotonic` had wave rocks drift across the lanes its later shots flew down and scored
490 and 590 where it expected 200 and 300, which its three "the score rises"
assertions could not see and only its total caught.

The specs do fix the order — banner for about 1.5 s, then spawn — so a build that
spawns during the banner is wrong, and `waves/banner` is where that belongs. But an
item that relies on the grace period is timing a race it does not own, and two builds
with the same fault landed on opposite sides of it. All three items now keep a
BYSTANDER rock parked out of the way and never shoot it, so the field is never empty,
no wave can clear, and there is nothing to arrive mid-measurement on any build. Each
asserts the bystander is still there at the end, which is what says the measurement
ran on the field it posed.

`monotonic` also poses its three rocks up front on separate lanes and shoots each with
`actFireOneShotAt`, aiming at a known position rather than at whichever rock is
nearest — with three on the field, a shot has to say which one it means.
`split-small` and `audio/shatter` fire exactly one bullet each, because a helper that
keeps shooting while a rock of the target's size remains would, on a build where a
Small wrongly splits, shoot the fragments down too and leave the same clean field a
correct build leaves.

## Firing is an action of the key press, not of the held key

`specs/instrumentation.md` said in one breath that `press(code)` is "the usual way
to trigger a one-shot action ... firing a single shot", and in the next listed the
one-shot actions a `keyDown` applies immediately as only the menu, confirm, pause and
mute ones. A build that read the second list as exhaustive decided whether to fire by
asking "is the fire key down?" at the top of each fixed step — which is unanswerable
for a `press`, because a press holds the key for no time at all. Such a build shoots
perfectly well for a player, who holds the key across several steps, and answers
every scripted tap with silence.

The `keyDown` bullet now lists a single shot (and, in Warhead, a torpedo launch)
among the actions applied on the press itself, and the section says outright that the
shot belongs to the press: take it on the way down, either immediately or latched for
the next step, but never conditional on the key still being held when that step
arrives. Holding the key still auto-fires at the 0.18-second rate `specs/ship.md`
sets; that is the held path, on top of the press's own shot rather than instead of
it.

## `lives` counts the ship in play; the HUD row does not

The case fixed neither convention, so a build could report 2 (the reserve behind the
ship being flown) or 3 (every ship left) out of a fresh game and satisfy every
sentence written about it — `specs/gameplay.md` counted "3 ships",
`specs/instrumentation.md` called the snapshot field "ships in reserve", and
`specs/ui.md` drew "one [glyph] per life still in reserve". Two builds could disagree
by a whole ship and both pass.

The snapshot's `lives` and `setLives(n)` are now the total still left **including the
ship in play**, so a new game reports `3`, and the HUD keeps drawing one glyph per
ship in *reserve*, which is `lives - 1` and shows two at that same moment. The two
counts differing by one is the intent, and all three specs now say so.

## The saucer's audio cue is about its arrival

`specs/ui.md` asked for a short sound for "the saucer's presence", which left it
unclear whether a cue on arrival was enough or a hum had to be held for as long as
the saucer was on the field. The audio requirements are now written out one event at
a time: a distinct cue when a saucer enters is what is required, a sustained hum is
welcome but optional, and thrust — the one that genuinely is continuous — is called
out as a held sound that a single blip does not satisfy.

## Validation: clips that show their event, and audio read after a frame

No assertion changed and the reference stays green; these are repairs to what the
checks film and when they look.

- The audio items read the Web Audio probe only after a real frame has been painted.
  The simulation is required to be render-free, so a build that records "a rock
  shattered" during the step and hands it to its audio layer on the next animation
  frame is doing exactly what the case asks — but the validate pass advances the
  clock instantly and never produces that frame, so the probe was read while the cue
  was still queued and four of the five audio items failed a build whose audio was
  entirely correct. The baseline count is taken at the end of `arrange`, while the
  build is still on the manual clock, so the pause cannot let a scenario posed on a
  hair trigger resolve before the sweep that films it has started.
- `flight/thrust-accelerates` still decides its verdict on the quarter-second window
  where the 480 px/s² is sharp, then keeps thrusting to a full 1.5 seconds so the
  clip shows a ship winding up to ~608 px/s rather than twitching and stopping.
- `gravity/bullet-curves` runs a second instead of 0.35 s, which used to end the
  flight at the star's own x — the moment the bend begins. `gravity/rock-curves` now
  poses its rock to round the well rather than fall into it (the old pass reached the
  core three quarters of a second in, so the clip could not simply be lengthened
  without turning a curve item into a recycle one) and runs 1.5 s, long enough for
  the whole bend.
- `bullets/inherits-motion` reports a tap that fires nothing as the failed assertion
  it is, instead of throwing a bare `Cannot read properties of undefined` that the
  driver recorded as the check never having run.

## The `window.__shatter` debug API and overlay are required

A new common spec, `specs/instrumentation.md`, requires the build to expose a
`window.__shatter` debugging and automation API plus a read-only overlay toggled
with the backtick key, backed by a render-free core with seedable randomness and an
`autoStep` flag: `reset()`/`step()` switch to manual stepping while
`setAutoStep(true)` hands the clock back for real-time play, so a scenario replays
identically. A new mandatory deliverable, hence the major bump.

## Specs reorganized around Shatter's own concerns

`specs/playfield.md`, `specs/ship.md`, `specs/hazards.md`, `specs/simulation.md`,
`specs/gameplay.md`, and `specs/ui.md` replace the previous playfield/physics/flow
split, so each variant's seeded set reads as one self-contained game. The per-variant
mode spec is gone: the standard-vs-Warhead differences are now branched by variant
slug inside `specs/gameplay.md.hbs` and `specs/ui.md.hbs`. The prose was tightened
throughout.

## Reviewer checklist reorganized into categories with automated validation

The checklist moves to the categories grammar (`[review] format = 2`), with every
graded point a one-point leaf item. Each mechanically verifiable point is decided by
a validation script that drives `window.__shatter` — establishing the precondition,
stepping the real simulation, and reading the outcome back from the snapshot or the
rendered pixels. Feel, art, and audio remain reviewed by a person.

## Other changes

- The prompt drops its prescribed verify-before-you-finish checklist; it now explains
  what Playwright and Chromium are there for and leaves how far to validate to the
  model.
- `specs/proof.md` notes that the debug API can set up the exact state each capture
  needs.
- Warhead: losing a ship now refills the torpedo — a respawned ship comes back with
  its torpedo charged, cancelling any recharge in progress (previously the recharge
  kept counting through a death and respawn). The base game is unchanged.
