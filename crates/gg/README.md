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

- the **model client** (multi-provider, [slot-bound](../../apps/docs/src/content/docs/gg/multi-model.md)),
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
      { "id": "filesystem", "enabled": true }
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
`planning.rs`, `fsm.rs`, `compaction.rs`, `archive.rs`, `subagents.rs`, `git.rs`,
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
| `agent.code.rs` | One [responses-as-code](../../apps/docs/src/content/docs/gg/responses-as-code.md) turn: heal the reply into a program, run it, service every call it composes, and tell the loop what to do next. |
| `healing.rs` | [Response healing](../../apps/docs/src/content/docs/gg/response-healing.md): the deletion-only, counted, disclosed repairs applied to a model's reply before it is compiled. |
| `limits.rs` | [Execution limits](../../apps/docs/src/content/docs/gg/execution-limits.md): the single definition of a failed turn, the five ceilings a run is bounded by, and the run-wide spend the cost ceiling is measured against. |
| `context.rs` | The context window model: what the agent is holding, what is pinned, and what a reclaim frees. |
| `prompts.rs` | Everything gg *says* to a model, rendered from the `templates/*.hbs` files. |
| `tools/` | Tool dispatch, the offered toolset, and the typed `ToolData`/`ToolFailure` outcomes every tool emits. |
| `sandbox.rs` + `sandbox/` | [Responses as code](../../apps/docs/src/content/docs/gg/responses-as-code.md): the wasmtime host, the WIT membrane, the `oxc` type-strip, and the committed interpreter component. |
| `replay.rs` / `replay_driver.rs` | Capturing a run's non-deterministic inputs, and reconstructing the run from that record. |
