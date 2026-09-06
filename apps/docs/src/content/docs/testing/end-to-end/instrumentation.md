---
title: Instrumentation
---

A test case is deliberately complex, which makes a finished run expensive to
review. A person playing the build has to reach every state the specification
calls out, including the uncommon ones a design deliberately asks for, and judge
by eye whether each behaves to spec. Reproducing a rare state by hand is slow and
error-prone, and it scales poorly across a large catalog. A specific score, a
ball struck at one exact angle, or a system pushed to an edge each costs a
reviewer minutes of fiddling before the check can begin.

Instrumentation is how a case makes itself checkable. It is the set of
inspection-and-control systems a case requires the build to implement so a run
can be driven and read programmatically: a debug API that puts the game into a
precise state and reports the state it is in, a render-free core that lets a
driver step the game without a canvas or a clock, a read-only debug overlay for
a human reviewer, and, where a game's state is rich enough to warrant it, a
save/load format. Together they let
The Test Cabinet construct the exact scenarios a review needs, capture the
evidence, and decide the verdict for a large class of requirements.

This page defines the systems a case should mandate and how to mandate them. For
the schema they are declared in see
[Manifests](/testing/end-to-end/manifests/); for how a scored run combines
automated and human signals see
[Evaluation](/testing/end-to-end/evaluation/).

## Scope

This contract governs a run with no [engine](/components/core/engines/) selected,
which is every case's baseline. The build supplies the whole instrumentation
surface, so the reliability rules below apply in full.

An engine supplies the same control and inspection as engine code. A run under
an engine is driven by a [validator](/components/core/validation/) that
constructs the engine itself and holds the build's state, events, and drawing
context as live values. The build still writes the whole debug surface the
case's instrumentation spec states; the engine is only the route by which a
check reaches it.

The global handle below belongs to the engineless run alone. Under an engine the
build's `initialize` returns its
[debug surface](/components/core/engines/) beside its state, the engine hands
that value back off its handle, and a check reads the scenario operations from
there, so the page the build draws on carries no handle.

## The reliability principle

Instrumentation is code the model under test writes, and anything the model
writes is unreliable by construction. The rule for leaning on it is therefore
strict: a validation mechanism must either depend on no model-implemented work
at all, or be built so that the model's unreliability is itself indicative of a
failure. A mechanism that quietly produces a wrong answer when the model gets it
wrong manufactures false confidence.

Instrumentation is allowed to lean on model-written code because it is designed
to land in the second category, three ways.

