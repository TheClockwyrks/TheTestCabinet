## Shatter is a TypeScript project, on one of three engines

This version stops asking a model for a self-contained page built on top of a
bare `package.json` and asks it for a real project instead. A run is seeded with a
complete TypeScript workspace: Vite, `tsc`, ESLint, Prettier and Vitest already
configured, and an `index.html` holding the canvas. How much of that project the
model writes is what the engine decides.

Under [Simple 2D](/engines/simple-2d/) and
[Structured 2D](/engines/structured-2d/) the workspace also carries the
case-owned modules around the game, `src/constants.ts` and `src/main.ts`, and the
model writes `src/game.ts` against them. Everything the specification fixes as a
number, a key binding, a cue name or a piece of screen copy has a name in
`src/constants.ts`, and the specs cite those names rather than restating the
figures. The engine owns the frame loop, which hands the game the real elapsed
time of each frame and mandates no timestep of its own, the canvas fit, keyboard
input as named actions, audio as named cues, and the debug overlay; Structured 2D
also owns rendering and the framework the game is written inside. What stays the
build's is Shatter itself: the wrapping field, the well, every body flying over
it, and everything drawn.

Under `none` the workspace is that toolchain and nothing else: configuration,
`index.html`, and no `src/` at all. The model writes every line of what runs, from
the frame loop and its fixed-step accumulator up to the game.

## Three engines, one game

Because all three projects deliver the same game, the review items, the domains
and the checks that decide them are the same across engines, and a score recorded
under one engine is comparable with a score recorded under another. The specs
branch only where the deliverable differs, and the three validator suites differ
only in how they stand a build up. Each variant ships a reference implementation
per engine, under `references/<engine>/<variant>/`, and the case's Reference tab
offers a switch between them.

## Four domains instead of one

Earlier versions rated a run on a single `arcade` domain, so any failure anywhere
was the whole score. A run is now rated on `gravity`, `flight`, `arcade` and
`presentation` independently, and its overall rating is the worst of the four, so
a build whose well bends shots correctly and whose flight model does not is told
apart from one where it is the other way round.

## Every review point is decided by a validator

The checklist grew from 99 points to 290, and every one of them carries a Vitest
suite under `validation/<engine>/`, the domains its failure lowers, and how far it
lowers them. A `base` run is rated on 236 points and a `warhead` run on 290.

Nothing is left to a reviewer to decide from a screenshot. The six points that had
been backed by a reference view or a proof capture rather than by a check are now
decided by validators: the field staying fitted and centred at any window size, a
shape straddling a seam being drawn on both sides of it, the bullet trail being
continuous and scaling with speed, the HUD drawing the score and one glyph per ship
in reserve, and — on the `warhead` ruleset — a chipped rock flashing on the tick the
hit lands and a damaged rock being drawn measurably differently from an undamaged
one. The reference screenshots and the proof captures are gone with them, and
`specs/proof.md` with those. Every piece of media a reviewer looks at is now
produced by the case's own validators, from scenarios the case controls, and the
same suites run against each reference build to produce the baseline they are
shown beside.

## The checklist asks one question at a time

Each point now asserts one observable behavior, which is most of the growth from
99 points to 290. Where a single point had asked that a wave clears, that the
banner appears, that the number advances and that play continues underneath, four
points ask those four things, so a build that raises the banner and forgets to
increment the wave loses one point rather than all four, and a reviewer reading
the checklist can see which half of a sentence a build got wrong.

## The debug surface was redesigned

No operation of the debugging and automation surface survives with its old
signature. The rule the whole surface is now built to is that each operation sets
one field, reads the state, or moves the clock, and takes scalars, and that
`snapshot()` reports every field an operation can set, so every operation is
verifiable by setting a value and reading it back. The checklist owns that
property as a point of its own.

What that replaced:

- The patch operations. `setShip(state)`, `setSaucer(state)`, `addRock(size,
  state)` and `addBullet(state)` each took a partial object and applied every
  field it carried, which made the case's own state layout a requirement on the
  build. Each is now a set of scalar operations that name what they set.
- `startGame()`, which entered a screen, opened a run and began a wave at once.
  Arranging several things at once is now the caller's to sequence.
- The missing removals. There was no `clearBullets`, no `clearEnemyBullets`, no
  `clearTorpedoes`, and no way to address one rock among several, so a scenario
  could not take enemy fire already in flight off the field. Each roster now has
  its own clear, and each empties one roster and leaves the others standing.
- `removeSaucer()` as the only way to isolate the saucer. A check on what the
  saucer senses needs its senses live and its body still; a check on how it
  travels needs both. The saucer now carries three faculties that are held
  independently, and `snapshot()` reports each.
