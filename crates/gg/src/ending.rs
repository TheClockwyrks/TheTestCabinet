//! How an agent's session ends: the [role](EndingRole) it was dispatched in, and the typed
//! [declaration](Ending) that role produces.
//!
//! Every agent gg drives has to say when it is done, and **saying it is always an explicit call**.
//! There is no shape of reply that means "finished" by implication: a tool-calling turn that requests
//! no tools is an error, and a [responses-as-code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE)
//! reply that is not a program is an error. One rule, both execution modes, no per-run variation.
//!
//! # Why an ending has a shape
//!
//! An ending is a **result**, and a role's result is not always a summary. An agent doing work
//! reports what it did; a reviewer returns a verdict, and a verdict that requests changes is
//! meaningless without the list of changes. Those are different shapes, so they are different
//! calls, and each call's signature carries exactly what that result is made of.
//!
//! That is the whole point of this module. Handing every role one `finish(summary)` and reading the
//! verdict back out of the summary text means a parse, and every such parse has a failure mode that
//! produces a *plausible* answer rather than an error: a reviewer that requested changes and listed
//! none. That cannot happen to a typed call, because the shape is refused at the membrane before it
//! is ever a verdict.
//!
//! # One rule, enforced once
//!
//! The constructors below are the only way an [`Ending`] is built, in either execution mode: the
//! [sandbox membrane](crate::sandbox) calls them for a program's `review.approve()` /
//! `harness.finish(…)`, and the [loop](crate::agent) calls them for the
//! equivalent tool call. So a model cannot reach a laxer check by picking an execution mode, and the
//! message it is told off with is the same sentence either way — with the **calls it names** written
//! the way the caller's mode writes them, since a sentence that says "call this instead" is only
//! useful if the model can write what it names.

use crate::completion::{APPROVE_TOOL, FINISH_TOOL, REQUEST_CHANGES_TOOL};

/// Which group of ending calls an agent is given — the [`ending-kind`](crate::sandbox) the sandbox is
/// handed, and the set of synthetic tools the tool-calling loop offers.
///
/// It is decided by **how the agent was dispatched**, not by its profile: the same profile reviews an
/// issue in one dispatch and implements one in the next, and what it may declare is a property of the
/// job, not of the model behind it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum EndingRole {
    /// An agent doing work: `finish(summary)`. The root, a subagent, an issue's implementer, the
    /// merge agent.
    #[default]
    Standard,
    /// An agent reviewing work: `approve()` / `request_changes(items)`, and **no** `finish` — "the
    /// work is complete" is not a verdict a reviewer is asked for.
    Review,
}

impl EndingRole {
    /// **Every role an agent is dispatched in**, in the order gg offers them.
    ///
    /// It is here, next to [`tools`](Self::tools), rather than written out wherever a caller needs
    /// to enumerate roles — and that placement is the whole of its value. A copy of this list kept
    /// in another file rots in the direction nothing notices: the enum grows, the copy does not,
    /// and a gate that reads the copy goes on agreeing with itself about the roles it still knows
    /// while agents dispatched in the new one are offered an ending nothing documents or records.
    ///
    /// It cannot rot here, and the [assertion below](self) is what makes that a fact rather than a
    /// hope — an array is not something the compiler can derive from an enum, so the chain that
    /// walks it is what a third variant has to be threaded onto.
    pub(crate) const ALL: [Self; 2] = [Self::Standard, Self::Review];

    /// The role after `self` in [`ALL`](Self::ALL)'s order, or `None` for the last of them.
    ///
    /// Read by nothing but the compile-time assertion below, and that is its whole job: it is an
    /// **exhaustive** `match`, so a role added to the enum does not compile until it is threaded
    /// into this chain, and threading it in is what makes the walk longer than [`ALL`](Self::ALL)
    /// and fails the build until the array grows too.
    const fn after(self) -> Option<Self> {
        match self {
            Self::Standard => Some(Self::Review),
            Self::Review => None,
        }
    }

    /// The tool names this role may end with, in the order the loop offers them.
    pub(crate) fn tools(self) -> &'static [&'static str] {
        match self {
            Self::Standard => &[FINISH_TOOL],
            Self::Review => &[APPROVE_TOOL, REQUEST_CHANGES_TOOL],
        }
    }

    /// Whether `name` is one of this role's ending calls — what the loop intercepts a tool call by.
    pub(crate) fn owns(self, name: &str) -> bool {
        self.tools().contains(&name)
    }

    /// The word a **catalogue** files this role's ending calls under, and the word gg's own
    /// [reference projection](crate::reference) reports them by.
    ///
    /// It is here rather than at either of those two places because both of them need it and
    /// neither owns it: a role is a gg concept, so the string that names one in an artifact a human
    /// or a model reads is gg's to choose, and choosing it twice is how two artifacts come to
    /// disagree about which agents may declare work complete.
    pub(crate) const fn id(self) -> &'static str {
        match self {
            Self::Standard => "standard",
            Self::Review => "review",
        }
    }
}

