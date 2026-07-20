# The controller contract

Your controller is compiled to a **WebAssembly core module** and loaded into a
sandbox. The game invokes it **once per tick** with your colony's observation, and
applies the action you return. The two JSON schemas — `schemas/world.json` (in)
and `schemas/action.json` (out) — are the **only** channel between your controller
and the game. You never see the authoritative state, the opponent's observation,
or any way to mutate the world directly. Cheating cannot compile: there is no
representable action that touches game state.

Your controller crate is already wired up against the controller SDK (provided by
the run environment — see [Writing your controller](#writing-your-controller)
below) before the low-level ABI. The ABI section exists so you understand (or
replace) what the SDK does, not because you have to write it by hand.

## `world` — the observation (input)

Each tick you receive a `World` for your colony. Fully observable in v1 —
there is no fog; you see the whole board, both teams, every seed (ordinary and
large), and every active jelly node. The authoritative schema is
`schemas/world.json`; the shape is:

```jsonc
{
  "tick": 412,                    // 0-based tick counter
  "timestep_ms": 16,              // the fixed, faked delta (always 16)
  "team": "red",                  // which colony you drive ("red" | "blue")
  "board": {
    "width": 32, "height": 16,
    "border_x": 16,               // first column belonging to Blue's half
    "walls": [[3,4],[3,5]]        // blocked tiles, STATIC for the whole match
  },
  "score": { "red": 7, "blue": 5 },          // banked points
  "seeds_remaining": { "red_half": 13, "blue_half": 11 }, // sweep progress
  "my_agents": [                  // ALWAYS your three agents, ids 0..3
    // `load` is the number that matters: carrying + 3 * carrying_large.
    { "id": 0, "x": 14, "y": 8, "role": "raider", "carrying": 4,
      "carrying_large": 0, "load": 4,
      "immune_ticks": 0, "can_move_this_tick": false },
    { "id": 1, "x": 6, "y": 2, "role": "soldier", "carrying": 0,
      "carrying_large": 0, "load": 0,
      "immune_ticks": 0, "can_move_this_tick": true },
    // Hauling a large seed: NOTHING in `carrying`, but three units of load.
    { "id": 2, "x": 9, "y": 11, "role": "raider", "carrying": 0,
      "carrying_large": 1, "load": 3,
      "immune_ticks": 12, "can_move_this_tick": true }
  ],
  "enemies": [                    // the opposing colony's three agents (no cadence)
    { "id": 0, "x": 20, "y": 8, "role": "soldier", "carrying": 0,
      "carrying_large": 0, "load": 0, "immune_ticks": 0 }
  ],
  // EVERY takeable seed tile — ordinary caches (incl. dropped, recoverable ones)
  // AND large seeds. Step on any of these to pick it up.
  "seeds": [ [18,3], [21,9], [15,6] ],
  // The large seeds, with what `seeds` alone cannot tell you. Each also appears
  // in `seeds` above. `ticks_to_drift` is a clock: it moves whether you like it
  // or not, and it is heading for the border.
  "large_seeds": [
    { "x": 15, "y": 6, "home_x": 1, "home_y": 6, "half": "red",
      "value": 3, "ticks_to_drift": 128 }
  ],
  "jelly": [ { "x": 24, "y": 1, "active": true } ]  // ACTIVE royal-jelly nodes
}
```

Key fields to reason about:

- **`role`** is derived from the half the agent stands on — `soldier` at home,
  `raider` on the enemy half. You do not compute it; you read it.
- **`carrying`** is **ordinary** seeds eaten but not yet banked — it does **not**
  count a large seed.
- **`carrying_large`** is how many large seeds the agent holds.
- **`load`** is the number that actually matters: `carrying + 3 * carrying_large`.
  It is **both** what the agent banks if it gets home **and** what carry-weight
  charges it to move. Read `carrying` alone and a raider hauling nothing but a large
  seed looks unladen — it is in fact three units heavy, one ordinary seed away from
  losing its speed edge over a soldier. It is given to you so you never derive it.
- **`can_move_this_tick`** (own agents only) exposes the
  [carry-weight speed model](/specs/rules.md) directly: it is `true` when the agent
  has banked enough charge to step this tick if told to. A laden raider mid-stall
  reads `false` (any move you submit for it is a no-op), and because a soldier
  moves just under one tile/tick, even a soldier reads `false` on its occasional
  skipped step. Enemies do not carry this field — you do not drive them.
- **`immune_ticks`** is the remaining royal-jelly window (`0` when not immune), and
  it is given for **enemies too**. An immune ant cannot be tagged **and tags any
  non-immune enemy it meets** — including a soldier standing on its own half. An
  enemy with `immune_ticks > 0` is not a target; it is a threat.
- **`seeds`** is every takeable seed tile — ordinary caches *and* large seeds. The
  ones you *raid* are on the **enemy** half; the ones you *defend* are on your own.
  A dropped load (from a tag) appears here too, as recoverable caches.
- **`large_seeds`** is the richer view of the large seeds, which `seeds` alone
  cannot distinguish: each is worth (and weighs) `value` = 3, drifts toward the
  border every `ticks_to_drift`, and can be recalled to `home_x`/`home_y` by an ant
  of the colony named in `half`. Ignore this list and you will still pick large seeds
  up by walking onto them — you just will not know what you are holding, or that the
  ones on **your** half are walking toward the enemy.
- **`seeds_remaining`** is the sweep-progress signal, counted by **value** (a half
  starts at 20): `blue_half` is what Red still has to strip to win by sweep, and vice
  versa.

## `action` — the output

Return **one move per owned agent**, every tick. The schema is
`schemas/action.json`:

```jsonc
{
  "moves": [
    { "agent": 0, "dir": "N" },     // dir is one of: N | S | E | W | Stop
    { "agent": 1, "dir": "Stop" },
    { "agent": 2, "dir": "W" }
  ]
}
```

`N` is `y-1`, `S` is `y+1`, `E` is `x+1`, `W` is `x-1`, `Stop` holds.

## Legality — two tiers

Legality mirrors the cheating guarantee: illegal *intent* is impossible, but
ordinary bugs are forgiven, not match-ending.

- **Schema-invalid output is a forfeit.** Missing the `moves` array, naming an
  agent you do not own, omitting or duplicating an owned agent, an unknown `dir`,
  or malformed JSON — your controller **loses the match**. The SDK's helper builds
  a structurally valid `moves` list for you (exactly your three ids, once each),
  so use it and you cannot trip this.
- **A well-formed but blocked move is clamped, not punished.** A move into a wall,
  off the board, or submitted for an agent that has not banked a full step this
  tick, is applied as **Stop**. Ordinary pathfinding bugs cost you tempo, not the
  match.

One clamp is **not** harmless, and it is worth stating plainly here because it is
the one that kills controllers: a **soldier and an enemy raider that try to trade
tiles** in the same tick do not swap — and they are then treated as having **met**,
so the tagging rule settles it. Absent jelly, that means the defender **catches**
the raider. Walking a raider straight into a defender's tile in the hope of slipping
through does not cost you tempo; it costs you the agent and its whole load.

## The ABI (what the SDK does for you)

The host and guest speak a small hand-rolled C ABI over a single linear memory —
**no `wasm-bindgen`, no component model**. Your module exports exactly three
things, all of which the SDK and `rustc` provide automatically:

- `memory` — your module's linear memory (rustc emits this for a `cdylib`).
- `alloc(len: i32) -> i32` — reserve `len` bytes in your memory and return a
  pointer; the host writes the observation JSON there.
- `tick(ptr: i32, len: i32) -> i64` — the contract entry. The host calls
  `alloc(len)`, writes the `world` JSON into the returned region, then calls
  `tick(ptr, len)`. You decode the world, decide, encode the `action` JSON into
  your own memory, and return its location packed as
  `((out_ptr as i64) << 32) | (out_len as i64)`. The host reads the action back
  out of your memory at that location.

The host **reuses one wasm instance for the whole match**, so your module globals
and statics **persist across ticks** — you may build up working memory (an
explored map, a plan in flight, a per-agent assignment) and carry it forward,
exactly like a stateful agent. (The sandbox limits in `specs/sandbox.md` still
apply every tick.)

## Writing your controller

You do not implement the ABI by hand. The run environment provides a controller
SDK (`foray-controller-sdk`, under `$FORAY_HOME/buildkit`, already a
dependency of your controller) that owns `alloc`, `tick`, the JSON
decode/encode, and a
legal-action builder. You write **one function** and one macro call:

```rust
use foray_controller_sdk::controller;
use foray_core::{Action, World};

fn decide(world: &World) -> Action {
    // your strategy: read `world`, return an `Action`
}

controller!(decide);
```

`controller!(decide)` defines the `tick` export by delegating to the SDK's
dispatcher; `alloc` and `memory` come from the SDK and rustc. The crate is a
`cdylib` built for `wasm32-unknown-unknown`, and the build emits
`target/wasm32-unknown-unknown/release/controller.wasm` — the artifact the harness
loads. `controller/src/lib.rs` is a working starter you replace.

The SDK also gives you maze helpers you will want:

- `foray_controller_sdk::grid::Grid` — a passability grid built from the
  observation, with a BFS (`step_toward`, `step_to_nearest`) and `legal_dirs`, so
  you pathfind without re-deriving anything.
- `foray_controller_sdk::util::act` — iterate your owned agents and build a legal
  `Action` from a per-agent direction, guaranteeing the structural rule above.

You may write the controller in **any language that compiles to a
`wasm32-unknown-unknown` core module** exporting `memory`, `alloc`, and `tick` with
this ABI — Rust with the SDK is the supported, batteries-included path, and the
engine the run environment provides (`foray-core`, under `$FORAY_HOME/buildkit`)
is the same one the harness runs you against, so its `World`/`Action` types are
exactly right.
