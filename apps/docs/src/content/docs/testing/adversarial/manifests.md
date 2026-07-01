---
title: Manifests
---

An adversarial test case version lives under `test-cases/<slug>/<version>/` and
declares its contents in a `test-case.toml` manifest, the same versioned,
immutable [catalog layout](/testing/end-to-end/overview/#catalog-layout) every
test type uses. Where an [end-to-end manifest](/testing/end-to-end/manifests/)
describes a build to seed and references to render, an adversarial manifest
additionally describes the **game**, the **controller contract** the model must
implement, the **sandbox limits**, the **simulation loop**, and how matches are
**structured** and **replayed**. The harness reads it to build each submission
into a wasm module and to drive matches.

```toml
# test-cases/<slug>/<version>/test-case.toml
name = "Capture"             # human-readable display name (site-facing)
difficulty = "hard"          # relative difficulty: easy | medium | hard (required)
tags = ["adversarial", "ctf"] # free-form classification tags (site-facing, required)
summary = "..."              # optional one- or two-sentence abstract for the site cards (inline; NOT seeded)
description = "description.md" # optional site-facing prose (relative path; NOT seeded)
prompt = "prompt.hbs"        # the prompt template handed to the harness (required)
max_runtime_hours = 0.5      # cap on the harness session before it's stopped (default 1)
workspace = "workspaces/base" # starter project the model fills in (seeds the run root)
init = "cargo fetch"         # optional command run in the container after seeding, before the harness

# Variants: an ORDERED list of paths to standalone variant files (first = default).
# A root key, so it must precede the first table header (`[build]`). Each is a
# self-contained TOML document (top-level keys are the variant's fields), by
# convention under `variants/`, with every path resolving against the version folder.
variants = ["variants/base.toml"]

# How the harness builds the model's submission into a wasm controller module.
# Required: the case states the commands and the artifact path explicitly.
[build]
install = "cargo fetch"                                  # dependency fetch (required)
build = "cargo build --release --target wasm32-wasip2"  # must emit the module (required)
module = "target/wasm32-wasip2/release/controller.wasm" # the produced wasm artifact (required)

# The contract the controller must implement. The schemas define the observation
# handed in and the actions allowed out; the model never sees authoritative state.
[contract]
entry  = "tick"                  # the exported function invoked once per game tick (required)
world  = "schemas/world.json"    # the per-tick observation passed to the controller
action = "schemas/action.json"   # the actions the controller may return each tick

# Sandbox limits applied to every controller, every tick. Exceeding either is a
# disqualifying failure, not a recoverable one.
[sandbox]
fuel_per_tick    = 50_000_000    # wasmtime fuel ceiling per invocation; exhaustion disqualifies
max_memory_bytes = 67_108_864    # 64 MiB linear-memory cap

# The simulation loop. The timestep is faked to a fixed value so a match runs at
# the hardware's maximum speed while advancing game time deterministically.
[simulation]
timestep_ms = 16                 # fixed, faked delta handed to game logic per tick
max_ticks   = 18_000             # hard cap on match length (a draw if reached)

# How implementations are paired against each other to produce a result.
[match]
participants = 2                 # controllers per match
structure    = "round-robin"     # how the field is paired: round-robin | bracket
rounds       = 1                 # matches played per pairing

# How a recorded match is rendered for browser playback on the site.
[replay]
renderer = "replay/index.html"   # browser renderer fed the recorded replay data

# Common specs, seeded for EVERY variant (the rules and contract documentation
# the model builds against). Same `source` → `dest` mapping as end-to-end, and
# `dest` defaults to `source` with a trailing `.hbs` removed.
[[spec]]
source = "specs/overview.md"     # dest defaults to "specs/overview.md"
```

Each `variants` entry names a standalone variant file (the first is the default) —
a TOML document whose top-level keys are the variant's fields, exactly as for an
[end-to-end case](/testing/end-to-end/manifests/). Here a variant typically varies
the seeded specs — a different map, ruleset, or starting condition:

```toml
# test-cases/<slug>/<version>/variants/base.toml
slug = "base"                    # stable slug, recorded in the run record
name = "Base"                    # display name (optional; default humanizes the slug)
spec = []                        # ADDITIVE specs on top of the common specs
```

- The site-facing metadata (`name`, `difficulty`, `tags`, `summary`,
  `description`), `prompt`, `max_runtime_hours`, `workspace`, `init`, and the
  `[[spec]]` and `variants` seeding rules behave exactly as they do for an
  [end-to-end case](/testing/end-to-end/manifests/) — an adversarial case seeds a
  starter workspace and specs, renders a prompt, and lists its variants as
  standalone files the same way (each `[[spec]]` `dest` defaulting to its
  `source`).
- The `[build]` table is **required**. Unlike an end-to-end build, which emits a
  static site, an adversarial build emits a **wasm module**: `install` and
  `build` produce it and `module` names the artifact path the harness loads into
  the sandbox. The model may use any language that compiles to wasm; the case
  fixes only the commands and the artifact path.
- The `[contract]` table defines the **controller interface**. `entry` is the
  exported function The Test Cabinet invokes once per tick; `world` and `action`
  are JSON Schemas for the observation passed in and the actions returned. The
  contract is the only channel between a controller and the game — there is no
  way to reach authoritative state directly (see
  [Overview](/testing/adversarial/overview/#the-controller-contract)).
- The `[sandbox]` table sets the per-invocation limits. `fuel_per_tick` is the
  wasmtime fuel ceiling for a single tick; a controller that exhausts it is
  disqualified. `max_memory_bytes` caps the controller's linear memory. Both
  exist so a buggy controller can never crash or hang a match.
- The `[simulation]` table configures the loop. `timestep_ms` is the **fixed,
  faked** delta handed to the game logic each tick, so the match advances by the
  same amount of game time regardless of how long the hardware takes;
  `max_ticks` bounds a match's length so it always terminates.
- The `[match]` table describes how the field is paired into matches:
  `participants` per match, the `structure` used to pair them, and how many
  `rounds` each pairing plays.
- The `[replay]` table names the browser `renderer` that reconstructs a recorded
  match from its replay data for playback on the [site](/components/site/overview/).
