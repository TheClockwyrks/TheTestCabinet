//! Publisher configuration, resolved from the environment.
//!
//! The publisher is the one-shot per-publish-Job binary: it releases exactly one
//! reviewed run and streams its progress to the backend, then exits. The dispatcher
//! passes everything it needs through the environment when it creates the publisher
//! Job — no config file, no HTTP server, no flags.
//!
//! | Variable | Required | Purpose | Default |
//! | --- | --- | --- | --- |
//! | `TCAB_BACKEND_URL` | yes | The backend the publisher streams progress/result back to (`POST /publish-jobs/{id}/events\|result`). | — |
//! | `TCAB_PUBLISH_JOB_ID` | yes | The id of the publish job this binary serves (the `/publish-jobs/{id}/…` path key and the id the publish-job token was minted for). | — |
//! | `TCAB_PUBLISH_JOB_TOKEN` | yes | The per-publish-job bearer token authenticating the binary's calls (and the `tree.tar` download). | — |
//! | `TCAB_PUBLISH_RUN_ID` | yes | The id of the run to release — the artifact-service store key the source tree is downloaded by. | — |
//! | `TCAB_ARTIFACTS_URL` | yes | The artifact service the run's source tree is downloaded from (`GET /runs/{id}/tree.tar`). | — |
//! | `TCAB_WORK_DIR` | no | Ephemeral scratch directory the downloaded tree is untarred into. The pod is disposable, so this is lost on exit. | `./.tcab-publisher` |
//! | `TCAB_PUBLISHER_TERMINATION_GRACE_SECONDS` | no | The pod's termination grace period, in seconds: how long the publisher has after `SIGTERM` to finish the step it is on and report (see [`crate::sequence`]). It matches the publisher Job's `terminationGracePeriodSeconds`, which the dispatcher leaves at Kubernetes' default. | `30` |
//!
//! `TCAB_GITHUB_ORG` / `TCAB_PAGES_PROJECT` are **not** parsed here — they are read
//! directly by [`PublishConfig::from_env`](crate::release::PublishConfig::from_env)
//! when the release runs. `GH_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and
//! `CLOUDFLARE_API_TOKEN` arrive via the Job's `envFrom`. `GH_TOKEN` is consumed by
//! `gh` alone. The Cloudflare pair is consumed by `wrangler` and read by
//! [`PagesApi::from_env`](crate::pages::PagesApi::from_env) when the release runs,
//! to look the build's deployment up before deploying it; both are required.

use std::path::PathBuf;
use std::time::Duration;

/// The termination grace period the publisher assumes when
/// `TCAB_PUBLISHER_TERMINATION_GRACE_SECONDS` is unset: Kubernetes' default
/// `terminationGracePeriodSeconds`, which the dispatcher does not override for a
/// publisher Job.
pub const DEFAULT_TERMINATION_GRACE: Duration = Duration::from_secs(30);

/// A publisher configuration error: a required variable is unset or unusable.
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    /// A required environment variable is missing (or blank).
    #[error("required environment variable {0} is not set")]
    Missing(&'static str),
    /// An optional environment variable is set to a value that cannot be used.
    #[error("environment variable {var} is not usable: `{value}` ({reason})")]
    Invalid {
        /// The variable.
        var: &'static str,
        /// The value it holds.
        value: String,
        /// What a usable value is.
        reason: &'static str,
    },
}

/// The resolved publisher configuration.
#[derive(Debug, Clone)]
pub struct Config {
    /// The backend base URL the publisher streams the publish's progress and
    /// terminal result back to (`TCAB_BACKEND_URL`), without a trailing slash.
    pub backend_url: String,
    /// The id of the publish job this binary serves (`TCAB_PUBLISH_JOB_ID`): the
    /// `/publish-jobs/{id}/…` path key and the id the publish-job token was minted
    /// for (so the artifact service verifies the `tree.tar` download against it).
    pub publish_job_id: String,
    /// The per-publish-job bearer token authenticating the binary's reporting
    /// calls and the source-tree download (`TCAB_PUBLISH_JOB_TOKEN`).
    pub publish_job_token: String,
    /// The id of the run to release (`TCAB_PUBLISH_RUN_ID`): the artifact-service
    /// store key the source tree is downloaded by (a different UUID from the
    /// publish-job id).
    pub run_id: String,
    /// The artifact service base URL the run's source tree is downloaded from
    /// (`TCAB_ARTIFACTS_URL`), without a trailing slash.
    pub artifacts_url: String,
    /// Ephemeral scratch directory the downloaded tree is untarred into
    /// (`TCAB_WORK_DIR`). The pod is disposable, so this is lost on exit.
    pub work_dir: PathBuf,
    /// The pod's termination grace period
    /// (`TCAB_PUBLISHER_TERMINATION_GRACE_SECONDS`, default
    /// [`DEFAULT_TERMINATION_GRACE`]): the time between `SIGTERM` and the pod's
    /// kill, which bounds the step the publisher is on and its report.
    pub termination_grace: Duration,
}

impl Config {
    /// Resolve the configuration from the process environment.
    ///
    /// `TCAB_BACKEND_URL`, `TCAB_PUBLISH_JOB_ID`, `TCAB_PUBLISH_JOB_TOKEN`,
    /// `TCAB_PUBLISH_RUN_ID`, and `TCAB_ARTIFACTS_URL` are required (the dispatcher
    /// always sets them); `TCAB_WORK_DIR` and
    /// `TCAB_PUBLISHER_TERMINATION_GRACE_SECONDS` default, and the latter must be a
    /// whole number of seconds when set. A blank value is treated as
    /// unset so an empty export does not slip through.
    pub fn from_env() -> Result<Self, ConfigError> {
        let backend_url = non_empty("TCAB_BACKEND_URL")
            .ok_or(ConfigError::Missing("TCAB_BACKEND_URL"))?
            .trim_end_matches('/')
            .to_string();
        let publish_job_id =
            non_empty("TCAB_PUBLISH_JOB_ID").ok_or(ConfigError::Missing("TCAB_PUBLISH_JOB_ID"))?;
        let publish_job_token = non_empty("TCAB_PUBLISH_JOB_TOKEN")
            .ok_or(ConfigError::Missing("TCAB_PUBLISH_JOB_TOKEN"))?;
        let run_id =
            non_empty("TCAB_PUBLISH_RUN_ID").ok_or(ConfigError::Missing("TCAB_PUBLISH_RUN_ID"))?;
        let artifacts_url = non_empty("TCAB_ARTIFACTS_URL")
            .ok_or(ConfigError::Missing("TCAB_ARTIFACTS_URL"))?
            .trim_end_matches('/')
            .to_string();
        let work_dir = non_empty("TCAB_WORK_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(".tcab-publisher"));
        let termination_grace =
            match non_empty("TCAB_PUBLISHER_TERMINATION_GRACE_SECONDS") {
                None => DEFAULT_TERMINATION_GRACE,
                Some(value) => value.parse::<u64>().map(Duration::from_secs).map_err(|_| {
                    ConfigError::Invalid {
                        var: "TCAB_PUBLISHER_TERMINATION_GRACE_SECONDS",
                        value,
                        reason: "a whole number of seconds",
                    }
                })?,
            };
        Ok(Self {
            backend_url,
            publish_job_id,
            publish_job_token,
            run_id,
            artifacts_url,
            work_dir,
            termination_grace,
        })
    }
}

/// Read an environment variable, treating a blank value as unset.
fn non_empty(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[cfg(test)]
#[path = "config.test.rs"]
mod tests;
