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

| Cap        | Use when the validator failing                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `broken`   | Makes it impossible to play the game as intended.                                                                                     |
| `scuffed`  | Makes the game unplayable along an optional path the player can avoid, or makes normal play unpleasant.                               |
| `passable` | Affects gameplay without making the game unplayable or dramatically changing how it plays.                                            |
| `great`    | Leaves the standard flow of gameplay unaffected.                                                                                      |

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
- Each validator decides one requirement in one direction, and each edge case
  has its own validator.
- Each validator reaches its scenario through the debug API alone and drives
  nothing outside its requirement.
- Integration validators exist only where the game replays to a known outcome
  without a validator-side player.
- Each validated item's failure cap follows the table above.
