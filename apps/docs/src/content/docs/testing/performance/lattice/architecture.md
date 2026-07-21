---
title: "Engine & contract"
---

Lattice's authoritative rules, the **reference engine** that produces every
scenario's expected output, and the **host** that runs and meters a submission all
live in a small set of Rust crates. The reference engine is compiled two ways —
natively (for the [CLI](#the-cli) that generates scenarios and scores locally) and to
wasm (for optional [browser visualization](#browser-visualization)) — so one
authoritative implementation defines *the answer* and there is no second rules engine
to drift from it. This page covers that code, the
[submission contract](#the-submission-contract) and its schemas, and the
[fixed-point canonical state](#determinism-and-the-canonical-state) that makes
"correct" a bit-exact notion.

For the test-type-level framing — building a submission to wasm, the fuel/memory
sandbox, and the correctness-then-fuel scoring order — read the
[performance overview](/testing/performance/overview/) and
[manifests](/testing/performance/manifests/) first; this page only adds what is
specific to Lattice. The simulation rules themselves are in the
[Lattice overview](/testing/performance/lattice/overview/).

## Crate layout

```
crates/
  lattice-core/      # the authoritative simulation: prototypes, fixed-point world,
    src/lib.rs        #   tick advance, scenario (de)serialize, canonical state + checksum.
                      #   crate-type = ["cdylib", "rlib"] — links natively and to wasm.
  lattice-host/      # the reusable wasm host: load a submission module, feed it a
    src/lib.rs        #   scenario, meter fuel/memory, read back its canonical state.
  lattice-cli/       # `lattice` binary: thin clap wrapper over core + host.
    src/main.rs
  lattice-sdk/       # ergonomic Rust SDK a submission may depend on (ABI glue +
                      #   re-exported scenario/state types).
```

- **`lattice-core`** owns everything authoritative: the
  [prototype table](#prototypes-and-recipes) (belt tiers, the inserter swing, recipes,
  and the `TILE` / `SPACING` / `SPEED` / `SWING` / `CRAFT` constants), the fixed-point
  world, the per-tick advance (belt movement and compaction, side-loading, splitter
  balancing, inserter swings, assembler crafting, source/sink bookkeeping), and the
  **canonical (de)serialization** of both the scenario and the snapshot state. It has
  **no I/O and no wasm-host dependency** — pure rules plus data — so the exact same
  crate that defines the answer for the CLI also compiles to
  `wasm32-unknown-unknown` for the browser. The scenario and state types and their
  JSON Schemas are defined here and exported, so the schemas and the engine can never
  disagree.
- **`lattice-host`** is the reusable **wasm host**
  ([`wasmtime`](https://wasmtime.dev/)). It loads the submission module, calls its
  [`simulate`](#the-submission-contract) entry once per scenario under **fuel
  metering**, enforces the memory cap, and reads back the canonical state the
  submission produced. It lives in its own crate — not in `lattice-core` (which must
  stay wasm-compilable) and not buried in the CLI — because `core`'s
  `PerformanceValidator` reuses the **exact same host** to score a submission, so the
  CLI and the validator can never diverge on what a fuel number means.
- **`lattice-cli`** is the thin native `lattice` binary: a clap wrapper that reads
  scenarios and modules off disk, calls `lattice-core` (as the reference oracle) and
  `lattice-host` (to run a submission), and reports results.
- **`lattice-sdk`** is the optional Rust SDK a submission can depend on: it owns the
  hand-rolled [ABI glue](#the-submission-abi) and re-exports the scenario/state types,
  so a Rust engine writes a plain `simulate(scenario) -> state` and never touches raw
  pointers. A submission in any other wasm-targeting language implements the same tiny
  ABI directly.

:::note[Reference engine ≠ template]
`lattice-core` is the **oracle**, not a worked solution. The model is given the
[`lattice` CLI](#the-cli) (which embeds it) to generate expected outputs and to score
locally, and the fully-documented
[rules](/testing/performance/lattice/overview/) to implement against —
but **not** `lattice-core`'s source. The reference is written for clarity and
canonical correctness, not for minimal fuel; reproducing its *outputs* is the task,
and doing so with far less work than a naive engine is the entire
[point](#why-this-is-a-performance-case).
:::

## Prototypes and recipes

The fixed constants of the world — belt tiers and their `SPEED`, the single inserter
`SWING`, item definitions, and the recipe table (inputs, output, `CRAFT`) —
live in a **prototype table** that ships with the case (in its specs) and is baked
into `lattice-core`. A scenario refers to prototypes by name (`"tier": "fast"`,
`"recipe": "gear"`); it does not redefine them. This keeps a scenario small and makes
the constants a single source of truth the reference engine and the model's engine
both read from the case, never guess.

## The CLI

`lattice` is compiled from `lattice-cli` and **baked into the performance
run-container image** (on `PATH`), alongside the
[reference material](/testing/performance/lattice/references/) the model
builds against. It does double duty — it is both the **oracle** that produces expected
outputs and the **same host** the validator scores with:

```bash
# Oracle: run the reference engine on a scenario, emit the canonical snapshot state.
lattice solve --scenario scenario.json --out expected.json

# Local scoring: build/load a submission module, run it on a scenario, diff its
# output against the reference, and report pass/fail plus the fuel it consumed.
lattice run --module target/wasm32-wasip2/release/engine.wasm \
            --scenario scenario.json

# Generate fresh randomized scenarios to expand the training set.
lattice gen --seed 0xFAC7 --grid 64x64 --ticks 100000 --out scenario.json

# Dump the scenario / state JSON Schemas straight from lattice-core.
lattice schema scenario   # | state
```

Because `lattice run` uses `lattice-host` — the same host as the validator — a model
can confirm both halves of its result locally: that its engine is **correct**
(matches the reference) and **how much fuel** it spends, with the same numbers the
scored run will report. (The CLI and the training scenarios are baked from this repo
at image-build time, so they stay in lockstep with the engine the validator scores
against — see the run-container definition under `containers/performance/`.)

:::caution[The CLI is a dev tool, not a runtime dependency]
The model uses `lattice` **during the harness session** to iterate. The **scored
submission is pure wasm** running in the sandbox with no host access — it cannot shell
out to `lattice`, read the reference engine, or reach the expected outputs. There is
no path for a submission to obtain an answer it did not compute itself, which is what
keeps the fuel number meaningful.
:::

## The submission contract

The model writes an **engine** — not a controller and not a per-tick callback, but a
function that simulates a whole scenario end to end. The submission exports the entry
named by the manifest's [`[contract] entry`](/testing/performance/manifests/) (here,
`simulate`). It is invoked **once per scenario** with the scenario encoded as JSON
bytes and must return the **snapshot state** as JSON bytes:

- [`scenario`](#scenario-the-input) in — the blueprint, the tick count, and the
  snapshot schedule.
- [`state`](#state-the-output) out — the canonical factory state at each scheduled
  snapshot tick.

One call simulates the entire run, so the **fuel** the call consumes is the cost of
the whole simulation — there is no per-tick host/guest crossing to pollute the
measurement, and the model owns its own tick loop and is free to advance the world
however efficiently it can, as long as the snapshots come out right.

### The submission ABI

For v1 a submission compiles to a **`wasm32-unknown-unknown` core module** (or any
wasm the host can instantiate; the Rust path via `wasm32-wasip2` is the documented
default). The host (`lattice-host`) and the guest exchange JSON over a small
hand-rolled C ABI of two exports — the same shape Lattice's sibling
[Foray](/testing/adversarial/foray/architecture/#the-controller-abi)
uses, applied to a once-per-scenario call instead of a per-tick one:

- `alloc(len: i32) -> i32` — the guest allocates `len` bytes in its linear memory and
  returns a pointer; the host writes the `scenario` JSON there.
- `simulate(ptr: i32, len: i32) -> i64` — the contract entry. The guest reads the
  scenario at `ptr` (`len` bytes), runs the whole simulation, writes its `state` JSON
  into its own memory, and returns the location packed as
  `((out_ptr as i64) << 32) | (out_len as i64)`. The host unpacks it and reads the
  state back out.

A Rust submission depending on [`lattice-sdk`](#crate-layout) gets this ABI for free
and just writes `simulate(scenario) -> state`.

### `scenario` — the input

The blueprint, the run length, and when to snapshot. Shape (illustrative):

```jsonc
{
  "version": 1,
  "grid": { "width": 64, "height": 64 },
  "ticks": 100000,                       // simulate this many ticks from an empty start
  "snapshots": [25000, 50000, 100000],   // emit canonical state at each of these ticks
  "entities": [
    { "type": "belt",      "x": 9,  "y": 5, "dir": "E", "tier": "fast" },
    { "type": "source",    "x": 8,  "y": 5, "dir": "E", "item": "iron-plate", "lane": "both", "period": 4 },
    { "type": "splitter",  "x": 12, "y": 5, "dir": "E" },   // occupies (12,5) and (12,6)
    { "type": "inserter",  "x": 14, "y": 6, "dir": "N" },
    { "type": "assembler", "x": 14, "y": 7, "recipe": "gear" },  // 3×3 footprint, covers (14,7)–(16,9)
    { "type": "sink",      "x": 20, "y": 5, "dir": "W" }
  ]
}
```

Entities are listed in **placement order**, which is also the order they appear in
the output. Each entity's type-specific fields (a belt's `tier`, a source's `item` /
`lane` / `period`, an assembler's `recipe` and 3×3 footprint, a splitter's two-tile
footprint) follow
the [prototype table](#prototypes-and-recipes). The
[`schemas/scenario.json`](/testing/performance/manifests/) JSON Schema is the
authoritative shape.

### `state` — the output

The canonical factory state at one snapshot tick (the output is one of these per
entry in `snapshots`). Shape (illustrative):

```jsonc
{
  "tick": 50000,
  "checksum": "fnv1a64:9f3c1a77b2e40118",   // hash of the canonical bytes below
  "entities": [                              // in scenario placement order
    { "belt": {                              // each lane: items from the output end back
        "left":  [ { "pos": 0, "item": "iron-plate" }, { "pos": 64, "item": "iron-plate" } ],
        "right": [ { "pos": 0, "item": "iron-plate" } ] } },
    { "splitter": { "rr_in": 1, "rr_out": 0, /* ...the two lanes' contents... */ } },
    { "inserter": { "phase": "swing", "held": "iron-plate", "swing_left": 3 } },
    { "assembler": { "inputs": { "iron-plate": 2 }, "output": { "gear": 1 }, "craft_left": 12 } },
    { "sink": { "consumed": { "gear": 4123 } } }
  ]
}
```

The `checksum` is the actual comparison key (see below); the **full state** is emitted
so a mismatch on a *training* scenario is debuggable down to the offending item, lane,
and tick — not just "wrong."

## Determinism and the canonical state

The whole case stands on one property: **the state after *N* ticks is a single value
every correct engine must agree on.** Two design rules guarantee it:

- **Integer / fixed-point everywhere.** Item positions, belt speeds, swing and craft
  timers are all integers; there is no floating-point arithmetic anywhere in the
  model. This sidesteps the cross-language, cross-runtime float-determinism hazard
  entirely — a submission in Rust, in JavaScript via
  [`componentize-js`](https://github.com/bytecodealliance/ComponentizeJS), or in any
  other wasm language computes the identical integers — and makes "bit-exact match" a
  meaningful, achievable bar rather than a fragile one.
- **A fully-specified canonical serialization.** Entities appear in scenario
  placement order; each belt lane lists its items from the **output end** backward;
  every field has a fixed unit and order. The reference engine's serialization is
  authoritative, and `lattice schema state` dumps its exact shape. Given the same
  scenario, two faithful engines emit **byte-identical** canonical state.

Correctness is then checked by **checksum**: `lattice-core` hashes the canonical bytes
of each snapshot, and a submission matches iff its checksum equals the reference's at
every snapshot. This is precisely Factorio's own **desync-detection** model — each
client checksums its game state and a mismatch means someone's simulation diverged —
applied here as the correctness gate. The compact checksum is what the validator
compares; the full canonical state is what makes a divergence diagnosable.

## Why this is a performance case

Correctness has one answer, but the **cost** of reaching it spans orders of
magnitude, and that spread is the reason Lattice exists.

A **naive** engine advances the world the obvious way: every tick, visit every belt
tile, and move every item on it one step. That is `O(ticks × items)` work, and with a
large factory run for hundreds of thousands of ticks the fuel is enormous — most of it
spent re-confirming that long runs of already-compressed belt did not change.

The **efficient** engine is the one Factorio itself uses
([FFF #176](https://www.factorio.com/blog/post/fff-176)): merge each maximal straight
run of belts into a single **transport line** that stores the **gaps between items**
rather than their absolute positions. While a line flows unobstructed, only the gap at
each **end** changes — the interior is a rigid compressed block — so a line of dozens
of belt segments updates in constant time by incrementing two integers, touching no
item at all. Compression is permanent (the
[overview's](/testing/performance/lattice/overview/#movement-and-compaction)
"once a belt compresses it stays that way"), so the engine caches where the last open
gap is and never rescans the packed remainder. Splitters
[break lines apart](/testing/performance/lattice/overview/#splitters);
inserters, assemblers, sources, and sinks are event-driven rather than polled. The
result is the same canonical state for a tiny fraction of the fuel.

Both engines are **correct** — they produce identical checksums. The transport-line
engine simply does far less work to do so, and **lower fuel is better**
([evaluation](/testing/performance/evaluation/)). That is the `O(n²)`-vs-`O(log n)`
distinction the [performance type](/testing/performance/overview/) is built to
measure, made concrete in a simulation the model has to actually get right before its
efficiency counts for anything.

## Browser visualization

Because `lattice-core` already compiles to wasm, a scenario can be **replayed in the
browser** for the [public site](/components/site/overview/): the renderer instantiates
the reference engine, steps it tick by tick, and a thin canvas layer draws the belts,
lanes, items, and machines so a reader can *watch* a factory run rather than read a
checksum. As with [Foray's replay](/testing/adversarial/foray/architecture/#browser-playback),
the renderer holds **no rules of its own** — the shared engine is the simulation. This
visualization is a **planned enhancement**, not part of the v1 scored path: a
performance run's decisive signal remains correctness plus the fuel number (the
[performance manifest](/testing/performance/manifests/) carries no replay renderer
today), and the visualization is a way to make a run legible, not a way to score it.

### Interpolated playback (not one tick per frame)

The renderer **must** be built the same way [Foray's was revised
to](/testing/adversarial/foray/architecture/#browser-playback): it does
**not** draw one simulation tick per displayed frame. Ticks are the simulation's
discrete steps; drawing them raw makes everything **jump** from one tick's state to
the next, which on a dense factory is illegible — items, inserter hands, and craft
progress all teleport. Instead the renderer runs a continuous clock and draws each
moving thing at an **interpolated** position between the two nearest reconstructed
ticks, so motion reads smoothly. State that genuinely changes *at* a tick boundary
(a sink's running count, an assembler depositing an output set, an item consumed)
**snaps** on that tick; only continuous motion is tweened. None of this is a rule —
the interpolation is pure presentation over the reconstructed canonical states, and
the shared engine still decides every value.

This matters more here than it does for Foray, because of how belt items move. An
item's [position](/testing/performance/lattice/overview/#the-fixed-point-item-model)
is its fixed-point distance from the lane's output end, and it advances by `SPEED`
units per tick. If the renderer drew one tick per frame, a packed run of items would
not just stutter — it could appear **not to move at all**: when every item advances
by the same step, the item that occupied position *p* last tick is replaced by a
*different* item arriving at position *p* this tick, so a naive tick-to-tick redraw
shows an item sitting at *p* both frames and the belt looks frozen except at its two
ends (where items enter and leave). The fix is the same interpolation: match each
item to its **own** next-tick position (by lane order along the line) and tween *that*
item's position across the displayed frames, so every item visibly glides forward at
the belt's speed. Inserter swings (tween the hand along its arc between phases),
source/sink pulses, and assembler craft progress are smoothed the same way.

### Renderer sprites

The art the canvas layer draws is **itself produced by The Test Cabinet**: each
entity's sprite is the output of an
[asset-generation](/testing/asset-generation/overview/) case — a
[sprite sheet](/testing/asset-generation/manifests/) drawn one operation at a time
against its own brief, the same way [Foray's
sprites](/testing/adversarial/foray/assets/) are. They sit under the
`lattice-*` slug, mirroring the in-fiction title:

| Entity | Case | Frames |
| --- | --- | --- |
| Transport belt (scrolling surface) | `lattice-belt` | 8-frame loop |
| Splitter (2-tile balancer) | `lattice-splitter` | 8-frame loop |
| Inserter (swing arm) | `lattice-inserter` | 12-frame swing cycle |
| Assembler (3×3 machine) | `lattice-assembler` | 8-frame craft loop |
| Source fixture (emitter) | `lattice-source` | 6-frame emit pulse |
| Sink fixture (drain) | `lattice-sink` | 6-frame consume pulse |
| Belt items (icon set) | `lattice-items` | 8 item icons |

The sprites are drawn at **32 px/tile** — Factorio's normal-resolution tile size,
so a one-tile entity is a 32×32 frame, the 3×3 assembler is 96×96, and a sub-tile
belt item is 16×16. They share one **projection**: Factorio's high-angle,
**pseudo-3D** view — the factory is seen from above but at a steep angle, with a
single overhead light, so the ground-level entities (belts, splitters, the
source/sink housings, the items) sit nearly flat in the ground plane while the
**machines read as raised blocks with real height** (a lit top face, beveled
sides, a grounding contact shadow). The assembler and the inserter are explicitly
*not* flat top-down silhouettes; drawing the inserter as a side elevation — the
mistake to avoid — would clash with everything around it.

Handling of facing follows from that. Flat ground entities are drawn in a **single
canonical orientation** (the flow runs east) and the renderer **rotates** them for
the other three facings rather than the case drawing each four times. The
**assembler is non-directional** — a symmetric square machine with no facing — so
the renderer draws its one sheet as-is and never rotates it. The **inserter is
directional but authored to stay rotatable**: its base is a centred pivot and its
swing happens in the ground plane (height shown by shading and a tracking contact
shadow, not by a screen-space lift), so rotating the canonical east-facing sheet
still reads correctly for the other facings. Its sheet is **item-agnostic** — it
draws only the arm and claw (the claw closed on the delivery stroke, open on the
return), never a specific item — and the renderer draws whatever the inserter is
actually carrying **into the claw**, positioned along the swing arc for the frame
the arm is on, so one sheet serves any cargo. As with the engine itself, the
renderer holds no art of its own — it composites these regenerated frames onto the
grid the canonical state describes.
