---
title: "Test Case Definition"
---

Test case definitions describe how the test suite's data can be used for test
runs. Each test case represents an individually runnable segment of the test
suite.

One definition lives in one file at `test-cases/<name>.toml` inside the version
folder. The file stem is the definition's slug, so `test-cases/end-to-end.toml`
defines the `end-to-end` test case. Every path a definition names is relative to
the suite tree.

```toml
# test-cases/<name>.toml
name = "Carom, end to end"      # display name (required)
type = "end-to-end"             # test case type (required, see "Test Case Types")
difficulty = "easy"             # easy | medium | hard (required)
engines = ["none", "simple-2d"] # engine slugs (required for code-producing types)
specifications = ["ball-physics", "ui"] # specification ids (default: all of them)
prompt = "prompts/end-to-end.hbs"       # prompt template handed to the harness (required)
max_runtime_hours = 1           # cap on the run (default 1)
experimental = false            # default false; hidden unless a deployment opts in
# optional; run in the run container after seeding, before the harness starts
init = "npm ci && npx playwright install chromium"

# Engine slug -> the starter workspace directory seeded at the run root.
[workspaces]
none = "workspaces/none"
simple-2d = "workspaces/simple-2d-e2e"

# Commands that turn the produced implementation into a served static build.
[build]
install = "npm ci"
build = "npm run build"

# The TypeScript toolchain run over the produced implementation.
[toolchain]
typecheck = "npm run typecheck" # required; a non-zero exit rates the run broken
lint = "npm run lint"           # optional; recorded
format = "npm run format"       # optional; recorded
test = "npm run test"           # optional; recorded
```

## Definition keys

- `name` is the display name shown wherever the test case is listed.
- `type` selects the test case type and decides which type table the definition
  must carry. The types are described below.
- `difficulty` is the difficulty of this test case.
- `engines` lists the engine slugs a run may select one entry from.
- `specifications` lists the specification ids this test case covers. Omitting
  the key covers every specification in the suite. Only the requirements
  belonging to the listed specifications are seeded and graded.
- `prompt` names a Handlebars template under the suite tree. The rendered
  prompt is what the harness hands to the model.
- `max_runtime_hours` caps the session. A run exceeding it is stopped.
- `experimental` keeps the definition out of the catalog for deployments that
  have not opted in. It defaults to `false`.
- `init` is an optional command run inside the run container once the workspace
  and specifications are seeded and before the harness starts. Any type may
  declare it, and it must not be blank when declared. It runs, is verified, and
  is retried exactly as an authored case's [init](/testing/end-to-end/overview/#init).
  A code-producing definition whose starter workspace ships a lockfile
  conventionally declares `npm ci && npx playwright install chromium`.

## Code-producing types

The test case types whose subject is code the model wrote, `end-to-end` and
`full-stack`, declare `engines` along with the `[workspaces]`, `[build]` and
`[toolchain]` tables.

`[workspaces]` carries one entry per engine the definition declares, mapping an
engine slug to the starter workspace seeded at the run root. `[toolchain]` names
the TypeScript commands run over the produced implementation; `typecheck` is
required and a non-zero exit rates the run broken, while the rest are recorded.

`[build]` names the commands that turn the produced implementation into a served
static build, which is what the [validators](/test-suites/validators/) are run
against.

### Workspace directories

Workspaces live at `workspaces/<slug>/`, where the slug is author-chosen. It is
commonly the engine name when one workspace serves that engine across every test
case, and a definition's `[workspaces]` map is what binds a slug to an engine.
Two definitions on the same engine may name different workspace slugs.

## Test Case Types

### End to End

End to end test cases are a purely code-focused test case. These provide the
model under test with all assets that it needs and the specifications that
describe the implementation that must be written.

### Full Stack

Full stack test cases require models to generate their own assets and write the
code necessary to implement specifications.

### Sprite

Sprite test cases ask a model to produce one or more sprites. Each sprite in a
sprite test case may either be a single sprite or a sprite sheet for a single
entity.

### Voxel

Voxel test cases require models to generate "boxel"-style models and may
optionally require a model to add rigid-body animations to their model.

### Blender

The Blender test case type allows models to author assets in Blender using
Blender's Python API.

### Particle

In particle test cases, models are required to author particle effects that can
then be read by and played using The Test Cabinet's particle effects package.

### Music

Music test cases are audio test cases that require the model to author a musical
score. These test how well a model can produce longer audio clips.

### Audio FX

Audio FX test cases require the model to author short, non-musical audio. These
test cases are used to create audio assets for various effects in games.

### Performance

