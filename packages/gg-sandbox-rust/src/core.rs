//! The types every other module's signatures name: how a call fails, and what a directory lists.
//!
//! A capability module owns the types it produces, so `files::FileRead` belongs to `files` and
//! `board::IssueCreated` to `board`. These three belong to none of them because they belong to all
//! of them: every function in this SDK returns `Result<_, ToolError>`, and every module's `list`
//! returns [`FunctionSummary`].
//!
//! They are the one part of the surface a program writes unqualified. `gg::prelude` re-exports them
//! by name, because a `match` on an error code that had to spell out a module would be a `match`
//! nobody writes.

use crate::bindings::test_cabinet::gg::types as wire;

/// A gg call that failed.
///
/// Every function in this SDK returns one of these in its `Err` arm, which is what a Rust author
/// expects of a fallible library call and what makes `?` compose: a program's body returns
/// `Result<(), Failure>` and this implements [`std::error::Error`], so an unhandled failure ends the
/// program with gg told which call failed and where.
///
/// A failure a program expects is an ordinary `match` on [`code`](Self::code):
///
/// ```ignore
/// match files::read_text_file("notes.md", files::ReadOptions::default()) {
///     Ok(notes) => views::open_text("notes", &notes)?,
///     Err(failure) if failure.code == ToolErrorCode::NotFound => {
///         files::write_file("notes.md", "")?;
///     }
///     Err(failure) => return Err(failure.into()),
/// }
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolError {
    /// The failure class, so a catch site branches on a value rather than on prose.
    pub code: ToolErrorCode,
    /// The gg call that failed, under gg's own name for it (`read_file`, `spawn_subagent`).
    pub tool: String,
    /// What went wrong, in gg's words. Worth showing in a view; not worth matching on.
    pub message: String,
}

impl std::fmt::Display for ToolError {
    /// gg's own sentence about a failed call: the tool, the class, and what went wrong.
    ///
    /// Not a Rust convention so much as a gg one. It is the same line the ECMAScript guest's shim
    /// writes and the same one the native tool-calling path shows, and it is what a model reads
    /// twice over — once if the program formats the failure itself, and once if it lets it out with
    /// `?`, since the shell reports the `Failure`'s `Display`. Two arms whose uncaught failures read
    /// differently would be two arms whose error rates a study could not compare.
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "`{}` failed ({}): {}",
            self.tool,
            self.code.as_str(),
            self.message
        )
    }
}

impl std::error::Error for ToolError {}

/// Why a gg call failed — the [`code`](ToolError::code) a catch site branches on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ToolErrorCode {
    /// The arguments were malformed, ill-typed, or out of range.
    ///
    /// It covers a path that is absolute or climbs out of the workspace, and an agent name this run
    /// does not declare.
    InvalidArgument,
    /// The named thing does not exist.
    ///
    /// A file, a skill, a memory, a task, an epic, an issue, a subagent, a stored program, or a
    /// documentation entry.
    NotFound,
    /// Well-formed, but in conflict with the current state.
    ///
    /// An ambiguous edit, a dependency cycle, a duplicate id, a subagent that has already returned.
    Conflict,
    /// gg refused the call on a rule about the session's state.
    ///
    /// A compaction in flight that this call is not the one it asked for, a memory call while
    /// memories are read-only, a second ending or hand-over in a turn that already declared one, or
    /// a hook that blocked it. A ceiling that was reached is `LimitExceeded` rather than this.
    Refused,
    /// The call exists and this run's capability set does not offer it.
    ///
    /// Every name in this SDK is in scope whatever a run enables, because the crate is compiled once
    /// and a run's capability set is decided per run — so a withheld call comes back as this rather
    /// than as a compile error.
    Unavailable,
    /// A gg-side ceiling was reached.
    ///
    /// A shell timeout, a store cap, the delegation depth cap, or the run's wall-clock budget.
    LimitExceeded,
    /// The underlying input, output or process failed.
    IoError,
    /// The failure was not classified.
    ///
    /// Reserved for outcomes raised outside a tool implementation; no call in this SDK produces it.
    Other,
}

/// One function in a module's directory, as `list` returns it.
///
/// The summary is one line. A function's whole documentation — every shape it may be called in, what
/// to put in each argument, and the types it refers to — is a view, opened with
/// [`views::open_docs_view`](crate::views::open_docs_view).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FunctionSummary {
    /// The function's name in its module — `read_file` in `files::read_file`.
    pub name: String,
    /// One line saying what it does.
    pub summary: String,
}

impl ToolError {
    /// The SDK's own error, lifted out of the one the generated bindings hand back.
    pub(crate) fn from_wire(error: wire::ToolError) -> Self {
        Self {
            code: ToolErrorCode::from_wire(error.code),
            tool: error.tool,
            message: error.message,
        }
    }
}

impl ToolErrorCode {
    /// gg's own word for this class, as every other execution mode and every other arm prints it.
    ///
    /// A variant's Rust name is `NotFound` and gg's word is `not-found`; a model that has read one
    /// failure should recognise the next one whichever arm it is on, so the sentence a failure
    /// renders as uses gg's word rather than this crate's.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InvalidArgument => "invalid-argument",
            Self::NotFound => "not-found",
            Self::Conflict => "conflict",
            Self::Refused => "refused",
            Self::Unavailable => "unavailable",
            Self::LimitExceeded => "limit-exceeded",
            Self::IoError => "io-error",
            Self::Other => "other",
        }
    }

    /// The arm a wire code names.
    pub(crate) fn from_wire(code: wire::ErrorCode) -> Self {
        match code {
            wire::ErrorCode::InvalidArgument => Self::InvalidArgument,
            wire::ErrorCode::NotFound => Self::NotFound,
            wire::ErrorCode::Conflict => Self::Conflict,
            wire::ErrorCode::Refused => Self::Refused,
            wire::ErrorCode::Unavailable => Self::Unavailable,
            wire::ErrorCode::LimitExceeded => Self::LimitExceeded,
            wire::ErrorCode::IoError => Self::IoError,
            wire::ErrorCode::Other => Self::Other,
        }
    }

    /// The wire code this arm names, for the host's own classification of a program that ended on a
    /// failed call.
    pub(crate) fn to_wire(self) -> wire::ErrorCode {
        match self {
            Self::InvalidArgument => wire::ErrorCode::InvalidArgument,
            Self::NotFound => wire::ErrorCode::NotFound,
            Self::Conflict => wire::ErrorCode::Conflict,
            Self::Refused => wire::ErrorCode::Refused,
            Self::Unavailable => wire::ErrorCode::Unavailable,
            Self::LimitExceeded => wire::ErrorCode::LimitExceeded,
            Self::IoError => wire::ErrorCode::IoError,
            Self::Other => wire::ErrorCode::Other,
        }
    }
}
