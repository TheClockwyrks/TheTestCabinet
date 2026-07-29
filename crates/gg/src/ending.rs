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
//! meaningless without the list of changes; a judge names which attempt won. Those are three
//! different shapes, so they are three different calls, and each call's signature carries exactly
//! what that result is made of.
//!
//! That is the whole point of this module. gg used to hand every role the same `finish(summary)` and
//! then read the verdict back out of the summary text — a marker line to match, a bulleted list to
//! scrape. Every such parse has a failure mode that produces a *plausible* answer rather than an
//! error: a reviewer that requested changes and listed none, a judge whose marker line never
//! appeared. Neither can happen to a typed call, because the shape is refused at the membrane before
//! it is ever a verdict.
//!
//! # One rule, enforced once
//!
//! The constructors below are the only way an [`Ending`] is built, in either execution mode: the
//! [sandbox membrane](crate::sandbox) calls them for a program's `review.approve()` /
//! `harness.finish(…)` / `judge.selectWinner(…)`, and the [loop](crate::agent) calls them for the
//! equivalent tool call. So a model cannot reach a laxer check by picking an execution mode, and the
//! message it is told off with is the same sentence either way.

use crate::completion::{APPROVE_TOOL, FINISH_TOOL, REQUEST_CHANGES_TOOL, SELECT_WINNER_TOOL};

/// Which group of ending calls an agent is given — the [`ending-kind`](crate::sandbox) the sandbox is
/// handed, and the set of synthetic tools the tool-calling loop offers.
///
/// It is decided by **how the agent was dispatched**, not by its profile: the same profile reviews an
/// issue in one dispatch and implements one in the next, and what it may declare is a property of the
/// job, not of the model behind it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum EndingRole {
    /// An agent doing work: `finish(summary)`. The root, a subagent, an issue's implementer, a
    /// speculation attempt, the merge agent.
    #[default]
    Standard,
    /// An agent reviewing work: `approve()` / `request_changes(items)`, and **no** `finish` — "the
    /// work is complete" is not a verdict a reviewer is asked for.
    Review,
    /// An agent choosing among attempts: `select_winner(attempt, rationale)`, and no `finish`.
    Judge {
        /// How many attempts were presented, so a pick outside that range is refused where the range
        /// is known — at the call — rather than clamped into a merge of the wrong work.
        attempts: u32,
    },
}

impl EndingRole {
    /// The tool names this role may end with, in the order the loop offers them.
    pub(crate) fn tools(self) -> &'static [&'static str] {
        match self {
            Self::Standard => &[FINISH_TOOL],
            Self::Review => &[APPROVE_TOOL, REQUEST_CHANGES_TOOL],
            Self::Judge { .. } => &[SELECT_WINNER_TOOL],
        }
    }

    /// Whether `name` is one of this role's ending calls — what the loop intercepts a tool call by.
    pub(crate) fn owns(self, name: &str) -> bool {
        self.tools().contains(&name)
    }

    /// How many attempts a [judge](Self::Judge) may choose between; `0` for every other role, which
    /// has no `select_winner` to bound.
    pub(crate) fn attempts(self) -> u32 {
        match self {
            Self::Judge { attempts } => attempts,
            _ => 0,
        }
    }
}

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
    /// [`Judge`](EndingRole::Judge): this attempt won, for this reason.
    Winner {
        /// The 1-based number the winning attempt was presented under.
        attempt: u32,
        /// Why it won.
        rationale: String,
    },
}

impl Ending {
    /// The [`Finished`](Self::Finished) ending, or why the summary was refused.
    ///
    /// The summary becomes the session's final text and, for a subagent, its entire answer to
    /// whoever asked for the work — so "I am done and have nothing to say about it" is not an ending
    /// gg accepts on the model's behalf.
    pub(crate) fn finished(summary: String) -> Result<Self, String> {
        if summary.trim().is_empty() {
            return Err(format!(
                "`{FINISH_TOOL}` takes a non-empty summary — one or two sentences saying what you \
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
    pub(crate) fn changes_requested(items: Vec<String>) -> Result<Self, String> {
        let items: Vec<String> = items
            .into_iter()
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty())
            .collect();
        if items.is_empty() {
            return Err(format!(
                "`{REQUEST_CHANGES_TOOL}` takes at least one change, each saying what is wrong and \
                 what to change. If the work needs nothing, call `{APPROVE_TOOL}` instead. Your \
                 session is NOT over."
            ));
        }
        Ok(Self::ChangesRequested { items })
    }

    /// The [`Winner`](Self::Winner) ending, or why the pick was refused. `count` is how many attempts
    /// were presented, so an out-of-range number is caught where the range is known rather than
    /// silently clamped into a merge of the wrong work.
    pub(crate) fn winner(attempt: u32, rationale: String, count: u32) -> Result<Self, String> {
        if attempt < 1 || attempt > count {
            return Err(format!(
                "`{SELECT_WINNER_TOOL}` takes the winning attempt's number, from 1 to {count}. Your \
                 session is NOT over; call it again."
            ));
        }
        let rationale = rationale.trim().to_string();
        if rationale.is_empty() {
            return Err(format!(
                "`{SELECT_WINNER_TOOL}` takes a non-empty rationale — one sentence saying why that \
                 attempt won. Your session is NOT over; call it again."
            ));
        }
        Ok(Self::Winner { attempt, rationale })
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
            Self::Winner { attempt, rationale } => {
                format!("Selected attempt {attempt}: {rationale}")
            }
        }
    }

    /// Which call produced this ending, for the telemetry line that names it.
    pub(crate) fn call_name(&self) -> &'static str {
        match self {
            Self::Finished { .. } => FINISH_TOOL,
            Self::Approved => APPROVE_TOOL,
            Self::ChangesRequested { .. } => REQUEST_CHANGES_TOOL,
            Self::Winner { .. } => SELECT_WINNER_TOOL,
        }
    }
}

#[cfg(test)]
#[path = "ending.test.rs"]
mod tests;
