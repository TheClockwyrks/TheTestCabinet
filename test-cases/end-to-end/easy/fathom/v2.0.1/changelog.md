## A posed fixture says whether it is safe to grade

Fifty-odd checks pose a maze and then measure something standing on it, and every one of
them rests on one sentence of `specs/instrumentation.md`: the op returns "every predator to
the den and held there exactly as `setPredator(kind, "den")` holds it". A build that
rebuilds the board but leaves its hunters where its OWN den used to be drops them wherever
the fixture put those tiles, which is regularly the corridor the scenario is about. A run
went exactly that way — a Lanternjaw standing mid-corridor ate the forager a quarter of a
second in, and three items reported an input bug and a turning bug (`expected up, actual
left`, `left` being the facing a respawn gives it) against a build whose input and turning
were fine.

`poseMaze` now refuses to grade a scenario in that state, naming `setMaze` rather than
whatever the item was about. It refuses narrowly: only a predator standing on OPEN CORRIDOR
can swim into the scene, and one that lands in rock cannot move at all
(`specs/movement.md`), so a fixture with a hunter sealed in rock is still the fixture the
item meant to pose and is still graded.

A refusal is inconclusive rather than a finding, so `controls/setmaze-houses-predators` is
added to own the claim and fail it. It grades the whole contract — every predator in the
den, rock included — and then watches the den for twelve seconds, past the `10 s` the third
predator would be due at on an ordinary board. Its last assertion is the one that is not
vacuous: every fixture's den is sealed, so a hunter that tries to leave and is stopped by
rock looks exactly like one that was held, and only `released` tells them apart.

Both reference implementations were re-arming the ordinary staggered schedule after a
posed board, which that sentence forbids; `setMaze` now holds them, as `setPredator(kind,
"den")` already did.

## Three checks that were grading their own setup

**A derived radius is read a beat after the eat.** `brightness/widens-vision` read
`visionRadius` on the exact tick `planktonRemaining` dropped. `V = 96 + 64 G`
(`specs/gameplay.md`) is a relationship, not a moment: a build that recomputes the radius
at the top of the next step satisfies it just as much as one recomputing it inside the step
that raised `G`, and reports the old radius alongside the new `G` for exactly one tick. One
run failed on `96` against a build whose radius was the exact `117.76` a tick later.
`actGrazeOne` now returns a settled snapshot beside the eat-moment one, and only the item
reading a derived value uses it — the `+0.34` and the `+10` still come from the tick the
pellet went, and the beat is short enough that the forager cannot reach a second pellet.

**A hunter that never moved is not a mechanic that failed.** `requireSwim` already stands
aside for checks that reach their subject by swimming the forager. `requirePredatorMotion`
is its mirror, for checks whose subject is a hunter that has to travel — cross an ink cloud,
turn a corner, reach the tile a ping named, close the last three tiles. A build whose
predators never moved a pixel had that reported as ink failing to break a fix, cornering
failing to cost speed, a "lost you" ping never firing and contact never costing a life: four
mechanics named, none of them the one that was broken. It is deliberately not applied to the
checks that allow a hunter to give up on the spot, which conform without moving at all.

**`gloamfin/ink-noop` guards rather than scores its isolation.** Its two setup clauses — the
hunter is inside the cloud, and far enough away that hearing is not why it still knows where
to go — were assertions. A run had every substantive assertion pass (the fix held, 50 ticks
inside the cloud, 214 px covered through it) and failed the item anyway, because by the read
the Gloamfin had closed to `51.6 px` against its own `64 px` hearing. The verdict called that
a Gloamfin broken by ink, in the same breath as the evidence that it was not. Both are
preconditions now.

**And `audio/caught` cannot pass its own precondition vacuously.** It waited for
`screen !== "playing"`, which `until` reports on the first read if the dive has already left
live play — so a build that kept simulating between driver calls took the life during
`arrange`, before the audio log was armed, and the item recorded a catch it never saw beside
a cue count that never moved. It now asserts the dive is still in play when the catch is
staged.

Baseline media regenerated for the nine items whose scripts changed.

## The release schedule is read from the schedule, not from the swim out of the den

