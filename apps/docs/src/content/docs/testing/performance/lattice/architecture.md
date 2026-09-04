---
title: "Engine & contract"
---

Lattice's authoritative rules, the reference engine that produces every
scenario's expected output, and the host that runs and meters a submission live
in a small set of Rust crates. The reference engine compiles natively for the
[CLI](#the-cli) and to wasm for [browser playback](#browser-playback), so one
implementation defines the answer and there is no second rules engine to drift
from it.

This page covers that code, the [submission contract](#the-submission-contract),
and the [canonical state](#determinism-and-the-canonical-state) that makes
"correct" a bit-exact notion. Building a submission to wasm, the sandbox, and the
correctness-then-fuel scoring order are covered in the
[performance overview](/testing/performance/overview/) and
[manifests](/testing/performance/manifests/). The simulation rules are in the
[Lattice overview](/testing/performance/lattice/overview/).

## Crate layout

```
crates/
  lattice-core/          # prototypes, fixed-point world, tick advance,
                         #   scenario/state (de)serialize, canonical checksum
  lattice-host/          # the wasm host: load a submission, feed it a scenario,
                         #   meter fuel and memory, read back its state
  lattice-cli/           # the `lattice` binary, a clap wrapper over core + host
  lattice-sdk/           # the Rust SDK a submission may depend on
  lattice-ref-naive/     # calibration engine: correct, move every item every tick
  lattice-ref-transport/ # calibration engine: correct and efficient
```

`lattice-core` owns everything authoritative: the
[prototype table](#prototypes-and-recipes), the fixed-point world, the per-tick
advance, and the canonical serialization of both the scenario and the snapshot
state. It has no I/O and no wasm-host dependency, so the same crate that defines
the answer for the CLI also compiles to `wasm32-unknown-unknown` for the browser.
The scenario and state types and their JSON Schemas are defined here and
exported, so the schemas and the engine can never disagree.

`lattice-host` is the reusable [`wasmtime`](https://wasmtime.dev/) host. It loads
the submission module, calls its [`simulate`](#the-submission-contract) entry once
per scenario under fuel metering, enforces the memory cap, and reads back the
canonical state the submission produced. It is a separate crate because
`lattice-core` must stay wasm-compilable and because core's
`PerformanceValidator` reuses this exact host to score a submission, so the CLI
and the validator can never diverge on what a fuel number means.

`lattice-cli` is the thin native `lattice` binary. It reads scenarios and modules
off disk, calls `lattice-core` as the reference oracle and `lattice-host` to run
a submission, and reports results.

`lattice-sdk` is the optional Rust SDK a submission depends on. It owns the
[ABI glue](#the-submission-abi) and re-exports the scenario and state types, so a
Rust engine writes a plain `simulate(scenario) -> state`. A submission in any
other wasm-targeting language implements the same ABI directly.

The two `lattice-ref-*` engines calibrate the case. They are both correct and
post identical checksums, and the fuel between them is the spread the case
measures. Neither reaches the model, in source or as wasm, because an efficient
reference on disk would be an answer key.

:::note[The reference engine is not a template]
`lattice-core` is the oracle rather than a worked solution. The model receives the
[`lattice` CLI](#the-cli), which embeds it, to generate expected outputs and score
locally, and the fully documented
[rules](/testing/performance/lattice/overview/) to implement against. It does not
receive `lattice-core`'s source. The reference is written for clarity and
canonical correctness rather than for minimal fuel; reproducing its outputs is
the task, and doing so with far less work than a naive engine is the
[point](#the-efficiency-spread).
:::

## Prototypes and recipes

The fixed constants of the world live in a prototype table that ships with the
case in its specs and is baked into `lattice-core`: the per-tier belt `SPEED`,
the single inserter `SWING` tied to the reference (`fast`) speed, the item
definitions and their stable index order, and the recipe table of inputs, output,
and `CRAFT` cost.

A scenario refers to prototypes by name, for example `"tier": "fast"` and
`"recipe": "iron-gear"`, and never redefines them. That keeps a scenario small
and makes the constants a single source of truth both the reference engine and
the model's engine read from the case.

## The CLI

`lattice` is compiled from `lattice-cli` and baked onto `PATH` in the performance
run-container image, alongside the
[reference material](/testing/performance/lattice/references/) the model builds
against. It is both the oracle that produces expected outputs and the same host
the validator scores with:

```bash
# Oracle: run the reference engine on a scenario, emit the canonical state.
lattice solve --scenario scenario.json --out expected.json

# Local scoring: run a submission module on a scenario, diff its output against
# the reference, and report pass/fail plus the fuel it consumed.
lattice run --module target/wasm32-unknown-unknown/release/engine.wasm \
            --scenario scenario.json

# Generate a fresh, deterministic, valid scenario from a seed.
lattice gen --seed 0xFAC7 --layout bus --grid 64x64 --ticks 100000 \
            --out scenario.json

# Dump the scenario / state JSON Schemas straight from lattice-core.
lattice schema scenario   # | state
```

Because `lattice run` uses `lattice-host`, a model confirms both halves of its
result locally: that its engine is correct, and how much fuel it spends, with the
same numbers the scored run reports. The CLI and the training scenarios are baked
from this repository at image-build time, so they stay in lockstep with the
engine the validator scores against. The image is defined under
`containers/performance/`.

The model uses `lattice` during the harness session to iterate. The scored
submission is pure wasm running in the sandbox with no host access, so it cannot
shell out to `lattice`, read the reference engine, or reach the expected outputs.

## The submission contract

The model writes an engine: a function that simulates a whole scenario end to
end. The submission exports the entry named by the manifest's `[contract] entry`,
which is `simulate`. It is invoked once per scenario with the scenario encoded as
JSON bytes and returns the snapshot states as JSON bytes:

- [`scenario`](#the-scenario-input) in: the blueprint, the tick count, and the
  snapshot schedule.
- [`state`](#the-state-output) out: the canonical factory state at each scheduled
  snapshot tick.

One call simulates the entire run, so the fuel the call consumes is the cost of
the whole simulation. There is no per-tick host crossing to pollute the
measurement, and the model owns its own tick loop and advances the world however
efficiently it can, as long as the snapshots come out right.

### The submission ABI

A submission compiles to an import-free `wasm32-unknown-unknown` core module. The
host and the guest exchange JSON over a small C ABI, the same shape
[Foray](/testing/adversarial/foray/architecture/#the-controller-abi) uses, applied
to a once-per-scenario call. The module exports `memory` plus:

- `alloc(len: i32) -> i32`. The guest allocates `len` bytes in its linear memory
  and returns a pointer; the host writes the `scenario` JSON there.
- `simulate(ptr: i32, len: i32) -> i64`. The contract entry. The guest reads the
  scenario at `ptr` (`len` bytes), runs the whole simulation, writes its `state`
  JSON into its own memory, and returns the location packed as
  `((out_ptr as i64) << 32) | (out_len as i64)`. The host unpacks it and reads the
  state back out.

A Rust submission depending on `lattice-sdk` gets this ABI for free.

### The `scenario` input

The blueprint, the run length, and when to snapshot:

```jsonc
{
  "version": 1,
  "grid": { "width": 64, "height": 64 },
  "ticks": 100000,                       // simulate this many ticks from empty
  "snapshots": [25000, 50000, 100000],   // emit canonical state at each tick
  "entities": [
    { "type": "belt",   "x": 9, "y": 5, "dir": "E", "tier": "fast" },
    { "type": "source", "x": 8, "y": 5, "dir": "E", "item": "iron-ore",
      "lane": "both", "period": 4 },
    { "type": "splitter", "x": 12, "y": 5, "dir": "E" }, // covers (12,5)-(12,6)
    { "type": "inserter", "x": 14, "y": 6, "dir": "N" },
    { "type": "assembler", "x": 14, "y": 7, "recipe": "iron-plate" },
    { "type": "sink", "x": 20, "y": 5, "dir": "W" }
  ]
}
```

Entities are listed in placement order, which is also the order they appear in
the output and the order each tick phase visits them. Each entity's type-specific
fields follow the [prototype table](#prototypes-and-recipes). The seeded
`schemas/scenario.json` is the authoritative shape.

### The `state` output

An array with one canonical snapshot per entry in the scenario's `snapshots`:

```jsonc
[
  {
    "tick": 50000,
    "checksum": "fnv1a64:9f3c1a77b2e40118",  // hash of the canonical bytes
    "entities": [                            // in scenario placement order
      { "source": { "emit_phase": 1 } },
      { "belt": {                            // each lane: from the output end back
          "left":  [ { "pos": 0, "item": "iron-ore" } ],
          "right": [ { "pos": 64, "item": "iron-ore" } ] } },
      { "splitter": { "out_pref": 1, "in_first": 0 } },
      { "inserter": { "phase": "swing", "held": "iron-ore", "swing_left": 3 } },
      { "assembler": { "inputs": { "iron-ore": 2 }, "output": {},
                       "craft_left": 12 } },
      { "sink": { "consumed": { "iron-plate": 4123 } } }
    ]
  }
]
```

The `checksum` is the comparison key. The full state is emitted so that a
mismatch on a training scenario is debuggable down to the offending item, lane,
and tick.

## Determinism and the canonical state

The case stands on one property: the state after *N* ticks is a single value
every correct engine agrees on. Two rules guarantee it.

Everything is integer and fixed-point. Item positions, belt speeds, and swing and
craft timers are all integers, with no floating-point arithmetic anywhere in the
model. That sidesteps cross-language and cross-runtime float-determinism hazards
entirely, so an engine in any wasm-targeting language computes the identical
integers and a bit-exact match is an achievable bar.

The serialization is fully specified. Entities appear in scenario placement
order, each belt lane lists its items from the output end backward, and every
field has a fixed unit and order. Items are written as their stable numeric index
rather than as strings, so the canonical bytes are language- and
format-independent. The reference engine's serialization is authoritative, and
`lattice schema state` dumps its exact shape.

Correctness is then checked by checksum. `lattice-core` hashes the canonical
bytes of each snapshot with FNV-1a 64 and formats the result as
`fnv1a64:<16 lowercase hex digits>`. A submission matches exactly when its
checksum equals the reference's at every snapshot. This is Factorio's own
desync-detection model applied as the correctness gate. The compact checksum is
what the validator compares, and the full canonical state is what makes a
divergence diagnosable.

### The compared checksum is derived from the returned state

A submission returns JSON, and its `checksum` is a plain field in it: nothing in
the wire format binds that string to the `entities` beside it. The host does not
take it on trust. For each returned snapshot it re-serializes the entities the
submission returned to canonical bytes, hashes those itself, and requires the
result to equal both the checksum the submission reported and the reference's
(`lattice-host`'s `score_against`). A snapshot whose reported checksum is not its
own state's is a wrong answer, as is one naming an item the prototype table does
not define. The re-derivation runs host-side and unmetered, so it costs a
submission no fuel.

That is what makes the state, rather than a claim about it, the graded key, and
it is the property [browser playback](#browser-playback) depends on: the factory
a reviewer watches is drawn from those same `entities`. Without it, an engine
that reported the oracle's checksums beside state it never computed would grade
as correct and then animate a factory that visibly disagreed with the
[Reference tab](#the-reference-tab), which is exactly what once happened.

## The efficiency spread

Correctness has one answer, and the cost of reaching it spans orders of
magnitude. That spread is what the case measures.

A naive engine advances the world the obvious way: every tick, visit every belt
tile and move every item on it one step. That is `O(ticks × items)` work, and on
a large factory run for hundreds of thousands of ticks the fuel is enormous, most
of it spent re-confirming that long runs of already-compressed belt did not
change.

An efficient engine refuses to re-walk state that is not changing. Factorio's own
transport-line representation
([FFF #176](https://www.factorio.com/blog/post/fff-176)) merges each maximal
straight run of belts into a single line that stores the gaps between items
rather than their absolute positions, so while a line flows unobstructed only the
gap at each end changes and dozens of belt segments update in constant time.
Compression is permanent, so the engine caches where the last open gap is and
never rescans the packed remainder. Inserters, assemblers, sources, and sinks are
event-driven rather than polled. A scenario is driven entirely by periodic
sources, so the whole factory settles into a cycle after a finite warm-up, and an
engine that detects that cycle fast-forwards across it and advances only the
sinks' totals.

Both engines are correct and produce identical checksums. The efficient one does
far less work to do so, and lower fuel is better. On the shipped scored set that
gap is roughly 50× to 65× in fuel.

## Browser playback

Browser playback steps a run's own engine, the submission's compiled
`engine.wasm` rather than the reference, so a reader watches the factory the
submission actually computed. The engine exports a tick-at-a-time playback ABI
(`playback_load`, `playback_board`, `playback_step`, `playback_reset`) that the
`lattice-sdk` macro wires up alongside the scored `simulate` entry, and a thin
canvas layer drives it to draw the belts, lanes, items, and machines. As with
[Foray's replay](/testing/adversarial/foray/architecture/#browser-playback), the
renderer holds no rules of its own. The reference engine compiles to that same
ABI, which is what the case's own [Reference tab](#the-reference-tab) plays; a
run's playback drives the submission's module.

The submission's engine is arbitrary code, and its `playback_load` runs a whole
window of ticks up front, so it may trap, spin, or grow memory until it exhausts
its allocation. The console therefore runs it in a Web Worker under a load
timeout, never on the main thread, and terminates a runaway module. The SDK's
playback ABI runs the engine over a bounded dense window from tick 0, one frame
per tick, caches those frames, and streams them to the renderer. The window is
bounded because a per-tick canonical state lists every item's position, so a
full-length trace is far too large to hold. A module that fails to start leaves
playback unavailable, since there is no reference fallback to show a factory the
submission never ran.

The scored boards are larger than a browser viewport at any legible scale: the
medium factory is 48×32 cells and the large one 72×40, at one 32px sprite per
cell. The player therefore fits the whole board to the window by default and
offers a zoom ladder, with `Ctrl`/`Cmd` and the wheel zooming about the cursor,
for looking closer. A factory is read as a whole — which lanes are starved, where
items pile up, and which branch of the bus has stalled are all properties of the
layout at large, invisible when a viewer can only see a screenful at a time.

Playback makes a run legible rather than scoring it, and the decisive signal
stays correctness plus the fuel number. It honours the held-out split: a run
publishes a scored scenario for playback only for a case whose answer was
correct, including a correct-but-over-ceiling case, so a wrong run's held-out
input is never revealed.

### The drift gate

Playback re-steps the run's own module, so at a tick the run graded, the frame
the module emits must carry the checksum the run
[recorded](/components/core/run-records/). The player compares the two and shows
a standing warning when they disagree, because the factory on screen is then not
the one the verdict covers. The gate compares the checksums the two paths report
and re-derives nothing — the renderer holds no rules — which is why it is paired
with the host's
[derived checksum](#the-compared-checksum-is-derived-from-the-returned-state):
the host ties a run's recorded checksum to real state, and the drift gate ties
the frames on screen to that recorded checksum.

The gate can only check ticks inside the played window, so the scenario generator
schedules graded snapshots inside it (`PLAYBACK_WINDOW_TICKS`, at the window's
midpoint and its final tick) alongside the quarter, half, and end checkpoints.
Before that, a scored scenario's earliest graded tick was 12,500 and the window
ended at 2,500: the graded stretch and the watchable stretch were disjoint, every
frame a viewer could see was ungraded, and the gate had nothing to compare.

### The Reference tab

A run's playback answers what this model's engine computed. The case's Reference
tab answers the question underneath it — what the factory is supposed to look
like — by playing the three scored scenarios through the reference engine. It is
the performance-case analogue of an [end-to-end](/testing/end-to-end/overview/)
case's reference build and an [asset](/testing/asset-generation/overview/) case's
published reference frames: a performance case produces neither a site nor an
image but an engine, so its reference is what the authoritative engine does.

Both halves ship with the UI bundle — `lattice-core.wasm`, already vendored for
the renderer, and the scenarios — vendored by
`scripts/vendor-lattice-assets.mjs` from the case's replay bundle. They cannot
come from a run's artifacts, because the tab is reachable with no run at all and
on the static site, which has no backend to ask. That is also why the tab is
offered off the case rather than off a per-variant signal, the way the other two
references are.

The scenarios are the scored layouts verbatim, the same grid and the same
entities, with one change: the timeline is cut to the same dense window the SDK
bounds a submission's playback to, so the reference and a run's factory are
watched over identical ticks and read side by side. The reference driver, unlike
the SDK's, has no window of its own — it emits a full canonical state every tick
— so the cut is made in the committed scenario by the bundle's
`gen-reference.mjs`.

This does publish the held-out inputs on the case page. That is a deliberate
call: the inputs were already published per correct run, and the answer key (the
`.out` oracles and the fuel a run burned) is not in them, so what a reader gets
is the factory, not the grade.

### Interpolated playback

The renderer runs a continuous clock rather than drawing one simulation tick per
displayed frame. It draws each moving thing at an interpolated position between
the two nearest reconstructed ticks, so motion reads smoothly. State that changes
at a tick boundary, such as a sink's running count, an assembler depositing an
output set, or an item being consumed, snaps on that tick. The interpolation is
presentation over the reconstructed canonical states, and the engine still
decides every value.

Interpolation matters more here than it does for Foray because of how belt items
move. An item's position is its fixed-point distance from the lane's output end
and advances by `SPEED` units per tick, so on a packed run the item that occupied
a position last tick is replaced by a different item arriving at that position
this tick. A tick-per-frame redraw would show an item sitting there in both
frames and the belt would look frozen except at its two ends. The renderer
therefore matches each item to its own next-tick position by lane order along the
line and tweens that item's position across the displayed frames, so every item
visibly glides forward at the belt's speed. Inserter swings, source and sink
pulses, and assembler craft progress are smoothed the same way.

### Renderer sprites

The art the canvas layer draws is itself produced by The Test Cabinet. Each
entity's sprite is the output of an
[asset-generation](/testing/asset-generation/overview/) case drawn against its own
brief, under the `lattice-*` slug:

| Entity | Case | Frames |
| --- | --- | --- |
| Transport belt (scrolling surface) | `lattice-belt` | 48: three tiers × (8-frame straight loop + 8-frame curve) |
| Splitter (2-tile balancer) | `lattice-splitter` | 8-frame loop |
| Inserter (swing arm) | `lattice-inserter` | 36: three tiers × 12-frame swing cycle |
| Assembler (3×3 machine) | `lattice-assembler` | 24: three tiers × 8-frame craft loop |
| Source fixture (emitter) | `lattice-source` | 6-frame emit pulse |
| Sink fixture (drain) | `lattice-sink` | 6-frame consume pulse |
| Belt items (icon set) | `lattice-items` | 17 item icons (8 base materials + 9 machine icons) |

The belt, inserter, and assembler are drawn across three upgrade tiers laid end
to end. The atlas, `sheet.json`, records each tier's frames and its own playback
rate, and the renderer plays the tier a belt's scenario `tier`
(`slow`/`fast`/`express`) selects, so the tread scrolls faster the higher the
tier. The inserter and assembler have tiered art but no engine tier yet, so the
renderer draws tier 1 until one is resolved. The item icons cover the eight base
materials the engine carries plus nine machine icons (belt, assembler, and
inserter in three tiers each) seeded ahead of the recipes that will craft them.

The sprites are drawn at 32 px per tile, so a one-tile entity is a 32×32 frame
and the 3×3 assembler is 96×96. A belt item is a 32×32 icon too, which the
renderer draws at a sub-tile half-cell so four ride a tile without swamping it.
They share one projection: a high-angle pseudo-3D view with a single overhead
light, in which the ground-level entities sit nearly flat in the ground plane
while the machines read as raised blocks with real height, drawn with a lit top
face, beveled sides, and a grounding contact shadow.

Facing follows from that projection. Flat ground entities are drawn in a single
canonical orientation, with the flow running east, and the renderer rotates them
for the other three facings. The assembler is a symmetric square machine with no
facing, so the renderer draws its sheet as-is. The inserter is directional and
authored to stay rotatable: its base is a centred pivot and its swing happens in
the ground plane, with height shown by shading and a tracking contact shadow, so
rotating the canonical east-facing sheet reads correctly for the other facings.
Its sheet is item-agnostic and draws only the arm and claw, closed on the
delivery stroke and open on the return, and the renderer draws whatever the
inserter is carrying into the claw along the swing arc.
