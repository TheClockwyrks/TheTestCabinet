---
title: "Game code & replay"
---

Foray's rules, world state, and replay handling live in a **single Rust
implementation** that is compiled two ways: natively (for the
[CLI](#the-cli) that produces a match) and to wasm (for the
[browser](#browser-playback) that plays it back). One authoritative rules engine
both **produces** and **reconstructs** a match, so a replay can never drift from
the rules that generated it. This page covers that code, the
[controller contract](#the-controller-contract) schemas specific to Foray, and
the [replay format](#the-replay-format).

For the test-type-level framing — the sandbox, fuel/memory limits, and the
lockstep/replay model — read the
[adversarial overview](/testing/adversarial/overview/) first; this page only adds
what is specific to Foray.

## Crate layout

```
crates/
  foray-core/             # the authoritative game: rules, state, scoring, replay (de)serialization
    src/lib.rs            #   crate-type = ["cdylib", "rlib"] — links natively and to wasm
  foray-host/             # the reusable wasm host: load controllers, per-tick loop, sandbox
    src/lib.rs
  foray-cli/              # `foray` binary: thin clap wrapper over foray-host
    src/main.rs
  foray-controller-sdk/   # ergonomic Rust SDK a controller depends on (world/action + ABI glue)
  foray-ref-random/       # baseline: uniformly-random legal moves
  foray-ref-greedy-raider/# baseline: rush the nearest cache, never break off
  foray-ref-border-soldier/# baseline: hug the border; the committed canonical opponent
```

- **`foray-core`** owns everything authoritative: the board model, agent state,
  the tick advance (movement, eating, carry-weight cadence, tagging, banking,
  jelly), legality checks, scoring, and the **replay (de)serialization**. It has
  **no I/O and no wasm-host dependency** — it is pure rules plus data types, so
  the exact same crate compiles for the native CLI and for
  `wasm32-unknown-unknown` in the browser. The controller-facing
  [`world`](#world-the-observation) and [`action`](#action-the-output) types and
  their JSON Schemas are defined here and exported so the schemas and the engine
  can never disagree.
- **`foray-host`** is the reusable **wasm host** ([`wasmtime`](https://wasmtime.dev/)).
  It loads the two competing controller modules, runs the per-tick invocation
  loop, and enforces the sandbox (fuel, memory). It lives in its own crate — not in
  `foray-core` (which must stay wasm-compilable) and not buried in the CLI —
  because the core `AdversarialValidator` reuses the **exact same host** to score a
  submission, so there is one host implementation and the CLI and the validator can
  never diverge.
- **`foray-cli`** is the thin native `foray` binary: a clap wrapper that reads the
  map and two modules off disk, calls `foray-host`, and writes the replay (plus a
  `schema` helper that dumps the `world`/`action` JSON Schemas straight from
  `foray-core`).
- **`foray-controller-sdk`** is the optional ergonomic Rust SDK a model's
  controller can depend on: it owns the hand-rolled ABI glue (`alloc`/`tick`, see
  [The controller ABI](#the-controller-abi)) and re-exports the `world`/`action`
  types, so a Rust controller writes a plain `tick(world) -> action` and never
  touches raw pointers.
- The three **`foray-ref-*`** crates are the
  [baseline controllers](/testing/adversarial/adversarial-pacman/references/);
  `foray-ref-border-soldier` is the one committed with the case as the **canonical
  opponent** every submission is scored against.

## The CLI

The binary runs **one match between two controller modules** and writes the
replay:

```bash
foray simulate \
  --red   path/to/red.wasm \
  --blue  "$FORAY_HOME/references/border-soldier.wasm" \
  --map   "$FORAY_HOME/maps/mirror-32x16.toml" \
  --seed  0xC0FFEE \
  --out   replay.json
```

`foray` is compiled from `foray-cli` and **baked into the adversarial run-container
image** (on `PATH`), alongside the controller
[buildkit](/testing/adversarial/adversarial-pacman/references/#what-the-model-receives)
the model builds against and the reference modules + map under `$FORAY_HOME`
(`/opt/foray`) — so a model runs local matches with the *same* host the validator
scores with, without building any tooling itself. It prints the winner, the final
score, and the outcome (`swept` / `time_limit` / `forfeit`); when the time limit is
reached on a **level score** it reports the winner "on efficiency" — the
[tie-break](/testing/adversarial/evaluation/#standings) awards a level match to the
controller that consumed the **least total fuel**. On a forfeit it also prints
which controller forfeited, on what tick, and **why** (fuel, memory, a trap, or a
contract-invalid action) — the one outcome the recorded replay cannot explain on
its own. It reports each controller's **peak per-tick fuel** against the ceiling, so
a model can tell "comfortably within budget" from "one heavy tick from a forfeit",
and its **total fuel** over the match — the figure the efficiency tie-break
compares. Pairing the peak with the `--fuel-per-tick` override (which raises the
ceiling) lets a model measure how far over the limit an over-budget controller runs
and decide whether to optimize.

Each tick the CLI:

1. Builds the [`world` observation](#world-the-observation) for **Red**, invokes
   Red's controller, and validates the returned [`action`](#action-the-output);
   then the same for **Blue**. Each controller sees only its own team's
   observation — never the authoritative state, and never the opponent's view.
2. Hands both action sets to `foray-core`, which advances the world by one
   **fixed, faked [timestep](/testing/adversarial/overview/#lockstep-simulation-and-replays)**
   (movement → eating → tagging → banking, with the carry-weight speed model
   deciding which agents have banked enough charge to step this tick, and only the
   tag-dodging tile-swap — a soldier and an enemy raider trading places — cancelled
   so a raider cannot pass *through* a defender; other head-on swaps resolve).
3. Appends the tick's inputs to the replay log.

The loop ends at a win condition or `max_ticks`. Because the timestep is faked,
the match runs at the host's maximum speed and the outcome does not depend on
machine speed.

### Sandbox enforcement

The CLI applies the manifest's
[sandbox limits](/testing/adversarial/manifests/) to **every controller
invocation**: a `fuel_per_tick` ceiling on wasmtime fuel and a `max_memory_bytes`
linear-memory cap. The wasm engine is **reused between ticks** (not rebuilt), so
a controller may keep working memory — an explored map, a plan in flight —
across the whole match. A controller that exhausts fuel, exceeds memory, traps,
or returns a contract-invalid action **forfeits** the match (see
[Evaluation](/testing/adversarial/evaluation/)); the match continues so a replay
is still produced.

## The controller contract

The controller exports the entry function named by the manifest's
[`[contract] entry`](/testing/adversarial/manifests/) (here, `tick`). It is
invoked **once per tick per team** with that team's `world` observation encoded
as JSON bytes and must return an `action` as JSON bytes. The two schemas are the
**only** channel between a controller and the game.

### The controller ABI

For v1 a controller compiles to a **`wasm32-unknown-unknown` core module** — a
plain wasm module, **not** a component/`wasip2` module — so a controller needs
nothing beyond the standard `wasm32-unknown-unknown` target (no `wasm-bindgen`, no
component toolchain). The host (`foray-host`) and the guest exchange JSON over a
small **hand-rolled C ABI** of two exports:

- `alloc(len: i32) -> i32` — the guest allocates `len` bytes in its own linear
  memory and returns a pointer to them. The host calls this each tick to obtain a
  buffer it then writes the `world` JSON into.
- `tick(ptr: i32, len: i32) -> i64` — the contract entry. The host has written the
  `world` JSON at `ptr` (`len` bytes); the guest reads it, decides, writes its
  `action` JSON somewhere in **its own** memory, and returns that location packed
  as `((out_ptr as i64) << 32) | (out_len as i64)`. The host unpacks the i64 and
  reads the `action` JSON back out of the guest's memory.

`foray-host` reuses **one wasmtime `Store` + `Instance` per controller for the
whole match** (the engine is built once and shared), so guest globals/statics
persist across ticks — a controller may carry working memory (an explored map, a
plan) forward — while the per-tick `fuel_per_tick` ceiling and the
`max_memory_bytes` cap still apply to every invocation. A Rust controller can use
[`foray-controller-sdk`](#crate-layout) to get this ABI for free and just write
`tick(world) -> action`.

The **same C-ABI style** is how `foray-core` exposes
[browser playback](#browser-playback): it exports `alloc` plus
`replay_load`/`replay_board`/`replay_step`/`replay_reset`, so the renderer
instantiates it through the platform `WebAssembly` API with no extra toolchain.

### `world` — the observation

The per-tick view handed to the controller. In v1 the world is **fully
observable** (no fog) — a deliberate simplification for the first case; noisy /
limited enemy sensing is a planned variant. Shape (illustrative):

```jsonc
{
  "tick": 412,
  "timestep_ms": 16,
  "team": "red",                  // which colony this controller drives
  "board": {
    "width": 32, "height": 16,
    "border_x": 16,               // first column belonging to Blue's half
    "walls": [[3,4],[3,5], ...]   // blocked tiles (static for the match)
  },
  "score": { "red": 7, "blue": 5 },
  "seeds_remaining": { "red_half": 13, "blue_half": 11 },
  "my_agents": [                  // always this team's three agents
    { "id": 0, "x": 14, "y": 8, "role": "raider",  "carrying": 4, "immune_ticks": 0, "can_move_this_tick": false },
    { "id": 1, "x": 6,  "y": 2, "role": "soldier", "carrying": 0, "immune_ticks": 0, "can_move_this_tick": true  },
    { "id": 2, "x": 9,  "y": 11,"role": "raider",  "carrying": 0, "immune_ticks": 12,"can_move_this_tick": true  }
  ],
  "enemies": [                    // the opposing colony's three agents
    { "id": 0, "x": 20, "y": 8, "role": "soldier", "carrying": 0, "immune_ticks": 0 }
  ],
  "seeds": [ [18,3], [21,9], ... ],          // every uneaten cache (incl. dropped, recoverable ones)
  "jelly": [ { "x": 24, "y": 1, "active": true } ]
}
```

`can_move_this_tick` exposes the [carry-weight](/testing/adversarial/adversarial-pacman/overview/#carry-weight--the-signature-mechanic)
speed model directly, so a controller never has to re-derive it: it is `true` when
the agent has banked enough charge to step this tick. A laden raider mid-stall
reads `false` (an action submitted for it is a no-op), and because a soldier moves
just under one tile/tick, even a soldier reads `false` on its occasional skipped
step.

### `action` — the output

One move per **owned** agent, every tick:

```jsonc
{
  "moves": [
    { "agent": 0, "dir": "N" },     // N | S | E | W | Stop
    { "agent": 1, "dir": "Stop" },
    { "agent": 2, "dir": "W" }
  ]
}
```

Legality has two tiers, mirroring the
[overview's](/testing/adversarial/overview/#the-controller-contract) cheating
guarantee:

- **Schema-invalid output is a forfeit.** Missing the `moves` array, naming an
  agent the team does not own, duplicate/omitted agents, an unknown `dir`, or
  malformed JSON — the controller loses the match. There is no representable
  action that mutates state directly, so cheating cannot compile.
- **A well-formed but blocked move is clamped, not punished.** A move into a wall
  or off the board (or any move submitted for an agent whose carry-weight cadence
  stalls it this tick) is applied as **Stop**. This keeps ordinary pathfinding
  bugs from being match-ending while still making illegal *intent* impossible.

## The replay format

A replay is a **seed plus a per-tick input log** — not a frame dump. It records
everything needed to re-run `foray-core` and reproduce the match
bit-for-bit:

```jsonc
{
  "version": 1,
  "map": "mirror-32x16",          // map id (the map definition ships with the case)
  "seed": "0xC0FFEE",             // seeds any randomness in the original run
  "timestep_ms": 16,
  "participants": { "red": "<model/controller id>", "blue": "<model/controller id>" },
  "ticks": [
    { "red": { "moves": [...] }, "blue": { "moves": [...] } },
    ...
  ],
  "result": { "winner": "red", "score": { "red": 41, "blue": 39 }, "ended": "swept", "ticks": 9123 }
  // "ended" is one of: "swept" (all enemy seeds banked) | "time_limit" (10-min cap) | "forfeit"
}
```

This is the **lockstep** model from the
[adversarial overview](/testing/adversarial/overview/#lockstep-simulation-and-replays):
the original run need **not** have been deterministic, but **replaying the
recorded log is**. The committed `result` lets a player verify its own
reconstruction matches the recorded outcome — a drift between the two means the
core changed under the replay and is a bug, not a re-scoring.

The committed `result` is purely the **rules** outcome: `foray-core` knows banked
score and forfeits, not fuel, so a level score at `max_ticks` is recorded with
`"winner": null` (a draw) and reconstructs identically in the browser. The
[efficiency tie-break](/testing/adversarial/evaluation/#standings) that crowns the
leaner controller is a **host** concern (fuel is metered by `foray-host`, which is
not part of the wasm-portable core), so it is applied *on top of* this result when
the match verdict is recorded — never written into the replay. A match whose replay
reconstructs to a draw can therefore still be credited to one side on efficiency;
the two are consistent, not contradictory.

## Browser playback

The site does not ship a second rules implementation. The `[replay] renderer`
named in the [manifest](/testing/adversarial/manifests/) loads **`foray-core`
compiled to wasm**, feeds it the replay's seed and per-tick log, and steps the
engine forward exactly as the CLI did, reconstructing every tick up front. A thin
JS/canvas layer (`replay/renderer.mjs`) draws the match using the
[pixel-art sprite sheet](/testing/adversarial/adversarial-pacman/assets/); the
renderer holds **no game rules of its own**, only drawing.

Ticks are the simulation's discrete steps, but they are **not** drawn one-per-
displayed-frame: that would teleport agents cell to cell. Instead the renderer
runs a continuous clock and draws each agent at an **interpolated** position
between the two nearest reconstructed ticks, cycling its **walk animation** as it
crosses a tile, so motion reads smoothly. State that genuinely changes at a tick
boundary (seeds eaten, jelly spent, the score) snaps on that tick; only movement
is smoothed. The static board is **autotiled** into a connected pac-man-style maze
from the wall set. None of this is a rule — the interpolation is pure presentation
over the reconstructed ticks. Because the engine is shared, what a visitor watches
on the [public site](/components/site/overview/) is the same simulation that
decided the match, not an approximation of it.