`den/stagger` and `den/re-release` timed the `5 s` staggered release from `state` leaving
`"den"`. That flag cannot carry the claim, because it does not mean what the schedule
means. The den chamber runs several tiles wide (`specs/maze.md`) and nothing fixes which
tile a predator waits on, so a released hunter still has a swim to the gate whose length
is the build's own business — measured from the moment each one clears the chamber, a
build releasing exactly `5 s` apart reports gaps of `3.95` and `4.75`. Reading `state`
the other way is no better: a build that flipped it early said `"wander"` of three
predators sitting on den tiles.

Both readings of `state` are legitimate, and `specs/instrumentation.md` had settled
neither, so the snapshot now reports the two facts separately. `state` says WHERE a
predator is, and `"den"` includes a released one still crossing the chamber. A new
required field, `released`, says whether its turn has come: `false` while it waits its
slot, `true` from the moment that slot arrives — before the gate, and whatever `state`
says. A predator posed with `setPredator(kind, "den")` has its schedule suspended and
stays `released: false`. `specs/predators.md` says the same thing from the other side:
the `5 s` spacing is between release times, and the walk to the gate is not part of it.

`actDenReleases` times the stagger from `released` and keeps asserting the leaving from
the tiles, so neither claim stands in for the other. On a reference mutated to hold its
Lanternjaw at the far end of the den — a perfectly conforming schedule — the old signal
reported gaps of `4.45 / 5.30` and the new one reports `4.95 / 5.00`. Against references
mutated to release all three at once, both items fail on the gaps; against one that omits
`released` altogether, they fail on a first assertion that names the missing field rather
than on a den that appears never to have opened.

## The brightness hold is armed by eating, because that is what arms it

`brightness/holds-decays` posed `G` with `setBrightness(1)` and called that arming the
hold. `specs/instrumentation.md` did not say what the op does to the hold, and the two
readings diverge completely: the reference implementation armed it, two builds under test
cleared it, and on those two the posed value began decaying on the call — so the item
reported a decay bug against builds whose hold and half-life were exact to four decimal
places when driven by eating.

The op's contract is now stated: `setBrightness` arms the `1.0 s` hold as a pellet does,
so a posed brightness is steady for that window instead of draining out from under its
caller, and it therefore cannot be used to place the forager part-way through a hold.

The item no longer depends on that either way. `specs/gameplay.md` defines the hold in
terms of the last pellet swallowed, and the forager is standing on one, so eating that
pellet is the whole precondition — the rule is now driven by the only event it is defined
in terms of. `G` starts at one pellet's `+0.34` rather than a posed `1`, so the readings
are taken against the value the eat produced: steady across the hold, and more than half
of it gone a second later. A build whose `setBrightness` clears the hold now passes.
Against references mutated to drain constantly and never to decay at all, the two halves
fail one each.

## A flare's radius is read a beat into the bloom

`flarefish/flare-cadence` asserted the bloom had a positive radius from the snapshot the
`flaring` flag first rose on. A build may raise the flag and light the disc on the next
step — one build does, for exactly one tick — and nothing fixes an order between a flag
and its own radius. Worse than a false failure, it was a lottery: with the flare cycle
landing on tick `900`, the sweep's `30`-tick poll hit that tick from a clean start and
missed it when the phase shifted, so the same build passed or failed on where the count
began.

The radius is now read a beat into the bloom, as `flarefish/flare-reveals` already read
its disc. The bloom lasts about a second, so a fifth of it is inside the burn on any
build. The assertion is no weaker for it: against a reference mutated to report a bloom
radius of `0`, it still fails.

## Three checks that were reading the scenario, not the build

**The bulb is read where the trench is actually dark.** `lanternjaw/bulb-visible` stood
the
pair two tiles apart and took its darkness from the rock between them. Two tiles is
`64 px`, inside the forager's own light pocket (`V = 96 px` while it is dim), and a build
is entitled to paint that pocket as a soft glow rather than a hard disc. One does: the
glow
washed over the bulb and the sample came back green, so a build drawing the bulb at the
palette's exact `#ffd166` was failed for it. The tile was unlit — the rock did its job —
but the trench around it was not dark. The pair now stands five tiles apart: past the
light,
still inside the Kindle vision circle, the same band `amber/lookalikes` has always
measured
its lights from.

