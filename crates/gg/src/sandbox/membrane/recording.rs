//! The **API-call bracket**: the one place a model-facing call is recorded, and the reason no host
//! function on this membrane can quietly skip it.
//!
//! # Two surfaces over one core, and only one of them is here
//!
//! gg's tools and gg's [operations](crate::sandbox::operations) are two surfaces over one core of
//! typed functions ([`OperationApi`]), and they are independent: a tool exists because a tool-calling
//! model needs a JSON name to dispatch, an operation exists because a program needs something to
//! write, and neither is defined in terms of the other. An agent has exactly one of the two, so what
//! is recorded here is the **whole** account of what a responses-as-code agent did — no tool-call
//! record accompanies it — and the record is keyed on the operation the model called rather than on
//! whatever the internals dispatched underneath.
//!
//! What runs underneath is recorded under the same identity, and that is the point rather than a
//! coincidence: a dispatched call is pinned in the [replay](crate::capture) under the **operation**,
//! so a re-run feeds the recorded outcome back to the call the model actually wrote. Several
//! operations share one implementation (`files.read_file`, `files.read_text_file` and
//! `views.open_file` are all reads), so a replay keyed on the implementation would feed one
//! operation's recorded outcome to another's call. Fourteen operations reach no internal dispatch at
//! all, and a call the membrane refused ran nothing whatsoever though the model made it — both are
//! still API calls, and both are recorded here.
//!
//! # Why the bracket is at the host function, not inside `dispatch`
//!
//! [`dispatch`](super::MembraneState::dispatch) knows which internal call is being made and nothing
//! else — the operation is the host function's own knowledge and is gone by the time dispatch is
//! reached. So the bracket goes around the *whole* host function body, which buys three things at
//! once: it covers the calls that never dispatch; it closes **after** the typed conversion, so an
//! internal call that answered `ok` with a payload the function could not use is a failed API call;
//! and it encloses everything the call set off, so the nesting on the stream reads the way it
//! happened.
//!
//! # Why a token
//!
//! [`GuardedApi`] owns the [api](OperationApi) behind a field this module alone can see, and hands it out
//! only against a [`Recording`] — which only [`recorded`](MembraneState::recorded) and its siblings
//! can mint. A host function in a sibling module therefore *cannot* reach the api, dispatch a tool,
//! or declare an ending without having opened a bracket first: the omission this whole file exists
//! to prevent is a compile error rather than a silent zero on a console. The
//! `every_host_function_records_its_own_api_call` in `recording.test.rs` closes the remaining gap — a host
//! function that opened a bracket naming the *wrong* call, and the one function that touches
//! neither the api nor a tool and could therefore have skipped the bracket and still compiled.

use super::test_cabinet::gg::types::ApiError;
use super::{MembraneState, OperationApi, wire_failure};
use crate::sandbox::OperationId;
use crate::sandbox::invoker::ApiIdentity;

/// Proof that a model-facing API call is being recorded around whatever is done with it.
///
/// Its field is private to this module, so no sibling can forge one: the only way to hold a
/// `Recording` is to be inside the closure [`recorded`](MembraneState::recorded) ran. That is the
/// whole enforcement mechanism — see the module docs.
#[derive(Debug, Clone, Copy)]
pub(super) struct Recording(());

/// The [api](OperationApi) itself, reachable only from inside an open [`Recording`].
///
/// A newtype rather than a bare field on [`MembraneState`] for one reason: Rust privacy is
/// module-*subtree* privacy, so a field declared in `membrane.rs` is visible to every host function
/// file under it and could be called without a record. Declared here, it is visible to this module
/// alone, and [`get`](Self::get) is the only door.
pub(super) struct GuardedApi<A: OperationApi> {
    /// The native, typed operation surface. Private to this module on purpose.
    api: A,
}

impl<A: OperationApi> GuardedApi<A> {
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

impl<A: OperationApi> MembraneState<A> {
    /// Record one model-facing API call around `body` — the bracket every host function on this
    /// membrane opens, and the only source of the [`Recording`] its body needs to do anything.
    ///
    /// The identity is an [`OperationId`]: gg's own name for the call, never the SDK spelling the
    /// model actually typed, so a count means the same thing in every arm of a cross-language study.
    ///
    /// A membrane **refusal** — a spent wall-clock budget, a call this agent was not granted —
    /// closes the bracket as a failed call rather than skipping it. The model made the call; that
    /// nothing ran underneath it is the execution layer's fact, which is exactly why
    /// [`SandboxRefusal`](crate::sandbox::invoker::SandboxRefusal) is kept out of the tool roster
    /// and why an API call is not.
    ///
    /// # The bracket is also the capability gate
    ///
    /// Because every arm's SDK is **static**. No guest leaves a name out of a program's scope any
    /// more, so every call a program can write arrives here, and the one thing that decides whether
    /// it happens is [`granted`](MembraneState::granted) — asked here, once, from the operation gg
    /// files the call under. Putting it in the bracket rather than in each host function is what
    /// makes "no model-facing call escapes the gate" a property of the mechanism instead of a rule
    /// forty-eight functions have to remember, and it is why the refusal is *inside* the record: a
    /// call the model made and gg refused is a failed API call, not an absence.
    pub(super) fn recorded<R>(
        &mut self,
        id: OperationId,
        body: impl FnOnce(&mut Self, Recording) -> Result<R, ApiError>,
    ) -> Result<R, ApiError> {
        let rendered = id.to_string();
        // Built once and used for **both** halves of the bracket, so a closing record cannot name a
        // different call from the opening one it answers.
        let identity = ApiIdentity {
            operation: &rendered,
        };
        self.api.api.begin_api_call(identity);
        self.api_calls = self.api_calls.saturating_add(1);
        let result = self.granted(id).and_then(|()| body(self, Recording(())));
        // The class the program is about to be thrown with, taken from the error itself. It is the
        // API layer's own reason, not the tool's: a membrane refusal has no tool record at all, and
        // a typed conversion that failed over a tool that answered `ok` is a failure here and a
        // success there.
        let failure = result.as_ref().err().map(|error| wire_failure(error.code));
        self.api.api.end_api_call(identity, failure);
        result
    }

    /// As [`recorded`](Self::recorded), for the one call that cannot fail.
    ///
    /// `views.current` answers with a list — an agent with nothing open gets an empty one, which is
    /// an answer rather than an error — so there is no verdict to take and the record is always
    /// `ok`. Spelling that out here is what keeps its host function from having to invent a
    /// `Result` it would then unwrap.
    ///
    /// `programs.history` is not one: the host checks the [program-library](super::programs)
    /// capability, because an agent with no library and an agent that has run nothing are different
    /// facts and one empty list could only tell the model one of them.
    ///
    /// It carries **no capability gate**, and it is the only bracket that does not. Its one caller
    /// is bound by [`Binding::Always`](crate::sandbox::Binding::Always) — nothing gates showing a
    /// program its own open views — so a gate here could only ever answer yes, and giving it one
    /// would mean inventing a `Result` for a call that cannot fail.
    /// `the_one_ungated_bracket_serves_an_operation_nothing_gates` is what holds that true.
    pub(super) fn recorded_ok<R>(
        &mut self,
        id: OperationId,
        body: impl FnOnce(&mut Self, Recording) -> R,
    ) -> R {
        let rendered = id.to_string();
        let identity = ApiIdentity {
            operation: &rendered,
        };
        self.api.api.begin_api_call(identity);
        self.api_calls = self.api_calls.saturating_add(1);
        let value = body(self, Recording(()));
        self.api.api.end_api_call(identity, None);
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
