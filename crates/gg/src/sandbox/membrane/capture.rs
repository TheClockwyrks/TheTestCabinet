//! What a program is allowed to leave behind, and the caps that bound it.
//!
//! A program accumulates four things on its way to a result: an ordered roster of the calls it
//! made, the calls that were refused, the lines it logged, and the [views](super::views) it opened,
//! closed and had refused. Every one of them is **fed back into the model's context window on the
//! next turn**, and every one of them is written by the program itself — a `for` loop can produce a
//! hundred thousand of any of them well within an execution timeout sized for real work. So each is
//! bounded here, and what a bound discarded is **counted** rather than silently dropped: a model
//! whose roster was cut needs to be told so, or it will read the shorter list as evidence that its
//! loop never ran.
//!
//! Three of the four keep what came **first** and count the rest, because the first refusal, the
//! first calls and the first views are the ones that explain what the program was doing. Logs
//! are the exception and keep the **last** lines instead: a program logs per item and then logs its
//! conclusion, so the end of the stream is the part written for the model to read.
//!
//! **Pictures are not one of them.** A view is the only channel into the window, so a bare
//! `fs.readFile` of an image no longer attaches anything to the turn — see
//! [`withhold_pictures`].
//!
//! The caps live together, away from the [membrane](super)'s dispatch policy, because they are one
//! decision — how much of a program's exhaust is worth a context window — and because keeping them
//! next to the code that enforces them is the only way the numbers and the enforcement stay in step.

use super::feedback;
use super::{
    ErrorCode, MembraneState, OperationApi, ProgramError, ProgramErrorKind, SandboxRefusal,
    SandboxToolCall, SandboxViewOpened,
};
use crate::sandbox::language::{ProgramLanguage, spell};
use crate::sandbox::operations::{FILES_READ_FILE, OperationId, VIEWS_OPEN_FILE};
use crate::tools::{ApiData, ToolOutcome};

/// The most log lines one program's output is kept from. A JavaScript guest can log in a loop well
/// within its execution timeout, and every kept line is charged to the agent's context window on the
/// next turn, so the capture is bounded here rather than trusted to the program.
///
/// What the cap keeps is the **tail**: see [`feedback::Host::log`] for why.
pub(super) const MAX_LOG_LINES: usize = 200;

/// The most bytes of log output kept in total — the same 16 KiB ceiling `shell` truncates its own
/// output at, so the two sources of program output cost the context window the same.
pub(super) const MAX_LOG_BYTES: usize = 16_384;

/// The most bytes one line is kept from, so a single `console.log(hugeString)` cannot spend the
/// whole budget by itself.
pub(super) const MAX_LOG_LINE_BYTES: usize = 2_048;

/// The most calls one program's roster keeps.
///
/// A program can compose far more calls within its execution timeout than a roster could usefully
/// hold — each of which would otherwise push two or three owned `String`s onto a vector nothing
/// bounds, and a line onto a roster the model has to read. Five hundred is far more than a
/// composed program makes on purpose (listing a directory of two hundred files and reading every
/// one is 201 calls) and small enough that the roster stays something a model can actually use.
///
/// What the cap discards is counted in [`MembraneState::calls_suppressed`], and the two together —
/// not the vector's length — are what the turn actually dispatched.
pub(super) const MAX_RECORDED_CALLS: usize = 500;

/// The most refusals one program's roster keeps.
///
/// Lower than [`MAX_RECORDED_CALLS`] because a refusal is a *mistake*, and the hundredth identical
/// one teaches a model nothing the first did not. It also closes the one shape that turns the
/// deadline guard into an allocation loop: once the run's budget is spent every call is refused,
/// and a program that swallows the throws (`for (;;) { try { shell("x") } catch {} }`) would
/// otherwise spin recording refusals until its execution timeout ran out.
pub(super) const MAX_RECORDED_REFUSALS: usize = 100;

/// The most bytes of a failure message one roster entry keeps.
///
/// The message is the failed outcome's whole `output`, which for `shell` is up to 16 KiB of command
/// output. The program has already *seen* that output — it was handed to it, or thrown at it — so
/// the roster's copy is only a reminder of which call failed and roughly why. Keeping it whole
/// would let five failing commands put 80 KiB of duplicated text into the next turn's window, on
/// top of what the program itself returned, while the logs beside it are capped at 16 KiB in total.
pub(super) const MAX_CALL_ERROR_BYTES: usize = 512;