**Ink is asked whether the Gloamfin keeps coming, not what it was doing for one tick.**
`gloamfin/ink-noop` read the hunter's state on the single tick it touched the cloud, which
cannot tell a hunter that swims on from one that recoils on the next step. It now watches
it
cross — and stops watching before the search begins. The chase is toward a tile the
forager
has left, so a conforming Gloamfin reaches it a beat later, drops to `search` and starts
"casting back and forth around the spot" (`specs/predators/gloamfin.md`). That cast is a
turn-around in plain view, and the clip used to run into it: a hunter apparently repelled
by
the ink, directly under a verdict saying ink does nothing.

**A predator is released when it leaves the den, not when a flag says so.** `den/stagger`
timed the stagger off `state`, which is the build's own bookkeeping. A build flipped all
three to `wander` while they sat on den tiles, and its Lanternjaw then stood on the same
tile for twenty-five seconds reporting `wander` at the drifter's `64 px/s` without
covering
a pixel — a textbook staggered release by the numbers, three predators sitting in the den
on
screen. `actDenReleases` now records both moments: the flag, which still times the
schedule
because that is what the spec fixes, and the moment the predator is clear of the chamber,
which is a new assertion of its own. Stragglers get a release gap of grace to finish the
swim, so a hunter still crossing the chamber when the last flag lands is not mistaken for
one that never left.

## A fixture puts the forager where it belongs, and says when it has been moved

Two runs turned nearly every posed scenario into noise, and the cause was one assumption.

**The fixture places the forager.** Every poser but one left it wherever `setMaze` had
rested it — "the first corridor tile in reading order" — which the spec is explicit is "a
defined resting place rather than a meaningful one: a caller poses it where the scenario
wants it next" (`specs/instrumentation.md`). A build that rests it elsewhere put the
forager
inside the ring these fixtures keep a PREDATOR in, two tiles from a hunter that heard it
and
ate it within half a second. That re-dens every predator and restarts the dive, so eleven
checks measured a board that had already reset — and reported it against the hunter's
speed,
its silence, its flare cadence. All eight posers now place the forager on a named tile of
their own fixture, as `poseSonarSense` already did.

**And a scenario says when it stopped standing.** `sceneGuard` takes a picture of the
scene
at the end of `arrange` — where the forager was parked, which predators were held in the
den, the lives, the screen — and `sceneHeld` asks in `assert` whether any of it gave way.
It is the FIRST assertion of the bystander checks, so when a scenario breaks the verdict
names what broke: "the forager did not stay where the scenario parked it — it was at (12,
7)
and ended at (20, 9)", rather than a sentence about the Gloamfin.

**Checks that swim to their subject stand aside when the forager cannot move.** A build
whose forager never left its tile failed nine checks on their own wording — "the forager
swam into a plankton", "clearing awards the 500 bonus" — each blaming a different
mechanic,
none of them the one that was broken. Whether the forager moves at all is `controls/*` and
`maze-movement/*`'s verdict, and they give it; everything downstream now raises an unmet
precondition saying so.

`gloamfin/ping-reveals-nothing` also stops counting revealed tiles and starts measuring
the
ping's effect. It required the count out in the dark to be zero; a build that had twelve
tiles showing from before the scenario began was failed for a ping that had changed
nothing.
The claim is that the ping reveals nothing, so it is read as a change.

## Posed fixtures house their predators, and checks wait for what they ask for

Another three runs, and another set of checks that were reading their own setup.

**A fixture now has a den.** `setMaze` sends every predator back to the den, and a fixture
had none — so each build was left to decide what "back to the den" means when there is no
den, and they decided differently. One dropped its held predators onto the forager's own
tile on the next tick, took a life, and did it again on each respawn until the dive was
over before the check had run a step; the forager never moved, and the check reported that
it could not move. Every fixture now carries a small den chamber sealed into the bottom of
the board, with its gate walled on three sides, so there is somewhere real to hold them
and
it is nowhere near the scenario.

