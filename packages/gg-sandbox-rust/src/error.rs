//! **How a gg call fails**, and how a Rust program handles it.
//!
//! Every function in this SDK hands back a [`Result`], and a failing one is an [`Err`] carrying a
//! [`ToolError`]. That is not a translation of another arm's exception into Rust: it is what a Rust
//! author expects of a fallible library call, and it is what makes `?` compose — the program's own
//! body returns [`Result<(), Failure>`](crate::Failure) and [`ToolError`] implements
//! [`std::error::Error`], so `let notes = fs::read_text_file("notes.md", ReadOptions::default())?;`
//! binds a `String` and a failure ends the program with gg told exactly which call failed.
//!
//! A failure a program *expects* is an ordinary `match` on the [`code`](ToolError::code):
//!
//! ```ignore
//! match fs::read_text_file("notes.md", ReadOptions::default()) {
//!     Ok(notes) => view::open_text("notes", &notes)?,
//!     Err(failure) if failure.code == ToolErrorCode::NotFound => {
//!         fs::write_file("notes.md", "")?;
//!     }
//!     Err(failure) => return Err(failure.into()),
//! }
//! ```

use crate::bindings::test_cabinet::gg::types as wire;

/// A gg call that failed.
///
/// Every function in this SDK returns one of these in its [`Err`] arm. Branch on
/// [`code`](Self::code) when you expect a particular failure; let it out with `?` when you do not,
/// and gg reports which call failed and where your program was.
///
/// It implements [`std::error::Error`], so `?` converts it into the
/// [`Failure`](crate::Failure) your program's body returns, and it composes with `std`'s own
/// fallible operations in one `?` chain.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolError {
    /// The failure class, so a catch site branches on a value rather than on prose.
    pub code: ToolErrorCode,
    /// The gg call that failed, under gg's own name for it (`read_file`, `spawn_subagent`).
    pub tool: String,
    /// What went wrong, in gg's words. Worth showing yourself; not worth matching on.
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

/// Why a gg call failed — the [`code`](ToolError::code) on a [`ToolError`], and the value a catch
/// site branches on instead of matching on prose.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ToolErrorCode {
    /// The arguments were malformed, ill-typed, or out of range — including a path that is absolute
    /// or climbs out of the workspace, and an agent name this run does not declare.
    InvalidArgument,
    /// The named file, skill, memory, task, epic, issue, subagent, stored program, or documentation
    /// entry does not exist.
    NotFound,
    /// Well-formed, but in conflict with the current state: an ambiguous edit, a dependency cycle, a
    /// duplicate id, a subagent that already returned.
    Conflict,
    /// gg refused the call on a rule about your state: a compaction in flight that this call is not
    /// the one it asked for, a memory call while your memories are read-only, a second ending or
    /// hand-over in a turn that already declared one, or a hook that blocked it. A ceiling you ran
    /// into is `LimitExceeded`, not this.
    Refused,
    /// The call exists but this run's capability set does not offer it. Every name in this SDK is in
    /// scope whatever a run enables, because the crate is compiled once and a run's capability set
    /// is decided per run — so this is the failure a call gg withheld comes back as.
    Unavailable,
    /// A gg-side ceiling was hit: a shell timeout, a store cap, the delegation depth cap, one of the
    /// view caps this program spends, or the run's wall-clock budget.
    LimitExceeded,
    /// The underlying I/O or process failed.
    IoError,
    /// The failure was not classified. Reserved for outcomes raised outside a tool implementation;
    /// nothing you call produces it.
    Other,
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
