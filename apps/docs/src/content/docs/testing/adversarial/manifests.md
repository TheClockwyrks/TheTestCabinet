---
title: Manifests
---

An adversarial test case version lives under
`test-cases/<type>/<difficulty>/<slug>/<version>/` and declares its contents in a
`test-case.toml` manifest, the same versioned, immutable
[catalog layout](/testing/end-to-end/overview/#catalog-layout) every test type
uses. On top of the fields an
[end-to-end manifest](/testing/end-to-end/manifests/) declares, an adversarial
manifest describes the game, the controller contract the model must implement,
the sandbox limits, the simulation loop, and how matches are structured and
replayed.

```toml
# test-cases/<type>/<difficulty>/<folder>/<version>/test-case.toml
slug = "capture"              # stable identity (required); the store key
name = "Capture"              # display name (site-facing)
type = "adversarial"          # selects the required and forbidden tables
difficulty = "hard"           # easy | medium | hard (required)
experimental = false          # optional; hides the case unless the deployment
                              # enables experimental cases (default false)
tags = ["ctf", "wasm"]        # classification tags (site-facing, required)
summary = "..."               # optional site-card abstract (inline; NOT seeded)
description = "description.md" # optional site-facing prose (NOT seeded)
changelog = "changelog.md"    # REQUIRED per-version changelog (NOT seeded)
prompt = "prompt.hbs"         # prompt template handed to the harness (required)
max_runtime_hours = 2         # cap on the session and each setup step (default 1)
workspace = "workspaces/base" # starter project seeded at the run root
init = "cargo fetch"          # optional command run after seeding

# Variants: an ORDERED list of standalone variant files (first = default). A root
# key, so it must precede the first table header.
variants = ["variants/base.toml"]

# How the harness builds the submission into a wasm controller module.
[build]
install = "cargo fetch"
build = "cargo build --release --target wasm32-unknown-unknown -p controller"
module = "target/wasm32-unknown-unknown/release/controller.wasm"

# The contract the controller must implement.
[contract]
entry  = "tick"                # exported function invoked once per tick
world  = "schemas/world.json"  # the per-tick observation passed in
action = "schemas/action.json" # the actions the controller may return

# Sandbox limits applied to every controller invocation.
[sandbox]
fuel_per_tick    = 50_000_000  # wasmtime fuel ceiling per invocation
max_memory_bytes = 67_108_864  # 64 MiB linear-memory cap

# The simulation loop.
[simulation]
timestep_ms = 16               # fixed, faked delta handed to the game logic
max_ticks   = 37_500           # hard cap on match length

# How implementations are paired against each other.
[match]
participants = 2               # controllers per match
structure    = "round-robin"   # how the field is paired
rounds       = 1               # matches played per pairing

# How a recorded match is rendered for browser playback.
[replay]
renderer = "replay/index.html"

# Common specs, seeded for EVERY variant. `dest` defaults to `source` with a
# trailing `.hbs` removed.
[[spec]]
source = "specs/rules.md"

# Scoring domains for the human review that accompanies a published run. At
# least one is required, exactly as on an end-to-end case.
[[domain]]
id = "play"
name = "Play"
description = "How the controller actually played the match."
```

Each `variants` entry names a standalone variant file whose top-level keys are
the variant's fields, exactly as for an
[end-to-end case](/testing/end-to-end/manifests/). An adversarial variant
typically varies the seeded specs, for example a different map, ruleset, or
starting condition:

```toml
# test-cases/<type>/<difficulty>/<slug>/<version>/variants/base.toml
slug = "base"                 # stable slug, recorded in the run record
name = "Base"                 # display name (optional; humanizes the slug)
spec = []                     # ADDITIVE specs on top of the common specs
```

## Field requirements

- The site-facing metadata, the required `changelog`, `prompt`,
  `max_runtime_hours`, `workspace`, `init`, and the `[[spec]]`, `[[domain]]`,
  `[[review_item]]`, and `variants` rules behave exactly as they do for an
  [end-to-end case](/testing/end-to-end/manifests/).
- `type` must be `adversarial`. It selects the tables required here and forbids
  the asset-generation tables `[canvas]`, `[tool]`, and `[output]`, and `[[check]]`.
- The `[build]` table is required, and it emits a wasm module rather than a static
  site. `install` and `build` produce it, and `module` names the run-root-relative
  artifact the validator loads into the sandbox. The build must emit an
  import-free `wasm32-unknown-unknown` core module.
- The `[contract]` table defines the controller interface. `entry` is the exported
  function invoked once per tick, and `world` and `action` are JSON Schemas for
  the observation passed in and the actions returned. Both schemas are seeded into
  the run at these exact paths.
- The `[sandbox]` table sets the per-invocation limits. `fuel_per_tick` is the
  wasmtime fuel ceiling for a single tick, and `max_memory_bytes` caps the
  controller's linear memory. Exceeding either forfeits the match.
- The `[simulation]` table configures the loop. `timestep_ms` is the fixed, faked
  delta handed to the game logic each tick, so a match advances by the same amount
  of game time however long the hardware takes. `max_ticks` bounds a match's
  length so it always terminates.
- The `[match]` table records how the field is paired into matches: `participants`
  per match, the `structure` used to pair them, and the `rounds` each pairing
  plays.
- The `[replay]` table names the browser `renderer` that reconstructs a recorded
  match from its replay data for playback on the
  [site](/components/site/overview/).