**A flare is read a beat into the bloom.** `flarefish/flare-reveals` sampled the trench on
the tick the `flaring` flag went up. One build lights the disc as it raises the flag,
another raises the flag and lights the disc on the next step, and both are a flare that
reveals its area — but the second read as a flare that revealed nothing at all. The check
now waits a beat, and while it is there it asks the spec's actual claim instead of a
count that went up: "Every tile within the flare's radius, floor and wall alike, straight
through walls, is revealed" (`specs/predators/flarefish.md`), against the `192 px` the
same page fixes. It also reads REVEALED rather than LIT, because `visibility` separates
`'l'` from `'r'` without saying whose light `'l'` counts, and two conforming builds label
a
flare-lit disc differently.

**Running out of lives is waited for.** `scoring/three-lives` and `states/gameover` posed
a
hunter on the forager and stepped six ticks — a twentieth of a second — before posing it
again. That is enough for the first death and, on a build that grants a moment of grace
where the forager respawns, for none of the others: a run lost one life, sat there for the
rest of the loop, and was failed for never reaching game over. Each death is now waited
for
on its own budget. Nothing in `specs/` forbids that grace, and a check about running out
of
lives has no business turning on how quickly a build lets the next one be taken.

**And the Lanternjaw earns its fix.** `lanternjaw/wander-disguise` parked it in a sealed
ring nine tiles from a dark forager and then set `mode: "chase"` on it — asking a build to
hold a fix on a forager it had no reason to have found. One re-read its senses, saw
nothing
to chase, and was wandering again a twentieth of a second later, which read as failing to
drop its disguise; another crossed the rock and was already chasing when the check wanted
it disguised. Two halves of one item failing on two builds for two reasons, neither of
them
the disguise. The pair now stands seven tiles apart on one straight corridor, and the fix
is
made by the mechanism the spec gives it: `R = 128 + 192 G`, so a dark forager at `224 px`
is
outside the Lanternjaw's `128 px` reach and a fully lit one is inside its `320 px`.
Turning
the light up is the whole of it, and the clip shows a drifting amber mote turning into a
hunter the moment it comes on.