/// The most view records — opens, closes, refusals — one program's report keeps **of each kind**.
///
/// A view call is cheap to make in a loop and every kept record is charged to the next turn's
/// window, so the same bound the roster and the log carry applies here. It matters most for
/// refusals: once a program has spent its per-program view budget every further view call is
/// refused, and `for (;;) { try { view.close("x") } catch {} }` would otherwise spin appending
/// strings until the execution timeout stopped it.
///
/// What the cap drops is counted in [`MembraneState::views_suppressed`] rather than dropped
/// silently, for the reason the module opens with.
pub(super) const MAX_RECORDED_VIEW_EVENTS: usize = 100;

impl<A: OperationApi> MembraneState<A> {
    /// Push the ordered record of one dispatched call, under gg's own
    /// [operation id](OperationId) for it.
    ///
    /// The id and not the internal call's name, on the rule this whole membrane keeps: the record is
    /// of what the **model wrote**, and three operations may share one internal read. Keying it on
    /// what ran would make `views.open_file` and `files.read_text_file` both report as the read they
    /// were composed out of, which is the reading the offered-versus-called contrast exists to rule
    /// out.
    ///
    /// `completed` is whether the **call** succeeded, which is not always whether the internal call
    /// reported success: a `shell` command that exits non-zero is a completed call whose result the
    /// program branched on, and recording it as a failure would make the next turn's roster
    /// contradict both the program and the rule the membrane is built around.
    pub(super) fn record(&mut self, id: OperationId, outcome: &ToolOutcome, completed: bool) {
        if self.calls.len() >= MAX_RECORDED_CALLS {
            self.calls_suppressed = self.calls_suppressed.saturating_add(1);
            self.last_recorded_call = None;
            return;
        }
        self.last_recorded_call = Some(self.calls.len());
        self.calls.push(SandboxToolCall {
            name: id.to_string(),
            ok: completed,
            summary: outcome.summary.clone(),
            // The failure text is kept even though the program may catch the throw: a caught
            // failure is invisible in the return value, and "it made four calls, one of which
            // failed like this" is exactly what the model needs to read next turn.
            error: (!completed).then(|| truncate(outcome.output.clone(), MAX_CALL_ERROR_BYTES)),
        });
    }

    /// Turn the record of the call just made into a failed one.
    ///
    /// One call's success is only known *after* its outcome has been interpreted: a tool that
    /// answered `ok` but produced no structured sidecar has failed the program even though nothing
    /// about the dispatch went wrong. Rather than defer every record until its conversion — which
    /// would put the bookkeeping in thirty-two places instead of one — the record is written at
    /// dispatch and amended here, on the one path that can discover it was wrong.
    ///
    /// The amendment is by **index**, not by looking at the last entry: a suppressed record leaves
    /// the previous call at the end of the vector, and amending that one would blame a call that
    /// succeeded.
    pub(super) fn amend_last_call_as_failed(&mut self, message: &str) {
        if let Some(call) = self
            .last_recorded_call
            .and_then(|index| self.calls.get_mut(index))
        {
            call.ok = false;
            call.error = Some(truncate(message.to_string(), MAX_CALL_ERROR_BYTES));
        }
    }

    /// Record a call the membrane refused before it reached the invoker, under the same
    /// [operation id](OperationId) a serviced one is recorded under.
    pub(super) fn record_refusal(&mut self, id: OperationId, message: &str) {
        if self.refusals.len() >= MAX_RECORDED_REFUSALS {
            self.refusals_suppressed = self.refusals_suppressed.saturating_add(1);
            return;
        }
        self.refusals.push(SandboxRefusal {
            name: id.to_string(),
            message: message.to_string(),
        });
    }

    /// Record a view the program opened, so the turn's feedback can tell it what its own call did.
    pub(super) fn record_view_opened(&mut self, view: SandboxViewOpened) {
        if self.views_opened.len() >= MAX_RECORDED_VIEW_EVENTS {
            self.views_suppressed = self.views_suppressed.saturating_add(1);
            return;
        }
        self.views_opened.push(view);
    }

    /// Record a selector the program closed. Only a close that actually closed something is
    /// recorded: `view.close` of a selector that is not open returns `0` by design, and reporting
    /// that back as a closure would tell the model it reclaimed something it did not.
    pub(super) fn record_view_closed(&mut self, selector: &str) {
        if self.views_closed.len() >= MAX_RECORDED_VIEW_EVENTS {
            self.views_suppressed = self.views_suppressed.saturating_add(1);
            return;
        }
        self.views_closed.push(selector.to_string());
    }

