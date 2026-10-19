//! The publisher's error type.

/// A failure releasing a run's outputs.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// A release step failed: `gh`, `git` or `wrangler` could not be run or
    /// reported a failure, the publish configuration is incomplete, or the staged
    /// tree could not be read or rewritten for redaction.
    #[error("publishing the run: {0}")]
    Publish(String),
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