- A missing or non-conformant debug API fails the points it hides. The API is a
  hard, required deliverable, like the build interface itself. Every check a
  build's broken instrumentation prevents from running fails that check's
  checklist point automatically (see
  [The debug API is load-bearing](#the-debug-api-is-load-bearing)), which for a
  case built around automated validation is most of the score. A model that
  cannot implement the contract has not met the spec, and its inability to do so
  is the signal.
- Control establishes preconditions; the real systems produce the outcome. The
  debug API sets up a starting state, the real simulation runs forward from it,
  and the outcome is read back from an independent observation: a state
  snapshot, or the pixels the game rendered. See
  [The precondition guardrail](#the-precondition-guardrail).
- Contradiction is detectable. Because the API both sets state and reports
  state, and outcomes are observed independently of the way they were set up, a
  build whose systems disagree with each other surfaces that disagreement
  automatically. A model unreliable in a mechanic tends to be unreliable in
  reporting it, and the mismatch is the failure.

Instrumentation decides the checklist, which is the part of a review that is
expensive to verify by hand, and through each item's failure cap the run's
functional rating. The run-wide aesthetic rating stays with the reviewer (see
[Human judgement](#human-judgement)).

## The debug API

The centerpiece is a debug API: an object the build installs on a global handle
that lets a caller drive the game and inspect its state without touching the
keyboard or waiting on real time.

### The handle

The build installs the API on a case-specific global that the case's
specification names, for example `window.__carom`. The name is pinned by the
case and is the game's own: it must read as an ordinary debugging and automation
affordance of that game, the kind many games ship. A seeded specification
presents the game alone, so the handle must be named after the game rather than
after The Test Cabinet, testing, or validation. Each case declaring its own
handle costs nothing, because the driver that consumes it is authored per case
anyway.

### Core operations

Every case's debug API exposes the same three core operations, so a driver's
lifecycle is uniform across the catalog.

- `reset(options?)` returns the build to a known initial state. A case states
  any options its reset takes.
- `step(amount)` advances the simulation by exactly `amount`, running the
  build's fixed timestep internally rather than waiting on real time. The case
  pins the unit: seconds of simulation time, or whole simulation ticks. A case
  that steps in ticks declares its rate as `tick_hz` in the manifest, which is
  what lets the validation runtime relate stepped ticks back to real time. This
  is what lets a driver run the real systems forward from a precondition and
  observe where they land without waiting on real time.
- `snapshot()` returns a JSON-serializable object describing the full observable
  game state: the current screen or phase, scores, the position, velocity, and
  per-entity state of every live object, and whatever else a check asserts on.
  It is the same ground truth the [debug overlay](#the-debug-overlay) shows a
  human, and it is a pure read.

A case whose review items declare validation scripts exposes one more, because the
runtime driving those scripts holds the clock to decide a verdict and hands it back
to record the media at the speed the game runs.

- `setAutoStep(auto)` chooses which clock drives the game. `setAutoStep(false)`
  holds the simulation still, so `step()` is the only thing that advances it, and
  `setAutoStep(true)` returns the game to its own frame loop. It changes no game
  state.

### Control operations

Beyond the core, a case declares its own control operations: the verbs that set
up the scenarios its review items need. These are case-specific, and the
specification must enumerate each by name, signature, and effect, precisely
enough that a driver can call it blind. Each control operation is atomic: it
sets one field of the declared state, and takes scalar arguments. Typical
shapes:

- Select a screen or mode, such as `setScreen("countdown")` or
  `setMode("versus")`.
- Set a precondition value, such as putting the score at `10–10`, giving the
  player a resource level, or placing an entity at a coordinate.
- Trigger a real event such as a serve, a shot, or a turn advancing, routed
  through the same code path normal play uses.

A control operation is a setup verb. It arranges one thing in the world;
`step()` runs the real systems; `snapshot()` or a screenshot reads the result.
Sequences of operations, such as opening a match in a given mode, are composed
by the case's validators. The design rules for both sides are in
[Writing Debug APIs and Validators](/guides/authoring/writing-debug-apis-and-validators/).

### The precondition guardrail

The single rule that keeps the debug API honest: control operations may only
establish preconditions and fast-forward setup. They must route through the real
systems, mutating the same state normal gameplay mutates, so that stepping
forward exercises the genuine code path. What a driver observes must come from
the real simulation, read back through a channel independent of the one that set
it up.

To check that reaching the score cap with a two-point lead ends the match, a
driver may set the score to `10–8` as a precondition, drive a real point across
the goal through the real scoring path, and read back that the match ended with
the right winner. A `declareWinner()` that jumps straight to the match-over
screen would prove only that the debug API can draw a screen. When designing a
case's control operations, keep each one on the precondition side of this line:
an operation that would directly assert the thing a review item checks is the
wrong operation.

### The debug API is load-bearing

A build that does not install the declared handle, is missing a required core or
control operation, or whose API throws or returns malformed data when exercised,
is recorded as failing the debug-API contract. Each script that could not be
driven fails the checklist point it backs: a failed verdict is synthesized for
that point and pre-filled into the review exactly as a passing auto verdict is,
marked machine-set and overridable by the reviewer.

A broken debug API leaves the run in review. It costs the run precisely the
points its checks could not answer, which is usually most of them, so the penalty
lands on the score rather than on the run's classification. The reviewer sees
which scripts failed and why, and can override any verdict where the build
clearly does the right thing despite the missing instrumentation.

This is why the contract must be small and mechanical: a complete build should
satisfy it almost incidentally, so that failing it is a real signal rather than
a tax on good implementations.

### Unmet preconditions

One class of script failure is held apart. A validation script's arrange step
often has to find somewhere in the model's own world to pose its scenario, such
as a blind corner in an invented maze or a legal tile to build on. That search
can come up empty against a build that answered every debug-API call perfectly.
There was simply no such spot. Failing the point for that would punish the model
for the shape of the world it invented rather than for the contract it was asked
to expose.

So a helper that cannot pose its scenario throws an error carrying the
`ttcPreconditionUnmet` marker (see `PRECONDITION_UNMET` in
`packages/browser-driver/validation.mjs`, and `unmetPrecondition()` in a case's
`validation/_helpers.mjs`). The driver records such a script as inconclusive: it
did not run, no failed verdict is synthesized for it, and the point is left for
the reviewer to judge by hand. An unmarked throw keeps its original meaning, so
the API misbehaved and the point fails. A bug in the script itself, such as a
bad argument or an impossible tick count, is a plain `throw` and stays loud.

The marker is a platform capability rather than an authoring practice. A case
whose debug API lets a validator remove the world's entities and place the ones
it asserts on gives every validator a world it poses rather than searches, so
the search never comes up empty and the marker stays unused. Authoring toward
that is the rule in
[Writing Debug APIs and Validators](/guides/authoring/writing-debug-apis-and-validators/):
a validator always reaches a verdict.

## A render-free core

The debug API can step a game only if the game's state advances apart from its
drawing, so a case that mandates instrumentation also requires a render-free,
fixed-timestep core.

- The simulation advances on a fixed timestep decoupled from rendering. Game
  state advances from the elapsed simulation time it is handed, so a step means
  the same thing whatever the frame rate.
- The simulation is render-free at its core: game state advances with no canvas
  and no wall clock, so a driver can step it headlessly.

The spec stops there. It says nothing about seeds, generators, or replaying a
session identically, because such a rule constrains a build's internals without
naming a behavior a validator can read. A build may keep any private random
source it likes, and the case never speaks of it.

## Posed randomness

Where the game draws at random, the spec states the draw as behavior: the set
it is uniform over, the probability it carries, and when it is drawn. The spec
names no generator, gives the game's declared state and snapshot no generator
state, and offers no operation that seeds, skips, or counts draws.

For every random draw a validator's requirement touches, the debug API carries
an operation that sets the outcome the draw decides: spawn this enemy type at
this position, deal this exact board, land the next critical hit, release the
next unit from this vent. Where the game would otherwise keep drawing on its
own, the API also carries a gate that stops the automatic draw while a scenario
is posed, such as a spawn gate a validator switches off before it spawns by
hand. Each is an ordinary control operation: atomic, one field, scalar
arguments, enumerated in the spec by name, signature, and effect, and graded
under the case's instrumentation items like the rest.

A posed outcome sits on the precondition side of the
[guardrail](#the-precondition-guardrail). The operation decides what the draw
would have decided; the systems that follow from it run for real, and the
validator reads where they land. A validator seeds nothing, reads no generator
state, counts no draws, and compares no two runs for sameness. The design rules
for both sides are in
[Writing Debug APIs and Validators](/guides/authoring/writing-debug-apis-and-validators/#random-draws-are-posed-as-outcomes).

## The debug overlay

The debug API serves the machine; the debug overlay serves the human reviewer.
It is a read-only, toggleable on-screen display of the same internal state
`snapshot()` exposes: scores and phase, the live objects' positions and
velocities, and the values of whatever systems the game runs. It is drawn over
the running game and toggled with a documented key, off by default, and leaves
gameplay untouched.

Its value is the uncommon-behavior problem. A reviewer verifying that a rare
mechanic fires correctly usually struggles to reproduce the trigger; the overlay
lets them watch the internal variable that gates it while playing normally, so
it exposes ground truth the rendered game only implies. A model buggy in a
system may also mis-report that system in the overlay, so the overlay is an aid
to a reviewer's judgement rather than proof on its own. It is cheap to require,
safe, and the single highest value-per-effort instrument for a person.

## Cheats and setup affordances

The control operations the debug API exposes can also be surfaced to a human
through a small debug panel or a set of debug keybinds, as cheats:
invincibility, infinite resources, jump-to-state, spawn-an-entity, and the like.
This is optional and exists to help a reviewer explore a build, setting up a
situation quickly and then playing it. It carries the same guardrail as the API
it sits on: a cheat may set up state and must route through the real systems. A
reviewer treats what they see through a cheat as something to explore rather
than as evidence, because a mutation can bypass the code path a check cares
about. An "infinite money" toggle that writes a counter may skip the earning
path entirely. Mandate cheats only where they meaningfully speed a reviewer up;
the debug API and overlay are the parts that carry weight.

## Save/load

Where a game accumulates rich, persistent state such as a built-up base, a deep
progression, or a large board, a case may additionally or instead mandate a
documented, versioned save/load format, so the build can export its full state
to a blob and import one back. A hand-authored save is then an arbitrary
precondition loaded through the game's real load path, which is often lower
friction than a long script of control operations.

Save/load is not universal, and a case should reach for it only when the state a
review needs is expensive to construct step by step and cheap to describe as
data. For a small, fully driveable game such as Carom, the debug API's control
operations reach every state that matters directly. When a case does mandate a
save format, the format must be specified so a save can be authored by hand,
versioned, and loaded through the same path a player's save uses.

## Use in validation

For the objective, mechanically verifiable portion of a review, The Test Cabinet
drives the build itself: `reset()` to a known start, the case's control
operations to establish a review item's precondition, `step()` to run the real
systems forward, and `snapshot()` and the rendered canvas to read the result.
From that it both synthesizes the item's proof media and, where the outcome is
an unambiguous fact, sets the item's verdict.

A case marks a whole review item, or an individual sub-item, as an
[automatically validated](/testing/end-to-end/manifests/#automated-validation)
verdict unit by pointing it at a debug script that drives the declared handle.
Per run, validation drives that script — or, under an
[engine](/components/core/engines/), runs the case's validator suite — against
the model's build to decide it and synthesize its actual media. The baseline
half of the side-by-side is the same thing run against the case's reference
implementation for that engine, a fixed property of the case version, so it is
synthesized once by
[`tcab capture-baselines`](/components/cli/overview/#commands) and committed
under the version folder at `validation-baseline/<engine>/<variant>/`. Run that
command whenever you add or change a script or a validator suite, or change the
reference implementation it runs against; it needs only the case's toolchain,
and a browser for a case decided by browser scripts.

Even for an item left to human judgement, the same instrumentation earns its
place: the debug overlay gives a reviewer a read-only window into ground truth,
and the debug API gives the model a way to verify its own build.

## Human judgement

Instrumentation decides every checklist item, and with it the functional
rating, and leaves the subjective judgement alone. Whether the art direction is
coherent, whether the motion and audio feel right, and whether the game is
enjoyable remain a human judgement: together they are the run-wide
[aesthetic rating](/testing/end-to-end/evaluation/#rating-channels) on the
legendary-to-slop scale, and the review a person writes is what frames a
published run. Behavior is decided by the case's validators; a reviewer may
override a verdict, and doing so is the exception, for an unmet precondition or
a build that clearly does the right thing despite broken instrumentation.
Instrumentation also cannot catch a bug living in a subsystem
that both the debug API and the observation route through. It moves the
reviewer's job from reconstructing rare states by hand to auditing the scenarios
that got flagged and judging how the whole thing plays.

## Authoring guidelines

When adding instrumentation to a case's specification:

- Keep the seeded spec clean. Present the debug API and overlay as ordinary
  debugging and automation features of the game, useful for the model's own
  testing. Name the handle after the game, and keep grading, review, and The
  Test Cabinet itself out of the seeded text (see
  [Self-contained specifications](/testing/end-to-end/overview/#self-contained-specifications)).
- Pin the handle and the core operations exactly. Name the case-specific global
  and specify `reset`, `step`, and `snapshot`, including the exact shape of the
  `snapshot()` object and the unit `step` takes, so the contract is unambiguous.
- Enumerate the control operations the case needs, each by name, signature, and
  effect, and keep every one on the precondition side of the
  [guardrail](#the-precondition-guardrail). A well-designed operation sets one
  value rather than announcing an outcome; see
  [Writing Debug APIs and Validators](/guides/authoring/writing-debug-apis-and-validators/).
- Require the render-free, fixed-timestep core the API rests on in the same
  spec that covers the simulation.
- State each random draw as a distribution, and give the debug API an operation
  that poses the outcome of every draw a validator touches, with a gate wherever
  the game would keep drawing on its own.
- Require the read-only overlay, naming its toggle key and the state it must
  show. Mandate cheats and save/load only where they pull their weight.
- Keep the review checklist out of the run. The properties a driver asserts are
  reporter-side, like every [review item](/testing/end-to-end/manifests/). The
  spec states the observable requirements and mandates the instrument.
