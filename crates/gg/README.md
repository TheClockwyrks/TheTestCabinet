# `gg` — The Test Cabinet's first-party coding harness

`gg` (crate `test-cabinet-gg`, binary `gg`) is The Test Cabinet's own coding
harness — the first authored *inside* this repository rather than integrated from
a third party, and the headline feature of **v0.7.0**. Its design lives in its own
top-level docs section (`apps/docs/src/content/docs/gg/`); this README covers the
crate and how the binary is invoked.

## What it is

Unlike a third-party harness — which The Test Cabinet drives as an external
subprocess through an [orchestrator](../../orchestrators/README.md) and
`tcab-session` — `gg` **is** the executor. `core` invokes this binary **directly**,
and it contains the whole agent, in-process:

- the **model client** (multi-provider, [slot-bound](../../apps/docs/src/content/docs/gg/configurations.md#model-slots)),
- the **agent turn loop** (the one coarse-grained plug point),
- **tool dispatch** and the toolset (the primary axis of modularity), and
- the first-party **telemetry** emitter.

A run is configured by a declarative
[capability set](../../apps/docs/src/content/docs/gg/overview.md) — which
capabilities are on, their implementations/params, and the model-slot bindings —
not a `(harness, model, orchestrator)` tuple. gg still reuses the shared run
*infrastructure* (the run container, the test case's seeding/`init`, the
max-runtime bound, and validation + scoring), so a gg run yields a playable,
scoreable, reviewable artifact like any other — it just gets there through its own
executor and records far richer telemetry on the way.

The contract types (`GgCapabilitySet`, `GgTelemetryEvent`, …) are owned by
`crates/core` (`test_cabinet_core::gg`) so they are codegen'd into the published
TypeScript/JSON contract; this crate consumes them.

## Where it runs

gg runs **inside the run container**, alongside the seeded workspace. Locally it
runs with no external resources; in k8s it is published as a GitHub release and
downloaded into the container at run time (the same shape as a third-party
harness's install step, pulling our own release). It is
[**headless**](../../apps/docs/src/content/docs/gg/overview.md) — no TUI and no
interaction of its own; the Test Cabinet UI configures, launches, and monitors it,
and the telemetry stream is the only live window into a run.

## Invocation contract

The binary takes exactly one argument:

```sh
gg --config <PATH>
```

`<PATH>` points at a **JSON invocation file** that deserializes to
`GgInvocation` (the shared launch contract, owned by `core`, re-exported as
`config::GgInvocation`):

```json
{
  "sessionId": "run-abc123",
  "workspaceDir": "/workspace",
  "prompt": "Build the game described in specs/README.md.",
  "capabilitySet": {
    "preset": "minimal",
    "capabilities": [
      { "id": "shell", "enabled": true },
      { "id": "read-file", "enabled": true },
      { "id": "write-file", "enabled": true },
      { "id": "edit-file", "enabled": true },
      { "id": "list-dir", "enabled": true }
    ],
    "slots": [
      { "slot": "primary", "modelId": "anthropic/claude-opus-4-8" }
    ]
  }
}
```

- `sessionId` — stamped onto every telemetry event.
- `workspaceDir` — the seeded run workspace the agent builds in.
- `prompt` — the rendered test-case build instruction.
- `capabilitySet` — the run's configuration (optional; defaults to the Phase 0
  set with **no** slot bound, which parses but cannot launch a real session).

A single declarative file — rather than a spray of flags or env vars — keeps the
configuration inspectable and reproducible and gives `core` one artifact to
construct. The **one** input that does not travel in the file is the model
credential: the client reads `OPENROUTER_API_KEY` from the environment (injected
into the run container by `core`), so no secret is written to disk.

### Output

Telemetry is written as **NDJSON on stdout** — one
`GgTelemetryEvent` (schema v1, owned by `core`) per line. stderr carries only
pre-telemetry fatal errors (for example a malformed config file). Exit `0` on a
completed session.

## Module layout

The spine of the crate — where a reader should start. Each capability additionally
owns its own module (`skills.rs`, `memories.rs`, `tasks.rs`, `board.rs`,
`fsm.rs`, `compaction.rs`, `archive.rs`, `subagents.rs`, `git.rs`,
`dag.rs`, `vision.rs`, `summary.rs`); the authoritative description of each is its
page in [the docs section](../../apps/docs/src/content/docs/gg/), not this table.

| Module | Role |
| --- | --- |
| `main.rs` | Entrypoint: parse `--config`, load the invocation, drive the session, emit telemetry. |
| `config.rs` | Loads the invocation file from disk; re-exports `core`'s `GgInvocation` launch contract. |
| `telemetry.rs` | The NDJSON-on-stdout `Emitter` for `GgTelemetryEvent`. |
| `model.rs` | The provider-agnostic message/tool types (`Message`, `ToolCall`, `ToolDefinition`, `ModelResponse`) and the `ModelClient` trait + `ModelError`. |
| `client.rs` | The slot-bound model clients: `OpenRouterClient` (with bounded retry/backoff), the scripted offline `MockClient`, and slot → client selection. |
| `agent.rs` | The agent turn loop and the orchestrator above it (the one coarse-grained plug point). |
| `agent.code.rs` | One [responses-as-code](../../apps/docs/src/content/docs/gg/responses-as-code/programs.md) turn: heal the reply into a program, run it, service every call it composes, and tell the loop what to do next. |
| `agent.transitions.rs` | [Succession](../../apps/docs/src/content/docs/gg/fork-and-exec.md): the `Handoff` an `exec`, a `fork` or an [FSM transition](../../apps/docs/src/content/docs/gg/fsms.md) declares, and the refusals that answer an illegal one. |
| `modules.rs` | [Modules](../../apps/docs/src/content/docs/gg/modules.md): the six units of per-agent state, the ownership param the board and the archive read, and the fork / share / transfer primitives every succession is built from. |
| `healing.rs` | [Response healing](../../apps/docs/src/content/docs/gg/response-healing.md): the deletion-only, counted, disclosed repairs applied to a model's reply before it is compiled. |
| `limits.rs` | [Execution limits](../../apps/docs/src/content/docs/gg/execution-limits.md): the single definition of a failed turn, the five ceilings a run is bounded by, and the run-wide spend the cost ceiling is measured against. |
| `context.rs` | The context window model: what the agent is holding, what is pinned, and what a reclaim frees. |
| `prompts.rs` | Everything gg *says* to a model, rendered from the `templates/*.hbs` files. |
| `bootstrap.rs` | The synthesized opening turn a code window starts with: the program gg writes in the agent's own language and actually runs, which lists every module the run granted and opens a documentation view of each of the two calls discovery is made of. It is how the surface reaches a model the language-agnostic prompt can name no call to, and a failure in it is gg's — it ends the run. |
| `tools/` | Tool dispatch, the offered toolset, and the typed `ToolData`/`ToolFailure` outcomes every tool emits. |
| `sandbox.rs` + `sandbox/` | [Responses as code](../../apps/docs/src/content/docs/gg/responses-as-code/sandbox.md): the wasmtime host and the WIT membrane. |
| `sandbox/language.rs` + `sandbox/language/` | [Program languages](../../apps/docs/src/content/docs/gg/languages/registration.md): the seam a program's language is registered behind — preparing a reply for its guest, that guest's prebuilt component and the signature catalogue `build.rs` reflects out of its SDK, what it needs from the host linker, its `healing::Dialect`, and the whole programs it has to be able to write (`bootstrap_program` is required of every arm, because a language that could not write the opening turn would be a language whose agents are never handed their surface). Eleven languages are registered, one module each; `language/typescript.check.rs` is the `tsc` pass that type-checks a model's program against the SDK's own declarations. |
| `replay.rs` / `replay_driver.rs` | Capturing a run's non-deterministic inputs, and reconstructing the run from that record. |

## Building it

This crate has a **build script**, and it is not the ordinary kind. `build.rs`
reflects each of the eleven program languages' signature catalogues out of that
language's own SDK, with that language's own documentation tool — `tsc`, griffe,
YARD, `purs`, javadoc, the Kotlin front end, rustdoc,
`swiftc -emit-symbol-graph`, `clang++ -ast-dump=json`, Roslyn — into the build's
`OUT_DIR`, and the arm modules `include_str!` them from there. Nothing is
committed, so what a model is told this sandbox offers is reflected out of the
SDK sources of this checkout on the build that compiles the code telling it.

So compiling `test-cabinet-gg` wants every one of those toolchains present.
Install them with `scripts/ci/install-gg-toolchains.sh` (idempotent; the
devcontainer runs it on create) plus a repo-root `npm ci` for the pinned `tsc`.
To read a catalogue — which is how a reflector bug is found, since a dropped
`@return` paragraph is invisible in the SDK and obvious in the emitted JSON —
run `scripts/gg-signatures.sh`, the same script the build runs and the only list
of the arms in the repository. `build.rs`'s own header states the rest.
