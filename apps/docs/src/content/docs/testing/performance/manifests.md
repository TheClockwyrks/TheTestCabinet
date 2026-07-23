---
title: Manifests
---

A performance test case version lives under `test-cases/<type>/<difficulty>/<slug>/<version>/` and
declares its contents in a `test-case.toml` manifest, the same versioned,
immutable [catalog layout](/testing/end-to-end/overview/#catalog-layout) every
test type uses. Like an [adversarial manifest](/testing/adversarial/manifests/) it
builds the model's submission into a **wasm module** and runs it in a sandbox, but
it scores a single solution against a set of **inputs** under **fuel metering**
rather than pairing implementations against each other.

```toml
# test-cases/<type>/<difficulty>/<folder>/<version>/test-case.toml
slug = "route-finder"        # stable identity (required); the store key + recorded in every run
name = "Route Finder"        # human-readable display name (site-facing)
difficulty = "hard"          # relative difficulty: easy | medium | hard (required)
experimental = false         # optional; true hides the case from the UI unless the deployment enables experimental cases (default false)
tags = ["performance", "algorithms"] # classification tags (site-facing, required)
summary = "..."              # optional one- or two-sentence abstract for the site cards (inline; NOT seeded)
description = "description.md" # optional site-facing prose (relative path; NOT seeded)
changelog = "changelog.md"   # REQUIRED per-version changelog entry (relative path; NOT seeded)
prompt = "prompt.hbs"        # the prompt template handed to the harness (required)
max_runtime_hours = 0.5      # cap on the harness session before it's stopped (default 1)
workspace = "workspaces/base" # starter project the model fills in (seeds the run root)
init = "cargo fetch"         # optional command run in the container after seeding, before the harness

# Variants: an ORDERED list of paths to standalone variant files (first = default).
# A root key, so it must precede the first table header (`[build]`). Each is a
# self-contained TOML document (top-level keys are the variant's fields), by
# convention under `variants/`, with every path resolving against the version folder.
variants = ["variants/base.toml"]

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
# `kind` (default "stress") splits the set into a correctness PRE-FLIGHT and the
# scored set: every "smoke" case must pass before any "stress" case runs.
[[case]]
input    = "smoke/one-behavior.json" # a tiny case exercising one behavior in isolation
expected = "smoke/one-behavior.out"
kind     = "smoke"               # a correctness pre-flight: gates the stress cases; fuel not scored

[[case]]
input       = "cases/small.json" # an input instance fed to the solution
expected    = "cases/small.out"  # the correct answer to check against
fuel_runway = 10.0               # optional: run past the ceiling by up to 10x to measure an overshoot
# kind defaults to "stress" — the scored set whose fuel total is the result

[[case]]
input    = "cases/large.json"   # a larger instance, where efficiency dominates the fuel cost
expected = "cases/large.out"
fuel_runway = 2.0               # keep the runway tighter on a costlier-to-verify instance

# Sandbox limits. The fuel ceiling bounds a run so a non-terminating solution
# fails rather than hangs; memory is capped so a solution cannot exhaust the host.
[sandbox]
fuel_limit       = 5_000_000_000 # wasmtime fuel ceiling per input; exceeding it fails that input
max_memory_bytes = 268_435_456   # 256 MiB linear-memory cap

# Common specs, seeded for EVERY variant (the problem statement and contract docs).
# `dest` defaults to `source` with a trailing `.hbs` removed.
[[spec]]
source = "specs/problem.md"  # dest defaults to "specs/problem.md"
```

Each `variants` entry names a standalone variant file (the first is the default) —
a TOML document whose top-level keys are the variant's fields, exactly as for an
[end-to-end case](/testing/end-to-end/manifests/). Here a variant typically varies
the seeded specs — a different problem size or constraint:

```toml
# test-cases/<type>/<difficulty>/<slug>/<version>/variants/base.toml
slug = "base"                # stable slug, recorded in the run record
name = "Base"                # display name (optional; default humanizes the slug)
spec = []                    # ADDITIVE specs on top of the common specs
```

- The site-facing metadata (`name`, `difficulty`, `tags`, `summary`,
  `description`), the required `changelog`, `prompt`, `max_runtime_hours`,
  `workspace`, `init`, and the
  `[[spec]]` and `variants` seeding rules behave exactly as they do for an
  [end-to-end case](/testing/end-to-end/manifests/) — variants are standalone
  files listed in order (the first the default), and each `[[spec]]` `dest`
  defaults to its `source`.
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
  from an efficient one. An optional `fuel_runway` (a multiplier `>= 1.0`, default
  `1.0`) lets a solution run *past* the fuel ceiling — up to
  `fuel_limit * fuel_runway` — so a too-slow-but-correct solution can finish and
  have its overshoot recorded (and stay playable) instead of trapping with no
  reading. It does **not** move the pass line: the solution still only passes
  within `fuel_limit`. Scale it **down** for larger, costlier-to-verify instances —
  the fuel beyond the ceiling is cheap steady-state work, but a wide runway on a big
  instance still adds verification wall-clock for the reading it buys.
- A `[[case]]`'s `kind` (default `"stress"`) sorts it into one of two phases. A
  `"smoke"` case is a **correctness pre-flight** — a tiny instance exercising one
  behavior in isolation, graded on correctness **alone** (its fuel is not scored).
  Every smoke case must reproduce its `expected` answer before **any** `"stress"`
  case runs; if one fails, the stress cases are **not run** and are counted as
  failed, so a broken solution is caught in milliseconds rather than after burning
  through the large scored instances. The `"stress"` cases are the scored set whose
  fuel total is the performance result. Smoke cases are held out just like the
  scored set (never seeded, never baked into the image). The run's Results tab shows
  the two phases as separate sections.
- The `[sandbox]` table sets the limits applied per input. `fuel_limit` is the
  wasmtime fuel **pass line** — a solution must produce the answer within it to
  pass, and exceeding it (beyond any `fuel_runway`) fails that input rather than
  letting a non-terminating solution hang — and `max_memory_bytes` caps the
  solution's linear memory. The fuel a correct solution consumes within the ceiling
  is the performance result; see [Evaluation](/testing/performance/evaluation/).
