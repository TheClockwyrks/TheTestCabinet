# Workspace Per Agent

Each agent holds one compile workspace for the whole session. A preparation
reuses that workspace, clearing the previous response's sources and build output
before writing its own.

An agent's programs run sequentially, so one workspace serves one preparation at
a time.

## Current behaviour

`PrepareContext::new` (`crates/gg/src/sandbox/language/compile.rs`) allocates a
fresh id per preparation, and `Workspace::create` builds a new tree under
`gg-prepare/<pid>-<id>` for it. Every tree re-stages the language's library set
and re-links the prebuilt output directory.

## Isolation

`crates/gg/src/sandbox/language/isolation.rs` guards against the silent compiler
corruption measured on real toolchains: concurrent `purs` compiles into one
shared output tree produced a single artifact holding two agents' programs, and a
shared TeaVM build strategy driven from several threads produced no output for
most of them. Both exited zero.

The property that gate protects is that a preparation's result is a function of
its own input under the concurrency a run produces. Agents run in parallel up to
`limits.maxParallel`, so the sharing that corrupts is between agents. Sequential
preparations inside one agent share a workspace by design.

Re-scope the gate so it asserts that two agents receive different workspaces, and
so it exercises repeated sequential preparations within one agent.

## Design

Allocate the workspace when an agent starts and hold it for the agent's
lifetime. Each preparation removes the previous response's source and output
files, writes its own, and compiles.

## Done when

- [ ] A workspace is created once per agent and reused across that agent's turns.
- [ ] A preparation removes the previous response's sources and build output before writing its own.
- [ ] The isolation gate asserts per-agent separation and covers sequential reuse within one agent.
- [ ] Gates green.