    /// Record a view call that was refused — a cap, an unusable selector, or a read that failed.
    ///
    /// Bounded by the same [`MAX_CALL_ERROR_BYTES`] a failed call's roster entry is, and for the
    /// same reason: a *cap* message is gg's own text and comfortably under it, but a refusal
    /// carrying a failed tool's whole output is not, and the model has already been thrown that
    /// text once.
    pub(super) fn record_view_refusal(&mut self, message: &str) {
        if self.view_refusals.len() >= MAX_RECORDED_VIEW_EVENTS {
            self.views_suppressed = self.views_suppressed.saturating_add(1);
            return;
        }
        self.view_refusals
            .push(truncate(message.to_string(), MAX_CALL_ERROR_BYTES));
    }
}

/// Drop the pictures a bridged call produced, and correct what its result says about them.
///
/// # One channel
///
/// Under [responses as code](crate::prompts) a [view](super::views) is the only way material enters
/// the agent's window, and a picture is not an exception: an image is a **file view of an image
/// file**, opened with `view.openFile`. A bare `fs.readFile` therefore reads and *describes* a
/// picture without showing it — the same separation the model is taught for text (`fs.readFile`
/// gets bytes for your program; `view.openFile` shows a file to you), applied to pictures too.
///
/// The alternative — a bare read's picture riding out on the turn's feedback — is two independent
/// budgets for one context window: a program could put four pictures in through a view and four
/// more through a read, and neither counter could see the other. Collapsing them by construction is
/// what this buys.
///
/// # Why the sidecar is corrected here and not in `read_image`
///
/// [`read_image`](crate::tools) is shared with the **native** tool-calling path, where the picture
/// really is attached to the tool result and `shown: true` is the truth. Only this path withholds
/// it, so only this path rewrites the sidecar — and the reason it writes names the remedy
/// (`view.openFile`), because a program told merely that it cannot see a file it just read has
/// been given a fact with no action attached to it.
///
/// The prose is deliberately left alone: on this path an image read's `output` is not the program's
/// return value (the program is handed the sidecar) and never becomes a context item, so the only
/// description anybody reads is the one corrected here. A `view.openFile` reaches this function
/// with its pictures already moved into the view item, so nothing is dropped and the sidecar
/// correctly still says `shown: true`.
pub(super) fn withhold_pictures(outcome: &mut ToolOutcome, language: &dyn ProgramLanguage) {
    if outcome.images.is_empty() {
        return;
    }
    outcome.images.clear();
    if let Some(ApiData::FileImage(image)) = outcome.data.as_mut() {
        image.shown = false;
        // Both calls spelled from this program's own catalogue: the sentence is one a model reads
        // and acts on, so naming a call it cannot make would be worse than saying nothing.
        image.not_shown_reason = Some(format!(
            "`{}` does not show images; open one with `{}(path)`",
            spell(language, FILES_READ_FILE),
            spell(language, VIEWS_OPEN_FILE),
        ));
    }
}

impl<A: OperationApi> feedback::Host for MembraneState<A> {
    /// One line the program produced with `console.*`, subject to the three capture caps.
    ///
    /// The capture keeps the **tail**: once a cap is reached the *oldest* kept line is evicted to
    /// make room for the new one. That is the direction the model's own writing habits ask for —
    /// the natural shape is to log per item in a loop and then log the conclusion, so a head-biased
    /// capture would discard exactly the line the program wrote for the model to read. It is also
    /// what the system prompt promises, and a prompt and a capture that disagree teach a model to
    /// distrust both.
    ///
    /// Evicted lines are **counted**, never silently dropped: the feedback template says how many
    /// were lost, so a model whose diagnostic output was cut knows to log less rather than
    /// concluding its loop never ran.
    ///
    /// One line always fits: [`MAX_LOG_LINE_BYTES`] is well under [`MAX_LOG_BYTES`], so the
    /// eviction loop cannot spin on a line too large to keep.
    fn log(&mut self, line: String) {
        let line = truncate(line, MAX_LOG_LINE_BYTES);
        while !self.logs.is_empty()
            && (self.logs.len() >= MAX_LOG_LINES
                || self.log_bytes.saturating_add(line.len()) > MAX_LOG_BYTES)
        {
            let evicted = self.logs.pop_front().unwrap_or_default();
            self.log_bytes = self.log_bytes.saturating_sub(evicted.len());
            self.logs_suppressed = self.logs_suppressed.saturating_add(1);
        }
        self.log_bytes = self.log_bytes.saturating_add(line.len());
        self.logs.push_back(line);
    }

