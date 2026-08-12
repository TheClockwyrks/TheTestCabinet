---
title: Manifests
---

A performance test case version lives under
`test-cases/<type>/<difficulty>/<slug>/<version>/` and declares its contents in a
`test-case.toml` manifest, the same versioned, immutable
[catalog layout](/testing/end-to-end/overview/#catalog-layout) every test type
uses. Like an [adversarial manifest](/testing/adversarial/manifests/) it builds
the model's submission into a wasm module and runs it in a sandbox. It scores a
single solution against a set of held-out inputs under fuel metering rather than
pairing implementations against each other.

```toml
# test-cases/<type>/<difficulty>/<folder>/<version>/test-case.toml
slug = "lattice"              # stable identity (required); the store key
name = "Lattice"              # display name (site-facing)
type = "performance"          # selects the required and forbidden tables
difficulty = "hard"           # easy | medium | hard (required)
experimental = false          # optional; hides the case unless the deployment
                              # enables experimental cases (default false)
tags = ["simulation", "wasm"] # classification tags (site-facing, required)
summary = "..."               # optional site-card abstract (inline; NOT seeded)
description = "description.md" # optional site-facing prose (NOT seeded)
changelog = "changelog.md"    # REQUIRED per-version changelog (NOT seeded)
prompt = "prompt.hbs"         # prompt template handed to the harness (required)
max_runtime_hours = 1         # cap on the harness session (default 1)
workspace = "workspaces/base" # starter project seeded at the run root
init = "cargo fetch"          # optional command run after seeding

# Variants: an ORDERED list of standalone variant files (first = default). A root
# key, so it must precede the first table header.
variants = ["variants/base.toml"]

# How the harness builds the submission into a wasm solution module.
[build]
install = "cargo fetch"
build = "cargo build --release --target wasm32-unknown-unknown -p engine"
module = "target/wasm32-unknown-unknown/release/engine.wasm"

# The contract the solution must implement.
[contract]
entry  = "simulate"              # exported function invoked once per input
input  = "schemas/scenario.json" # the shape of an input instance handed in
output = "schemas/state.json"    # the shape of the answer returned

# The held-out inputs the solution is run against. `kind` (default "stress")
# splits the set into a correctness pre-flight and the scored set.
[[case]]
input    = "smoke/belt-transport.json" # one behavior in isolation
expected = "smoke/belt-transport.out"
kind     = "smoke"               # gates the stress cases; its fuel is not scored

[[case]]
input       = "cases/small.json" # an input instance fed to the solution
expected    = "cases/small.out"  # the correct answer to check against
fuel_runway = 10.0               # optional: run past the ceiling to measure it
# kind defaults to "stress" — the scored set whose fuel total is the result

[[case]]
input       = "cases/large.json" # a larger instance, where efficiency dominates
expected    = "cases/large.out"
fuel_runway = 2.0                # a tighter runway on a costlier instance

# Sandbox limits, applied per input.
[sandbox]
fuel_limit       = 5_000_000_000 # wasmtime fuel pass line per input
max_memory_bytes = 268_435_456   # 256 MiB linear-memory cap

# Common specs, seeded for EVERY variant. `dest` defaults to `source` with a
# trailing `.hbs` removed.
[[spec]]
source = "specs/rules.md"
```

Each `variants` entry names a standalone variant file whose top-level keys are
the variant's fields, exactly as for an
[end-to-end case](/testing/end-to-end/manifests/). A performance variant
typically varies the seeded specs, for example a different problem size or an
added rule:

```toml
# test-cases/<type>/<difficulty>/<slug>/<version>/variants/base.toml
slug = "base"                # stable slug, recorded in the run record
name = "Base"                # display name (optional; humanizes the slug)
spec = []                    # ADDITIVE specs on top of the common specs
```

## Field requirements

- The site-facing metadata, the required `changelog`, `prompt`,
  `max_runtime_hours`, `workspace`, `init`, and the `[[spec]]` and `variants`
  rules behave exactly as they do for an
  [end-to-end case](/testing/end-to-end/manifests/).
- `type` must be `performance`. It requires `[build]`, `[contract]`, `[sandbox]`,
  and the `[[case]]` set, and forbids `[simulation]`, `[match]`, `[replay]`,
  `[canvas]`, `[tool]`, `[output]`, and `[[check]]`.
- The `[build]` table is required and emits a wasm module rather than a static
  site. `install` and `build` produce it, and `module` names the artifact the
  harness loads. The build must emit an import-free `wasm32-unknown-unknown` core
  module.
- The `[contract]` table defines the solution interface. `entry` is the exported
  function invoked once per input, and `input` and `output` are JSON Schemas for
  the instance handed in and the answer returned. Both are seeded into the run at
  these exact paths.
- Each `[[case]]` declares a held-out input the solution is run against and the
  `expected` answer its output is checked against. Neither is seeded into the run
  or baked into the run-container image. A case set covers both small instances
  that confirm correctness and large ones where efficiency dominates the fuel
  cost.
- A `[[case]]`'s `kind` sorts it into one of two phases and defaults to
  `"stress"`. A `"smoke"` case is a correctness pre-flight, a tiny instance
  exercising one behavior in isolation and graded on correctness alone. Every
  smoke case must reproduce its `expected` answer before any `"stress"` case
  runs; if one fails, the stress cases are skipped and counted as failed. The
  `"stress"` cases are the scored set whose fuel total is the performance result.
- A `[[case]]`'s optional `fuel_runway` is a multiplier of at least `1.0`,
  defaulting to `1.0`. It lets the solution run past the fuel ceiling, up to
  `fuel_limit * fuel_runway`, so a correct-but-slow solution finishes and has its
  overshoot recorded instead of trapping with no reading. It leaves the pass line
  at `fuel_limit`. Scale it down for larger instances: fuel beyond the ceiling is
  cheap steady-state work, but a wide runway on a big instance still adds
  verification wall-clock time.
- The `[sandbox]` table sets the limits applied per input. `fuel_limit` is the
  wasmtime fuel pass line, and `max_memory_bytes` caps the solution's linear
  memory. The fuel a correct solution consumes within the ceiling is the
  performance result; see [Evaluation](/testing/performance/evaluation/).
- A performance case need declare no `[[domain]]`: the harness grades the whole
  result, so it is exempt from the at-least-one-domain rule the other
  domain-scored types follow. Domains and `[[review_item]]` tables are still
  accepted, for a case that wants a qualitative read of the approach recorded
  alongside the number.
