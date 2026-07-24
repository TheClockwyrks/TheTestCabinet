//! `gg-rac-interp` — the **responses-as-code interpreter**, the guest side of gg's
//! code-execution sandbox.
//!
//! It implements `gg-script`, the small scripting language a model emits *instead of*
//! discrete tool calls under gg's
//! [responses-as-code](../../apps/docs/src/content/docs/gg/responses-as-code.md)
//! capability. A model expresses what it wants as a **program over the available
//! tools** — loops, conditionals, intermediate values, and several tool invocations
//! composed together — which this interpreter runs, calling back into gg for each tool
//! and returning the program's result.
//!
//! Because a model cannot emit wasm directly, the faithful way to sandbox its
//! arbitrary control flow is a **trusted interpreter compiled to wasm**: this crate.
//! It compiles to `wasm32-unknown-unknown` as a `cdylib` and is loaded by the
//! [`crates/gg`](../../crates/gg) host under a wasmtime fuel + linear-memory ceiling,
//! exactly as the [Foray](../foray_host)/[Lattice](../lattice_host) hosts load their
//! guests. A tool call in a script becomes a call to the host import `gg.call_tool`,
//! which runs the real tool in the container and hands the result back into the
//! sandbox.
//!
//! ## Layers
//!
//! - `lexer` → `parser` → `interp`: the pure interpreter. It is portable Rust,
//!   unit-tested natively against a mock [`ToolHost`] — no wasm, no network.
//! - [`execute`]: the one-call entry the host drives — parse `source`, run it, and
//!   return a JSON [outcome envelope](ProgramOutcome).
//! - `abi` (only under `target_arch = "wasm32"`): the `memory`/`alloc`/`run_program`
//!   exports and the `gg.call_tool` import that bridge [`execute`] across the wasm
//!   boundary. Absent from the native build, so the pure interpreter has no wasm
//!   dependency.
//!
//! See the crate `README.md` for the full grammar, semantics, the ABI, and the step
//! that rebuilds the committed `.wasm`.

mod interp;
mod lexer;
mod parser;

#[cfg(target_arch = "wasm32")]
mod abi;

pub use interp::{RunConfig, RunOutcome, RuntimeError, RuntimeErrorKind, ToolHost, run};
pub use parser::Ast;

use serde_json::Value;

/// The request the host hands the interpreter: the program `source` and the optional
/// guest-side step budget.
///
/// The step budget is a *secondary* guard — the wasmtime fuel ceiling the host sets is
/// the hard limit — but honouring it in-guest lets a runaway loop stop with a clean
/// [`ProgramOutcome`] error (naming the budget) instead of a bare fuel trap, which is
/// the more useful diagnostic for a model.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgramRequest {
    /// The `gg-script` source to run.
    pub source: String,
    /// The guest step budget; falls back to [`RunConfig::default`] when absent.
    #[serde(default)]
    pub step_limit: Option<u64>,
}

/// What phase a run failed in, so the host/telemetry can distinguish a program the
/// model wrote wrong (`Lex`/`Parse`) from one that faulted while running (`Runtime`),
/// or a runaway loop the budget stopped (`StepLimit`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FailureKind {
    /// The source did not lex.
    Lex,
    /// The source lexed but did not parse.
    Parse,
    /// The program ran but faulted (a type error, an unbound variable, …).
    Runtime,
    /// The program exceeded its step budget (a probable runaway loop).
    StepLimit,
}

/// The outcome of running one program — the JSON envelope the host reads back out of
/// guest memory.
///
/// The tool *calls* a program made are recorded by the host (it sees every
/// `gg.call_tool`), so they are not repeated here; this envelope carries the program's
/// own result, any fault, its `print` log, and the steps it took.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgramOutcome {
    /// `true` when the program returned normally, `false` when it faulted.
    pub ok: bool,
    /// The program's `return` value (`null` if it returned nothing or faulted).
    pub result: Value,
    /// The failure message, when `ok` is `false`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Which phase the failure occurred in, when `ok` is `false`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure: Option<FailureKind>,
    /// The lines the program emitted via `print(..)`, in order.
    pub logs: Vec<String>,
    /// The number of steps the run consumed (statements executed + loop iterations).
    pub steps: u64,
}

impl ProgramOutcome {
    fn failed(kind: FailureKind, message: String) -> Self {
        Self {
            ok: false,
            result: Value::Null,
            error: Some(message),
            failure: Some(kind),
            logs: Vec::new(),
            steps: 0,
        }
    }
}

/// Parse and run `request_json` (a serialized [`ProgramRequest`]) against `host`,
/// returning the serialized [`ProgramOutcome`]. This is the single entry the wasm ABI
/// drives and the natural embedding point for any host; it never panics — every fault
/// is folded into the returned envelope.
pub fn execute(request_json: &str, host: &mut dyn ToolHost) -> String {
    let outcome = run_request(request_json, host);
    // `ProgramOutcome` always serialises (its fields are plain JSON), so the fallback
    // is unreachable, but never panic on the ABI boundary.
    serde_json::to_string(&outcome).unwrap_or_else(|_| {
        r#"{"ok":false,"result":null,"error":"failed to serialize outcome","logs":[],"steps":0}"#
            .to_string()
    })
}

/// The typed core of [`execute`]: decode the request, lex/parse/run, and build the
/// [`ProgramOutcome`].
fn run_request(request_json: &str, host: &mut dyn ToolHost) -> ProgramOutcome {
    let request: ProgramRequest = match serde_json::from_str(request_json) {
        Ok(request) => request,
        Err(err) => {
            return ProgramOutcome::failed(
                FailureKind::Parse,
                format!("invalid program request envelope: {err}"),
            );
        }
    };

    let tokens = match lexer::lex(&request.source) {
        Ok(tokens) => tokens,
        Err(err) => return ProgramOutcome::failed(FailureKind::Lex, err.to_string()),
    };

    let ast = match parser::parse(&tokens) {
        Ok(ast) => ast,
        Err(err) => return ProgramOutcome::failed(FailureKind::Parse, err.to_string()),
    };

    let config = RunConfig {
        step_limit: request
            .step_limit
            .unwrap_or(RunConfig::default().step_limit),
    };
    let outcome = run(&ast, host, config);
    match outcome.result {
        Ok(result) => ProgramOutcome {
            ok: true,
            result,
            error: None,
            failure: None,
            logs: outcome.logs,
            steps: outcome.steps,
        },
        Err(error) => {
            let failure = match error.kind {
                RuntimeErrorKind::StepLimit => FailureKind::StepLimit,
                RuntimeErrorKind::Message => FailureKind::Runtime,
            };
            ProgramOutcome {
                ok: false,
                result: Value::Null,
                error: Some(error.message),
                failure: Some(failure),
                logs: outcome.logs,
                steps: outcome.steps,
            }
        }
    }
}

#[cfg(test)]
#[path = "lib.test.rs"]
mod tests;
