**Lattice** is a performance test case: it measures how well the model's code
performs. The model writes a deterministic factory-simulation engine covering
two-lane belts with item compaction, splitters, inserters, assemblers, and the
source/sink fixtures that feed and drain them. It is scored on how little work
that engine does to simulate a factory correctly.

Lattice descends from Factorio's belt-and-machine logistics, built on a fully
deterministic fixed-point simulation. A factory's behavior is a pure function of
its layout and a tick count, so a reference engine can produce an unambiguous
expected output for any scenario, and a submission is correct iff it reproduces
that output exactly.

A run compiles the model's engine to a wasm module and runs it against a
held-out set of scenarios it never trained on, scoring two ways in order.
Correctness comes first. The engine's complete factory state must match the
reference engine's at every snapshot tick: every item's lane and position, every
inserter's swing, every assembler's buffers, every sink's counts. The comparison
is bit-for-bit by checksum, which is Factorio's own desync-detection model. A
single divergent item position anywhere fails the scenario. Only once an engine
is correct does its fuel become its result, and lower fuel is better. Fuel is
wasmtime's deterministic measure of work done.

A correct engine and an efficient one are far apart. A naive engine moves every
item on every belt every tick, spending most of its work re-confirming that
long, already-compressed runs of belt did not change. The engine Factorio itself
uses stores the gaps between items as a single transport line and advances a
packed run in constant time, touching no item at all while it flows, producing
the same checksums for a tiny fraction of the fuel. That
`O(n²)`-versus-much-less distinction is the entire result.

The model writes only the engine. The case owns the rules, the prototype table,
the sandbox, and the scoring. The reference engine is the oracle that defines
the answer; the model is handed the fully-documented rules and a `lattice` CLI
that queries the oracle and scores locally, and never the oracle's source.