- The absent world gates. A posed empty field was a cleared wave, so a scenario
  was invaded by rocks it never asked for, and the answer had been to park
  bystander rocks in a quiet corner. `setWaveSpawning` and `setSaucerSpawning` now
  hold the game's own loops off while a scenario runs, and the parked bystanders
  are gone.
- The keyboard operations. `keyDown`, `keyUp` and `press` are gone: the keyboard
  belongs to the runtime beneath the game, which is the engine's under an engine
  and the build's under `none`, so a check drives real key events at it instead.
- `setMuted`. Mute is reached the way a player reaches it, through the `mute`
  binding, and `muted` is read back from the snapshot.
- The `reset` option. `reset` took an option that fixed every draw the game
  makes, and the checks on the saucer, the waves and the recycled rocks replayed
  chosen values of it. `reset` takes no options now: the specification states
  each draw as the distribution it is drawn from and nothing about how a build
  draws it, and the surface poses the outcome of every draw a check touches.
  `setNextSaucerEdge`,
  `setNextSaucerRow`, `setNextSaucerAim`, `setNextRockSpeed` and
  `setNextRecycleEdge` each set what the next draw of one kind decides and are
  consumed by it, `setSaucerDue` sets the figure the gap draw decides, and
  `setSaucerWeave` the direction of the saucer's first reroll. A check that wants
  a particular outcome poses it, and a check on the draw itself reads the build's
  own.

## A wave is cleared by shooting it, not by emptying the field

Three wave checks reached a cleared wave by calling `clearRocks()`, two of them
carrying the comment "as if every rock were destroyed". It is not that.
`clearRocks` removes rocks from the field, awarding no score and destroying
nothing, and nothing anywhere said a wave turns over on it. The specification says
a wave clears only by shooting every rock down, so a build that raises its next
wave from the destruction that empties the field, rather than from polling the
field's emptiness, is conformant and failed all three checks. That is what the
checks were measuring: which of two equivalent readings of the clear rule a build
had taken, rather than whether it turned a wave over.

No check in this case now reaches a cleared wave through `clearRocks`. The wave
points shoot the field down for real: every round goes in through `addBullet` and
through the build's own collision and split code, each round is placed on its
target's doorstep on the side facing away from the star so it can never be
absorbed by the core on the way, each round carries the target's velocity as well
as its own so a drifting Small is not missed, and the run stops on Smalls as well
as on a count, because only destroying a Small takes a rock off the field.

The other reading is now a point of its own:
`waves/an-empty-field-does-not-clear-by-itself` asserts that a field emptied with
`clearRocks`, from which nothing was destroyed, raises no banner and advances no
wave, so the operation's own contract is graded rather than assumed.

## The saucer is graded on crossings it could survive

The check on the saucer avoiding the star's core lined the saucer up on the
star's row, 60 units out, and sent it at the core at cruise. That is under half a
second of warning, and a craft that answers by adding vertical speed while keeping
its crossing speed still clips the core. Only a build that clamps the saucer's
position out of the core survived it, which is one way to implement the
requirement and not the one it describes. The check was measuring the manner of a
build's steering, while claiming to measure whether the saucer overlaps the core,
and it posed a state a conformant build's own flight cannot reach, the steering
being what keeps it out of there.

`saucer/avoids-the-core` now flies 20 real crossings: five rows from 80 units
below the star's row to 80 above it in 40-unit steps, each from the left edge and
from the right, the whole set flown with the first weave reroll posed each way.
Every crossing is a course the specification's own entry rule produces, the whole
approach is left for the build to steer through, and the closest approach of all
20 decides the point.

Twenty rather than one, because both common faults here are invisible in a
single sample. Avoidance is often one-sided, clearing an approach from above and
driving one from below straight through, which is what the rows either side of the
star are for. And a build that rerolls its weave on a timer can have the reroll
discard the avoidance it has accumulated, so whether it clears depends on where
the reroll lands in the approach rather than on which row it came in on. That one
is intermittent by construction and does not respect a tidy sample.

The crossings are affordable because the closest approach is read as the star's
distance to the straight line between two samples rather than to the samples
themselves. Reading the samples alone at that stride reports the saucer further
out than it got, which is the wrong direction for a check hunting a build that
came too close. The saucer's gun is held off for the sweep, so the crossings
produce no saucer bullets at all, and the recording shows the crossing that came
closest, which is the one the verdict was decided on.

## The fragment fan is read out of the well's reach, and off the pair

The check on how a rock's fragments scatter posed the parent 163 units from the
star, where the pull moved its velocity by 70 units per second over the three
shots that killed it. The fragments then inherited that, so the check was reading
a drift gravity had built while claiming to read the drift it had arranged.

