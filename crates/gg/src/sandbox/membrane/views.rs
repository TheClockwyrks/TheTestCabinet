//! Putting material into the agent's own context window — the third model-facing carve-out on this
//! membrane, after [`session`](super::session) and [`docs`](super::docs).
//!
//! # Why these are not gg tools
//!
//! Because the tool-calling surface has no use for them. A view is how a **program** puts material
//! into its own agent's window, and a tool-calling turn needs no such call: on that path every tool
//! result is already an attributable message in the window, so an `open_file_view` tool would
//! duplicate `read_file` for no gain. No capability offers a tool for one and nothing dispatches one
//! by name. The two that *open* something a program computed or gg holds —
//! [`open_text_view`](ViewsHost::open_text_view) and [`open_docs_view`](ViewsHost::open_docs_view)
//! — are bound to every program whatever a run enables, which is what makes the view surface the one
//! channel a run that granted nothing at all still has. The two that *manage* the window —
//! [`close_view`](ViewsHost::close_view) and [`current_views`](ViewsHost::current_views) — are
//! context management and are bought by `agent-managed-context` like the evictions and the archive.
//!
//! # One of the five reaches the workspace, and is still recorded as itself
//!
//! [`open_file_view`](ViewsHost::open_file_view) **performs a read**. It goes through
//! [`dispatch`](MembraneState), so it keeps the wall-clock deadline guard, the ordered roster entry
//! and — on the far side of the [api](OperationApi) — the loop's own servicing: the compaction gate and
//! the session capture. What it adds is the view itself: the read's result also becomes a context
//! item, keyed by the path it came from.
//!
//! Every one of those records names `views.open_file`, because that is what the **model** wrote. The
//! internal read is shared with `files.read_file` and `files.read_text_file` — three operations over
//! one implementation — and none of the three is recorded, refused or reported as either of the
//! others. A program that opened a view of a file it may not read is refused `views.open_file`; a
//! read that fails throws with `open_file` in the error's `operation` field; and the turn's roster carries
//! one entry per call the model made.
//!
//! The other four bypass `dispatch`, whose deadline guard is wrong for them: it would withhold them
//! at exactly the moment they matter most — the same carve-out
//! [`finish`](super::MembraneState::declare) has, for the same reason: they perform no work, and a
//! turn that cannot report what it found is worse than one that reports late. They are recorded as
//! API calls exactly as the bridged one is; having no tool behind them has never been a reason to
//! count them nowhere.
//!
//! # Where the rules live
//!
//! Not here. The [caps](crate::agent) — the body and label ceilings, the open-text-view count, the
//! open-image-view count, the per-program op budget — are enforced in `LoopOperationApi`, because that
//! is where the [`ContextModel`](crate::context::ContextModel) is and a cap that cannot see the
//! window is a cap guessing. This file lowers what comes back into the typed WIT result, and
//! records what happened for the turn's feedback.
//!
//! # A picture reaches the model here or nowhere
//!
//! `view.openFile` is the **only** channel a picture has into the window: a bare `fs.readFile`
//! reads and describes an image without showing it (see
//! [`withhold_pictures`](super::capture::withhold_pictures)). That is what makes the open-image-view
//! cap a cap on the whole arm rather than one of two budgets that cannot see each other.

use super::test_cabinet::gg::types::ApiError;
use super::test_cabinet::gg::views::{FileRead, Host as ViewsHost, OpenView, ViewKind, ViewRegion};
use super::workspace::{file_read, read_window};
use super::{MembraneState, OperationApi, error_code};
use crate::context::{FileRegion, OpenViewInfo, ViewKind as HostViewKind};
use crate::sandbox::invoker::{ViewOpenOutcome, ViewRefusal};
use crate::sandbox::operations::{
    OperationId, VIEWS_CLOSE, VIEWS_CURRENT, VIEWS_OPEN_DOCS_VIEW, VIEWS_OPEN_FILE, VIEWS_OPEN_TEXT,
};

