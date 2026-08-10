//! The **shell** a model's program runs inside: what starts it, what a failure becomes, and what
//! the component answers when gg asks it what it can bind.
//!
//! Everything here is named by the entry file gg generates around a model's text
//! (`crates/gg/src/sandbox/language/rust.source.rs`) and by nothing else. It is not the SDK, it is
//! not one of the capability modules, and no model reads it.

use crate::bindings::test_cabinet::gg::feedback;
use crate::bindings::test_cabinet::gg::types::ErrorCode;

/// The gg tool names this component can bind, **module by module** — what `bound-tools` answers.
///
/// gg's drift gate asks the committed artifact which tools it binds and compares the answer with
/// gg's own `ALL_TOOL_NAMES`. The answer has to come from the SDK's own binding table rather than
/// from a list written here, because the whole point of asking the artifact is that it is a second,
/// independent statement of the same fact: each capability module declares the tools *its own*
/// functions dispatch, beside the functions that dispatch them, and this is the concatenation.
///
/// The four modules missing from it are missing because none of their functions is a gg tool:
/// `views`, `programs` and `session` are the model-facing carve-outs the WIT keeps outside the tool
/// interfaces, `core` declares no function at all, and `files`'s helper `read_text_file` dispatches
/// `read_file` rather than a name of its own.
const TOOLS: &[&[&str]] = &[
    crate::files::TOOLS,
    crate::shell::TOOLS,
    crate::board::TOOLS,
    crate::tasks::TOOLS,
    crate::memories::TOOLS,
    crate::context::TOOLS,
    crate::delegation::TOOLS,
    crate::skills::TOOLS,
];

/// The gg tool names this component can bind, as `bound-tools` returns them.
pub fn bound_tools() -> Vec<String> {
    TOOLS
        .iter()
        .flat_map(|object| object.iter())
        .map(|name| (*name).to_string())
        .collect()
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
    /// [`ToolFailure`](feedback::ErrorKind::ToolFailure) when the `?` that ended the program was a
    /// failed gg call, and [`Other`](feedback::ErrorKind::Other) for anything the program failed on
    /// its own account — a parse it did itself, a sentence it constructed with
    /// [`message`]. That is the same split the ECMAScript arm's shim makes when it classifies an
    /// uncaught error, which is what makes the two arms' error taxonomies comparable rather than
    /// merely similar.
    ///
    /// [`UnknownName`](feedback::ErrorKind::UnknownName) is deliberately unreachable here and is not
    /// a gap: a Rust program that names something out of scope does not run at all, because the
    /// compile refused it — so on this arm that failure is a compile error a turn earlier rather
    /// than a class of run-time fault.
    fn kind(&self) -> feedback::ErrorKind {
        match self.tool_error() {
            Some(_) => feedback::ErrorKind::ToolFailure,
            None => feedback::ErrorKind::Other,
        }
    }

    /// The failure class the **call** carried, for a program that ended on a failed gg call.
    ///
    /// `None` for anything else. The host classifies a turn's error from this rather than from
    /// [`kind`](Self::kind), because `Unavailable` — a model reaching for something its run does not
    /// offer — has to be the same fact on an arm whose SDK is always in scope as it is on an arm
    /// that can withhold a name. This arm is the first kind: every name is in scope and the host is
    /// what refuses.
    fn code(&self) -> Option<ErrorCode> {
        Some(self.tool_error()?.code.to_wire())
    }

    /// The gg failure this program ended on, if that is what ended it.
    ///
    /// The downcast is why [`Failure`] boxes the error it was given rather than flattening it to a
    /// string at the `?`: the class a failed call carried is the one thing the host cannot recover
    /// from prose, and it is the field a query slices an arm's failures by.
    ///
    /// It reads the **head** of the chain, not the whole of it. A `ToolError` a program wrapped in
    /// an error of its own is that program's failure, classified the way the program classified it;
    /// digging past the wrapper would report a class the program deliberately reframed.
    fn tool_error(&self) -> Option<&crate::ToolError> {
        self.error.downcast_ref::<crate::ToolError>()
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

/// A failure that is a sentence rather than an error value: `Err(gg::program::message("no rows"))`.
///
/// It is reached by that path rather than out of [`prelude`](crate::prelude), and the
/// responses-as-code prompt names it that way: a bare `message` glob-imported into every program
/// would take a common word out of a model's own namespace for a call it makes once a session.
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
