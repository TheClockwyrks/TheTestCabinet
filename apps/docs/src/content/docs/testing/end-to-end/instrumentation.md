---
title: Instrumentation
---

A test case is deliberately complex: the whole point is to see whether a model
can carry many overlapping systems to a coherent whole. That same complexity is
what makes a finished run **hard to review**. A person playing the build has to
reach every state the specification calls out — including the uncommon ones a
design deliberately asks for — and judge, by eye, whether each behaves to spec.
Reproducing a rare state by hand (a specific score, a ball struck at one exact
angle, a system pushed to an edge) is slow and error-prone, and it does not scale
across a large catalog.

**Instrumentation** is how a case makes itself checkable. It is the set of
inspection-and-control systems a case **requires the build to implement** so a
run can be driven and read programmatically: a **debug API** that can put the
game into a precise state and report the state it is in, a **deterministic core**
that makes that reproducible, a read-only **debug overlay** for a human reviewer,
and — where a game's state is rich enough to warrant it — a **save/load** format.
Together they let The Test Cabinet construct the exact scenarios a review needs,
capture the evidence, and, for a large class of requirements, decide the verdict
without a person reconstructing the scenario by hand.

This page defines the systems a case should add for automated validation and how
to add them. For the schema they are declared in see
[Manifests](/testing/end-to-end/manifests/); for how a scored run combines
automated and human signals see [Evaluation](/testing/end-to-end/evaluation/).

## The reliability principle

Instrumentation is code the **model under test** writes, and anything the model
writes is, by construction, unreliable. The Test Cabinet's design rule for
leaning on it is therefore strict: a validation mechanism must either **not
depend on model-implemented work at all**, or be built so that **the model's
unreliability is itself indicative of a failure**. A mechanism that quietly
produces a wrong answer when the model gets it wrong is worse than no mechanism —
it manufactures false confidence.

Instrumentation is allowed to lean on model-written code because it is designed
to land in the second category, three ways:

