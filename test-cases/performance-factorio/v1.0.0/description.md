**Lattice** is The Test Cabinet's first _performance_ test case: instead of
judging only whether a model writes working code, it measures **how well that
code performs**. The model writes a **deterministic factory-simulation engine**
— two-lane belts with item compaction, splitters, inserters, assemblers, and the
source/sink fixtures that feed and drain them — and is scored on how little
**work** it does to simulate a factory correctly.

Lattice descends from **Factorio**'s belt-and-machine logistics, the canonical
example of a game built on a fully deterministic fixed-point simulation — the
same property that lets Factorio run multiplayer in lockstep, every client
simulating independently and staying bit-for-bit identical. That determinism is
what makes it a good performance case: a factory's behaviour is a pure function
of its layout and a tick count, so a reference engine can produce an unambiguous
expected output for any scenario, and a submission is correct iff it reproduces
that output exactly.

A run compiles the model's engine to a wasm module and runs it against a
**held-out** set of scenarios it never trained on, scoring two ways in order.
**Correctness comes first**: the engine's complete factory state — every item's
lane and position, every inserter's swing, every assembler's buffers, every
sink's counts — must match the reference engine's at every snapshot tick,
compared bit-for-bit by checksum (Factorio's own desync-detection model). A
single divergent item position anywhere fails the scenario. Only once an engine
is correct does its **fuel** — wasmtime's deterministic measure of work done —
become its result, and **lower fuel is better**.

The point of the case is the enormous gap between a correct engine and an
efficient one. A naive engine moves every item on every belt every tick,
spending most of its work re-confirming that long, already-compressed runs of
belt did not change. The engine Factorio itself uses stores the gaps between
items as a single transport line and advances a packed run in constant time,
touching no item at all while it flows — the same checksums for a tiny fraction
of the fuel. That `O(n²)`-versus-much-less distinction, made concrete in a
simulation the model has to actually get right before its efficiency counts for
anything, is the entire result.

The model writes only the engine; the rules, the prototype table, the sandbox,
and the scoring are owned by the case. The reference engine is the oracle that
defines the answer — the model is handed the fully-documented rules and a
`lattice` CLI that queries the oracle and scores locally, but never the oracle's
source. Reproducing its _outputs_ with far less work is the whole task.
