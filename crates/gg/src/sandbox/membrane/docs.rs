//! Documentation lookup — the second model-facing carve-out on this membrane (the first is
//! [`session`](super::session)).
//!
//! Like `finish`, none of it is a gg tool: nothing dispatches through the tool seam, and it has its
//! own WIT interface for the same structural reason `session` does — so the one-to-one
//! correspondence the tool interfaces hold with [`ALL_TOOL_NAMES`](crate::tools::ALL_TOOL_NAMES) is
//! not perturbed.
//!
//! It bypasses [`dispatch`](super::MembraneState) — its deadline and enabled-set guards are wrong
//! for a call that is not a tool — and goes straight to the [api](super::ToolApi), whose loop-side
//! implementation answers it against the agent's [`DocsRuntime`](crate::docs).
//!
//! # Two of the three are unconditional, and one is bought
//!
//! The directory is bound into every program's scope whatever a run enables, because a model must
//! always be able to discover the functions it *does* have. **Closing** a documentation view is not:
//! it is gated on [`docview-close`](test_cabinet_core::gg::CAPABILITY_DOCVIEW_CLOSE), refused here
//! rather than withheld from the guest's scope, and the asymmetry is the point. Opening a
//! documentation view only ever appends to the prompt, so a provider's cached prefix survives every
//! open an agent makes for the life of a session; closing one removes an item from the middle and
//! costs the run every cached token after it. Whether that trade pays is a measurement, so it is a
//! toggle.
//!
//! Reading what a function *does* is [`view.openDocsView`](super::views), because documentation is
//! material the model reads and every channel into the model is a view.

use super::test_cabinet::gg::docs::{DocHit, DocSearch, FunctionSummary, Host as DocsHost};
use super::test_cabinet::gg::types::ToolError;
use super::{MembraneState, ToolApi};
use crate::docs::LIST_FUNCTION;
use crate::sandbox::invoker::{DocSearchQuery, ViewRefusal};

/// The object a documentation call is recorded under.
///
/// gg's own name for the family rather than any SDK's spelling of it, because no arm's committed
/// catalogue spells these two calls yet — so there is nothing to resolve a spelling *from*, and a
/// guessed one would be a name in the record that joins to nothing. See
/// [`MembraneState::docview_close_bound`](super::MembraneState).
pub(super) const DOCS_OBJECT: &str = "docs";

/// The function a documentation search is recorded under.
const SEARCH_FUNCTION: &str = "search";
/// The function a targeted documentation close is recorded and refused under.
const CLOSE_DOC_VIEW_FUNCTION: &str = "close";
/// The function a blanket documentation close is recorded and refused under.
const CLOSE_DOC_VIEWS_FUNCTION: &str = "close_all";

impl<A: ToolApi> DocsHost for MembraneState<A> {
    /// List one API object's bound functions, each with a one-line summary — the directory
    /// `object.list()` returns. Straight to the api: the loop knows the run's enabled set.
    ///
    /// It is one host function answering for a call bound on **every** object, so its API record is
    /// the one that cannot be a fixed pair: the object is the argument, and `context.list` and
    /// `fs.list` are two different rows built from the same function. Recorded through
    /// [`recorded_ok_on`](MembraneState::recorded_ok_on) for exactly that reason.
    fn list_functions(&mut self, object: String) -> Vec<FunctionSummary> {
        self.recorded_ok_on(&object.clone(), LIST_FUNCTION, |state, rec| {
            state
                .api(rec)
                .list_functions(&object)
                .into_iter()
                .map(|summary| FunctionSummary {
                    name: summary.name,
                    summary: summary.summary,
                })
                .collect()
        })
    }

