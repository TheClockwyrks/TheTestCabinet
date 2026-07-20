---
title: "Reference material"
---

Lattice hands the model everything it needs to implement and validate its engine
**short of the answer key**: the fully-documented
[rules](/testing/performance/lattice/overview/), a set of **training
scenarios** with their expected outputs, and the
[`lattice` CLI](/testing/performance/lattice/architecture/#the-cli) that
both generates more of them and scores a submission locally. What it does **not**
hand over are the **scored scenarios** — the held-out set the validator grades on.
This is the machine-learning **train/test split**, applied to a simulation
benchmark: you may practise against as many labelled examples as you like, but your
grade is on examples you have never seen.

## What the model receives

The performance run-container image provides, under the case's reference root:

- The **rules** — the simulation spec
  ([entities, the fixed-point model, compaction, splitter/inserter/assembler/source/
  sink behaviour](/testing/performance/lattice/overview/)) and the
  [prototype table](/testing/performance/lattice/architecture/#prototypes-and-recipes)
  of belt tiers, the inserter swing, and recipes. These are the **complete and authoritative**
  definition of the simulation — there is nothing about an entity's behaviour the
  model is expected to infer from examples. Lattice is a *reimplement-this-exactly*
  problem, not a *guess-the-rules* one.
- A set of **training scenarios**, each a
  [`scenario.json`](/testing/performance/lattice/architecture/#scenario--the-input)
  paired with the reference engine's
  [expected canonical output](/testing/performance/lattice/architecture/#state--the-output)
  (full state and checksum). These span the entity set and the tricky cases on
  purpose — a single side-loaded lane, a backed-up inserter, a saturated splitter, an
  assembler starved then flooded — so the model can check its engine against the exact
  behaviours the rules describe.
- The **`lattice` CLI** on `PATH`, which is both the **oracle** (`lattice solve`
  produces the expected output for *any* scenario, so the model can generate unlimited
  fresh labelled examples with `lattice gen`) and the **local scorer** (`lattice run`
  builds the submission and reports correctness + fuel using the same host the
  validator uses). See
  [The CLI](/testing/performance/lattice/architecture/#the-cli).

With these the loop is tight: write the engine, `lattice run` it against the training
scenarios to confirm it is **bit-exact**, generate harder and larger scenarios to find
where it diverges or where its fuel balloons, and iterate until it is both correct and
fast.

## The held-out scored set

The scenarios the validator actually grades — the manifest's
[`[[case]]`](/testing/performance/manifests/) entries — are **not** in the image. They
are committed with the case (the validator's, like a held-out test set), and they are
deliberately chosen to be **larger and longer** than the training scenarios: big
grids, long runs, dense belt networks where the
[efficiency gap](/testing/performance/lattice/architecture/#why-this-is-a-performance-case)
between a naive and a transport-line engine dominates the fuel total. A submission is
[scored](/testing/performance/evaluation/) by running these unseen scenarios —
correctness first (every snapshot checksum must match the reference), then the fuel a
correct engine consumed.

:::caution[There is no shortcut around simulating]
Because the scored scenarios are unseen and the
[submission runs as pure sandboxed wasm](/testing/performance/lattice/architecture/#the-cli),
there is no way to pass by **memorizing** outputs or by **reaching** the reference: a
correct checksum on an unseen scenario can only come from actually simulating it. The
training scenarios are for *building and validating* the engine, never an answer set
to hardcode — they will not be the ones you are graded on.

### Where the secrecy boundary actually is

"Held out" means held out from **the run**, not from the repository. The scored
scenarios and their expected outputs are committed with the case, and they ship inside
the distributed desktop app (which stages the `test-cases/` tree so it can run and
grade a case locally — grading reads both the input and the expected answer, so a local
runner cannot work without them).

That is deliberate and safe, because the boundary that matters is enforced at run time,
not by obscurity: the submission executes as sandboxed wasm with no filesystem access,
and the scored set is neither seeded into the workspace nor baked into the run-container
image. A model being graded cannot read these files no matter where else they exist. So
possession of the scored set by a *person* — a contributor reading the repo, a user of
the desktop app — does not weaken the gate, and is not treated as a leak.
:::

## Why this works as a benchmark

Lattice deliberately removes every source of correctness ambiguity so that **fuel is
the only thing left to compete on**. The rules are fully specified, the arithmetic is
[integer / fixed-point](/testing/performance/lattice/architecture/#determinism-and-the-canonical-state)
so the answer is bit-exact and language-independent, and the reference engine is a
black-box oracle the model can query without limit. What separates submissions is not
whether they *can* simulate a factory — the rules are right there — but **how much
work** their simulation does. A model that ports Factorio's transport-line
representation and event-driven machines lands the same checksums as one that moves
every item every tick, for a fraction of the fuel, and that difference is the entire
result.
