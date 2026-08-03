//! Documentation lookup — the second model-facing carve-out on this membrane (the first is
//! [`session`](super::session)).
//!
//! Like `finish`, it is NOT a gg tool: no capability offers it, no ablation withholds it, and it is
//! bound into every program's scope whatever a run enables — because a model must always be able to
//! discover the functions it *does* have. It has its own WIT interface for the same structural
//! reason `session` does: so the one-to-one correspondence the tool interfaces hold with
//! [`ALL_TOOL_NAMES`](crate::tools::ALL_TOOL_NAMES) is not perturbed.
//!
//! It bypasses [`dispatch`](super::MembraneState) — its deadline and enabled-set guards are wrong
//! for a call that is not a tool and must never be withheld — and goes straight to the
//! [api](super::ToolApi), whose loop-side implementation answers it against the agent's
//! [`DocsRuntime`](crate::docs).
//!
//! Only the **directory** lives here. Reading what a function does is
//! [`view.openDocsView`](super::views), because documentation is material the model reads and every
//! channel into the model is a view.

use super::test_cabinet::gg::docs::{FunctionSummary, Host as DocsHost};
use super::{MembraneState, ToolApi};

impl<A: ToolApi> DocsHost for MembraneState<A> {
    /// List one API object's bound functions, each with a one-line summary — the directory
    /// `object.list()` returns. Straight to the api: the loop knows the run's enabled set.
    fn list_functions(&mut self, object: String) -> Vec<FunctionSummary> {
        self.api
            .list_functions(&object)
            .into_iter()
            .map(|summary| FunctionSummary {
                name: summary.name,
                summary: summary.summary,
            })
            .collect()
    }
}
