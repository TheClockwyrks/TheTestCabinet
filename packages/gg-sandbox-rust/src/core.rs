//! The types every other module's signatures name: how a call fails.
//!
//! Every function in this SDK returns `Result<_, ApiError>`.
//!
//! Both types are re-exported at the crate root, so a program reaches them as `gg::ApiError` and
//! `gg::ApiErrorCode` or under a `use` of its own.

use crate::bindings::test_cabinet::gg::types as wire;

/// A gg call that failed.
///
/// Every function in this SDK returns one of these in its `Err` arm. It implements
/// [`std::error::Error`], so `?` composes it into a `fn main` returning `Result<(), gg::Failure>`.
///
/// An expected failure is a `match` on [`code`](Self::code):
///
/// ```ignore
/// match files::write_file("notes.md", "what the program computed") {
///     Ok(bytes) => bytes,
///     Err(failure) if failure.code == core::ApiErrorCode::IoError => 0,
///     Err(failure) => return Err(failure.into()),
/// };
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiError {
    /// The failure class.
    pub code: ApiErrorCode,
    /// The gg call that failed, by the key of the operation the program reached for.
    ///
    /// gg's own operation key — `read_file`, `spawn_subagent` — rather than the name of whatever
    /// ran underneath it.
    pub operation: String,
    /// What went wrong, in gg's words. It is prose rather than a value to match on.
    pub message: String,
}

impl std::fmt::Display for ApiError {
    /// gg's own sentence about a failed call: the operation, the class, and what went wrong.
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
            self.operation,
            self.code.as_str(),
            self.message
        )
    }
}

impl std::error::Error for ApiError {}

/// Why a gg call failed — the [`code`](ApiError::code) a catch site branches on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ApiErrorCode {
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
    /// Every name in this SDK is in scope whatever a run enables, so a withheld call comes back as
    /// this rather than as a compile error.
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

impl ApiError {
    /// The SDK's own error, lifted out of the one the generated bindings hand back.
    pub(crate) fn from_wire(error: wire::ApiError) -> Self {
        Self {
            code: ApiErrorCode::from_wire(error.code),
            operation: error.operation,
            message: error.message,
        }
    }
}

impl ApiErrorCode {
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
}
