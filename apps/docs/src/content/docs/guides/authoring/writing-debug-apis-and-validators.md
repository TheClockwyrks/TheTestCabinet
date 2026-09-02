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

### Operations stay on the precondition side

Atomic operations are setup verbs, and the
[precondition guardrail](/testing/end-to-end/instrumentation/#the-precondition-guardrail)
applies to each one. Setting the score to `10–8` is a precondition; an
operation that ends the match is an outcome, and the outcome is what the
validator observes after the real systems run.

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

`scripts/ci/validator-constants.sh` reads every reference a project makes and
allows three, over the whole project:

| File           | May take                                             |
| -------------- | ---------------------------------------------------- |
| `constants.ts` | named bindings from any module of the build          |
| `harness.ts`   | named bindings from the build's entry, `../src/game` |
| any file       | a type-only clause from any module of the build      |

A type is erased before anything runs, so `import type { State } from
"../src/game"` carries no figure and any suite may take one.

The gate parses the clause rather than matching the specifier, so the form
matters as much as the module. `export { LAYOUT } from "../src/constants"` is a
boundary a reader can count; `export * from "../src/constants"` names the same
module and hands every suite in the project the build's whole figure table, so
the gate refuses it, along with namespace and default bindings, bare side-effect
imports, `import()` and `require()`.

It refuses any reference that leaves the project for somewhere other than the
build, and any `paths` alias or `file:` dependency in the project's
`tsconfig.json` or `package.json` that would reopen the same route. Anything it
cannot positively recognize is a finding.

A project holding a `constants.ts` has been converted, and the gate blocks on it.
A project without one is reported instead, which is how the conversion lands one
case at a time. Adding the `constants.ts` enrols the project.

The gate runs on every commit through pre-commit, on Azure, and on every GitHub
pull request. Run it by hand over a case at any time:

```sh
./scripts/ci/validator-constants.sh test-cases/end-to-end/easy/carom/v3.0.0
```

It prints every name each project takes from the build even when it passes. That
list is the thing to read when a case starts drifting back toward grading the
build against itself.

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
- Each assertion traces to a statement in the specs, not to the reference
  implementation, and every spec-honoring design passes.
- Every figure a suite asserts comes from the project's own `constants.ts`,
  transcribed from the specs.
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
- Every validator reaches a pass or a fail, and a debug API that cannot be
  driven fails the item rather than leaving it undecided.
- Integration validators exist only where the game replays to a known outcome
  without a validator-side player.
- Each validated item's failure cap follows the table above.
