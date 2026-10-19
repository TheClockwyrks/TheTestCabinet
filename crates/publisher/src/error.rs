//! The publisher's error type.

/// A failure releasing a run's outputs.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// A release step failed for a reason repeating it cannot change: a tool
    /// could not be started, the publish configuration is incomplete, the staged
    /// tree could not be read or rewritten for redaction, or a tool's output could
    /// not be read.
    #[error("publishing the run: {0}")]
    Publish(String),
    /// `gh`, `git` or `wrangler` ran and reported a failure. Repeating the step
    /// can succeed (a network error, GitHub's permission-propagation lag, a
    /// Cloudflare hiccup), so it is transient (see [`crate::retry`]).
    #[error("publishing the run: {0}")]
    Command(String),
    /// The run's repository already holds a `main` whose tree differs from the
    /// run's implementation. A plain push may not replace it, so it is left as
    /// it is; repeating the publish cannot change that, so it is not transient.
    #[error(
        "publishing the run: `{0}` already holds a `main` whose tree differs from this \
         run's implementation; it is left as it is"
    )]
    Diverged(String),
    /// The Cloudflare API could not list the Pages project's deployments: the
    /// request failed in transport (`status` is `None`), was answered with an
    /// error `status`, or returned a listing that could not be read.
    #[error(
        "publishing the run: listing the Pages deployments failed{}: {detail}",
        status.map(|code| format!(" with HTTP {code}")).unwrap_or_default()
    )]
    PagesApi {
        /// The HTTP status the API answered with, or `None` when no response
        /// arrived.
        status: Option<u16>,
        /// Why the request failed.
        detail: String,
    },
}

/// The result of a release step.
pub type Result<T, E = Error> = std::result::Result<T, E>;