Moving the parent out was not enough on its own. Two graded builds kick their
fragments perpendicular to the rock's own course rather than perpendicular to the
bullet's travel, which is what the specification fixes, and the old placement
caught them only by accident: gravity had swung the parent's course away from the
shot, so the two conventions pointed in visibly different directions. With the
parent drifting along the shot's line they point the same way, and moving the rock
out of the well and changing nothing else would have turned a real catch into a
pass.

Both points now pose the parent 412 units out, where the pull is about 26 units
per second squared, and give it a diagonal drift against a horizontal shot, so the
two conventions differ by 60 degrees by construction rather than by luck. The
assertions are read off the pair rather than off each fragment: the average of the
two velocities is the parent's velocity whatever the kick did, and the difference
between them is twice the kick with the parent's motion cancelled. The parent's
velocity the average is compared against is read from the snapshot on the tick
before the fatal round lands, not from the posed figure, so what gravity did over
the shots cannot enter the comparison at all. The two directions are two points,
`rocks/fragment-velocity-carries-the-parent` and
`rocks/fragment-kick-is-perpendicular-to-the-shot`, because both are load-bearing.

## A recording ends on the outcome, not on the measurement

Every point in the torpedo category used to stop the moment its reading was taken,
which is the instant of impact, so a reviewer got one or two seconds that cut on
the frame the torpedo touched the rock, before anything the hit produced was on
screen. Every recording in this case now runs on after the reading and ends on the
effect: the fragments coming apart, the core that took the torpedo, the wave
arriving. The readings are unchanged.

Two of those points were wrong underneath, and both are fixed:

- `detonation/harder-scatter` compared a torpedo spread measured at impact against
  a gun spread measured most of a second later, which let gravity into one side of
  the comparison and not the other. Each spread is now read at the instant of its
  own kill.
- `torpedo/flies-true-through-the-well` followed the torpedo only as far as
  `x = 554`, short of the star's column at `640`, so the reading was taken before
  the closest approach to the well the point exists to prove it flies through. It
  now follows past the star.

A third fault becomes a rule for every check in this case: an entity a check then
reads is hard-asserted first. Two assertions used to dereference a torpedo whose
existence they had only soft-checked, so a build that launched nothing crashed the
script and was reported as failing to expose the debug surface rather than as
failing to launch a torpedo.

## A restart begins a game clear of saucers

Nothing graded that RESTART from the pause menu begins a game clear of saucers, so
a build that rebuilds its world but leaves the saucer flying passed all five
saucer points while handing a fresh wave 1 an enemy it never spawned, already
firing at a ship that has just launched.

`saucer/a-restart-clears-the-saucer` grades it in the shape a player would: a game
already down to two ships with a saucer crossing the field is paused, the pause
menu's `RESTART` entry is confirmed, and the new game is read back. Three devices
keep it from passing for the wrong reason. The saucer is read at the pause as well
as after the restart, because a visit is finite and a saucer that left of its own
accord would leave an indistinguishable field. A life is spent first, because a
game that merely resumed has three ships as well unless one has already been
spent, so the count reading three afterwards is what separates a restart from a
resume, and the screen reading `playing` is what separates it from a quit to the
title. And the pause selection is addressed rather than counted: the specification
fixes the order of the pause entries but not which one the menu opens on, so on a
build that opens on `RESTART` a fixed number of presses lands on `QUIT TO MENU`.

## The specifications were rewritten

Every spec was rewritten against the current authoring guidelines and re-split
from nine files into seventeen, one per concern, so each rule lives in exactly one
place. The prose states what the finished build must be and do and nothing about
how to build it: no algorithms, no data structures, no decomposition, no coaching.
Behavior a check reads is stated exactly or between explicit bounds, values are in
the game's own logical units throughout, and emphasis is reserved for the words
that would change the build if they were missed. The specification gained
`specs/state.md`, which states the shape of the observable state the debug surface
poses and reports, and `specs/showcase.md`, which defines the store-page
presentation the finished game ships beside its source. `specs/proof.md` is gone.

The prompt was rewritten with them. It states the task, the workspace, and how the
build is invoked, and points at the specs for everything else.

## The look is the build's

The seeded palette and the monospace type requirement are removed, along with the
three reference mockups. The specification states that the field is dark, and
gives a table of what a player must read at a glance: the ship and its facing, the
star reading as a well, the rocks apart from the ship and the saucer, a bullet's
tail, the thrust flame, a ship inside its respawn grace, and every readout at the
logical field size. The palette, the type, the glow, and every other aspect of the
look are the build's, and they are what the `presentation` domain rates.
