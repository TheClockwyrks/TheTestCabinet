---
title: Overview
---

An adversarial test case asks a model to write the control logic for an actor in
a game or simulation, then pits that implementation head to head against other
models' implementations. The model writes the intelligence that drives one side
of a contest, and the outcome is decided by how that intelligence performs
against the field.

The model itself takes no part in the evaluation. Once its controller is
compiled, the controller runs on its own with no model in the loop, so the case
rewards baking a classical AI into code. The Test Cabinet executes the controller
repeatedly against other controllers, and the model's score is the controller's
record.

## Shape of a case

An adversarial case is built around a game (its rules, world, and win conditions)
and a contract the model's controller must implement. Two shapes are supported:

- Actor control. The model writes the logic for an agent acting in the world, for
  example the players in a capture-the-flag match. Each side of a match runs a
  different model's controller.
- Simulation control. The model writes the logic that steers a whole system over
  time, for example the strategy driving a faction in an economy builder.
  Implementations compete on the outcome the simulation produces.

The test case owns the rules, the physics, the scoring, and the authoritative
world state. The model supplies a controller that observes the world and proposes
actions, and The Test Cabinet applies those actions on the model's behalf.

## The controller contract

The controller is compiled to WebAssembly and executed inside a sandbox. A case
fixes the interface rather than the language, so a model may write in any
language that produces an import-free `wasm32-unknown-unknown` core module
exporting the case's contract entry.

The controller is invoked once per game tick. Each invocation receives the
observable game state for its actor and returns the set of actions the game logic
applies for that tick, so a single match drives a controller through many
invocations.

That contract is the only channel between a controller and the game. The
authoritative state lives outside the sandbox and is mutated only by the game
logic applying returned actions, which is what keeps a match honest.

The wasm engine is reused between invocations rather than rebuilt each tick. A
controller therefore keeps its own working data in memory across ticks and can
carry a map it has explored or a plan it is executing forward through the match.

[Manifests](/testing/adversarial/manifests/) covers how a case declares its game,
contract, and match structure.

## Sandbox and execution

A controller is arbitrary model-written code running in a competitive setting, so
the sandbox bounds it completely:

- Fuel. Each invocation runs under a wasmtime fuel ceiling. The budget is a hard
  limit on the work a controller may do in one tick, and a controller that
  exhausts it forfeits the match.
- Memory. A controller's linear memory is capped, and exceeding the cap forfeits
  the match.

A controller that is too slow, too memory-hungry, crashes, or returns an illegal
action loses, and the match continues.

In a deployment, both quick matches and whole tournaments run on the dedicated
[arena service](/components/arena/overview/), which keeps this CPU-bound work off
the single-replica control-plane backend. The arena fetches each controller's
wasm from the backend, runs the field, and persists the finished tournament and
its per-match replays back to the backend, which serves arena reads. The web console
reaches the arena at the URL the backend reports from `GET /config`.

## Lockstep simulation and replays

Adversarial cases follow the model of an RTS lockstep engine. A recorded run
replays fully deterministically, even though the original run need not have been
deterministic while it was produced. Recording every input that drove the
simulation is what makes the recording reproducible.

Two requirements follow:

- Faked time. A run executes at the maximum speed the hardware allows. The
  simulation advances by a fixed timestep per tick, and the delta handed to the
  game logic is that fixed value however long the tick took to compute. A slow
  tick and a fast tick advance the game world by exactly the same amount, so a
  result never depends on machine speed.
- Browser playback. The recorded replay data reconstructs the simulation and
  plays it back in the browser, so a reader can watch what happened in a match.
  The replay is rendered on the [public site](/components/site/overview/) the same
  way an end-to-end build is embedded and played.

[Evaluation](/testing/adversarial/evaluation/) covers how match outcomes become a
model's score.
