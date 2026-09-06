---
title: Writing Debug APIs and Validators
---

## Overview

Every playable case mandates a debug API and ships the validators that drive
it. The [instrumentation](/testing/end-to-end/instrumentation/) contract says
what a debug API is and how a case's manifest points review items at
validators; this page says how to design both. The rules here apply to every
[end-to-end](/testing/end-to-end/overview/) and
[full-stack](/testing/full-stack/overview/) case on every engine, including
[no engine](/engines/none/). An engine may add guidance of its own under its
[engine pages](/engines/overview/), such as the
[Simple 2D validator pages](/engines/simple-2d/validators/overview/), and that
guidance builds on this page rather than replacing it.

The goal of a validator suite is to grade a build, not to test it. A grade has
to say precisely which requirement a build missed and how much that miss costs,
which is what shapes every rule below.

## The debug API

### Operations are atomic

Every operation the debug API exposes does one thing to one element of the
game's state. An operation sets a single value, reads the state, or moves the
clock. The case's specification enumerates each operation by name, signature,
and effect.

Arguments are scalars and small fixed tuples rather than objects a build has to
declare a type for. `setBall(x, y)` and `setBallVelocity(vx, vy)` are the
right shape; `setBall(ball: Ball)` requires the build to hold a `Ball` type
with the fields the case chose, and a build is free to store its ball however
it likes. The only structure a case imposes on a build is the
[`snapshot()`](/testing/end-to-end/instrumentation/#core-operations) shape,
which is a read the build projects into from whatever it keeps internally.

### Patch operations are banned

An operation that takes a partial object and applies every field it carries is
never part of a debug API. A patch can only be applied to a structure that
matches it, so a `pose(patch)` or `setState(partial)` makes the case's state
layout a requirement on the build. Each field such an operation would touch is
its own operation instead.

### Compound operations belong to the validators

A debug API has no operation that arranges several elements at once. Starting
a match, reaching a particular screen, or staging a rally are sequences of
atomic operations, and those sequences live in the case's validator harness
where every validator shares them.

```ts
// validation/harness.ts
export async function startMatch(h: Harness, mode: Mode): Promise<void> {
  await h.debug.setScreen("countdown");
  await h.debug.setMode(mode);
  await h.debug.setHoldTimer(HOLD_TIME);
  await h.debug.setScore(0, 0);
  await centerPaddles(h);
  await parkBall(h);
}
```

A validator that needs all of a sequence calls the shared helper. A validator
that needs only part of it calls the operations it needs. A validator that
needs the paddles under player control opens the match without the operation
that takes them away from the player, and a validator that poses the ball adds
it. Nothing a validator does not ask for happens.

### The declared state is the whole state

Because validators assemble scenarios from single-field operations, the state
those operations reach must be enough to describe any scenario the case
validates. The specification declares every field a validator may set, and
`snapshot()` reports every field an operation may set, so each operation can be
verified by setting a value and reading it back.

State a build keeps beyond the declared fields is derived from them or refreshed
by every operation that could invalidate it. A build that caches a trail,
remembers which screen a pause returns to, or latches input holds that data in
a form that a single-field operation leaves consistent.

### A build reports the layout a spec leaves loose

A case that validates a behavior over a layout it leaves to the build carries a
read reporting what the build chose. A case whose menus take pointer input
specifies a read returning a menu item's hit region in logical units, so a
validator moves the pointer onto the item as the build drew it and asserts the
selection that follows.

Such a read is a reading operation like `snapshot()`, enumerated in the
specification by name, signature, and effect. It reports position, and the
pointer's effect on the menu stays in the game's own input handling, which is
what the validator decides.

### Operations stay on the precondition side

Atomic operations are setup verbs, and the
[precondition guardrail](/testing/end-to-end/instrumentation/#the-precondition-guardrail)
applies to each one. Setting the score to `10–8` is a precondition; an
operation that ends the match is an outcome, and the outcome is what the
validator observes after the real systems run.

### Random draws are posed as outcomes

Where the specs state a draw as a distribution, the debug API carries an
operation that sets the outcome the draw decides. A spec saying an enemy type is
drawn uniformly over the roster at each spawn gives the API `spawnEnemy(type, x,
y)`; a spec saying a hit crits with probability 0.1 gives it
`setNextHitCrit(crit)`; a spec dealing a shuffled board gives it an operation
that deals an exact one. The operation decides what the draw would have
decided, and the systems that follow from it run for real.

Where the game keeps drawing on its own, the API carries a gate that stops the
automatic draw while a scenario is posed, such as `setSpawning(enabled)`, which
a validator switches off before it spawns by hand. The gate is a field of the
declared state like any other, reported by `snapshot()` and reset with the
rest.

The API exposes the game's random behavior through nothing else. It carries no
seed on `reset`, no operation that seeds or skips draws, and no generator state
in the declared state, because each of those makes how a build draws a
requirement, where the specs state only what it draws. A posed outcome is a
precondition, and an operation posing one is graded under the case's
instrumentation items like every other control operation.

## Validators

### Validators assert the specification, not the reference

Every assertion a validator makes traces to a statement in the case's rendered
specs, exactly or through an honest tolerance. The reference implementation is
one conformant build and **never** the source of an assertion. Behavior the
reference exhibits but the specs leave unstated is a design choice, and a
validator that asserts it fails other builds that satisfy every stated
requirement.

A spec can leave a choice to the build: how state maps onto an engine's
constructs, when within a frame an effect becomes visible, whether a value is
stored or derived. A validator passes every design that honors the stated
behavior, probing at the point the spec fixes it, such as reading a pose's
arrangement after an advanced frame rather than the intermediate state of one
design.

A validator that needs behavior the specs leave unstated calls for a spec
change first. Decide whether the behavior is a requirement. If it is, state it
in the specs, designed around the behavior rather than around an engine or the
reference's architecture, and assert the now-stated behavior. If it is not,
the validator has nothing to assert.

### A validator grades the build's code, not the engine's

An engine ships behavior every build on it gets for free, and a check on that
behavior returns the same verdict for every build. The debug overlay is the
standing example. The engine owns the backtick key, the panel, its start state,
and the fact that reading it changes nothing; a build owns only the sources it
registers into the engine's diagnostics registry. Pressing backtick under an
engine and looking for a panel decides whether the engine works.

An item whose behavior is the build's own work under one engine and the engine's
under another names the engines it covers, through the
[`engines`](/testing/end-to-end/manifests/#the-categories-grammar-format--2) key
on its `validation` table. The overlay's visibility, its toggle key, its start
state, and its read-only-ness are `engines = ["none"]`, where the build writes
the overlay itself. The sources a build registers are every engine's, because
the build registers them under every engine.

An item left with no engine to decide it goes, and its validators go with it.

### A figure the specs do not state is not a threshold

A validator compares against a figure the specs require and against nothing
else, plus an honest tolerance on the rule that figure belongs to. A threshold
read off the reference, measured once and written down, or chosen because it
looked reasonable, grades a build against a requirement it was never given: a
build is free to sit anywhere the specs allow, so it clears every stated
requirement and fails the check anyway.

A check that wants such a figure has two honest ends. The case's specs gain the
requirement, exactly or as an explicit bound, and the project's `constants.ts`
transcribes it. Otherwise the check has nothing to assert and is deleted.

### Validators own the figures they assert

Every figure a validator compares against is stated by the validator. Each
engine's validator project carries a `constants.ts` at its root that transcribes
those figures from the rendered specs under the names the specs use, and a suite
imports each figure it asserts from there: `./constants` from the project root,
`../constants` from a suite one directory down.

Under an engine the case seeds the build a `src/constants.ts`, so a suite can
reach the build's own copy of the same figures. A suite that reaches it grades
nothing. The comparison becomes "does the build do what the build says it does",
which holds for every build, including one whose figure is wrong.

Meltdown's `surge/walks-at-its-speed` is the pair that shows it. The suite in
each project computes the same expression:

```ts
const expected = SURGE_DEFS[type].speed * WINDOW_SECONDS;
```

The `none` project imports `SURGE_DEFS` from `../constants`, which spells out
`mote: { speed: 60 }` from `specs/surge.md`. An engine project that imports it
from `../../src/constants` reads the build's own table instead. A build that
walks Motes at 66 fails the first suite and passes the second, because its table
says 66 too. A run selects one engine, so that build buys itself a clean sheet on
whichever engine it draws.

### The build's module has one import site

A specification leaves some values to the build: which touch layout it
registers, which key it binds an action to where the specs name none, where it
places a decoration the specs require only to exist. A validator reads such a
value to drive the build or to locate what the build drew, and grades nothing by
it.

`constants.ts` is the file that reads them. It re-exports each value under a
heading saying why that value is the build's to choose, and the suites, the
harness and the surface all import from `constants.ts`. One import site per
project is what makes the rule mechanical.

```ts
// validation/simple-2d/constants.ts

/** The paddle's travel speed, in units per second (specs/paddles.md). */
export const PADDLE_SPEED = 720;

/* ---- What the specification leaves to the build ------------------------- */
//
// Read to drive the build, never compared against. `specs/controls.md` requires
// a touch layout carrying the four movement actions and names no layout, so
// which one the build registers is the build's own choice and the harness has
// to ask for it.

export { LAYOUT } from "../src/constants";
```

Each engine's project holds its own copy of `constants.ts`. A run stages one
project, copying `validation/<engine>/` whole into the produced tree at
`validation/`, so a module the projects shared from outside them is absent when
the suites run. That is why a project resolves everything it needs from inside
itself and from the build beside it.

### What a project may reach for

A project makes three kinds of reference to the build, and no others:

| File           | May take                                             |
| -------------- | ---------------------------------------------------- |
| `constants.ts` | named bindings from any module of the build          |
| `harness.ts`   | named bindings from the build's entry, `../src/game` |
| any file       | a type-only clause from any module of the build      |

A type is erased before anything runs, so `import type { State } from
"../src/game"` carries no figure and any suite may take one.

The form matters as much as the module. `export { LAYOUT } from
"../src/constants"` is a boundary a reader can count; `export * from
"../src/constants"` names the same module and hands every suite in the project
the build's whole figure table. So `constants.ts` takes what it takes BY NAME,
one binding at a time, and a namespace binding, a default binding, a bare
side-effect import, `import()` and `require()` are all the same reach in a shape
review cannot read at a glance.

Configuration reopens the route without a suite naming it: a `paths` alias in the
project's `tsconfig.json`, a `file:` dependency in its `package.json`, and a
`resolve.alias` in its `vitest.config.ts` each redirect an import that reads
correctly in the source. A project resolves everything from inside itself and
from the build beside it, so it carries none of them.

The names a project takes from the build are worth reading as a list, and worth
keeping short: a list that grows is the signal that a case is drifting back
toward grading the build against itself.

### The engineless project builds on the shared harness

An engine's validator project constructs the engine in process, as that engine's
own validator pages describe. An engineless project reaches the build through a
browser, and every case that supports the `none` engine reaches it the same way:
serve the built site, hold one Chromium, drive the build a frame at a time
through the debug API the case's instrumentation spec required, and read what it
drew.

That machinery is the `@clockwyrks/case-harness` package, staged beside the
project at `validation/case-harness/`, so a `./case-harness/...` import resolves
in the checkout and in a run alike. The runner stages it rather than the manifest
naming it, which keeps the suites out of the run repository the model works in.

The project's `harness.ts` calls `createCaseHarness` with what is genuinely the
case's: its handle, the operations its specification requires, its snapshot and
debug-surface types, its stage size, and its tick rate. The factory returns the
harness, the replay and still writers, and the audio-cue reader, which the file
re-exports under the case's own names. `assert.ts`, `setup.ts`, `globalSetup.ts`,
and `vitest.config.ts` are thin files over the same package, and the case's
compound sequences sit beside them.

### A project holds only the suites the checklist names

Every `.test.ts` in a validator project is a validator a review item names. The
checklist's script paths are the file filters vitest is handed, so the project's
suites and the checklist's points are one list, and a suite standing outside that
list is loaded by no run and decides nothing.

The shared harness's own tests live with the harness, in the
`@clockwyrks/case-harness` package as `test/*.spec.ts` files, where that
package's suite drives them against a fixture site laid out the way a staged
validator project is.

### One requirement per validator

A validator decides one requirement in one direction. A build with a working
down control and a broken up control must grade differently from a build with
both broken, so the up control and the down control are two validators. The
same applies to each player's controls, each wall, each screen transition, and
each scoring side.

Validator counts are high by design. The count is what lets a grade say which
requirement failed rather than which area failed.

### Each edge case is its own validator

An edge case is a requirement, so it has a validator of its own. Several values
that exercise the same edge case share one validator when they exercise it the
same way, such as `2` and `-2` both hitting a symmetric bound. Distinct edge
cases are distinct validators, so a failed grade names the edge case a build
mishandled.

### Validators reach their target directly

A validator drives the game to its scenario through the debug API and touches
nothing outside the requirement it decides. A validator for paddle speed opens
the match through the harness's `startMatch` and never presses a menu key,
because a build with a broken menu and a correct paddle must fail the menu
validators and pass the paddle validators.

Passing through unrelated surface on the way to a scenario adds failure modes
that belong to other validators. Any reasoning that a longer route makes a
validator stronger is mistaken: the route makes the grade less precise.

### Validators pose an isolated world

A validator poses a world holding only what its requirement concerns. Every
other entity is removed before the scenario is staged, rather than parked in a
harmless corner, frozen, or held in a state that keeps it quiet. Containment
leans on the game's own rules holding, and a broken build is broken in exactly
those rules, so an entity that escapes its containment makes a bystander
validator report a defect belonging to another validator.

The debug API carries the operations that make this possible: one that removes
the entities a case's world holds, and one that places each kind. A validator
clears the world and spawns back exactly what its requirement is about, so a
check on one predator's pursuit runs against one predator, and a check on the
player's movement runs against the player alone.

A case whose world holds entities a validator must exclude owes those removal
operations, as a requirement on the debug API rather than a convenience. The
specification enumerates each by name, signature, and effect like every other
control operation, and the
[precondition guardrail](/testing/end-to-end/instrumentation/#the-precondition-guardrail)
applies to them unchanged.

Isolation reaches inside the entity the requirement is about. That entity is
posed with only the faculties the requirement exercises, so a check on what a
creature senses gives it its senses and holds its body still, and a check on how
it travels gives it both. A switch that turns a whole creature off cannot express
the first, so each faculty a scenario has to hold is its own operation.

### A pose stays inside the bounds the specs set

A validator arranges a world normal play never reaches, and that is the point: a
field holding one ball and one obstacle, a score at match point, a timer one
frame from expiring. The arrangement is the validator's to choose. Each entity's
own state is the specification's, and a validator poses every property inside
the range the specs allow it.

A build is written against the stated bounds, so an entity posed outside them
exercises behavior no requirement describes. A ball driven above the case's speed
cap, a paddle placed off the field, or a timer set negative fails builds that
satisfy every stated requirement, which is the flaw
[a validator asserting the specification](#validators-assert-the-specification-not-the-reference)
exists to avoid.

A no-tunnelling check therefore fires the ball at the case's speed ceiling rather
than past it. What it varies instead is the host: the frame lengths a real
machine delivers are the case's to state and the validator's to drive, because
the frame is the world's, not the ball's.

### Validators pose what the game would draw

A validator whose requirement touches a random draw poses the outcome through
the [operation the API carries for it](#random-draws-are-posed-as-outcomes),
closes the gate on any automatic draw that would run over it, runs the real
systems, and reads the result. It seeds nothing, reads no generator state,
counts no draws, never compares two runs for sameness, and never searches for
the input that produces an outcome. Each of those grades how a build draws,
which the specs leave to the build.

A figure the simulation integrates is compared within the tolerance the spec's
precision allows, such as within `0.1` of the expected value or a named
tolerance in the project's `constants.ts`, wherever floating point could put two
correct builds a rounding apart. Exact equality is for figures the specs state
exactly: a count, a phase, a dealt card. A validator finishes in seconds, so
drift over a longer run is never what it measures.

A requirement that is itself a probability, such as a destroyed derelict
shedding a pod with probability `0.25`, may be decided by a bounded sample. The
debug API carries an operation that performs that one draw alone and nothing
else, the validator calls it enough times to finish in seconds, and the
acceptance band is at least six standard deviations wide, so a build honoring
the stated probability never fails on chance. Wherever the probability is not
what the item grades, the item is restated as a posed outcome instead, and the
sample stays unused.

### Every produced file loads

The produced files are a requirement of the build rather than a condition a
validator varies. A case's specs require the built site to be self-contained and
to serve every file it draws and plays, so a validator runs against a build whose
files are all present, and a load that fails is the defect it looks like.

A harness stands the produced files up for every check it runs. It offers no
switch that leaves them out, and a project carries no route interception, no
refused request, and no withheld path. A check about the simulation costs nothing
by having the real files, and a check about a produced asset is only meaningful
with them.

Where a check needs to know which file the build asked for, it reads the request
the build made and lets that request succeed.

### A check reads state before it reads pixels

A validator decides its requirement from the strongest reading it has: the
game's own state through the debug surface, the events the engine broadcast, and
the drawing operations the build submitted. Each of those says what the build
did. Pixels say what one frame happened to look like, which anti-aliasing, the
resolved font, and the device pixel ratio all move.

A pixel read answers one question: whether the build drew something where the
requirement says something is drawn. Presence is the whole of it, and a sample
is taken well inside the region rather than near an edge. Palettes, contrast
between two shapes, the extent of a drawn region, and where inside a region a
mark landed are appearance, which
[the reviewer judges](/guides/authoring/writing-case-specifications/#appearance-is-loose-and-reviewed),
and a suite measuring any of them fails builds that met every stated
requirement.

Under an engine the scene and the draw calls answer presence exactly, so they are
the reading and pixels are the last resort. Under `none` a validator holds a page
rather than an engine, so a sample is more often the only reading presence has.

Deciding presence takes an instrument, and an instrument carries a floor: the
sampled region differs from the ground the build cleared to, the region holds more
than one value, a produced sound rises above digital silence. Such a floor is set
where any drawing at all clears it, and it stays a presence reading. A floor tuned
so that some drawings pass and others fail is a threshold, and it needs a figure
the specs state.

Which of the two a figure is follows from the direction it is compared in. A
figure a reading must EXCEED is a floor, and raising it makes the check stricter,
so a build that drew what the spec asks for in a colour near its ground fails. A
floor therefore sits at the level below which a sampling cannot tell a drawing from
the rounding of eight-bit channels and the host's antialiasing, which is around
eight of the four hundred and forty-one the RGB cube spans. A figure a reading must
stay UNDER is a tolerance on a claim that two readings are the same reading, and
raising it only makes the check more lenient, so it cannot fail a conformant build
and it is set wherever the claim stays honest.

A check whose claim is that nothing was drawn takes its bound from a measurement
rather than a figure: sample the same region over several idle frames and compare
against the spread those frames show. A number chosen for that bound is a threshold
wearing a floor's clothes.

### Under `none`, nothing is on the canvas until a frame is driven

An engineless harness hands over a page whose build has installed its debug
surface. It has not necessarily drawn anything yet: the build owns its own frame
loop, and whether that loop has run a frame by the time the harness returns
depends on how the host was scheduled that second. A build that sizes its canvas
as part of drawing — which is what a runtime that owns the fit does — therefore
leaves the element at the `300 x 150` an HTML canvas carries until its first
frame lands.

So a check drives a frame before it reads anything the drawing produced. That
covers `surface()`, which reads the backing store the build sized, and every
pixel read, which addresses that backing store. A check that reads either before
driving a frame reads whatever the page happened to have reached, and passes or
fails on the load average rather than on the build. It is one of the two shapes a
[flaky validator](/guides/authoring/writing-case-specifications/#behavior-is-exact-and-validated)
takes here, and the fix is to drive the frame the reading is about first.

The other shape is a build still decoding its produced files. A case whose
[instrumentation spec](/guides/authoring/writing-case-specifications/#keeping-evaluation-out-of-the-seeded-set)
lets the surface go up before those files have settled has a window in which a
driven frame draws the build's fallback instead of its art, and every check that
reads the picture is a coin flip inside it. The spec closes the window rather
than the suite working around it: the surface goes up once the game has
initialized, and a game that must have every asset decoded before its first frame
draws has not initialized until they are.

### A replay covers the behavior it backs

A `replay` output brackets the stretch of the scenario its check is about. The
recorder is armed once the world is posed and disarmed once the behavior has
played out, with a short run-up before and a short settle after, so a reviewer
sees the behavior arrive and sees what it left behind.

The bracket is what a reviewer watches, so it runs long enough for the behavior
to be recognizable and stops once it has happened. A written recording holds at
most three hundred frames, five seconds at a sixty-hertz tick, and a longer
section is decimated to fit, so a bracket that spends its length on a world at
rest hands the reviewer a thinned recording of the moment that mattered.

### A validator always reaches a verdict

Every validator ends at a pass or a fail. A validator that cannot pose the world
it needs, or whose debug API answers wrongly, fails the item it decides. A buggy
debug API and buggy game behavior are one failure from the grade's point of
view, because the debug API is a deliverable the case requires. The
instrumentation contract states the same rule from the platform's side, where a
build's broken instrumentation fails the points it hides (see
[The debug API is load-bearing](/testing/end-to-end/instrumentation/#the-debug-api-is-load-bearing)),
and this rule is that principle carried into how a validator is written.

The reason is what a run resolves to. A run carries a single score, and one
number cannot separate a point lost to a failure from a point that could not be
decided. An undecided point lowers no rating and falls to a person to settle by
hand, which is the expense the automation exists to remove.

The platform holds one class of failure apart, and a validator reporting an
[unmet precondition](/testing/end-to-end/instrumentation/#unmet-preconditions)
leaves its point undecided. That path serves a validator that has to search the
build's own world for somewhere to stand, and a validator that poses its own
world searches for nothing, so a well-authored case leaves the path unused.

### Validators are unit tests

A validator establishes a precondition, runs the real systems for a bounded
span, and reads one result. This is the shape of nearly every validator in a
case.

A case adds integration validators only when the game can be driven end to end
programmatically without the validator implementing a player. A puzzle game
qualifies: a validator loads a configuration with a known solution, replays the
solving inputs, and checks the outcome. A game that needs an opponent or a
reactive player to reach its later states, such as a paddle game, has unit
validators only, because a validator-side AI would grade the AI as much as the
build.

### Each validator finishes in seconds

Most validators run in one to three seconds, and a validator stays under five.
Ten seconds is the hard cap for every validator other than an integration
validator, and a validator that reaches the cap is redesigned to a cheaper shape.

The budget follows from where validators run. Production grades every run with
them, a case ships hundreds, and each one is paid again on every run of every
case, so a validator that takes minutes is a defect in the check whatever verdict
it reaches.

Frames are what a validator spends, so it poses the state its requirement needs
and reads the result. A scenario that sits minutes of play away is posed through
the debug API rather than simulated toward, a requirement behind a timer sets the
timer and advances past it, and a requirement about a random draw poses the
outcome it is about through the debug API. An integration validator is the one
shape that replays a game end to end, and it carries that cost because the replay
is the requirement.

Reaching for a longer allowance is the wrong direction. A ceiling wide enough for
a slow validator is wide enough to turn how busy the host was into a lost point,
so the validator is made cheaper and the ceiling stays where it is.

### The suite finishes inside its budget

A run is validated on a two-core host, and the runner caps a case's whole suite
run at forty-five minutes, stopping it and leaving every point it had not
reached undecided. A case is authored to finish in fifteen minutes there,
measured by running the suites against the reference implementation, which
leaves the margin a loaded host needs.

A project's suites run across eight workers sharing one browser, so the wall
clock follows the longest file rather than the sum. A single validator inside its
own budget is what keeps that longest file short.

### Failure caps

Every validated review item declares the
[`failure_cap`](/testing/end-to-end/manifests/#the-categories-grammar-format--2)
its domains are held to while the item fails. The cap expresses what the miss
costs a player.

| Cap        | Use when the validator failing                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| `broken`   | Makes it impossible to play the game as intended.                                                       |
| `scuffed`  | Makes the game unplayable along an optional path the player can avoid, or makes normal play unpleasant. |
| `passable` | Affects gameplay without making the game unplayable or dramatically changing how it plays.              |
| `great`    | Leaves the standard flow of gameplay unaffected.                                                        |

`flawless` is never a cap. A validator only fails on a deviation from the
specification, and a deviation always costs something.

## Checklist

When designing or revising a case's debug API and validators:

- Every debug API operation sets one field, reads the state, or moves the
  clock, and takes scalar arguments.
- No operation takes a partial object or arranges several fields at once.
- The shared harness owns every compound sequence, built from atomic
  operations.
- `snapshot()` reports every field an operation can set.
- A layout a spec leaves to the build, such as a menu item's hit region, is
  reported by a read the validators drive.
- Each assertion traces to a statement in the specs, not to the reference
  implementation, and every spec-honoring design passes.
- Every threshold a check compares against is a figure the specs state, and a
  check wanting one they do not state is deleted or its figure is specified.
- Every random draw a validator touches has an operation posing its outcome,
  and a gate stops any draw the game would make on its own while a scenario is
  posed.
- No operation seeds, skips, or counts draws, and neither the declared state
  nor `snapshot()` carries generator state.
- No validator seeds, reads generator state, counts draws, compares two runs
  for sameness, or searches for the input that produces an outcome.
- A figure the simulation integrates is compared within a stated tolerance, and
  a requirement that is itself a probability is sampled through an operation
  performing that one draw, inside a band at least six standard deviations
  wide.
- No item decides behavior the engine owns, and an item that is the build's work
  under one engine alone carries `engines` naming it.
- Every figure a suite asserts comes from the project's own `constants.ts`,
  transcribed from the specs.
- An engineless project is built on the shared `@clockwyrks/case-harness`
  package, with only what is genuinely the case's held beside it.
- Every `.test.ts` the project holds is a validator a review item names.
- `constants.ts` re-exports only what the specs leave to the build, `harness.ts`
  takes only the build's entry, and every other reference the project makes
  resolves inside the project.
- Each validator decides one requirement in one direction, and each edge case
  has its own validator.
- Each validator reaches its scenario through the debug API alone and drives
  nothing outside its requirement.
- Each validator poses a world holding only what its requirement concerns, and
  the debug API carries the operations that remove the rest and gate the
  faculties its requirement does not exercise.
- An engineless check drives a frame before it reads the canvas the build sized
  or any pixel of it, and the case's instrumentation spec puts the debug surface
  up only once the build's produced files have settled.
- Every validator reaches a pass or a fail, and a debug API that cannot be
  driven fails the item rather than leaving it undecided.
- Each check reads state, events, or draw calls where they answer its claim, and
  reads pixels only to decide whether something was drawn.
- Each entity a scenario poses is inside the range the specs allow it, with the
  arrangement alone reaching states normal play does not.
- Every check runs with the produced files present, and no project withholds,
  refuses, or intercepts a load.
- Each replay brackets the behavior its check backs, with a short run-up and a
  short settle around it.
- Most validators finish in one to three seconds, each stays under five, and
  every validator other than an integration validator is under ten.
- The whole suite finishes in fifteen minutes on a two-core host.
- Integration validators exist only where the game replays to a known outcome
  without a validator-side player.
- Each validated item's failure cap follows the table above.