- **A missing or non-conformant debug API is an automatic failure.** The API is
  a **hard, required deliverable**, like the build interface itself. A build that
  does not expose it, or exposes it but does not conform to the contract the case
  declares, **fails outright, with no human review** (see
  [The debug API is a gate](#the-debug-api-is-a-gate)). A model that cannot
  implement the contract has not met the spec, and its inability to is the
  signal — not a gap a reviewer has to notice.
- **Control only establishes preconditions; the real systems produce the
  outcome.** The debug API is never allowed to *fabricate* the result a check is
  looking for. It sets up a starting state and then the **real simulation** runs
  forward from it; the outcome is read back from an **independent** observation
  (a state snapshot, or the pixels the game actually rendered). See
  [The precondition guardrail](#the-precondition-guardrail).
- **Contradiction is detectable.** Because the API can both *set* state and
  *report* state, and because outcomes are observed independently of the way they
  were set up, a build whose systems disagree with each other surfaces that
  disagreement automatically — the instrumentation doubles as a consistency
  check. A model that is unreliable in a mechanic tends to be unreliable in
  reporting it, and the mismatch is the failure.

What instrumentation deliberately does **not** try to do is replace human
judgement of the things automation cannot judge honestly — feel, art direction,
whether a game is actually good to play. Those remain the reviewer's call (see
[What it does not replace](#what-it-does-not-replace)). Instrumentation attacks
the *objective* half of a review — did the uncommon mechanic actually fire
correctly — which is exactly the half that is expensive to verify by hand.

## The debug API

The centerpiece is a **debug API**: an object the build installs on a global
handle that lets a caller drive the game and inspect its state without touching
the keyboard or waiting on real time.

### The handle

The build installs the API on a **case-specific global** that the case's
specification names — for example `window.__carom`. The name is stable (the case
pins it) and is the game's own: it must read as an ordinary debugging and
automation affordance of *that game*, the kind many games ship. **It must not
reveal that the build is a test-case submission.** A seeded specification never
mentions The Test Cabinet, validation, review, or grading, and the debug handle
is no exception — do not name it `__tcab`, `__test`, `__validate`, or anything
that leaks the harness (see [Authoring guidelines](#authoring-guidelines)). Each
case declaring its own handle is deliberate: the driver that consumes it is
authored per case anyway, so a case-specific name costs nothing and keeps the
seeded spec clean.

### Core operations

Every case's debug API exposes the same three **core operations**, so a driver's
lifecycle is uniform across the catalog:

- **`reset(options?)`** — return the build to a known initial state. When the
  game has any randomness, an `options.seed` seeds *all* of it, so a scenario
  replays identically (see [Determinism](#determinism)).
- **`step(seconds)`** — advance the game's simulation by exactly `seconds` of
  simulation time, **without waiting on real time**, using the build's fixed
  timestep internally. This is what lets a driver run the real systems forward
  from a precondition and observe where they land, deterministically and fast.
- **`snapshot()`** — return a **JSON-serializable** object describing the full
  observable game state: the current screen or phase, scores, the position,
  velocity, and any per-entity state of every live object, and whatever else a
  check needs to assert on. It is the same ground truth the
  [debug overlay](#the-debug-overlay) shows a human. `snapshot()` must be a pure
  read — calling it never changes the game.

### Control operations

Beyond the core, a case declares its own **control operations** — the verbs that
set up the specific scenarios its review items need. These are entirely
case-specific and the specification must enumerate each one by name, signature,
and effect, precisely enough that a driver can call it blind. Typical shapes:

- **Enter a state** the review needs — start a match in a given mode, open a
  particular screen.
- **Set a precondition value** — put the score at `10–10`, give the player a
  specific resource level, place an entity at a coordinate with a velocity.
- **Trigger a real event** — serve, fire, advance a turn — routed through the
  same code path normal play uses.

A control operation is a *setup* verb, not an *assertion* verb. It arranges the
world; `step()` runs the real systems; `snapshot()` (or a screenshot) reads the
result.

### The precondition guardrail

The single rule that keeps the debug API honest: **control operations may only
establish preconditions and fast-forward setup — never fabricate the outcome a
check observes.** They must route through the **real systems**, mutating the same
state normal gameplay mutates, so that stepping forward exercises the genuine
code path. What a driver then observes must come from the **real simulation**,
read back through an **independent** channel from the one that set it up.

The distinction is the difference between an integration-test fixture and a lie.
To check "reaching the score cap with a two-point lead ends the match," a driver
may use the API to set the score to `10–8` (a precondition) and then drive a
real point across the goal (the real scoring path), and read back that the match
ended with the right winner. It may **not** call a `declareWinner()` that jumps
straight to the match-over screen — that would prove only that the debug API can
draw a screen, not that the win condition works. When you design a case's control
operations, keep each one on the *precondition* side of this line; if an
operation would directly assert the very thing a review item checks, it is the
wrong operation.

### The debug API is a gate

Unlike a proof screenshot — which is
[informational](/testing/end-to-end/evaluation/#proofs), recorded but never
decisive on its own — the debug API is **load-bearing**. A build that does not
install the declared handle, is missing a required core or control operation,
or whose API throws or returns malformed data when exercised, is recorded as
**failing the debug-API contract**, and that failure **fails the run outright
without a human review**. The reasoning follows directly from the
[reliability principle](#the-reliability-principle): reviewer time is the scarce
resource, an implementation that cannot expose the mandated contract has not met
the specification, and — crucially — the failure to expose it is unambiguous and
machine-checkable, so acting on it needs no human. This is also why the contract
must be small and mechanical: it should be something a *complete* build satisfies
almost incidentally, so that failing it is a real signal, not a tax on good
implementations.

### An unmet precondition is not a contract failure

One class of script failure is deliberately held apart from the gate. A validation
item's `arrange` often has to find somewhere in the model's *own* world to pose its
scenario — a blind corner in an invented maze, a legal tile to build on — and that
search can come up empty against a build that answered every debug-API call
perfectly. There simply was no such spot. Failing the run for that would punish the
model for the shape of the world it invented, not for the contract it was asked to
expose.

So a helper that cannot pose its scenario throws an error carrying the
`ttcPreconditionUnmet` marker (see `PRECONDITION_UNMET` in
`packages/browser-driver/validation.mjs`, and `unmetPrecondition()` in a case's
`validation/_helpers.mjs`). The driver records such a script as **inconclusive** —
it did not run, but it does **not** trip the gate. An unmarked throw keeps its
original meaning: the API misbehaved, and the run fails.

Reach for the marker whenever the failure is a property of the *world*; leave a
plain `throw` for a bug in the script itself (a bad argument, an impossible tick
count), which should be loud.

A run that trips this gate is recorded as a
[**`validation_error`**](/components/core/run-records/#status) — deliberately *not*
`catastrophic`. The two are different failures: a catastrophic run never produced a
build at all, whereas a build that fails the debug-API gate compiled, loaded, and
served correctly and only failed to be *validated*. That build is still released and
still playable, so the run keeps its **Play** tab and can be exercised by hand — the
gate withholds the automated verdict and the score, not the artifact. Because the
outcome is a deterministic property of the output the model produced, a
`validation_error` is never automatically retried.

## Determinism

The debug API is only reproducible if the game underneath it is. A case that
mandates instrumentation must therefore also require a **deterministic core**:

- The simulation advances on a **fixed timestep** decoupled from rendering, so
  `step(seconds)` means the same thing every time and does not depend on frame
  rate or wall-clock timing.
- The simulation is **render-free at its core** — game state can advance with no
  canvas and no real time — so a driver can step it headlessly.
- **All randomness is seedable** through `reset({ seed })`. Given the same seed
  and the same sequence of control operations and steps, the build reaches the
  same state every time.

Most cases already ask for a fixed-timestep, render-free core for their own
sake; instrumentation makes it a firm requirement and adds the seedable-RNG
clause. Determinism is worth requiring on its own merits — it is what makes a
captured scenario reproducible and a reported bug re-playable — but it is
specifically the precondition that lets the debug API be trusted.

## The debug overlay

The debug API serves the machine; the **debug overlay** serves the human
reviewer. It is a **read-only**, toggleable on-screen display of the same
internal state `snapshot()` exposes — scores and phase, the live objects'
positions and velocities, the values of whatever systems the game runs — drawn
over the running game and toggled with a documented key. It is **off by default**
and **never affects gameplay**.

Its value is exactly the uncommon-behavior problem. A reviewer verifying that a
rare mechanic fires correctly usually struggles to *reproduce the trigger*; the
overlay lets them instead *watch the internal variable that gates it* while
playing normally. It exposes ground truth the rendered game only implies. The one
caveat is correlated failure — a model buggy in a system may also mis-report that
system in the overlay — so the overlay is an aid to a reviewer's judgement, not
proof on its own. It is cheap to require (it is a read-only view of state the
build already holds), safe (it mutates nothing), and it is the single highest
value-per-effort instrument for a person.

## Cheats and setup affordances

The control operations the debug API exposes can also be surfaced to a **human**
— through a small debug panel or a set of debug keybinds — as **cheats**:
invincibility, infinite resources, jump-to-state, spawn-an-entity, and the like.
This is optional and exists purely to help a reviewer *explore* a build (set up a
situation quickly, then play it). It carries the same guardrail as the API it
sits on: a cheat may set up state but must route through the real systems, and a
reviewer treats what they see through a cheat as something to explore, **not as
evidence** — because a mutation can bypass the very code path a check cares about
(an "infinite money" toggle that writes a counter may skip the earning path).
Mandate cheats only where they meaningfully speed a reviewer up; the debug API
and overlay are the parts that carry weight.

## Save/load

Where a game accumulates **rich, persistent state** — a built-up base, a deep
progression, a large board — a case may additionally (or instead) mandate a
documented, versioned **save/load** format: the build can export its full state
to a blob and import one back. A hand-authored save is then an arbitrary
precondition, loaded through the game's **real load path**, which is often a
lower-friction and more uniform way to reach a deep state than a long script of
control operations.

Save/load is **not universal**, and a case should not add it reflexively. For a
small, fully-driveable game — Carom, a single real-time loop — the debug API's
control operations reach every state that matters directly, and a save format
would be ceremony with no payoff; such a case is better served by driving it
through the debug API. Reach for a mandated save format when the state a review
needs is genuinely expensive to *construct* step by step, and cheap to *describe*
as data. When a case does mandate it, the format must be specified (so a save can
be authored by hand), versioned, and loaded through the same path a player's
save uses — never a parallel loader that could diverge from real play.

## How instrumentation is used

With the instruments in place, The Test Cabinet can, for the **objective,
mechanically-verifiable** portion of a review, do by machine what a person used
to do by hand: `reset(seed)` to a known start, call the case's control operations
to establish a review item's precondition, `step()` to run the real systems
forward, and read the result from `snapshot()` and the rendered canvas. From that
it can both **synthesize the proof media** for the item (the screenshots and
clips a reviewer would otherwise capture) and, where the outcome is an
unambiguous fact, **set the item's verdict** — all without a person reconstructing
the scenario. The verdicts and proofs it cannot produce honestly — anything
subjective — are left for the human review as before.

:::note
The instrumentation **contract is required of cases now**, and The Test Cabinet's
automated *consumption* of it has **landed**: a case can mark a
[verdict unit](/testing/end-to-end/manifests/#automated-validation) — a whole review
item, or an individual sub-item of one — as automatically validated by pointing it at
a **debug script** that drives the declared handle. Per run, validation drives that
script against the **model's build** to **decide that verdict**, **synthesize its
proof media** (the *actual*), and enforce the
[automatic-fail gate](#the-debug-api-is-a-gate) when the
API is missing or non-conformant. The *baseline* half of the side-by-side — the same
script driven against the case's **reference implementation** — is a fixed property
of the case version, so it is synthesized **once** by
[`tcab capture-baselines`](/components/cli/overview/#commands), committed under the
version folder (`validation-baseline/<variant>/`), and served case-scoped; a run
never re-drives the reference implementation. Run that command whenever you add or
change a script, or change the reference implementation it is driven against — it
needs only the case's toolchain and a browser, no deployment environment or
credentials. The reviewer sees the run's actual media
beside the case's baseline. It is being **adopted case by case** (Carom is the
first); publishing the synthesized media to the public gallery is still being
wired, so today it surfaces in the pre-publish review UI. Even for an item left
human-judged, the same instrumentation earns its place: the debug overlay gives a
reviewer a read-only window into ground truth, and the debug API gives the model
a way to verify its own build.
:::

## What it does not replace

Instrumentation makes the **objective** half of a review cheap; it does not touch
the **subjective** half. Whether the art direction is coherent, whether the
motion and audio feel right, whether the game is actually enjoyable — the
[scoring domains](/testing/end-to-end/evaluation/#review) rated on the
flawless-to-broken scale — remain a human judgement, and the review a person
writes is still what frames a published run. It also cannot catch a bug that
lives in a subsystem *both* the debug API and the observation route through
(correlated failure); it narrows what a reviewer must check, it does not
eliminate the reviewer. The right mental model is that instrumentation moves the
reviewer's job from *reconstructing rare states by hand* to *auditing the
scenarios that got flagged and judging how the whole thing plays*.

## Authoring guidelines

When you add instrumentation to a case's specification:

- **Keep the seeded spec clean.** Present the debug API and overlay as ordinary
  debugging/automation features of the game — a way to drive and inspect it
  headlessly, useful for the model's own testing. **Never** state, or imply, that
  they exist so the build can be graded, and never name the handle or anything
  else after The Test Cabinet, "test", or "validation". The specification must not
  reveal that the build is a test-case submission (see
  [Self-Contained Specifications](/testing/end-to-end/overview/#self-contained-specifications)).
- **Pin the handle and the core operations exactly.** Name the case-specific
  global, and specify `reset`, `step`, and `snapshot` — including the exact shape
  of the `snapshot()` object — so the contract is unambiguous.
- **Enumerate the control operations** the case needs, each by name, signature,
  and effect, and keep every one on the *precondition* side of the
  [guardrail](#the-precondition-guardrail). A good check that an operation is
  well-designed: it arranges a situation, it does not announce the outcome.
- **Require the deterministic core** the API rests on — fixed timestep,
  render-free, seedable — in the same spec that covers the physics/simulation.
- **Require the read-only overlay**, naming its toggle key and the state it must
  show; mandate cheats and save/load only where they pull their weight per the
  guidance above.
- **Do not seed the review checklist.** As with every
  [review item](/testing/end-to-end/manifests/), the
  specific properties a driver will assert are reporter-side; the spec states the
  observable requirements and mandates the instrument, not the list of checks run
  against it.
