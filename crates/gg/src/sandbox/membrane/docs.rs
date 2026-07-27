//! Documentation lookup — the second model-facing carve-out on this membrane (the first is
//! [`session`](super::session)).
//!
//! Like `finish`, it is NOT a gg tool: no capability offers it, no ablation withholds it, and it is
//! bound into every program's scope whatever a run enables — because a model must always be able to
//! discover the functions it *does* have. It has its own WIT interface for the same structural
//! reason `session` does: so the one-to-one correspondence the tool interfaces hold with
//! [`ALL_TOOL_NAMES`](crate::tools::ALL_TOOL_NAMES) is not perturbed.
//!
//! Both functions bypass [`dispatch`](super::MembraneState) — its deadline and enabled-set guards
//! are wrong for a call that is not a tool and must never be withheld — and go straight to the
//! [api](super::ToolApi), whose loop-side implementation answers them against the agent's
//! [`DocsRuntime`](crate::docs) and pins a fresh doc block into context, exactly as a read skill is
//! pinned.

use super::test_cabinet::gg::docs::{FunctionSummary, Host as DocsHost};
use super::test_cabinet::gg::types::{ErrorCode, ToolError};
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

    /// One function's full documentation by name. `not-found` for a name this run did not bind — the
    /// message points the model back at the two ways to discover what it does have.
    fn read_docs(&mut self, name: String) -> Result<String, ToolError> {
        self.api.read_docs(&name).ok_or_else(|| ToolError {
            code: ErrorCode::NotFound,
            tool: "readDocs".to_string(),
            message: format!(
                "no function named `{name}` is available this run. Call `<object>.list()` to see \
                 an object's functions, or read a function's docs from the function itself with \
                 `fn.docs()`."
            ),
        })
    }
}
