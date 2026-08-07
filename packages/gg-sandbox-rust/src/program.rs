//! The **shell** a model's program runs inside: what starts it, what a failure becomes, and what
//! the component answers when gg asks it what it can bind.
//!
//! Everything here is named by the entry file gg generates around a model's text
//! (`crates/gg/src/sandbox/language/rust.source.rs`) and by nothing else. It is not the SDK and no
//! model reads it.

use crate::bindings::test_cabinet::gg::feedback;
use crate::bindings::test_cabinet::gg::types::ErrorCode;

/// The gg tool names this component can bind — what `bound-tools` answers.
///
/// **Empty, honestly.** gg's drift gate asks the committed artifact which tools it binds, and
/// compares the answer with gg's own `ALL_TOOL_NAMES`; the answer has to come from the SDK's own
/// binding table, because the whole point of asking the artifact is that it is a second, independent
/// statement of the same fact. This arm has no SDK yet, so it binds no tool and says so. The SDK
/// step is what fills this, out of the table it binds from — never by hand.
pub const TOOLS: &[&str] = &[];

/// The gg tool names this component can bind, as `bound-tools` returns them.
pub fn bound_tools() -> Vec<String> {
    TOOLS.iter().map(|name| (*name).to_string()).collect()
}

/// Start a program: install the panic hook that gets a located failure out of an aborting guest.
///
/// `program_file` is the file name gg compiled the model's text under and `line_offset` is how many
/// lines of gg's own wrapper precede it, so that a panic at line 4 of the generated file is reported
/// at line 3 of the model's program. Both are passed rather than assumed, because both are gg's
/// facts about a compilation this crate never sees.
///
/// # Why a hook at all
///
/// `wasm32-unknown-unknown` has no unwinder, so `panic = "abort"` is not a setting but the only
/// option, and an abort is an `unreachable` that traps the store. What reaches gg from a trap is
/// "the program trapped" — no message, no location, and no way for a model to tell an
/// out-of-bounds index from an `unwrap` on `None`. That is the single worst error surface any arm
/// of this study could have, and it is entirely avoidable: a panic hook runs **before** the abort,
/// on a live guest, so it can make an ordinary synchronous host call. `feedback.report-error`
/// completes, gg records it, and the trap that follows is then a trap over an error gg already
/// knows the shape of.
///
/// The location comes from [`Location`](std::panic::Location), which is static data rather than a
/// symbol name — which is why `-C strip=symbols` can delete the whole name section without costing
/// this anything.
pub fn begin(program_file: &'static str, line_offset: u32) {
    std::panic::set_hook(Box::new(move |info| {
        let message = match info.payload_as_str() {
            Some(payload) => format!("panicked: {payload}"),
            None => "panicked".to_string(),
        };
        feedback::report_error(&feedback::ProgramError {
            kind: feedback::ErrorKind::Other,
            code: None,
            message,
            location: located(info.location(), program_file, line_offset),
        });
    }));
}

/// Where a panic happened, in the **model's** coordinates — or nothing, when it did not happen in
/// the model's text at all.
///
/// A panic raised inside a library gg linked, or inside `std`, carries that file rather than the
/// program's, and reporting its line as if it were the model's would point at whichever of the
/// model's lines happened to have the same number. Rust makes this the exception rather than the
/// rule: `#[track_caller]` is on `Option::unwrap`, `Result::unwrap`, `expect`, slice indexing and
/// the arithmetic checks, so the panic a program actually causes is attributed to the program's own
/// call.
fn located(
    location: Option<&std::panic::Location<'_>>,
    program_file: &str,
    line_offset: u32,
) -> Option<String> {
    let location = location?;
    if !location.file().ends_with(program_file) {
        return None;
    }
    let line = location.line().checked_sub(line_offset)?;
    Some(format!("line {line}, column {}", location.column()))
}

/// Report a program that ended by returning `Err`, and hand back nothing: the shell has already
/// told gg everything there is to tell.
pub fn report(failure: &Failure) {
    feedback::report_error(&feedback::ProgramError {
        kind: failure.kind(),
        code: failure.code(),
        message: failure.to_string(),
        location: None,
    });
}

/// **Why a program ended early** — the error type the body gg wraps a model's text in returns.
///
/// It exists so that `?` is the operator a Rust author would reach for. Anything that implements
/// [`std::error::Error`] converts into it, which covers every SDK call and every `std` fallible
/// operation a program composes them with; [`message`] is the constructor for a program that wants
/// to stop on a sentence of its own.
///
/// It deliberately does **not** implement [`std::error::Error`] itself. That is what lets the
/// blanket conversion below exist at all — an `impl<E: Error> From<E> for Failure` on a type that
/// was itself an `Error` would overlap the reflexive `impl<T> From<T> for T` — and it is the same
/// shape `anyhow::Error` has, for the same reason.
pub struct Failure {
    /// What ended the program. Boxed because it is whatever the program's own `?` produced, and
    /// because keeping it as itself — rather than flattening it to a string at the conversion — is
    /// what lets [`kind`](Self::kind) recover the gg failure class the SDK's own error carries.
    error: Box<dyn std::error::Error>,
}

impl Failure {
    /// Which of gg's [error kinds](feedback::ErrorKind) this is, as the guest reads it.
    ///
    /// `Other` today, because there is no SDK error type to recognise yet. When there is, this is
    /// where a `self.error.downcast_ref::<crate::Error>()` turns a failed gg call into
    /// `ToolFailure` — matching what the ECMAScript arm's shim classifies an uncaught tool error as,
    /// which is what makes the two arms' error taxonomies comparable rather than merely similar.
    fn kind(&self) -> feedback::ErrorKind {
        feedback::ErrorKind::Other
    }

    /// The failure class the **call** carried, for a program that ended on a failed gg call.
    ///
    /// `None` for anything else, which is everything today. The host classifies a turn's error from
    /// this rather than from [`kind`](Self::kind), because `Unavailable` — a model reaching for
    /// something its run does not offer — has to be the same fact on an arm whose SDK is always in
    /// scope as it is on an arm that can withhold a name.
    fn code(&self) -> Option<ErrorCode> {
        None
    }
}

impl std::fmt::Display for Failure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // The chain, not just the head: a program that `?`s a parse failure out of an SDK call has
        // two sentences worth saying, and a model shown only the outer one is shown "the call
        // failed" with the reason removed.
        write!(formatter, "{}", self.error)?;
        let mut source = self.error.source();
        while let Some(cause) = source {
            write!(formatter, ": {cause}")?;
            source = cause.source();
        }
        Ok(())
    }
}

impl std::fmt::Debug for Failure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Display::fmt(self, formatter)
    }
}

impl<E: std::error::Error + 'static> From<E> for Failure {
    fn from(error: E) -> Self {
        Self {
            error: Box::new(error),
        }
    }
}

/// A failure that is a sentence rather than an error value: `Err(Failure::message("no rows"))`.
///
/// A free function rather than `impl From<&str> for Failure`, and not for want of trying. The
/// blanket conversion above is what makes `?` work, and coherence will not admit a second `From`
/// beside it for **any** type this crate does not own — not `&str`, not `String`, not
/// `Box<dyn Error>` — because a future release of `std` could implement [`std::error::Error`] for
/// one of them and the two impls would then overlap (measured: three `E0119`s). So the ergonomic
/// half is a constructor, which coherence has no opinion about.
pub fn message(message: impl std::fmt::Display) -> Failure {
    Failure {
        error: message.to_string().into(),
    }
}