/// **[`EndingRole::ALL`] really is all of them**, asserted at compile time.
///
/// The failure this catches is a role added to gg whose ending calls nobody wrote down. It is
/// silent from every other angle: the capability gate reads `ALL` to work out which endings gg
/// offers, so a role missing from the array makes the gate compute *no* expectation for it, and an
/// expectation of nothing agrees with a table that carries nothing. Agents dispatched in the new
/// role would then be offered a native ending tool that no operation documents, gates or records,
/// and no program in any registered language could end their session.
///
/// The walk is what makes it airtight rather than merely co-located: [`after`](EndingRole::after)
/// is exhaustive, so a third variant must be threaded onto the chain, and a chain one longer than
/// the array fails here — before anything has a chance to run and quietly offer an ending nothing
/// knows about.
const _: () = {
    let mut counted = 1;
    let mut role = EndingRole::ALL[0];
    while let Some(next) = role.after() {
        counted += 1;
        role = next;
    }
    assert!(
        counted == EndingRole::ALL.len(),
        "`EndingRole::ALL` must list every ending role — a role threaded into `after` needs a slot \
         in the array too"
    );
};

/// What an agent declared when it ended its session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Ending {
    /// [`Standard`](EndingRole::Standard): the work is done, and this is what was done.
    Finished {
        /// The agent's final text — the run's last word, or a subagent's return value.
        summary: String,
    },
    /// [`Review`](EndingRole::Review): the work under review is acceptable.
    Approved,
    /// [`Review`](EndingRole::Review): the work under review is not acceptable, and these are the
    /// changes it needs. Never empty — the constructor refuses an empty list, which is why the agent
    /// that has to act on it always has something to act on.
    ChangesRequested {
        /// One actionable change per entry, in the reviewer's order.
        items: Vec<String>,
    },
}

impl Ending {
    /// The [`Finished`](Self::Finished) ending, or why the summary was refused.
    ///
    /// The summary becomes the session's final text and, for a subagent, its entire answer to
    /// whoever asked for the work — so "I am done and have nothing to say about it" is not an ending
    /// gg accepts on the model's behalf.
    ///
    /// `finish` is how **this caller's execution mode** names the call: the bare
    /// [tool name](FINISH_TOOL) on the tool-calling path, and the run's
    /// [program language](crate::sandbox::spell)'s own object-qualified spelling under
    /// responses-as-code. It is a parameter and not a constant because the sentence tells the model
    /// to call it again, and an instruction naming a call the model's protocol does not offer is an
    /// instruction it cannot follow.
    pub(crate) fn finished(summary: String, finish: &str) -> Result<Self, String> {
        if summary.trim().is_empty() {
            return Err(format!(
                "`{finish}` takes a non-empty summary — one or two sentences saying what you \
                 did. Your session is NOT over; write the summary and call it again."
            ));
        }
        Ok(Self::Finished { summary })
    }

    /// The [`ChangesRequested`](Self::ChangesRequested) ending, or why the list was refused.
    ///
    /// Blank entries are dropped and an empty result is an **error**, because the list is dispatched
    /// verbatim to the agent that must fix the work: a rejection with nothing in it would send that
    /// agent back to re-read criteria it already believed it had met.
    ///
    /// `request_changes` and `approve` are named by the caller for the reason
    /// [`finished`](Self::finished)'s `finish` is.
    pub(crate) fn changes_requested(
        items: Vec<String>,
        request_changes: &str,
        approve: &str,
    ) -> Result<Self, String> {
        let items: Vec<String> = items
            .into_iter()
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty())
            .collect();
        if items.is_empty() {
            return Err(format!(
                "`{request_changes}` takes at least one change, each saying what is wrong and \
                 what to change. If the work needs nothing, call `{approve}` instead. Your \
                 session is NOT over."
            ));
        }
        Ok(Self::ChangesRequested { items })
    }

    /// The agent's **final text**: what its spawner is handed, what the run records as its last word,
    /// and what an operator reads on the stream.
    ///
    /// A verdict is rendered rather than stored as prose because the verdict itself is the fact —
    /// nothing downstream reads this back, and rendering it here means one wording rather than one
    /// per caller.
    pub(crate) fn final_text(&self) -> String {
        match self {
            Self::Finished { summary } => summary.clone(),
            Self::Approved => "Approved.".to_string(),
            Self::ChangesRequested { items } => {
                let listed = items
                    .iter()
                    .enumerate()
                    .map(|(index, item)| format!("{}. {item}", index + 1))
                    .collect::<Vec<_>>()
                    .join("\n");
                format!("Changes requested:\n{listed}")
            }
        }
    }

    /// Which call produced this ending, for the telemetry line that names it.
    pub(crate) fn call_name(&self) -> &'static str {
        match self {
            Self::Finished { .. } => FINISH_TOOL,
            Self::Approved => APPROVE_TOOL,
            Self::ChangesRequested { .. } => REQUEST_CHANGES_TOOL,
        }
    }
}

#[cfg(test)]
#[path = "ending.test.rs"]
mod tests;
