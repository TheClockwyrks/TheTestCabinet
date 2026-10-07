//! **Discovery**: whether a model read what a call does before it wrote the call, and how gg
//! detects that it did not.
//!
//! # The discipline, and why it is a discipline rather than a convenience
//!
//! [Responses-as-code](crate::sandbox) makes discovery mandatory by construction. The
//! [prompt](crate::prompts) names the modules an agent holds and **no function inside any of
//! them**, so nothing tells a model that `readFile` exists, what it takes, or what it hands back.
//! The only way to learn any of that is to [search](crate::docs::DocsRuntime::search) the
//! documentation and open a [documentation view](crate::context::ContextModel::open_docview) of the
//! name — and a view a program opens arrives in the window on the turn **after** the program that
//! opened it. So the prompt states the discipline in one sentence:
//!
//! > Open a documentation view of each function you intend to call, and write the call on a later
//! > turn.
//!
//! A model that calls a function it never opened a view of is writing a signature **from memory**:
//! from another harness's SDK, from another arm of this one, or from nothing at all. That it
//! sometimes works is the problem rather than the mitigation — a model guessing at a surface it was
//! told to look up is a model that should not be given this surface, and the runs where the guess
//! compiles are exactly the ones no other signal would flag.
//!
//! # Where the detection happens, and why there
//!
//! At the API-call bracket in `sandbox::membrane` — the one place every model-facing call
//! passes through, which already asks whether this agent was *granted* the call. Asking a second
//! question of the agent's own state costs nothing there and cannot be skipped, because no host
//! function can reach the api without opening the bracket first.
//!
//! The bracket cannot answer the question itself: what an agent has open is the loop's state, so
//! the question goes out through [`OperationApi`](crate::sandbox::OperationApi) — the same seam
//! every other question about an agent's state goes through — and comes back as a
//! [`CallDiscovery`].
//!
//! **Nothing is refused.** This is a measurement: a refusal would change what a run *is*, and a run
//! whose calls gg started rejecting is no longer a measurement of the model. It is not a turn error
//! either — the program compiled, ran and did its work — so no [ceiling](crate::limits) observes it
//! and it never reaches the [error rollup](test_cabinet_core::gg::GgErrorSummary). What it produces
//! is a [count on the turn](test_cabinet_core::gg::GgTelemetryKind::CodeExecution), a
//! [rollup on the run](test_cabinet_core::gg::GgSessionSummary::undocumented_calls), and one
//! [warning](DiscoveryWarning) for the operator, written off that same count once per run.
//!
//! # The same turn does not count, and that is the interesting half
//!
//! A view opened by *this* program has not been read by anybody: the model wrote the whole program
//! before any of it ran, so a program that opens a view and then calls the function it documents
//! made the call from the same memory it would have made it from with no view at all. That is
//! precisely the mistake the prompt's *"and write the call on a later turn"* names, so it is a
//! violation and gg has to catch it.
//!
//! Which is why the question is asked against **what stood in the window when the turn began**
//! rather than against what is open at the moment of the call: the loop resolves the agent's
//! documentation surface against the open views as it builds the turn's api, and a call is cleared
//! only by that answer. Reading the live window instead would clear every call a program documented
//! one line earlier, which is the exact case worth catching.
//!
//! Taking the snapshot at the turn boundary also settles two things that a per-item turn number
//! could get wrong. A view that survived a [compaction](crate::compaction) or was restored for a
//! [persistent](crate::persistence) instance is re-placed as part of opening the window, and the
//! model really is holding it, so it clears a call. And a view the model **closed** during this turn
//! still clears the call, because the model read it before it closed it.
//!
//! # What is exempt, and the whole of the reason
//!
//! One class of call, on one ground: **gg spells the ending calls at the model itself**. The
//! prompt's *"Ending your session"* section names `finish` — or `approve`/`requestChanges` for a
//! [reviewer](crate::ending::EndingRole) — in the arm's own spelling, and says what to pass. A model
//! that calls one has followed an instruction rather than guessed a signature, so counting it would
//! be counting gg's own prompt as the model's failure. The exemption is read off the
//! [operations table](crate::sandbox::operation)'s own [`Ending`](crate::sandbox::Binding::Ending)
//! arm rather than written out as a list, so it is exactly the set the prompt names and cannot
//! drift from it.
//!
//! Nothing else is exempt, and the two candidates worth naming are deliberately not:
//!
//! * **The two discovery calls themselves.** `docs.search` and `views.openDocsView` are the calls a
//!   model needs before it can learn anything — but it is not left to guess them either: the
//!   [bootstrap](crate::bootstrap) opens a documentation view of each, before the model's first
//!   turn, in a program that actually ran. They are documented from turn one, so they need no
//!   exemption; and an agent that closed those views and went on calling is guessing exactly as
//!   much as it would be about anything else.
//! * **A call this agent was not granted.** The bracket refuses it, and a refusal is already its own
//!   record — *the model reached for something it was not given* — which is a different fact from
//!   *the model called something it never looked up*. It is also undocumentable by construction: a
//!   withheld operation has no page in this agent's [surface](crate::docs::DocsRuntime), so there
//!   was never a view to open. The bracket asks this question only of the calls it lets through.
//!
//! Beyond those, an operation this agent's surface documents under **no** key at all cannot be
//! violated — there was nothing to read — which is [`CallDiscovery::NotApplicable`]. That is drift
//! rather than a run-time condition (every registered arm catalogues every operation), and it is
//! answered conservatively for the same reason every other unresolvable catalogue lookup is.
//!
//! # Only the model's own programs are measured
//!
//! gg runs programs of its own on an agent's api: the [bootstrap](crate::bootstrap) that stands the
//! window up, and the [on-use script](crate::knowledge) of a skill or memory a turn brought into
//! use. Neither was written by a model, so neither can have skipped reading anything, and charging
//! their calls here would report a violation on every turn that used a skill. The bootstrap answers
//! [`NotApplicable`](CallDiscovery::NotApplicable) from its own api; an on-use script's record is
//! dropped where every other figure of its is dropped, in `absorb_on_use_script`.
//!
//! # It is a lower bound
//!
//! A guessed signature that did not compile never reaches a call site, so the compiler catches it
//! and this does not — which is the owner's own framing of the mechanism: *this would only work if a
//! function is correctly called, but would be better than nothing*. Every call counted here is a
//! call the model got structurally right while still not knowing what it was.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::sandbox::{Binding, OperationId, operation};