impl<A: OperationApi> ViewsHost for MembraneState<A> {
    /// Read a workspace file and open a view of it.
    ///
    /// The read is the same one `files.read_file` performs, under the same guards, so a program that
    /// opens a view of a file it may not read is refused exactly as a bare read would be. The view
    /// itself is pushed on the api side, which is why the record of it travels back out of the
    /// closure rather than out of the outcome.
    ///
    /// Everything the call leaves behind says `views.open_file`, because that is what the **model**
    /// wrote: the API bracket, the roster line, and the `operation` field of the error a failed read
    /// throws. What runs underneath is the execution layer's business and appears nowhere in what
    /// this agent's surface reports.
    fn open_file_view(
        &mut self,
        path: String,
        offset: Option<u32>,
        limit: Option<u32>,
        max_line_chars: Option<u32>,
    ) -> Result<FileRead, ApiError> {
        self.recorded(VIEWS_OPEN_FILE, |state, rec| {
            let (offset, limit) = read_window(offset, limit);
            // Not normalised here: unlike a zero `offset`, which plainly means the first line, a
            // zero line cut names nothing, and the api refuses it by name.
            let max_line_chars = max_line_chars.map(|chars| chars as usize);
            let mut opened = None;
            let outcome = state
                .call(rec, VIEWS_OPEN_FILE, |api| {
                    let ViewOpenOutcome {
                        outcome,
                        opened: view,
                    } = api.open_file_view(path, offset, limit, max_line_chars);
                    opened = view;
                    outcome
                })
                .inspect_err(|error| state.record_view_refusal(&error.message))?;
            if let Some(view) = opened {
                state.record_view_opened(view);
            }
            file_read(state, VIEWS_OPEN_FILE, outcome.data)
        })
    }

    /// Open (or replace) a text view. Never dispatched and never refused for a spent budget; the
    /// only failures are the ones the api's caps raise.
    fn open_text_view(&mut self, label: String, body: String) -> Result<(), ApiError> {
        self.recorded(VIEWS_OPEN_TEXT, |state, rec| {
            match state.api(rec).open_text_view(label, body) {
                Ok(view) => {
                    state.record_view_opened(view);
                    Ok(())
                }
                Err(refusal) => Err(state.refuse_view(VIEWS_OPEN_TEXT, refusal)),
            }
        })
    }

    /// Open the documentation view for `name`, and the type views the agent's mode opens beside it.
    ///
    /// It sits beside `open_text_view` rather than beside the [docs directory](super::docs) for the
    /// reason the whole call exists: documentation is something the model *reads*, and everything
    /// the model reads is a view — keyed, closable, and charged to a band. A lookup that handed the
    /// text straight back to the program instead was a second channel into the model that nothing
    /// could account for.
    ///
    /// **Every** view the call placed is recorded, which is why the api answers with a list. One
    /// call can place a function's view and one per type in its signature, and the turn's feedback
    /// has to report the window the model actually got. An empty list is a real answer too: it is
    /// what a re-open of something already open produces, since that is a total no-op.
    ///
    /// An unknown or unbound name is `not-found`, worded so the model is pointed at the one call
    /// that enumerates what it *does* have.
    fn open_docs_view(&mut self, name: String) -> Result<(), ApiError> {
        self.recorded(VIEWS_OPEN_DOCS_VIEW, |state, rec| {
            match state.api(rec).open_docs_view(name) {
                Ok(views) => {
                    for view in views {
                        state.record_view_opened(view);
                    }
                    Ok(())
                }
                Err(refusal) => Err(state.refuse_view(VIEWS_OPEN_DOCS_VIEW, refusal)),
            }
        })
    }

    /// Close every view carrying `selector` and report how many. Closing nothing is `0`, not a
    /// failure — a program that tidies up unconditionally should not have to guard every call.
    fn close_view(&mut self, selector: String) -> Result<u32, ApiError> {
        self.recorded(VIEWS_CLOSE, |state, rec| {
            match state.api(rec).close_view(selector.clone()) {
                Ok(closed) => {
                    if closed > 0 {
                        state.record_view_closed(&selector);
                    }
                    Ok(closed)
                }
                Err(refusal) => Err(state.refuse_view(VIEWS_CLOSE, refusal)),
            }
        })
    }

