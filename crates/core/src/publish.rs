//! Publishing: releasing a finished run's outputs.
//!
//! See `docs/results.md`. Publishing is an explicit operation that releases the
//! generated code to a public repository, makes the playable build available for
//! embedding, and adds the run record to the site's dataset. It must be
//! idempotent and usable in batch.

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::execution::ArtifactCollection;
use crate::run_record::RunRecord;

/// A request to publish a single finished run.
#[derive(Debug, Clone, PartialEq)]
pub struct PublishRequest<'a> {
    /// The run record describing the run.
    pub record: &'a RunRecord,
    /// The collected implementation to release.
    pub artifacts: &'a ArtifactCollection,
}

/// The result of publishing a run, with the links produced.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishOutcome {
    /// URL of the public repository holding the released source.
    pub source_repo: String,
    /// URL of the playable build made available for embedding.
    pub playable_build: String,
    /// Whether this publish actually changed anything, or was a no-op because the
    /// run was already published (publishing is idempotent).
    pub newly_published: bool,
}

/// Publishes finished runs.
///
/// Every operation must be idempotent so a sweep producing many runs can be
/// published repeatedly without manual handling of each one.
#[async_trait::async_trait]
pub trait Publisher: Send + Sync {
    /// Release the run's generated code to its own public repository.
    async fn release_code(&self, request: &PublishRequest<'_>) -> Result<String>;

    /// Make the run's playable build available for embedding.
    async fn release_playable_build(&self, request: &PublishRequest<'_>) -> Result<String>;

    /// Append the run record to the site's dataset.
    async fn append_run_record(&self, record: &RunRecord) -> Result<()>;

    /// Publish a single run end to end. Idempotent.
    async fn publish(&self, request: &PublishRequest<'_>) -> Result<PublishOutcome>;

    /// Publish many runs in batch. Idempotent for each entry.
    async fn publish_batch(&self, requests: &[PublishRequest<'_>]) -> Result<Vec<PublishOutcome>> {
        let mut outcomes = Vec::with_capacity(requests.len());
        for request in requests {
            outcomes.push(self.publish(request).await?);
        }
        Ok(outcomes)
    }
}
