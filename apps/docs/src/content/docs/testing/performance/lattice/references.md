---
title: "Reference material"
---

Lattice hands the model everything it needs to implement and validate its engine
short of the answer key: the fully documented
[rules](/testing/performance/lattice/overview/), a set of training scenarios with
their expected outputs, and the
[`lattice` CLI](/testing/performance/lattice/architecture/#the-cli) that both
generates more of them and scores a submission locally. The scored scenarios are
held out. This is the machine-learning train/test split applied to a simulation
benchmark: a model may practise against as many labelled examples as it likes,
and its grade is on examples it has never seen.

## Provided material

The performance run-container image provides, under `$LATTICE_HOME`
(`/opt/lattice`):

- The rules, as the seeded specs and the
  [prototype table](/testing/performance/lattice/architecture/#prototypes-and-recipes)
  of belt speed, the inserter swing, the item order, and the recipes. These are
  the complete and authoritative definition of the simulation, so Lattice is a
  reimplement-this-exactly problem rather than a guess-the-rules one.
- A set of training scenarios under `$LATTICE_HOME/training/<name>/`, each a
  [`scenario.json`](/testing/performance/lattice/architecture/#the-scenario-input)
  paired with the reference oracle's
  [`expected.json`](/testing/performance/lattice/architecture/#the-state-output),
  which carries the full state and the per-snapshot checksums. They span the
  entity set and the tricky behaviours deliberately: a side-loaded lane, a backed
  up inserter, a saturated splitter, a curve, a multi-input recipe, and a
  two-stage crafting chain.
- The `lattice` CLI on `PATH`, which is both the oracle and the local scorer.
  `lattice solve` produces the expected output for any scenario and `lattice gen`
  generates fresh ones, so the model can build unlimited labelled examples.
  `lattice run` reports correctness and fuel using the same host the validator
  uses.

The engine buildkit under `$LATTICE_HOME/buildkit` holds the `lattice-core`
contract types and the `lattice-sdk` the model's `engine` crate path-depends on,
so the seeded workspace vendors nothing.

The loop is therefore tight: write the engine, `lattice run` it against the
training scenarios to confirm it is bit-exact, generate harder and larger
scenarios to find where it diverges or where its fuel balloons, and iterate until
it is both correct and fast.

## The held-out scored set

The scenarios the validator grades, the manifest's
[`[[case]]`](/testing/performance/manifests/) entries, are committed with the case
and are absent from the run-container image and from the seeded workspace. They
are deliberately larger and longer than the training scenarios: big grids, long
runs, and dense interconnected factories where the
[efficiency
gap](/testing/performance/lattice/architecture/#the-efficiency-spread)
between a naive and an efficient engine dominates the fuel total. A submission is
[scored](/testing/performance/evaluation/) by running these unseen scenarios,
correctness first, then the fuel a correct engine consumed.

Because the scored scenarios are unseen and the submission runs as pure sandboxed
wasm, a correct checksum on an unseen scenario can only come from actually
simulating it. The training scenarios exist to build and validate the engine.

### The secrecy boundary

Held out means held out from the run rather than from the repository. The scored
scenarios and their expected outputs are committed with the case, so anyone with
a checkout of the repository holds them. Grading reads both the input and the
expected answer, so the grader needs them.

That is safe because the boundary is enforced at run time. The submission
executes as sandboxed wasm with no filesystem access, and the scored set is
neither seeded into the workspace nor baked into the run-container image. A model
being graded cannot read these files wherever else they exist, so possession of
the scored set by a person is not treated as a leak.

## Benchmark properties

Lattice removes every source of correctness ambiguity so that fuel is the only
thing left to compete on. The rules are fully specified, the arithmetic is
[integer and fixed-point](/testing/performance/lattice/architecture/) so the
answer is bit-exact and language-independent, and the reference engine is a
black-box oracle the model can query without limit.

What separates submissions is how much work their simulation does. A model that
exploits the transport-line representation, event-driven machines, and the
factory's steady-state cycle lands the same checksums as one that moves every
item every tick, for a fraction of the fuel, and that difference is the entire
result.
