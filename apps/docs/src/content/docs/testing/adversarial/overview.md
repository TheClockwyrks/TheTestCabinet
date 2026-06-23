---
title: Overview
---

An **adversarial** test case asks a model to write the control logic for an
actor in a game or simulation, then pits that implementation **head-to-head**
against other models' implementations. The design takes its inspiration from PvP
games: rather than building a whole application, the model writes the
intelligence that drives one side of a contest, and the outcome is decided by how
that intelligence performs against the field.

This is a deliberately different challenge from an
[end-to-end](/testing/end-to-end/overview/) case. Where end-to-end rewards taking
a large, open-ended task to completion, an adversarial case is smaller in scope
but demands that the model **bake intelligence into code** — typically a
"classical" AI controller, since the implementation runs on its own with no model
in the loop. Once a model has written its controller, the model itself does not
participate in the evaluation; the controller is executed repeatedly by The Test
Cabinet against other controllers, and the model's score is the controller's
record.

## Shape of a case

An adversarial case is built around a **game** — the rules, the world, and the
win conditions — and a **contract** the model's controller must implement. Two
broad shapes are supported:

- **Actor control.** The model writes the logic for an agent acting in the world
  — for example the players in a capture-the-flag match. Each side runs a
  different model's controller, and they compete directly.
- **Simulation control.** The model writes the logic that steers a whole system
  over time — for example the strategy driving a faction in an economy-builder
  RTS or 4X simulation. Implementations compete on the outcome the simulation
  produces.

The game logic itself — the rules, physics, scoring, and the authoritative world
state — is owned by the test case, never by the model. The model only supplies a
controller that observes the world and proposes actions; The Test Cabinet applies
those actions on the model's behalf.

## The controller contract

The model's controller is compiled to **WebAssembly** and executed inside a
sandbox. Models may write in **any language that compiles to wasm** — Rust,
JavaScript via [`componentize-js`](https://github.com/bytecodealliance/ComponentizeJS),
and others — so the case constrains the interface, not the language.

The controller is invoked **once per game tick**. On each invocation it is given
the observable game state for its actor and must return the set of actions the
game logic should apply for that tick. A single run therefore drives a controller
through many invocations as the match advances.

The sandbox is the security boundary, and it is strict by design:

- A controller **cannot directly modify game state**. It observes a view of the
  world and emits actions; the authoritative state lives outside the sandbox and
  is only ever mutated by the game logic applying those actions. There must be no
  path for a controller to reach in and change the world directly — this is what
  keeps a match honest and prevents cheating.
- The wasm engine is **reused between invocations** rather than torn down and
  rebuilt each tick. This avoids the cost of standing up an engine per tick, and
  it lets a controller keep its own working data in memory across ticks — a
  controller can build up state (a map it has explored, a plan it is executing)
  and carry it forward, exactly as a stateful agent would.

See [Sandbox and execution](#sandbox-and-execution) for the resource limits that
bound a controller, and [Manifests](/testing/adversarial/manifests/) for how a
case declares its game, contract, and match structure.

## Sandbox and execution

Because a controller is arbitrary model-written code running in a competitive
setting, the sandbox must contain it completely:

- **Fuel.** Each invocation is given a bounded amount of wasmtime **fuel** so
  that a buggy or pathological controller cannot crash the game or hang it. A
  controller that **exhausts its fuel** is **disqualified** rather than allowed
  to stall the match — the fuel budget is a hard ceiling on the work a controller
  may do per tick.
- **Bounded memory.** A controller's memory is capped for the same reason: a
  controller cannot be allowed to exhaust the host's memory. Exceeding the cap is
  a disqualifying failure, not a recoverable one.

These limits make a controller's misbehaviour the model's problem, not The Test
Cabinet's: a controller that is too slow, too memory-hungry, crashes, or returns
an illegal action loses, and the match continues.

In a deployment, this CPU-bound match execution — both quick **matches** and whole
**tournaments** — runs on the dedicated **[`tcab-arena`](/components/arena/overview/)**
service, kept off the single-replica control-plane backend. The arena fetches each
controller's wasm from the backend, runs the field, and persists the finished
tournament and its per-match replays back to the backend, which serves the arena
**reads** (published tournaments + stored replays). A console reaches the arena via
the URL the backend reports at `GET /config`. (The desktop app runs the same engine
in-process instead.)

## Lockstep simulation and replays

Adversarial cases are designed around the same idea as **RTS lockstep engines**:
the simulation must be **fully replayable**, but it does **not** need to be
deterministic while it is being produced. The requirement is one-directional —
**once a run is recorded, replaying it is fully deterministic**, even though the
original run need not have been. Recording every input that drove the simulation
is what makes the recorded run reproducible regardless of how it was originally
generated.

Two consequences follow from this design:

- **Faked time.** Because this is a benchmark, a run is executed at the maximum
  speed the hardware allows rather than in real time. The simulation advances by
  a **fixed timestep** per tick, and the time delta handed to the game logic is
  **faked** to that fixed value regardless of how long the hardware actually took
  to compute the tick. A slow tick and a fast tick advance the game world by
  exactly the same amount, so the result does not depend on machine speed and the
  whole match can run as fast as the host can compute it.
- **Browser playback.** The recorded replay data is used to **reconstruct** the
  simulation and play it back in the browser, so a reader can watch what actually
  happened in a match. The replay is rendered on the [public site](/components/site/overview/)
  the same way an end-to-end build is embedded and played, turning an otherwise
  opaque head-to-head into something a visitor can watch unfold.

See [Evaluation](/testing/adversarial/evaluation/) for how match outcomes become
a model's score.