Performance test cases measure how efficiently a model implemented the code, so
they separate models that satisfy the same requirements by the cost of their
implementation. The model writes Rust, which is built into a wasm module and run
under wasmtime, as
[performance testing](/testing/performance/overview/) describes.

A performance run is scored in two steps, correctness first and then fuel. The
contract's entry function runs against the held-out inputs and its answers are
checked against the expected outputs. An implementation that answers any input
wrongly earns no performance result, because an incorrect implementation says
nothing about how efficiently the work was done.

Only a correct implementation is measured. It simulates a fixed number of ticks
from a given scenario, and the wasmtime fuel it consumed is the result. Fuel is
metered as a function of the code and its input rather than of the host, so the
same implementation posts the same number wherever it runs. Wall-clock
milliseconds depend on the hardware and the OS scheduler, which is why fuel is
what a result records.

Measurement has three outcomes. An implementation that finishes within the fuel
ceiling passes, and the fuel it consumed is its score, which is the figure that
separates one model from another. An implementation that finishes only on the
runway granted above that ceiling is marked as over it and earns no comparable
score, with its consumed fuel recorded so a reader sees how far over it went. An
implementation that exhausts the runway fails. The runway keeps the pass line
where it is and bounds a run that would otherwise need unlimited fuel to be
measured at all.

TBD. The definition keys a performance test case declares are specified against
[performance testing](/testing/performance/overview/).

### Adversarial

Adversarial test cases ask models to implement an AI controller, and the
controllers from multiple models are run against each other in a head-to-head
tournament. The model writes Rust, which is built into a wasm module, as
[adversarial testing](/testing/adversarial/overview/) describes.

TBD. The definition keys an adversarial test case declares are specified against
[adversarial testing](/testing/adversarial/overview/).

### Puzzle

TBD. The test suite form of puzzle test cases is not yet specified.

## Type tables

A definition carries the one table its type requires, and that table alone.

| Type         | Required table |
| ------------ | -------------- |
| `end-to-end` | none           |
| `full-stack` | none           |
| `sprite`     | `[sprite]`     |
| `voxel`      | `[voxel]`      |
| `blender`    | `[blender]`    |
| `particle`   | `[particle]`   |
| `music`      | `[music]`      |
| `audio-fx`   | `[audio-fx]`   |

Each asset-producing type owns a table named for the type, carrying the fields
that type needs. `id` names an asset under `assets/` and is required in every
one of them.

```toml
type = "voxel"

[voxel]
id = "player-ship"
animated = true
```

### `[sprite]`

- `id` names the asset the model produces.
- `sheet` selects the `sprite-sheet` asset kind over `sprite`. It defaults to
  `false`.

### `[voxel]`

- `id` names the asset the model produces.
- `animated` requires rigid-body animation of the produced model. It defaults to
  `false`.

### `[blender]`

- `id` names the asset the model produces.

### `[particle]`

- `id` names the asset the model produces.

### `[music]`

- `id` names the asset the model produces.

### `[audio-fx]`

- `id` names the asset the model produces.

## Prompt template

`prompt` names a Handlebars template under the suite tree, conventionally
under `prompts/`. The Test Cabinet renders it into the instruction handed to the
harness. The rendered prompt is handed over rather than seeded, so the
in-container paths and the selected engine stay out of the authored
specifications.

The template is rendered in strict mode with HTML escaping disabled. Strict mode
makes a reference to any variable other than the ones below a render error
rather than a silent blank. The context exposes exactly:

- `{{workspace}}` — the absolute in-container path of the run workspace, where
  the starter workspace is seeded and the harness builds.
- `{{engine.slug}}`, `{{engine.name}}`, and `{{engine.docs}}` — the engine
  selected for the run, always present. `slug` is `none` when no engine is
  selected, and `docs` is then empty; otherwise `docs` is the absolute
  in-container path of the seeded engine documentation.
- `{{#each specifications}} … {{/each}}` — the specifications this test case
  covers, in the order the definition lists them. Each exposes `{{this.id}}`,
  `{{this.name}}`, `{{this.summary}}`, and `{{this.path}}`, the absolute
  in-container path of the seeded specification document.

## Seeded specifications

Every specification named by `specifications` is seeded under `specs/` in the
run workspace, at the output path the
[specification](/test-suites/specifications/) declares. Each seeded document is
that specification's prose followed by its requirements, rendered as one
Markdown file at `specs/<path>`.

The prose and the RFC 2119 requirements together are the specification, and a
model implements the requirements it has been given. The
[validators](/test-suites/validators/) that decide those requirements stay with
the suite.