/// What an agent's own state says about **having read the documentation of one call** before
/// writing it — the answer the API-call bracket files a violation on.
///
/// Three states rather than a `bool` because "no view was open" and "there was never a view to open"
/// are different facts that a boolean would collapse into the accusing one. Only
/// [`Undocumented`](Self::Undocumented) is recorded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CallDiscovery {
    /// A [documentation view](crate::context::OpenDocview) of the call stood in this agent's window
    /// **before this turn began**, so the model could have read it. The turn's own opens do not
    /// count — see the [module docs](self#the-same-turn-does-not-count-and-that-is-the-interesting-half).
    Documented,
    /// No such view stood, and one could have: the model wrote a call it never looked up.
    Undocumented,
    /// The question does not arise. Either this agent's [surface](crate::docs::DocsRuntime)
    /// documents the operation under no key at all — so there was never a view to open — or the
    /// program is **gg's own** and there is no model whose reading is in question.
    NotApplicable,
}

/// Whether gg itself told the model this call's name, and therefore whether a call of it can be a
/// violation at all.
///
/// Exactly one class answers `true`: the [ending calls](Binding::Ending), which the prompt spells at
/// the model in the arm's own words. See the
/// [module docs](self#what-is-exempt-and-the-whole-of-the-reason) for why that is the whole list and
/// why the two obvious other candidates are not on it.
///
/// Derived from the [operations table](operation)'s own binding rather than listed here, so it is
/// the set the prompt names by construction. An id the table has no row for answers `false` — the
/// conservative reading, and unreachable from the bracket, whose ids are the table's.
pub fn spelled_by_gg(id: OperationId) -> bool {
    matches!(
        operation(id).map(|operation| operation.binding),
        Some(Binding::Ending(_))
    )
}

/// The run's **discovery warning latch**: whether an operator has already been told that this run's
/// model is calling functions it never looked up.
///
/// One line per run, not one per call. The finding is a property of the *model* rather than of any
/// one call — the fortieth undocumented call tells a reader nothing the first did not — and a run
/// whose model ignores the mechanism entirely would otherwise fill its own log with the same
/// sentence. The per-call detail is on the telemetry, where it can be counted and grouped; the log
/// line exists so that somebody watching a live run understands what they are looking at.
///
/// Run-wide rather than per agent, and shared by every agent for the reason the
/// [fault latch](crate::fault) is: this says something about the model, and every agent of a run
/// that binds one profile is the same model making the same mistake.
#[derive(Debug, Clone, Default)]
pub struct DiscoveryWarning {
    /// Raised by the first turn that records one. An `Arc` so every agent's clone is the same
    /// latch, and an [`AtomicBool`] because the only operation on it is *claim it if nobody else
    /// has*.
    warned: Arc<AtomicBool>,
}

impl DiscoveryWarning {
    /// Claim the run's one warning: `true` for the first caller and `false` for every caller after
    /// it, whichever agent each is on.
    ///
    /// A single [`swap`](AtomicBool::swap) rather than a read followed by a write, so two agents
    /// finishing a turn at the same moment cannot both be the first.
    pub fn claim(&self) -> bool {
        !self.warned.swap(true, Ordering::SeqCst)
    }
}

#[cfg(test)]
#[path = "discovery.test.rs"]
mod tests;
