//! The seam between the typed membrane and gg's real toolset, and the records a run keeps of what
//! crossed it.
//!
//! Everything above this file is typed all the way to the model: a WIT function per tool, a
//! TypeScript function per tool, typed arguments and a typed result. Everything below it is gg's
//! existing tool dispatch, which has always taken a name and a `serde_json::Value`. This module is
//! where the two meet — and it is the **only** place JSON exists in the design, inside the host,
//! between a [membrane](super::membrane) function and
//! [`ToolRegistry::dispatch`](crate::tools::ToolRegistry::dispatch). That is deliberate: it is what
//! lets the loop's plan-mode and FSM gating, its delegation routing through the subagent scheduler,
//! its `ToolCall`/`ToolResult` telemetry and its replay capture stay exactly as they are while the
//! model-facing surface becomes typed functions.

use serde_json::Value;

use crate::tools::ToolOutcome;

/// The synchronous seam every membrane call is bridged through: the membrane hands over a gg tool
/// name and its JSON arguments, the implementation performs the call, and the [`ToolOutcome`] comes
/// back to be converted into that call's typed WIT result.
///
/// It is a trait so the sandbox is testable with an in-memory fake and free of any runtime
/// dependency; in production it is the [loop](crate::agent)'s channel invoker, which hands the call
/// to the async loop and blocks for the reply, so a program's delegation still goes through the
/// scheduler and every call is still gated exactly as a native tool call is.
///
/// The invoker is **owned** by the [store](super::membrane::MembraneState) rather than borrowed,
/// which is what lets the store's data be `'static` — wasmtime's requirement — with no
/// lifetime-erasing pointer and no `unsafe` anywhere in this sandbox. `Send` is required because
/// the box is moved onto a blocking thread by the loop.
pub trait ToolInvoker: Send {
    /// Perform `name(args)` and return its outcome. Never panics: a tool that cannot run reports a
    /// failed [`ToolOutcome`], which the membrane turns into a typed `tool-error` the program can
    /// catch.
    fn invoke(&mut self, name: &str, args: Value) -> ToolOutcome;

    /// List the [documented functions](FunctionSummary) on one API object (`fs`, `project`, …),
    /// each with a one-line summary — the directory `object.list()` returns. Only the functions this
    /// run actually bound are listed. An unknown object is an empty list.
    ///
    /// This is a [documentation carve-out](crate::docs), not a tool: no capability offers it, it
    /// dispatches nothing through [`invoke`](Self::invoke), and it is bound into every program's
    /// scope whatever a run enables.
    fn list_functions(&mut self, object: &str) -> Vec<FunctionSummary>;

    /// The full documentation for one function by the name it is called by (`readFile`, `finish`):
    /// its signature, its description, and the declarations of any types it refers to that have not
    /// already been shown this session. Also injects a durable copy into the agent's context.
    /// `None` for an unknown name, which the membrane turns into a `not-found`.
    fn read_docs(&mut self, name: &str) -> Option<String>;
}

/// One function in an API object's directory, as [`list_functions`](ToolInvoker::list_functions)
/// returns it: the name a program calls it by and a one-line summary. The host counterpart of the
/// guest's `FunctionSummary` WIT record, kept free of the bindgen types so the trait has no
/// dependency on the generated membrane.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FunctionSummary {
    /// The function name on its object — `readFile` in `fs.readFile(...)`.
    pub name: String,
    /// A one-line description of what the function does.
    pub summary: String,
}

/// One tool call a program made and the loop serviced — the composed-calls record the loop feeds
/// back to the model and telemetry counts.
///
/// It deliberately does **not** carry the arguments. The loop already sends the same `Value` to the
/// servicing seam, which emits it as `ToolCall` telemetry and hands it to the replay recorder, so a
/// second full copy retained for the whole turn would be pure waste — a program that rewrites forty
/// 64 KiB files would hold ~2.5 MiB of dead clones, uncapped, for a field nothing renders.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SandboxToolCall {
    /// The gg tool name the program called.
    pub name: String,
    /// Whether the tool reported success.
    pub ok: bool,
    /// The tool's short summary, when it recorded one.
    pub summary: Option<String>,
    /// The failure message, when it failed — so the feedback can say *how* a call failed even when
    /// the program caught the throw and carried on to return a value.
    pub error: Option<String>,
}

/// A call the membrane refused before it reached the loop: a turn-level transition, or a tool this
/// run does not offer.
///
/// Refusals are kept apart from [serviced calls](SandboxToolCall) because they produce no telemetry
/// and no replay entry — nothing was dispatched — so counting them together would make the
/// `CodeExecution` event's `tool_calls` disagree with the number of `ToolCall`/`ToolResult` pairs
/// the turn actually streamed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SandboxRefusal {
    /// The gg tool name that was refused.
    pub name: String,
    /// Why — the same text the program's `ToolError` carried.
    pub message: String,
}

/// The prefix of the synthetic call id a program-composed tool call is recorded under:
/// `program:{ordinal}:{tool}`.
///
/// A program's call has no provider-assigned id, so the loop mints one. The **ordinal** is what
/// makes it unique within a turn: an id named only after the tool would collide whenever one
/// program called one tool twice, which is wrong for anything keyed by it. The
/// [replay driver](crate::replay_driver) recognises this prefix to attribute a recorded
/// `ToolResult` to the open turn's program rather than to a native tool call the model never made.
pub const PROGRAM_CALL_ID_PREFIX: &str = "program:";
