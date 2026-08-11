//! The **API-call bracket**: the one place a model-facing call is recorded, and the reason no host
//! function on this membrane can quietly skip it.
//!
//! # Two surfaces over one core, recorded separately
//!
//! gg's tools and gg's API objects are two surfaces over one core of typed functions
//! ([`ToolApi`]), and they are independent: a tool exists because a tool-calling model needs a JSON
//! name to dispatch, an API function exists because a program needs something to write, and neither
//! is defined in terms of the other. What follows is that a call has **two** honest records, and
//! they answer different questions:
//!
//! * the [tool record](super::capture) — what *ran*: `read_file`, dispatched, streamed as a
//!   `ToolCall`/`ToolResult` pair, pinned in the [replay](crate::capture) so a re-run feeds the
//!   recorded outcome back;
//! * the API record — what the *model wrote*: `view.open_file`, which happens to bridge to
//!   `read_file`, and `view.current`, which bridges to nothing at all.
//!
//! Only the second can answer "was this agent offered that call, and did it use it?", which is the
//! question an ablation is run to ask. The first cannot: several API functions share one tool
//! (`fs.readFile`, `fs.readTextFile` and `view.openFile` are all reads), fourteen API functions have
//! no tool at all, and a call the membrane refused has no tool record even though the model made it.
//!
//! # Why the bracket is at the host function, not inside `dispatch`
//!
//! [`dispatch`](super::MembraneState::dispatch) knows a tool name and nothing else — the API
//! identity is the host function's own knowledge and is gone by the time dispatch is reached. So the
//! bracket goes around the *whole* host function body, which buys three things at once: it covers
//! the carve-outs that never dispatch; it closes **after** the typed conversion, so a tool that
//! answered `ok` with a payload the function could not use is a failed API call even though its
//! `ToolResult` already streamed a success; and it encloses the bridged pair, so the nesting on the
//! stream reads the way it happened.
//!
//! # Why a token
//!
//! [`GuardedApi`] owns the [api](ToolApi) behind a field this module alone can see, and hands it out
//! only against a [`Recording`] — which only [`recorded`](MembraneState::recorded) and its siblings
//! can mint. A host function in a sibling module therefore *cannot* reach the api, dispatch a tool,
//! or declare an ending without having opened a bracket first: the omission this whole file exists
//! to prevent is a compile error rather than a silent zero on a console. The
//! `every_host_function_records_its_own_api_call` in `recording.test.rs` closes the remaining gap — a host
//! function that opened a bracket naming the *wrong* call, and the one function that touches
//! neither the api nor a tool and could therefore have skipped the bracket and still compiled.

use super::test_cabinet::gg::types::ToolError;
use super::{MembraneState, ToolApi, wire_failure};
use crate::sandbox::language::SurfaceCall;

/// Proof that a model-facing API call is being recorded around whatever is done with it.
///
/// Its field is private to this module, so no sibling can forge one: the only way to hold a
/// `Recording` is to be inside the closure [`recorded`](MembraneState::recorded) ran. That is the
/// whole enforcement mechanism — see the module docs.
#[derive(Debug, Clone, Copy)]
pub(super) struct Recording(());

/// The [api](ToolApi) itself, reachable only from inside an open [`Recording`].
///
/// A newtype rather than a bare field on [`MembraneState`] for one reason: Rust privacy is
/// module-*subtree* privacy, so a field declared in `membrane.rs` is visible to every host function
/// file under it and could be called without a record. Declared here, it is visible to this module
/// alone, and [`get`](Self::get) is the only door.
pub(super) struct GuardedApi<A: ToolApi> {
    /// The native, typed tool surface. Private to this module on purpose.
    api: A,
}

impl<A: ToolApi> GuardedApi<A> {
    /// Take ownership of the api for one program.
    pub(super) fn new(api: A) -> Self {
        Self { api }
    }

    /// Hand the api back when the program has ended, so the loop reclaims the per-turn state it
    /// moved in. Not a call, so it needs no [`Recording`].
    pub(super) fn into_inner(self) -> A {
        self.api
    }

