//! The publisher's error type.

/// A failure releasing a run's outputs.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// A release step failed: `gh`, `git` or `wrangler` could not be run or
    /// reported a failure, the publish configuration is incomplete, or the staged
    /// tree could not be read or rewritten for redaction.
    #[error("publishing the run: {0}")]
    Publish(String),
}

/// The result of a release step.
pub type Result<T, E = Error> = std::result::Result<T, E>;