    /// The shim's note that the program ended with a `return` carrying a value.
    ///
    /// The value itself never crosses: a program's return value is not a channel, and the whole
    /// point of that rule is that there is nothing here to serialise, size or bound. What is
    /// recorded is the *fact*, so the turn's feedback can tell the model where its value went —
    /// which is the one thing a silent discard could not do.
    fn note_return(&mut self) {
        self.returned_value = true;
    }

    /// The shim's note that a tool call happened after the program ended. First one wins: the shim
    /// sends it at most once per run, and a second would say nothing new.
    fn report_deferred(&mut self, note: String) {
        self.deferred_note.get_or_insert(note);
    }

    /// A code module that threw while it was being loaded, so its `lib` entry is empty.
    ///
    /// Every one is kept rather than only the first: the modules are independent, they came from
    /// different skills and memories, and a model told about one broken module out of three would
    /// fix that one and meet the next next turn. The list is bounded by how many modules the host
    /// handed over in the first place, which is how many the agent has read — so there is no cap to
    /// apply here that the read path has not already applied.
    fn report_module_error(&mut self, name: String, message: String) {
        self.module_errors
            .push((name, truncate(message, MAX_LOG_LINE_BYTES)));
    }

    /// The throw the shim caught. First one wins, for the same reason — the shim has exactly one
    /// `catch`, and a program cannot fail twice.
    ///
    /// It also **revokes** a completion the same program declared. `finish` sets a flag and returns,
    /// so a program can declare the run over and then throw two statements later — and the summary
    /// it declared describes work whose checks did not finish running. Keeping the ending would end
    /// the run on a claim the program never got to make good; dropping it costs one more turn, in
    /// which the model is told its ending was cancelled and why. The revocation is counted rather
    /// than silent, because a `finish` that did not finish is exactly the fact a model needs.
    fn report_error(&mut self, error: feedback::ProgramError) {
        self.revoke_completion();
        self.program_error.get_or_insert(ProgramError {
            kind: classify(error.kind, error.code),
            message: error.message,
            location: error.location,
        });
    }
}

/// What class an uncaught throw is recorded as — **the host's reading, not the guest's**.
///
/// A throw carrying an [`ErrorCode`] was a failed model-facing call, and there is one distinction in
/// it that no guest can be trusted with. [`Unavailable`](ErrorCode::Unavailable) means the model
/// reached for something this run does not offer it, which is the same fact — and the same recovery
/// — as a name that was never in scope at all. A guest that can withhold a name raises a
/// `ReferenceError` and calls that [`UnknownName`](ProgramErrorKind::UnknownName); a guest that
/// links its SDK as a library has the name, is refused at the membrane, and would call the identical
/// event a [`ToolFailure`](ProgramErrorKind::ToolFailure). One event, two turn-error metrics, split
/// by nothing but which language arm the run was in — which is precisely the confound a cross-arm
/// study cannot have. Deciding it here decides it once, for every guest.
///
/// A throw with no code is the program's own — a `TypeError`, a thrown string, a name the program
/// invented — and the guest's reading is the only reading there is.
fn classify(kind: feedback::ErrorKind, code: Option<ErrorCode>) -> ProgramErrorKind {
    match code {
        Some(ErrorCode::Unavailable) => ProgramErrorKind::UnknownName,
        Some(_) => ProgramErrorKind::ToolFailure,
        None => match kind {
            feedback::ErrorKind::ApiFailure => ProgramErrorKind::ToolFailure,
            feedback::ErrorKind::UnknownName => ProgramErrorKind::UnknownName,
            feedback::ErrorKind::Other => ProgramErrorKind::Other,
        },
    }
}

/// `text`, cut to `limit` bytes on a character boundary with an ellipsis marking the cut.
///
/// Cutting on a byte index would split a multi-byte character and panic; walking back to the last
/// boundary is cheap and cannot fail. The marker matters as much as the cut: an unmarked truncation
/// reads as a program that logged half a value, or as a tool whose diagnostic stopped mid-sentence.
fn truncate(text: String, limit: usize) -> String {
    if text.len() <= limit {
        return text;
    }
    let mut end = limit;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &text[..end])
}

#[cfg(test)]
#[path = "capture.test.rs"]
mod tests;