    /// The api, for the duration of a recorded call.
    pub(super) fn get(&mut self, _: Recording) -> &mut A {
        &mut self.api
    }
}

impl<A: ToolApi> MembraneState<A> {
    /// Record one model-facing API call around `body` — the bracket every host function on this
    /// membrane opens, and the only source of the [`Recording`] its body needs to do anything.
    ///
    /// The identity is a [`SurfaceCall`]: the API object and the function's language-independent
    /// [key](SurfaceCall::key), never the SDK spelling the model actually typed, so a count means
    /// the same thing in every arm of a cross-language study.
    ///
    /// A membrane **refusal** — a spent wall-clock budget, a tool this run does not offer — closes
    /// the bracket as a failed call rather than skipping it. The model made the call; that nothing
    /// ran is the tool layer's fact, which is exactly why
    /// [`SandboxRefusal`](crate::sandbox::invoker::SandboxRefusal) is kept out of the tool roster
    /// and why an API call is not.
    pub(super) fn recorded<R>(
        &mut self,
        call: SurfaceCall,
        body: impl FnOnce(&mut Self, Recording) -> Result<R, ToolError>,
    ) -> Result<R, ToolError> {
        self.recorded_on(call.object, call.key, body)
    }

    /// As [`recorded`](Self::recorded), for a call named by two strings rather than by a
    /// [`SurfaceCall`].
    ///
    /// The callers are the [documentation carve-out](crate::docs)'s own three calls, which no arm's
    /// committed catalogue spells yet — so there is nothing to resolve a
    /// [`SurfaceCall`] from and no fixed pair in
    /// [`OPERATIONS`](crate::sandbox::operations::OPERATIONS) to name. They record under gg's own
    /// words for them instead, which is a name in the record that joins to gg's own vocabulary
    /// rather than to a spelling nobody wrote.
    pub(super) fn recorded_on<R>(
        &mut self,
        object: &str,
        function: &str,
        body: impl FnOnce(&mut Self, Recording) -> Result<R, ToolError>,
    ) -> Result<R, ToolError> {
        self.api.api.begin_api_call(object, function);
        self.api_calls = self.api_calls.saturating_add(1);
        let result = body(self, Recording(()));
        // The class the program is about to be thrown with, taken from the error itself. It is the
        // API layer's own reason, not the tool's: a membrane refusal and a carve-out have no tool
        // record at all, and a typed conversion that failed over a tool that answered `ok` is a
        // failure here and a success there.
        let failure = result.as_ref().err().map(|error| wire_failure(error.code));
        self.api.api.end_api_call(object, function, failure);
        result
    }

    /// As [`recorded`](Self::recorded), for the one call that cannot fail.
    ///
    /// `view.current` answers with a list — an agent with nothing open gets an empty one, which is
    /// an answer rather than an error — so there is no verdict to take and the record is always
    /// `ok`. Spelling that out here is what keeps its host function from having to invent a
    /// `Result` it would then unwrap.
    ///
    /// `programs.history` used to be a second, and stopped being one when the host started checking
    /// the [program-library](super::programs) capability: an agent with no library and an agent that
    /// has run nothing are different facts, and one empty list could only have told the model one of
    /// them. `object.list()` used to be a third, and its object was the reason this ever took one at
    /// run time rather than from the call — it was the one carve-out whose object was an argument.
    /// With the directory gone every recorded call names a fixed pair again.
    pub(super) fn recorded_ok<R>(
        &mut self,
        call: SurfaceCall,
        body: impl FnOnce(&mut Self, Recording) -> R,
    ) -> R {
        self.api.api.begin_api_call(call.object, call.key);
        self.api_calls = self.api_calls.saturating_add(1);
        let value = body(self, Recording(()));
        self.api.api.end_api_call(call.object, call.key, None);
        value
    }

    /// The api, for a caller holding a [`Recording`] — the shorthand every carve-out uses instead of
    /// reaching through the guard by hand.
    pub(super) fn api(&mut self, recording: Recording) -> &mut A {
        self.api.get(recording)
    }
}

#[cfg(test)]
#[path = "recording.test.rs"]
mod tests;