    /// What is open in this agent's window. An agent with nothing open gets an empty list, which is
    /// an answer rather than an error; the one way the call fails is the gate every bracket asks,
    /// for an agent whose run did not buy it.
    fn current_views(&mut self) -> Result<Vec<OpenView>, ApiError> {
        self.recorded(VIEWS_CURRENT, |state, rec| {
            Ok(state
                .api(rec)
                .current_views()
                .into_iter()
                .map(open_view)
                .collect())
        })
    }
}

impl<A: OperationApi> MembraneState<A> {
    /// Record a refused view call and render it as the error the program will see thrown.
    ///
    /// It deliberately does **not** go through [`refuse`](Self::refuse), which files into the
    /// membrane's roster of calls this agent was not granted: nothing was withheld here, the agent
    /// holds the call and made it, and a cap said no. A refusal filed there would make the turn's
    /// report claim the agent reached for something it does not have, which is the one thing that
    /// roster is counted for. The view report is where it belongs.
    ///
    /// The error carries the operation's key, exactly as every other failed call on this membrane
    /// does — a `catch` site branches on the call that failed, and the sentence beside it is the
    /// api's own, already written for the model.
    pub(super) fn refuse_view(&mut self, id: OperationId, refusal: ViewRefusal) -> ApiError {
        self.record_view_refusal(&refusal.message);
        ApiError {
            code: error_code(Some(refusal.failure)),
            operation: id.key.to_string(),
            message: refusal.message,
        }
    }
}

/// One open view as the membrane declares it.
///
/// Destructured field by field rather than read through dots, on the rule this membrane holds
/// everywhere: a field added to [`OpenViewInfo`] then fails to compile *here*, which is where
/// someone has to decide whether a program should be told about it.
fn open_view(view: OpenViewInfo) -> OpenView {
    let OpenViewInfo {
        kind,
        selector,
        tokens,
        region,
    } = view;
    OpenView {
        kind: match kind {
            HostViewKind::File => ViewKind::File,
            HostViewKind::Text => ViewKind::Text,
            HostViewKind::Docs => ViewKind::Docs,
            // The [search-results view](crate::context::ViewKind::Search) is declared to a program
            // as a **text** view, and this is the one place gg's own taxonomy and the guest's do not
            // line up.
            //
            // It is a compromise with a date on it rather than a judgement. `view-kind` is a WIT
            // enum, and a component's import is only satisfied by a host whose types it is a
            // supertype of — so adding a fourth case to it makes every one of the eleven committed
            // guests refuse to instantiate until it is rebuilt, which is the stage that reshapes the
            // SDKs and not this one. What is chosen instead is the word that is *behaviourally*
            // right at this boundary: like a text view and unlike a documentation view, the results
            // carry composed text under one label and are closed by `view.close` rather than by the
            // capability-bought `docs.close-doc-view`. A model told `docs` would reach for the close
            // that cannot remove it.
            //
            // Nothing about the measurement rides on this. The band is gg's own either way, so what
            // discovery costs a window is still reported apart from every other view.
            HostViewKind::Search => ViewKind::Text,
        },
        selector,
        tokens,
        region: region.map(view_region),
    }
}

/// A view's line window, narrowed to the `u32` the membrane declares.
///
/// The host's [`FileRegion`] counts lines in `u64`. Saturating rather than wrapping is the only
/// honest direction: a file with more than four billion lines does not exist, and a wrap would turn
/// a preposterous number into a small plausible one the model would then act on.
fn view_region(region: FileRegion) -> ViewRegion {
    let FileRegion { offset, limit } = region;
    ViewRegion {
        offset: u32::try_from(offset).unwrap_or(u32::MAX),
        limit: u32::try_from(limit).unwrap_or(u32::MAX),
    }
}

#[cfg(test)]
#[path = "views.test.rs"]
mod tests;