    /// Search the surface this agent binds, hand the program its page, and leave the results in the
    /// window as a view.
    ///
    /// Ungated like the directory beside it, and for the same reason: with the prompt naming no
    /// functions, this **is** how an agent finds what it has, so a run that could withhold it could
    /// withhold an agent's knowledge of its own capabilities. What the agent may *find* is still
    /// decided per agent — the runtime filters every hit through the one bound predicate — so the
    /// call being unconditional costs nothing a capability was buying.
    #[allow(
        clippy::too_many_arguments,
        reason = "the arguments are the WIT function's, and it takes a query plus three filters \
                  plus a page; collapsing them into a record here would put a shape in the guest's \
                  hands that no SDK writes"
    )]
    fn search(
        &mut self,
        query: String,
        module: Option<String>,
        r#type: Option<String>,
        kind: Option<String>,
        offset: Option<u32>,
        limit: Option<u32>,
    ) -> Result<DocSearch, ToolError> {
        self.recorded_on(DOCS_OBJECT, SEARCH_FUNCTION, |state, rec| {
            let request = DocSearchQuery {
                query,
                module,
                declared_type: r#type,
                kind,
                offset,
                limit,
            };
            match state.api(rec).search_docs(request) {
                Ok(found) => {
                    state.record_view_opened(found.opened);
                    Ok(DocSearch {
                        total: found.page.total,
                        offset: found.page.offset,
                        hits: found
                            .page
                            .hits
                            .into_iter()
                            .map(|hit| DocHit {
                                key: hit.key,
                                kind: hit.kind.id().to_string(),
                                module: hit.module,
                                name: hit.name,
                                summary: hit.summary,
                            })
                            .collect(),
                    })
                }
                Err(refusal) => Err(state.refuse_docs(SEARCH_FUNCTION, refusal)),
            }
        })
    }

    /// Close the documentation view keyed by `key`, and report how many went.
    ///
    /// The capability check is the **first** statement inside the bracket rather than before it, on
    /// exactly the terms a program-library call's is: the API call is still opened and still counted
    /// as a failure, because "the model reached for something this run does not offer it" is the
    /// fact a capability ablation exists to measure, and a refusal that closed no bracket would be
    /// invisible to it.
    fn close_doc_view(&mut self, key: String) -> Result<u32, ToolError> {
        self.recorded_on(DOCS_OBJECT, CLOSE_DOC_VIEW_FUNCTION, |state, rec| {
            state.docview_close_bound(CLOSE_DOC_VIEW_FUNCTION)?;
            match state.api(rec).close_docviews(Some(key.clone())) {
                Ok(closed) => {
                    if closed > 0 {
                        state.record_view_closed(&key);
                    }
                    Ok(closed)
                }
                Err(refusal) => Err(state.refuse_docs(CLOSE_DOC_VIEW_FUNCTION, refusal)),
            }
        })
    }

    /// Close every documentation view, and report how many went. The blanket form, on the same
    /// terms and behind the same capability.
    fn close_doc_views(&mut self) -> Result<u32, ToolError> {
        self.recorded_on(DOCS_OBJECT, CLOSE_DOC_VIEWS_FUNCTION, |state, rec| {
            state.docview_close_bound(CLOSE_DOC_VIEWS_FUNCTION)?;
            match state.api(rec).close_docviews(None) {
                Ok(closed) => {
                    if closed > 0 {
                        // Recorded under gg's own word for *all of them*, because the view report is
                        // a list of selectors and a blanket close has none: the alternative — one
                        // entry per key removed — would report a single call as a dozen.
                        state.record_view_closed("(every documentation view)");
                    }
                    Ok(closed)
                }
                Err(refusal) => Err(state.refuse_docs(CLOSE_DOC_VIEWS_FUNCTION, refusal)),
            }
        })
    }
}

impl<A: ToolApi> MembraneState<A> {
    /// Record a refused documentation call and render it as the error the program will see thrown —
    /// the [view](super::views) family's `refuse_view` for the two calls that live on this
    /// interface rather than on `views`, and filed in the same view report for the same reason:
    /// nothing was dispatched and no tool was withheld.
    fn refuse_docs(&mut self, function: &str, refusal: ViewRefusal) -> ToolError {
        self.record_view_refusal(&refusal.message);
        ToolError {
            code: super::error_code(Some(refusal.failure)),
            tool: function.to_string(),
            message: refusal.message,
        }
    }
}

#[cfg(test)]
#[path = "docs.test.rs"]
mod tests;
