//! The match runner's errors.

use std::io;

/// A failure that stopped a match (or a case) from being played at all. A
/// controller that fails to load, or misbehaves mid-match, is not one of these: it
/// forfeits, and the match still has a result.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The test case does not declare what a match needs (its `[contract]`,
    /// `[sandbox]`, `[simulation]` or `build.module`): a case-authoring failure,
    /// not either controller's fault.
    #[error("{0}")]
    Case(String),

    /// The wasm engine the host plays in could not be built: an infrastructure
    /// failure on the host running the match.
    #[error("the wasm engine could not be built: {0}")]
    Engine(String),

    /// Reading a controller module from disk failed.
    #[error("host I/O: {0}")]
    Io(#[from] io::Error),
}

/// The match runner's result type.
pub type Result<T> = std::result::Result<T, Error>;