Two checks now name a cause instead of a symptom. `scoring/descend-on-clear`, when five
simulated seconds leave a build still on the cleared screen, hands the clock back and
looks
again: a dive that descends only once a real person is watching is a deterministic-core
failure (`specs/instrumentation.md`: state "must not depend on ... wall-clock time to make
progress"), not a build that cannot descend, and the verdict says so.
`flarefish/flare-reveals`
and `flarefish/flare-lock` ask first whether their sealed ring held — a build whose
hunters
cross rock reaches the forager and re-dens everything, after which "it never flared" is
true
and about something else entirely.

## No check can be ended early by the forager eating

The single most damaging thing a scenario could do to itself was strip the board down to
one plankton. `quietBoard` — which thirty-eight checks call to settle the forager as a
bystander — did exactly that, through `poseLastPlankton`, and it placed that last pellet
on
a tile NEXT TO the forager. Any forager that moved ate it. The maze cleared, the dive
descended, every predator went back to the den, and whatever the check was watching ended
underneath it. Whether the forager moved was never the check's to decide: a build may
leave
a forager with no key held swimming, and one under test turns it aside when the way ahead
is rock rather than stopping it dead, so a forager parked against a wall simply left.

Two changes make it impossible rather than unlikely.

`quietBoard` no longer strips the board. It parks the forager and settles the one pellet
underneath it — eaten through the real eat path, with `G` put back to the zero a dive
opens
on — and leaves every other pellet where it is. A full board cannot be cleared in the
seconds a check runs for.

And every posed fixture now carries a **larder**: a few corridor tiles walled off from the
rest of the layout, holding plankton the forager can never reach. `planktonRemaining`
never
reaches zero, so no amount of grazing can clear the maze whatever the forager does. It is
free — the tiles are sealed away from the scenario — and it is automatic, so a fixture
cannot forget it. Driving a forager up and down a fixture until it has eaten everything it
can reach: with the larder, three pellets left and the dive still at depth 1; without it,
depth 3.

The four checks that are ABOUT clearing the maze (`scoring/descend-on-clear`,
`scoring/cleared-bonus`, `states/cleared`, `audio/descend`) run on the build's own maze
and
call `poseLastPlankton` themselves, which is what that op is for. Nothing else calls it,
and
`flarefish/flare-cadence` loses the machinery it had grown for dodging that stray pellet.

Sweeping every check on a build whose forager wanders: no check descends mid-measurement
any more.

## The gate is asked whether it opens, not whether the forager stands still

`maze-movement/no-den-gate` drives the forager into the den gate and used to require that
it be exactly where it started and not moving. That is stricter than the rule it is named
for. `specs/maze.md` makes the gate "passable only by predators"; what a forager does when
the way ahead is rock is `specs/movement.md`'s business, and a build that turns it aside
rather than stopping it was failed here for something the gate had no part in. The check
now
samples every tick of the drive and asks the question it is named for: the forager must
never stand on the gate tile, and never be inside the den. A reference mutated to let the
forager through the gate fails both.

## Smaller repairs from the same runs

- `sonar/marks-predators`, `sonar/not-reveal-amber` and `sonar/heard-by-gloamfin` trusted
  `setMaze` to leave the forager on "the first corridor tile in reading order". The spec
  calls that "a defined resting place rather than a meaningful one: a caller poses it
  where
  the scenario wants it next", and a build that read it differently left the forager a
  tile
  from the predator these checks need it to be unable to see. They pose it now.
- `brightness/holds-decays` stands the forager on a SEALED tile rather than in a dead end.
  It is the subject here and it must not move — every pellet it eats re-arms the hold it
  is
  measuring — and a tile with no open neighbor takes that question away from every build
  equally.
- - `maze/proportions` renames its openness assertion to say it is a whole-board MEAN. A
  board
  can hold one plainly-too-wide room and still average out under the bound; that room is
  `maze/corridors-one-wide`'s to report, and it does. Nothing about the measurement
  changed
  — the spec defines openness as "the mean number of open neighbors per corridor tile" —
  but
  the old label read as though it were the room check itself.

## Checks that were reading the scenario instead of the build

Three runs against this version turned up checks that failed conforming builds, or passed
without showing a reviewer anything. The specs did not move; what each check reads, and
what its clip contains, did.

**A real-time clock is proved by the forager, not by a patrol.**
`controls/advances-in-real-time` asked whether the game runs itself by sampling a predator
twice, two seconds apart, and measuring the straight line between the two readings. That
is
DISPLACEMENT, not travel: a patrol that rounds a corner and comes back covers a couple of
hundred px and reports nearly none. A run failed on `0.53 px` while its clock advanced the
full `2.0 s` and its forager swam `258 px` — the item's own claim, holding perfectly.
Which
hunter is even out of the den is the release schedule's business
(`specs/predators.md`), so the witness is now the forager under a held key: driven, in a
posed corridor, with the distance it should cover a matter of arithmetic. It still catches
a build whose frame loop never runs — mutated to boot with `autoStep` off, both the clock
and the travel read zero.

**A wrap that stops dead is now reported as one.** `maze-movement/wrap-tunnel` failed a
run
on "nothing stops at the edge that does not stop everywhere", which named a threshold
rather
than a finding. The finding was real and worth reading: the forager crossed the seam and
then
parked at the far border, `0` px per tick, for every remaining tick of the scenario —
`specs/maze.md` asks that "movement and speed are continuous through the wrap; nothing
stops
at the edge". Both seam assertions now report what they measured, in ticks of pause and px
per tick, against what the same build does in open corridor a moment earlier.

**The Gloamfin's hearing was probed exactly on its own boundary.**
`gloamfin/silent-when-close` posed the pair two tiles apart — `64 px`, which IS the
hearing
range — so whether a build locked at all came down to reading "within about 2 tiles"
(`specs/predators/gloamfin.md`) as `<=` or `<`. All three runs failed there. The pair now
sits diagonally adjacent at `45 px`, inside that range under any reading, and each is
walled
into its own tile: hearing is explicitly "in or out of line of sight", so rock keeps them
apart without keeping them from hearing. That also retires the re-posing loop this check
used
to run — a hundred and twenty teleports across six seconds, which a reviewer saw as the
pair
juddering in place and the sensing code saw as its subject moving out from under it.

**A mote is read where the mote is drawn.** `standard/amber-any-distance` and
`amber/lookalikes` sampled rings centred on the position `snapshot()` reports a creature
at.
A run drew its bulb six px higher, at the top of the body, as a bulb on a bell would be —
plainly amber, amber at every radius about its own centre, and failed for "the distant
amber
drifter is still drawn amber" because the ring centred below it averaged to a dim
`64,56,37`. Nothing in `specs/gameplay.md` or `specs/assets.md` fixes the light to that
pixel, so the mote is now found first, within a few px of the creature, and read about
itself.

**A flare is one flare even when its parts arrive out of order.**
`flarefish/flare-cadence` timed from one rise of the `flaring` flag to the next. A run
blooms before it charges — a real defect, since "the charge-up glow before each flare
telegraphs" it and the player's counter is to "break out of its radius before the bloom"
(`specs/predators/flarefish.md`) — and the flag rose twice inside that one cycle, so this
item read a one-second cadence and failed a Flarefish whose flares were `7 s` apart. It
now
waits for a flare to be wholly over before timing to the next, and reports the cadence it
was
named for.

**And `setMaze` says plainly what it leaves alone.** Its first wording said the board ends
up
"as though it had just been generated", which a run read as including the dive countdown a
freshly generated maze is entered through. The op swaps the board out underneath a live
dive
and leaves the screen alone; that is now stated. Two smaller gaps in the same op: a
fixture
may legally have no den, no gate and no tunnel, so the spec now says that anything which
would happen at a structure the layout lacks simply does not happen and is never an error
—
a build must not throw because a bonus drifter has no den gate to enter from.

## Evidence a reviewer can actually read

Several clips showed the right verdict and the wrong picture.

- - **`fog/light-line-of-sight`** was a still of an unlit predator, which is to say a
  still of
  dark trench: nothing in it distinguishes a build that correctly hides a predator around
  a corner from one that has no predator there. It is now a clip of a forager swimming a
  corridor with a Gloamfin waiting around a blind corner, and of the moment rounding it
  reveals them. The reveal is also a new assertion — the predator sits inside the light's
  reach throughout, so "never lit while behind rock" can no longer pass by drawing
  nothing.
  The corner tile itself is not judged: whether a body three px short of a junction is
  visible is a pixel question this check answers in tiles, and the specs settle it in
  neither direction.
- **`flarefish/no-tell`** was likewise a still of nothing. It now films a flare fading, so
  the Flarefish is unmistakably there and then unmistakably not.
- - **`gloamfin/wander-speed` and `gloamfin/ping-cadence`** watch a Gloamfin that must be
  far
  from the forager to wander and self-ping at all, so no light reaches it and the clip was
  black. Both now turn on the debug overlay, which the spec requires to carry exactly the
  facts they read — kind, state, tile, speed — and requires to change nothing.
- **`ink/cooldown`** asked for the whole `8 s` cooldown in one `advance`, which spends a
  clip's entire filming budget before a frame is recorded; the recording ended almost as
  soon as it began. Half the cooldown is filmed now and the rest is skipped, so the meter
  is visibly part-way back and the verdict still covers the full wait.
- **`maze-movement/reverse-anytime`** turned around a tenth of a second in — two or three
  frames — so the clip opened on a forager that had all but already reversed. It now swims
  for `0.6 s` first, still stopping mid-tile, which is where the rule applies.
- **`flarefish/flare-cadence`** opens on the first bloom rather than on the gap after it,
  and **`flarefish/flare-lock`** gives its flare a beat to burn before the forager is put
  into it, so the acquisition has somewhere to happen.
- **`flarefish/ink-breaks`** gives the forager six tiles of corridor to break away down
  instead of three. The verdict never needed them; the picture did, because a blinded
  Flarefish keeps drifting the way it was pointed and with three tiles it drifted right up
  to the forager, which reads as a hunter still closing in.
- - **`den/re-release`** says in its own description that the life is taken by placing a
  hunter
  on the forager. Staging a catch worth watching costs time the release schedule is
  measured
  in — it moved one build's stagger from `5 s` to `1.75 s` — so the clip keeps the
  re-release, which is the item's subject, and the text stops implying a chase.

## A build poses the maze a check needs, through a new `setMaze`

`window.__fathom` gains one operation, `setMaze(rows)`, and it is required
(`specs/instrumentation.md`). It takes a layout in exactly the form `snapshot().tiles`
reports one and makes it the maze, rebuilding everything derived from it — passability,
predator pathing, the sonar flood, the den and its gate, and the wrap tunnel. The dive
carries on as though that maze had just been generated: plankton on every corridor tile,
fog back to unrevealed, every predator returned to the den. Score, lives and depth are
untouched.

It exists for the reason `setCreatureAI` does. You design the maze (`specs/maze.md`) and
a conforming layout is yours to invent, so a check that needs a shape — a straight run of
a given length, a corner to turn, a corridor ending in rock, two tiles with rock between
them — could only go hunting for one in the maze you drew and take what it found. What it
found differed from build to build: a different amount of room, a different approach,
sometimes nothing usable, and the measurement moved with it. A run failed
`gloamfin/chase-cap` at `117.8 px/s` against a build whose Gloamfin chases at exactly the
`134` the spec asks for, because the four-tile corridor the check landed in was a pocket
where the hunter had to turn into the chase and pay the cornering penalty on the way.

So fifty-three checks now pose the geometry they are about. The layout is a **fixture**,
not a maze: it is used exactly as given and is deliberately NOT held to `specs/maze.md`,
because the shapes a scenario wants — a bare hallway, a dead end, two rooms with no way
between them — are precisely the shapes a real maze may not have. A build must not
validate it or repair it.

Two rules decide which checks pose and which do not, and the second matters as much as
the first:

- **Pose only what the spec does not guarantee.** Run lengths, corner arms, sight lines,
  distances and rock between two points are a build's own invention, so a check that
  needs one poses it.
- **Read what the spec does guarantee.** The den, its single gate, the corridor outside
  it and the wrap tunnel exist in every conforming maze, so the checks about them still
  find them on the board the build drew — finding them there is part of checking the
  build built them. `maze-movement/no-den-gate` still presses the forager against the
  build's own den gate, and the eight structural `maze/` checks are untouched.

`maze-movement/wrap-tunnel` sits across both rules and now says so: it reads the real
maze for the tunnel and then drives a posed one. Its structural half is stronger for it —
the maze must have **exactly one** row piercing the border, and that row must be **clear
of the den**, both of which `specs/maze.md` states and neither of which anything checked
before. It does not check that the row is "mid-height": the spec offers row 12 as an
example and fixes no band, so a threshold there would only fail conforming builds.

Posing also settles things a berth could only postpone. A patrol crosses the whole board
in about five seconds, so "far away" on a real maze is a head start, not a fact, and
`flarefish/flare-cadence` had grown a re-posing loop to keep the forager ahead of one for
the twenty seconds two flares take. The checks that want an undisturbed creature now put
it in a sealed room: a fixture may be two regions with no way between them, which a maze
may not, so far away stays far away.

## The Gloamfin's chase cap is measured on a run it does not have to turn into

`gloamfin/chase-cap` reads one number: the speed a chasing Gloamfin settles at on a
straight run, which `specs/predators/gloamfin.md` fixes at `134 px/s`. It posed the
hunter four tiles from a parked forager, set it chasing, and sampled `0.3 s` later — and
never said which way the Gloamfin was facing.

Facing is not decoration here. The same spec prices the chase by the turns it makes: on
"any perpendicular turn, not a straight run, and not a free reversal" the Gloamfin drops
to about `115 px/s` and takes about `2 s` to climb back. A hunter posed on the line still
carrying an unrelated heading has to turn before it can run, and a perpendicular turn
costs. Sampled `0.3 s` into a `2 s` ramp that reads about `118 px/s` against a check
wanting `134 ± 6`, so the check failed a build for having implemented the cornering rule,
and reported it as one that cannot reach its chase speed.

Both reference implementations hid it, because a denned predator of theirs has no heading
at all and their corner test skips when there is no previous direction — the pose that
costs another build `19 px/s` costs the reference nothing. Two of the headings a build
might legitimately hold are free anyway (down the corridor is no turn; back up it is the
free reversal the spec names), so the check was passing or failing on which of four
arbitrary answers a build happened to give. It now names the heading, as
`gloamfin/corners-slow` and `scoring/caught-costs-life` already did.

The run it measures is also long enough to be one. Four tiles is `128 px` and contact is
made a body's width short of that, so at the top of the tolerance the Gloamfin arrived
`0.79 s` in — inside the `1.1 s` the check films, which left the evidence for a
chase-speed check ending on a catch and the dive countdown, on both references. It is six
tiles now, which the fastest build the check can pass still needs `1.24 s` to close, and
the light is opened to `G = 1` so the chase happens somewhere a reviewer can see it: at
the `G = 0` a dive starts on, the pocket is `96 px` and the Gloamfin swam the whole
measurement through pitch black.

Against reference implementations mutated to chase at the wander's `116 px/s`, at `126`
and at `170`, all three fail on the cap; left alone, both references pass.

## The flare cadence is timed with nothing for the Flarefish to chase

`flarefish/flare-cadence` times the gap between two consecutive flares, and the
Flarefish has to hold its wander for all of it — `specs/predators/flarefish.md` has it
stop flaring the moment it acquires the forager ("while chasing it stops flaring"), so a
Flarefish that finds the forager mid-count leaves nothing to time. The item posed the
forager eight tiles off and hoped.

Eight tiles is not a berth. The maze is a fixed `36 x 18` tiles, `1152 px` across
(`specs/maze.md`), and the Flarefish wanders it at `116 px/s` — it crosses the whole
board in about five seconds and covers three board-widths in the twenty this item needs,
while its bloom senses `192 px` in every direction straight through rock. Wherever the
forager is parked, the wander arrives. It did: a run reported the item inconclusive
against a build that flares every `9.25 s`, comfortably inside the band the item accepts.
The wander reached the parked forager after `7.65 s`, fixed on it, and caught it two
seconds later, which re-dens every predator. Nothing about that verdict was about the
flare cadence, and a reader of it would have gone looking in the wrong code.

So the forager is now kept out of the way rather than merely placed out of it. It sits at
`G = 0`, the floor of the light-sense range, and whenever the Flarefish closes to within
`288 px` — the bloom's own radius plus three tiles, many times the `29 px` it can cover
between two reads — it is re-posed to the tile furthest from the Flarefish, by the same
`setForager` op that parked it in the first place. Nothing touches the Flarefish, its
state, or its flare timer: the forager is a bystander in this item and this only keeps it
one. The last of those moves is made unconditionally, before the timed gap opens, so on
both reference implementations the clip now contains no move at all.

Two smaller repairs came with it. The walk up to the first flare — which is skipped, not
filmed, and is not the interval being measured — is retried from a fresh far tile if the
wander finds the forager anyway, so an unlucky patrol costs a restart rather than the
verdict. And the two windows the item allows are now named in the assertions that depend
on them (`within 20 s` for the first flare, `within 13 s` for the second), so a Flarefish
that flares far slower than `7 s` fails on a sentence that says what happened rather than
on a bare "it flares while wandering".

What the item asks is unchanged, and it still fails what it should: against reference
implementations mutated to flare every `2 s`, to flare every `25 s`, and never to flare
while wandering, the three failures are the cadence assertion, the first-flare window,
and the first-flare window. The band itself — the gap being `7 s` onset-to-onset or about
`9 s` measured through the flare's own duration, both of them "about every `7 s`" as
written — is the one v2.0.0 settled on, untouched.

The tile the forager steps aside to is chosen by a new finder that scores every candidate
by the *smaller* of two distances, the straight line and the corridor route. A tile far
by one can be next door by the other: the bloom ignores walls, so a long way round is no
protection from rock one tile thick, and the wrap tunnel joins the two mouths of the maze
— as far apart in pixels as tiles get — as adjacent tiles.
