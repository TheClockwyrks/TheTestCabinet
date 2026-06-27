---
title: Manifests
---

A performance test case version lives under `test-cases/<slug>/<version>/` and
declares its contents in a `test-case.toml` manifest, the same versioned,
immutable [catalog layout](/testing/end-to-end/overview/#catalog-layout) every
test type uses. Like an [adversarial manifest](/testing/adversarial/manifests/) it
builds the model's submission into a **wasm module** and runs it in a sandbox, but
it scores a single solution against a set of **inputs** under **fuel metering**
rather than pairing implementations against each other.

```toml
# test-cases/<slug>/<version>/test-case.toml
name = "Route Finder"        # human-readable display name (site-facing)
difficulty = "hard"          # relative difficulty: easy | medium | hard (required)
tags = ["performance", "algorithms"] # classification tags (site-facing, required)
summary = "..."              # optional one- or two-sentence abstract for the site cards (inline; NOT seeded)
description = "description.md" # optional site-facing prose (relative path; NOT seeded)
prompt = "prompt.hbs"        # the prompt template handed to the harness (required)
max_runtime_hours = 0.5      # cap on the harness session before it's stopped (default 1)
workspace = "workspaces/base" # starter project the model fills in (seeds the run root)
init = "cargo fetch"         # optional command run in the container after seeding, before the harness

# How the harness builds the model's submission into a wasm solution module.
# Required: the case states the commands and the artifact path explicitly.
[build]
install = "cargo fetch"                                # dependency fetch (required)
build = "cargo build --release --target wasm32-wasip2" # must emit the module (required)
module = "target/wasm32-wasip2/release/solution.wasm"  # the produced wasm artifact (required)

# The contract the solution must implement.
[contract]
entry  = "solve"               # the exported function the harness invokes per input (required)
input  = "schemas/input.json"  # the shape of an input case handed in
output = "schemas/output.json" # the shape of the answer returned

# The inputs the solution is run against, and how its answers are checked. Each
# input pairs a problem instance with the answer a correct solution must produce.
[[case]]
input    = "cases/small.json"   # an input instance fed to the solution
expected = "cases/small.out"    # the correct answer to check against

[[case]]
input    = "cases/large.json"   # a larger instance, where efficiency dominates the fuel cost
expected = "cases/large.out"

# Sandbox limits. The fuel ceiling bounds a run so a non-terminating solution
# fails rather than hangs; memory is capped so a solution cannot exhaust the host.
[sandbox]
fuel_limit       = 5_000_000_000 # wasmtime fuel ceiling per input; exceeding it fails that input
max_memory_bytes = 268_435_456   # 256 MiB linear-memory cap

# Variants. As with every test type, a case offers one or more and exactly one
# runs per run — here typically a different problem size or constraint.
[[variant]]
slug = "base"                # stable slug, recorded in the run record
name = "Base"                # display name (optional; default humanizes the slug)
spec = []                    # ADDITIVE specs on top of the common specs

# Common specs, seeded for EVERY variant (the problem statement and contract docs).
[[spec]]
source = "specs/problem.hbs"
dest   = "specs/problem.md"
```

- The site-facing metadata (`name`, `difficulty`, `tags`, `summary`,
  `description`), `prompt`, `max_runtime_hours`, `workspace`, `init`, and the
  `[[spec]]` / `[[variant]]` seeding rules behave exactly as they do for an
  [end-to-end case](/testing/end-to-end/manifests/).
- The `[build]` table is **required** and, as with an
  [adversarial case](/testing/adversarial/manifests/), emits a **wasm module**
  rather than a static site: `install` and `build` produce it and `module` names
  the artifact the harness loads. Any language that compiles to wasm is allowed.
- The `[contract]` table defines the solution interface. `entry` is the exported
  function invoked once per input; `input` and `output` are JSON Schemas for the
  instance handed in and the answer returned.
- Each `[[case]]` declares an input the solution is run against and the `expected`
  answer its output is checked against. A case typically includes both small
  instances (to confirm correctness) and large ones (where efficiency dominates
  the fuel cost), so that a correct-but-slow solution is clearly distinguished
  from an efficient one.
- The `[sandbox]` table sets the limits applied per input. `fuel_limit` is the
  wasmtime fuel ceiling — exceeding it fails that input rather than letting a
  non-terminating solution hang — and `max_memory_bytes` caps the solution's
  linear memory. The fuel a correct solution consumes within this ceiling is the
  performance result; see [Evaluation](/testing/performance/evaluation/).
