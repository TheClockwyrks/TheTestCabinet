//! Putting material into the agent's own context window — the third model-facing carve-out on this
//! membrane, after [`session`](super::session) and [`docs`](super::docs).
//!
//! # Why these are not gg tools
//!
//! The eight tool interfaces stand in exact one-to-one correspondence with gg's
//! [tool vocabulary](crate::tools::ALL_TOOL_NAMES), and `crates/gg/src/sandbox.test.rs` checks the
//! committed component's `bound-tools` against it. A view function is not a tool: no capability
//! offers one, nothing dispatches one by name, and three of the four are bound into every program's
//! scope whatever a run enables. Filing them among the tool interfaces would break that bijection —
//! and making them *real* tools would hand a native tool-calling session an `open_file_view` that
//! duplicates `read_file` for no gain, since on that path every result is already an attributable
//! message.
//!
//! # One of the four is a tool call, and it says so
//!
//! [`open_file_view`](ViewsHost::open_file_view) **is** a `read_file`. It goes through
//! [`dispatch`](MembraneState) against that tool name, so it keeps the wall-clock deadline guard,
//! the enabled-set backstop (a run with reading withheld does not get a read through a side door),
//! and the ordered roster entry — and, on the far side of the
//! [api](ToolApi), the loop's own servicing: the compaction gate, the `ToolCall`/`ToolResult`
//! telemetry pair and the replay capture. What it adds is the view itself: the read's result also
//! becomes a context item, keyed by the path it came from.
//!
//! The other three bypass `dispatch`, and both of its guards are wrong for them. The enabled-set
//! guard would refuse a call that is not a tool at all. And the deadline guard would withhold them
//! at exactly the moment they matter most — the same carve-out
//! [`finish`](super::MembraneState::declare) has, for the same reason: they perform no work, and a
//! turn that cannot report what it found is worse than one that reports late.
//!
//! # Where the rules live
//!
//! Not here. The [caps](crate::agent) — the body and label ceilings, the open-text-view count, the
//! open-image-view count, the per-program op budget — are enforced in `LoopToolApi`, because that
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

use super::test_cabinet::gg::types::ToolError;
use super::test_cabinet::gg::views::{FileRead, Host as ViewsHost, OpenView, ViewKind, ViewRegion};
use super::workspace::{file_read, read_window};
use super::{MembraneState, ToolApi, error_code};
use crate::context::{FileRegion, OpenViewInfo, ViewKind as HostViewKind};
use crate::sandbox::invoker::{ViewOpenOutcome, ViewRefusal};
use crate::tools::READ_FILE_TOOL;

/// The name a refused view call is reported under. It is not a gg tool name — nothing dispatches it
/// — but a `tool-error` must name *something* a model can recognise, and this is the function it
/// called.
const OPEN_TEXT_VIEW_FUNCTION: &str = "openText";
/// The name a refused `view.close` is reported under, on the same terms.
const CLOSE_VIEW_FUNCTION: &str = "close";
/// The name a refused (or unresolvable) `view.openDocsView` is reported under.
const OPEN_DOCS_VIEW_FUNCTION: &str = "openDocsView";

impl<A: ToolApi> ViewsHost for MembraneState<A> {
    /// Read a workspace file and open a view of it.
    ///
    /// The bridged half is an ordinary `read_file` — same tool name, same guards, same roster line —
    /// so a program that opens a view of a file it may not read is refused exactly as a bare read
    /// would be. The view itself is pushed on the api side, which is why the record of it travels
    /// back out of the closure rather than out of the outcome.
    fn open_file_view(
        &mut self,
        path: String,
        offset: Option<u32>,
        limit: Option<u32>,
    ) -> Result<FileRead, ToolError> {
        let (offset, limit) = read_window(offset, limit);
        let mut opened = None;
        let outcome = self
            .call(READ_FILE_TOOL, |api| {
                let ViewOpenOutcome {
                    outcome,
                    opened: view,
                } = api.open_file_view(path, offset, limit);
                opened = view;
                outcome
            })
            .inspect_err(|error| self.record_view_refusal(&error.message))?;
        if let Some(view) = opened {
            self.record_view_opened(view);
        }
        file_read(self, outcome.data)
    }

    /// Open (or replace) a text view. Never dispatched and never refused for a spent budget; the
    /// only failures are the ones the api's caps raise.
    fn open_text_view(&mut self, label: String, body: String) -> Result<(), ToolError> {
        match self.api.open_text_view(label, body) {
            Ok(view) => {
                self.record_view_opened(view);
                Ok(())
            }
            Err(refusal) => Err(self.refuse_view(OPEN_TEXT_VIEW_FUNCTION, refusal)),
        }
    }

    /// Open (or replace) the documentation view for the function called `name`.
    ///
    /// It sits beside `open_text_view` rather than beside the [docs directory](super::docs) for the
    /// reason the whole call exists: documentation is something the model *reads*, and everything
    /// the model reads is a view — keyed, replaceable, closable, and charged to a band. A lookup
    /// that handed the text straight back to the program instead was a second channel into the
    /// model that nothing could account for.
    ///
    /// An unknown or unbound name is `not-found`, worded so the model is pointed at the one call
    /// that enumerates what it *does* have.
    fn open_docs_view(&mut self, name: String) -> Result<(), ToolError> {
        match self.api.open_docs_view(name) {
            Ok(view) => {
                self.record_view_opened(view);
                Ok(())
            }
            Err(refusal) => Err(self.refuse_view(OPEN_DOCS_VIEW_FUNCTION, refusal)),
        }
    }

    /// Close every view carrying `selector` and report how many. Closing nothing is `0`, not a
    /// failure — a program that tidies up unconditionally should not have to guard every call.
    fn close_view(&mut self, selector: String) -> Result<u32, ToolError> {
        match self.api.close_view(selector.clone()) {
            Ok(closed) => {
                if closed > 0 {
                    self.record_view_closed(&selector);
                }
                Ok(closed)
            }
            Err(refusal) => Err(self.refuse_view(CLOSE_VIEW_FUNCTION, refusal)),
        }
    }

    /// What is open in this agent's window. It cannot fail: an agent with nothing open gets an empty
    /// list, which is an answer rather than an error.
    fn current_views(&mut self) -> Vec<OpenView> {
        self.api
            .current_views()
            .into_iter()
            .map(open_view)
            .collect()
    }
}

impl<A: ToolApi> MembraneState<A> {
    /// Record a refused view call and render it as the error the program will see thrown.
    ///
    /// It deliberately does **not** go through [`refuse`](Self::refuse), which records into the
    /// membrane's *tool* refusal roster: nothing was dispatched and no tool was withheld, so a
    /// refusal filed there would make the turn's report claim a tool call that never existed. The
    /// view report is where it belongs.
    fn refuse_view(&mut self, function: &str, refusal: ViewRefusal) -> ToolError {
        self.record_view_refusal(&refusal.message);
        ToolError {
            code: error_code(Some(refusal.failure)),
            tool: function.to_string(),
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
