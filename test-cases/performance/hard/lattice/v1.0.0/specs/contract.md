# The engine contract

Your engine is compiled to a **WebAssembly core module** and loaded into a
sandbox. The host invokes it **once per scenario** with the whole `scenario` and
reads back the `state` you return. The two JSON schemas —
`schemas/scenario.json` (in) and `schemas/state.json` (out) — are the
authoritative shapes, and the only channel between your engine and the host. You
own your own tick loop; the host does not call you per tick.

Your engine crate is already wired up against the engine SDK (`lattice-sdk`,
provided by the run environment — see
[Writing your engine](#writing-your-engine) below) over the low-level ABI. The
ABI section exists so you understand (or replace) what the SDK does, not because
you have to write it by hand.

## `scenario` — the input

The blueprint, the run length, and the snapshot schedule. The authoritative
schema is `schemas/scenario.json`; the shape is:

```jsonc
{
  "version": 1, // must equal 1
  "grid": { "width": 64, "height": 64 },
  "ticks": 100000, // simulate this many ticks from an empty start
  "snapshots": [25000, 50000, 100000], // canonical state at each; ascending
  "entities": [
    // placement order = output order, and tick-visit order
    { "type": "belt", "x": 9, "y": 5, "dir": "E", "tier": "fast" },
    {
      "type": "source",
      "x": 8,
      "y": 5,
      "dir": "E",
      "item": "iron-plate",
      "lane": "both",
      "period": 4,
    },
    { "type": "splitter", "x": 12, "y": 5, "dir": "E" }, // covers (12,5),(12,6)
    { "type": "inserter", "x": 14, "y": 6, "dir": "N" },
    { "type": "assembler", "x": 14, "y": 7, "recipe": "iron-gear" }, // 3×3 block
    { "type": "sink", "x": 20, "y": 5, "dir": "W" },
  ],
}
```

- `version` must equal `1`. `snapshots` is non-empty, strictly ascending, and
  each tick is in `1..=ticks`.
- Each entity carries only its type-specific fields, named in the
  [prototype table](/specs/prototypes.md) and `specs/rules.md`. Field naming is
  `snake_case`; `dir` is uppercase `"N"|"S"|"E"|"W"`; `lane` is
  `"left"|"right"|"both"`; `type`, `tier`, `recipe`, and `item` are lowercase
  kebab strings.
- **Entities are listed in placement order, which is both the output order and
  the per-phase tick-visit order** — getting the deterministic state right
  depends on honouring it (see the tick order in `specs/rules.md`).

## `state` — the output

You return a JSON **array** of snapshots — one per entry in
`scenario.snapshots`, in the same order. Each snapshot is the canonical factory
state at that tick. The authoritative schema is `schemas/state.json`; the shape
of one snapshot is:

```jsonc
{
  "tick": 50000,
  "checksum": "fnv1a64:9f3c1a77b2e40118", // the comparison key — see specs/canonical-state.md
  "entities": [
    // in scenario placement order
    {
      "belt": {
        "left": [
          { "pos": 0, "item": "iron-plate" },
          { "pos": 64, "item": "iron-plate" },
        ],
        "right": [{ "pos": 0, "item": "iron-plate" }],
      },
    },
    { "source": { "emit_phase": 2 } },
    { "splitter": { "rr_in": 1, "rr_out": 0 } },
    { "inserter": { "phase": "swing", "held": "iron-plate", "swing_left": 3 } },
    {
      "assembler": {
        "inputs": { "iron-plate": 2 },
        "output": { "iron-gear": 1 },
        "craft_left": 12,
      },
    },
    { "sink": { "consumed": { "iron-gear": 4123 } } },
  ],
}
```

- Each entity is **externally tagged** (`{ "belt": {...} }`,
  `{ "sink": {...} }`, …) and the array stays **parallel to the scenario's
  `entities`**, in placement order.
- A **belt** lists each lane's items from the output end backward (ascending
  `pos`). A **splitter** carries only its two cursors — `out_pref` (the
  per-(item-type, lane) output-preference bitfield) and `in_first` (which input belt
  it tries first this tick). An
  **inserter** carries `phase` (`"idle"|"swing"`), the held item (omitted when
  none), and `swing_left`. An **assembler** carries its `inputs`/`output` count
  maps (empty maps allowed) and `craft_left`. A **source** carries `emit_phase`
  (= `tick % period`). A **sink** carries its `consumed` count map.
- The validator compares **only the `checksum`** per snapshot. The full state is
  for your own debugging when a training scenario diverges — `lattice run` tells
  you the first mismatching snapshot tick, and the full state lets you find the
  offending item, lane, or buffer.

### The checksum is what matters

The `checksum` is a hash of a **canonical byte serialization** of the snapshot,
not of the JSON text — so JSON formatting can never affect correctness. You must
compute it exactly as `specs/canonical-state.md` specifies (and the SDK's
`Snapshot::new` does it for you if you build snapshots through the re-exported
`lattice_core` types). An engine matches iff its checksum equals the
reference's at **every** snapshot; a single mismatch fails the scenario.

## Sandbox and limits

Your engine runs inside a wasm sandbox with **per-scenario** limits (set in the
manifest's `[sandbox]` table):

| Limit                                                  | Shipped value                     | On exceeding                         |
| ------------------------------------------------------ | --------------------------------- | ------------------------------------ |
| **Fuel** (wasmtime fuel for the whole `simulate` call) | **5,000,000,000**                 | that scenario fails (no fuel result) |
| **Memory** (linear-memory cap)                         | **256 MiB** (`268,435,456` bytes) | that scenario fails                  |

- **Fuel** is wasmtime's deterministic measure of work, charged across the
  single `simulate` call for the entire simulation — it is set once before the
  call and the amount consumed is your performance result. It is a **hard
  ceiling**: a scenario whose simulation exhausts the fuel ceiling fails (it is
  recorded as incorrect and earns no fuel result), so an inefficient engine that
  overruns the budget on a large scenario produces no result on it. **Lower fuel is
  better.**
- **Memory** caps your module's linear memory for the whole call. The efficient
  transport-line representation is also the memory-frugal one.

An engine that fails to build, does not export the contract entry, traps,
exceeds either limit, returns the wrong number of snapshots, or produces a wrong
checksum on any scenario is **incorrect** and earns no performance result
— correctness is the gate the engine must pass before its fuel means anything.

## The ABI (what the SDK does for you)

The host and guest speak a small hand-rolled C ABI over a single linear memory —
**no `wasm-bindgen`, no component model**. Your module exports exactly three
things, all of which the SDK and `rustc` provide automatically:

- `memory` — your module's linear memory (rustc emits this for a `cdylib`).
- `alloc(len: i32) -> i32` — reserve `len` bytes in your memory and return a
  pointer; the host writes the `scenario` JSON there.
- `simulate(ptr: i32, len: i32) -> i64` — the contract entry. The host calls
  `alloc(len)`, writes the `scenario` JSON into the returned region, then calls
  `simulate(ptr, len)`. You decode the scenario, run the **whole** simulation,
  encode the `state` JSON (the array of snapshots) into your own memory, and
  return its location packed as `((out_ptr as i64) << 32) | (out_len as i64)`.
  The host reads the state back out of your memory at that location.

Because the whole simulation is one call, the **fuel that call consumes is the
cost of the whole run** — there is no per-tick host/guest crossing to pollute
the measurement, and you are free to advance the world however efficiently you
can, as long as the snapshots come out right.

## Writing your engine

You do not implement the ABI by hand. The run environment provides the engine
SDK (`lattice-sdk`, under `$LATTICE_HOME/buildkit`, already a dependency of your
engine crate) that owns `alloc`, `simulate`, and the JSON decode/encode, and
re-exports the `Scenario`/`Snapshot` contract types and the canonical
state/checksum from `lattice-core`. You write **one function** and one macro
call:

```rust
use lattice_sdk::{simulate, Scenario, Snapshot};

fn run(scenario: &Scenario) -> Vec<Snapshot> {
    // your engine: simulate `scenario`, returning one Snapshot per scheduled
    // snapshot tick, in `scenario.snapshots` order.
}

simulate!(run);
```

`simulate!(run)` defines the `simulate` export by delegating to the SDK's
dispatcher; `alloc` and `memory` come from the SDK and rustc. The crate is a
`cdylib` built for `wasm32-unknown-unknown`, and the build emits
`target/wasm32-unknown-unknown/release/engine.wasm` — the artifact the harness
loads. `engine/src/lib.rs` is a working but slow starter you replace.

**The SDK gives you the contract types and the checksum.** The re-exported
`Snapshot::new(tick, entities)` computes the canonical checksum over the
canonical bytes for you, and the `Scenario`/entity types match the schemas
exactly. The buildkit's `lattice-core` also includes a straightforward reference
simulation you _may_ call to get a correct answer — but it is the **naive**
engine, the move-every-item-every-tick loop, and it spends far more fuel than it
needs to (the starter's floor `run` delegates to it). Calling it makes you
_correct_ but not _fast_, and **fast is the whole contest** — correctness is
only the gate. The work here is to rewrite the _simulation_ (belt
compaction, side-loading, splitter balancing, inserter swings, assembler
crafting, source/sink bookkeeping, the tick order from `specs/rules.md`) with an
efficient representation so the same checksums come out for a fraction of the
fuel.

You may write the engine in **any language that compiles to a
`wasm32-unknown-unknown` core module** exporting `memory`, `alloc`, and
`simulate` with this ABI — Rust with the SDK is the supported,
batteries-included path. If you build the canonical bytes and checksum yourself
(in another language), follow `specs/canonical-state.md` to the byte; the
checksum is the only thing compared. (The Rust path via `wasm32-wasip2` is a
documented forward-looking option; for v1 the host instantiates a plain
`wasm32-unknown-unknown` core module with no imports, which is what the starter
and the build command produce.)
