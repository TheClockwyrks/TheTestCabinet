//! What a program is allowed to leave behind, and the caps that bound it.
//!
//! A program accumulates four things on its way to a result: an ordered roster of the calls it
//! made, the calls that were refused, the lines it logged, and the pictures it read. Every one of
//! them is **fed back into the model's context window on the next turn**, and every one of them is
//! written by the program itself — a `for` loop can produce a hundred thousand of any of them well
//! within a fuel budget sized for real work. So each is bounded here, and what a bound discarded is
//! **counted** rather than silently dropped: a model whose roster was cut needs to be told so, or
//! it will read the shorter list as evidence that its loop never ran.
//!
//! Three of the four keep what came **first** and count the rest, because the first refusal, the
//! first calls and the first pictures are the ones that explain what the program was doing. Logs
//! are the exception and keep the **last** lines instead: a program logs per item and then logs its
//! conclusion, so the end of the stream is the part written for the model to read.
//!
//! The caps live together, away from the [membrane](super)'s dispatch policy, because they are one
//! decision — how much of a program's exhaust is worth a context window — and because keeping them
//! next to the code that enforces them is the only way the numbers and the enforcement stay in step.

use super::feedback;
use super::{MembraneState, ProgramError, ProgramErrorKind, SandboxRefusal, SandboxToolCall};
use crate::tools::{ToolData, ToolOutcome};

/// The most log lines one program's output is kept from. A JavaScript guest can log in a loop well
/// within its fuel budget, and every kept line is charged to the agent's context window on the next
/// turn, so the capture is bounded here rather than trusted to the program.
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
/// A bridged call costs ≈0.86 M fuel, so the default 2×10¹¹ ceiling affords a program roughly
/// 230,000 of them — each of which would otherwise push two or three owned `String`s onto a vector
/// nothing bounds, and a line onto a roster the model has to read. Five hundred is far more than a
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
/// otherwise spin recording refusals until its fuel ran out.
pub(super) const MAX_RECORDED_REFUSALS: usize = 100;

/// The most bytes of a failure message one roster entry keeps.
///
/// The message is the failed outcome's whole `output`, which for `shell` is up to 16 KiB of command
/// output. The program has already *seen* that output — it was handed to it, or thrown at it — so
/// the roster's copy is only a reminder of which call failed and roughly why. Keeping it whole
/// would let five failing commands put 80 KiB of duplicated text into the next turn's window, on
/// top of what the program itself returned, while the logs beside it are capped at 16 KiB in total.
pub(super) const MAX_CALL_ERROR_BYTES: usize = 512;

/// The most pictures one program may attach to a turn.
///
/// A program that reads twenty mockups would otherwise put tens of megabytes of base64 into one
/// context window. Further reads still succeed and still report their metadata — with `shown:
/// false` and a reason naming this budget — so the program can carry on and the model is told why
/// it is not looking at the picture.
pub(super) const IMAGE_BUDGET: u32 = 4;

impl MembraneState {
    /// Push the ordered record of one serviced call.
    ///
    /// `completed` is whether the **call** succeeded, which is not always whether the tool reported
    /// success: a `shell` command that exits non-zero is a completed call whose result the program
    /// branched on, and recording it as a failure would make the next turn's roster contradict both
    /// the program and the rule the membrane is built around.
    pub(super) fn record(&mut self, tool: &str, outcome: &ToolOutcome, completed: bool) {
        if self.calls.len() >= MAX_RECORDED_CALLS {
            self.calls_suppressed = self.calls_suppressed.saturating_add(1);
            self.last_recorded_call = None;
            return;
        }
        self.last_recorded_call = Some(self.calls.len());
        self.calls.push(SandboxToolCall {
            name: tool.to_string(),
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

    /// Record a call the membrane refused before it reached the invoker.
    pub(super) fn record_refusal(&mut self, tool: &str, message: &str) {
        if self.refusals.len() >= MAX_RECORDED_REFUSALS {
            self.refusals_suppressed = self.refusals_suppressed.saturating_add(1);
            return;
        }
        self.refusals.push(SandboxRefusal {
            name: tool.to_string(),
            message: message.to_string(),
        });
    }

    /// Move the pictures a call produced out of its outcome and into the turn's attachments, up to
    /// [`IMAGE_BUDGET`].
    ///
    /// A picture beyond the budget is counted, and the outcome's own description of it is rewritten
    /// to say it is not being shown and why — so the program's return value and the model's eyes
    /// agree about what happened, rather than the program being told a picture was shown that the
    /// model never sees.
    ///
    /// The description belongs to the outcome's **first** picture: a [`ToolData::FileImage`]
    /// sidecar describes one picture, and gg has exactly one tool that produces pictures, one at a
    /// time. Tracking acceptance per picture rather than "did anything get dropped?" is what keeps
    /// that true if a tool ever returns several — the attached one is never described as unshown
    /// because a later one was refused.
    pub(super) fn collect_images(&mut self, outcome: &mut ToolOutcome) {
        if outcome.images.is_empty() {
            return;
        }
        let mut first_accepted = false;
        for (index, image) in std::mem::take(&mut outcome.images).into_iter().enumerate() {
            if u32::try_from(self.images.len()).unwrap_or(u32::MAX) >= IMAGE_BUDGET {
                self.images_dropped = self.images_dropped.saturating_add(1);
            } else {
                self.images.push(image);
                first_accepted |= index == 0;
            }
        }
        if !first_accepted && let Some(ToolData::FileImage(image)) = outcome.data.as_mut() {
            image.shown = false;
            image.not_shown_reason = Some(format!(
                "a program may attach at most {IMAGE_BUDGET} pictures to one turn; this file was \
                 read and described, but is not being shown"
            ));
        }
    }
}

impl feedback::Host for MembraneState {
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
            kind: match error.kind {
                feedback::ErrorKind::ToolFailure => ProgramErrorKind::ToolFailure,
                feedback::ErrorKind::UnknownName => ProgramErrorKind::UnknownName,
                feedback::ErrorKind::Other => ProgramErrorKind::Other,
            },
            message: error.message,
            location: error.location,
        });
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
