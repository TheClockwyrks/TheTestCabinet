---
title: "Game code & replay"
---

Foray's rules, world state, and replay handling live in a single Rust
implementation compiled two ways: natively for the [CLI](#the-cli) that produces
a match, and to wasm for the [browser](#browser-playback) that plays it back. One
authoritative rules engine both produces and reconstructs a match, so a replay
can never drift from the rules that generated it.

This page covers that code, the [controller contract](#the-controller-contract),
and the [replay format](#the-replay-format). The sandbox, the fuel and memory
limits, and the lockstep model are described in the
[adversarial overview](/testing/adversarial/overview/); the rules of the game are
in the [Foray overview](/testing/adversarial/foray/overview/).

## Crate layout

```
crates/
  foray-core/              # rules, state, scoring, replay (de)serialization
  foray-host/              # the wasm host: load controllers, per-tick loop, sandbox
  foray-cli/               # the `foray` binary, a clap wrapper over foray-host
  foray-controller-sdk/    # the Rust SDK a controller depends on
  foray-ref-random/        # baseline: uniformly random legal moves
  foray-ref-greedy-raider/ # baseline: rush the nearest cache, never break off
  foray-ref-border-soldier/# baseline: hug the border; the canonical opponent
  foray-fuel-probe/        # the hidden calibration adversary
```

`foray-core` owns everything authoritative: the board model, agent state, the
tick advance (movement, eating, carry-weight cadence, banking, tagging, jelly and
its respawn, and large-seed drift and recall), legality checks, scoring, and
replay (de)serialization. It has no I/O and no wasm-host dependency, so the same
crate compiles for the native CLI and for `wasm32-unknown-unknown` in the
browser. The controller-facing [`world`](#the-world-observation) and
[`action`](#the-action-output) types and their JSON Schemas are defined here and
exported, so the schemas and the engine can never disagree.

`foray-host` is the reusable [`wasmtime`](https://wasmtime.dev/) host. It loads
the two competing controller modules, runs the per-tick invocation loop, and
enforces the fuel and memory limits. It is a separate crate because `foray-core`
must stay wasm-compilable and because core's `AdversarialValidator` reuses this
exact host to score a submission. There is one host implementation, so the CLI
and the validator can never diverge.

`foray-cli` is the thin native `foray` binary. It reads the map and two modules
off disk, calls `foray-host`, writes the replay, and exposes a `schema` helper
that dumps the `world` and `action` JSON Schemas straight from `foray-core`.

`foray-controller-sdk` is the optional Rust SDK a controller depends on. It owns
the ABI glue and re-exports the `world` and `action` types, so a Rust controller
writes a plain `tick(world) -> action` and never touches raw pointers.

The three `foray-ref-*` crates are the
[baseline controllers](/testing/adversarial/foray/references/).
`foray-fuel-probe` is a competent adversary kept out of the model's view; it
calibrates the fuel ceiling and serves as the strong auto-replay opponent.

## The CLI

The binary runs one match between two controller modules and writes the replay:

```bash
foray simulate \
  --red   path/to/red.wasm \
  --blue  "$FORAY_HOME/references/border-soldier.wasm" \
  --map   "$FORAY_HOME/maps/mirror-32x16.toml" \
  --out   replay.json
```

`foray` is compiled from `foray-cli` and baked onto `PATH` in the adversarial
run-container image, alongside the controller
[buildkit](/testing/adversarial/foray/references/#provided-tooling) and the
reference modules and map under `$FORAY_HOME` (`/opt/foray`). A model therefore
runs local matches with the same host the validator scores with, without building
any tooling itself.

The CLI prints the winner, the final score, and the outcome (`swept`,
`time_limit`, or `forfeit`). When the time limit is reached on a level score it
reports the winner on efficiency, applying the
[tie-break](/testing/adversarial/evaluation/#standings). On a forfeit it also
prints which controller forfeited, on what tick, and whether the cause was fuel,
memory, a trap, or a contract-invalid action. That is the one outcome the
recorded replay cannot explain on its own.

It reports each controller's peak per-tick fuel against the ceiling, so a model
can tell a comfortable budget from one heavy tick away from a forfeit, and its
total fuel over the match, the figure the efficiency tie-break compares. The
`--fuel-per-tick` flag raises the ceiling, which lets a model measure how far
over budget an expensive controller runs.

Each tick the CLI:

1. Builds the [`world` observation](#the-world-observation) for Red, invokes
   Red's controller, and validates the returned [`action`](#the-action-output),
   then does the same for Blue. Each controller sees only its own team's
   observation.
2. Hands both action sets to `foray-core`, which advances the world by one fixed,
   faked timestep: movement, eating, banking, tagging, jelly, then large-seed
   drift and recall, with the carry-weight speed model deciding which agents have
   banked enough charge to step this tick.
3. Appends the tick's inputs to the replay log.

Two orderings within the advance are load-bearing. Eating precedes tagging, so a
raider can be tagged on the tile it just ate. Banking precedes tagging, so an ant
that reaches home banks before it can be killed there; tagging first would let an
immune enemy kill a returning carrier and scatter seeds from the other half onto
the wrong side, breaking seed conservation.

Only the tag-dodging tile swap, a soldier and an enemy raider trading places, is
cancelled, so a raider cannot pass through a defender. A cancelled swap is then
settled in the tagging phase as though the two had met, and the defender catches
the raider. Cancelling alone would deadlock: the pair never shares a tile, so
tagging would never see them, and two controllers each re-issuing the swap would
hold forever.

The loop ends at a win condition or `max_ticks`. Because the timestep is faked,
the match runs at the host's maximum speed and the outcome is independent of
machine speed.

### Sandbox enforcement

The CLI applies the manifest's
[sandbox limits](/testing/adversarial/manifests/) to every controller invocation:
a `fuel_per_tick` ceiling on wasmtime fuel and a `max_memory_bytes` linear-memory
cap. The wasm engine is reused between ticks, so a controller may keep working
memory across the whole match. A controller that exhausts fuel, exceeds memory,
traps, or returns a contract-invalid action forfeits the match, and the match
continues so a replay is still produced.

## The controller contract

The controller exports the entry function named by the manifest's
`[contract] entry`, which is `tick`. It is invoked once per tick per team with
that team's `world` observation encoded as JSON bytes and must return an `action`
as JSON bytes. The two schemas are the only channel between a controller and the
game.

### The controller ABI

A controller compiles to an import-free `wasm32-unknown-unknown` core module, so
it needs nothing beyond the standard target: no `wasm-bindgen` and no component
toolchain. The host and the guest exchange JSON over a small C ABI of three
exports, `memory` plus:

- `alloc(len: i32) -> i32`. The guest allocates `len` bytes in its own linear
  memory and returns a pointer to them. The host calls this each tick to obtain a
  buffer it writes the `world` JSON into.
- `tick(ptr: i32, len: i32) -> i64`. The contract entry. The host has written the
  `world` JSON at `ptr` (`len` bytes); the guest reads it, decides, writes its
  `action` JSON into its own memory, and returns that location packed as
  `((out_ptr as i64) << 32) | (out_len as i64)`. The host unpacks the `i64` and
  reads the `action` JSON back out of the guest's memory.

`foray-host` reuses one wasmtime `Store` and `Instance` per controller for the
whole match, so guest globals and statics persist across ticks while the per-tick
fuel ceiling and the memory cap still apply to every invocation. A Rust
controller uses `foray-controller-sdk` to get this ABI for free and writes
`tick(world) -> action`.

The same ABI style exposes [browser playback](#browser-playback): `foray-core`
exports `alloc` plus `replay_load`, `replay_board`, `replay_step`, and
`replay_reset`, so the renderer instantiates it through the platform
`WebAssembly` API with no extra toolchain.

### The `world` observation

The per-tick view handed to the controller. The world is fully observable:

```jsonc
{
  "tick": 412,
  "timestep_ms": 16,
  "team": "red",                  // which colony this controller drives
  "board": {
    "width": 32, "height": 16,
    "border_x": 16,               // first column belonging to Blue's half
    "walls": [[3,4],[3,5]]        // blocked tiles, static for the match
  },
  "score": { "red": 7, "blue": 5 },
  "seeds_remaining": { "red_half": 13, "blue_half": 11 },
  "my_agents": [                  // always this team's three agents
    // `load` = carrying + 3 * carrying_large: what it banks AND what it weighs.
    { "id": 0, "x": 14, "y": 8, "role": "raider", "carrying": 4,
      "carrying_large": 0, "load": 4, "immune_ticks": 0,
      "can_move_this_tick": false }
  ],
  "enemies": [                    // the opposing colony's three agents
    { "id": 0, "x": 20, "y": 8, "role": "soldier", "carrying": 0,
      "carrying_large": 0, "load": 0, "immune_ticks": 0 }
  ],
  "seeds": [ [18,3], [21,9], [15,6] ],  // EVERY takeable tile, ordinary AND large
  "large_seeds": [                      // what `seeds` alone cannot say
    { "x": 15, "y": 6, "home_x": 1, "home_y": 6, "half": "red", "value": 3,
      "ticks_to_drift": 128 }
  ],
  "jelly": [ { "x": 24, "y": 1, "active": true } ]  // ACTIVE nodes only
}
```

A spent jelly node leaves the `jelly` list and returns when it regrows.

`can_move_this_tick` exposes the
[carry-weight](/testing/adversarial/foray/overview/#carry-weight) speed model
directly, so a controller never re-derives it. It is `true` when the agent has
banked enough charge to step this tick. A laden raider mid-stall reads `false`,
and an action submitted for it is a no-op; because a soldier moves just under one
tile per tick, even a soldier reads `false` on its occasional skipped step.

### The `action` output

One move per owned agent, every tick:

```jsonc
{
  "moves": [
    { "agent": 0, "dir": "N" },     // N | S | E | W | Stop
    { "agent": 1, "dir": "Stop" },
    { "agent": 2, "dir": "W" }
  ]
}
```

Legality has two tiers:

- Schema-invalid output forfeits the match. A missing `moves` array, an agent the
  team does not own, duplicate or omitted agents, an unknown `dir`, or malformed
  JSON all lose the match. No representable action mutates state directly, so
  cheating cannot compile.
- A well-formed but blocked move is clamped. A move into a wall or off the board,
  and any move submitted for an agent whose carry-weight cadence stalls it this
  tick, is applied as `Stop`. Ordinary pathfinding bugs are therefore not
  match-ending while illegal intent stays impossible.

## The replay format

A replay is a seed plus a per-tick input log rather than a frame dump. It records
everything needed to re-run `foray-core` and reproduce the match bit for bit:

```jsonc
{
  "version": 1,
  "map": "mirror-32x16",          // map id; playback regenerates the maze
  "seed": "0xC0FFEE",             // seeds any randomness in the original run
  "timestep_ms": 16,
  "participants": { "red": "<controller id>", "blue": "<controller id>" },
  "ticks": [
    { "red": { "moves": [] }, "blue": { "moves": [] } }
  ],
  "result": { "winner": "red", "score": { "red": 41, "blue": 39 },
              "ended": "swept", "ticks": 9123 }
  // "ended" is one of: "swept" | "time_limit" | "forfeit"
}
```

The recorded seed and board parameters are what playback regenerates the maze
from, so the map file itself is never shipped to the browser. The committed
`result` lets a player verify that its own reconstruction matches the recorded
outcome; a drift between the two means the core changed under the replay, which
is a bug rather than a re-scoring.

That `result` is purely the rules outcome. `foray-core` knows banked score and
forfeits, not fuel, so a level score at `max_ticks` is recorded as a draw with
`"winner": null` and reconstructs identically in the browser. The
[efficiency tie-break](/testing/adversarial/evaluation/#standings) is a host
concern, since fuel is metered by `foray-host`, so it is applied on top of this
result when the match verdict is recorded. A match whose replay reconstructs to a
draw can therefore still be credited to one side on efficiency.

## Browser playback

The site ships no second rules implementation. The `[replay] renderer` named in
the [manifest](/testing/adversarial/manifests/) loads `foray-core` compiled to
wasm, feeds it the replay's seed and per-tick log, and steps the engine forward
exactly as the CLI did, reconstructing every tick up front. A thin canvas layer
(`replay/renderer.mjs`) draws the match using the
[pixel-art sprite sheet](/testing/adversarial/foray/assets/) and holds no game
rules of its own.

Ticks are the simulation's discrete steps, and they are not drawn one per
displayed frame. The renderer runs a continuous clock and draws each agent at an
interpolated position between the two nearest reconstructed ticks, cycling its
walk animation as it crosses a tile, so motion reads smoothly. State that changes
at a tick boundary, such as seeds eaten, jelly spent, and the score, snaps on that
tick. The static board is autotiled into a connected maze from the wall set.

The interpolation is presentation over the reconstructed ticks. Because the
engine is shared, what a visitor watches on the
[public site](/components/site/overview/) is the simulation that decided the
match.
