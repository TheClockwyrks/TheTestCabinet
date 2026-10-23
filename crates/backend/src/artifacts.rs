//! The backend's calls to the **artifact service** (the data plane): the
//! delete-time prune and the periodic reclamation sweep of a run's tree, and the
//! public-dataset routes the snapshot writer goes through ([`put_public`],
//! [`list_public`], [`delete_public`] and [`publish_media`]).
//!
//! The backend holds no bucket credential: every object of the public dataset is
//! written, listed and deleted through the artifacts service, the one writer of
//! the public bucket.
//!
//! The backend is the system of record: deleting a run removes its row (and the
//! backend's own proof/asset/controller media). A run's *playable build* and the
//! recorded logs live in the separate artifact service, so a delete asks that
//! service to drop the tree too.
//!
//! Both paths go through the backend's **in-cluster** artifact URL
//! ([`Config::artifacts_internal_url`](crate::config::Config::artifacts_internal_url)),
//! not the address advertised to consoles, and both present the shared
//! control-plane service token. With either absent this module does nothing, which
//! is correct for a single-box dev setup with no artifact service.
//!
//! The prune is best-effort: the authoritative record is already gone, so a deleted
//! run has vanished from every listing and the snapshot regardless, and a failure
//! here must never fail the user's delete. What a failed prune leaves behind is an
//! unreferenced tree, which is what the sweep reclaims.
//!
//! The sweep lists the service's stored trees, keeps every tree whose id still has
//! a run row, and deletes the rest once they are older than a grace window. The
//! grace window is load-bearing: a driver uploads a run's tree *before* it reports
//! the run terminal, so a tree with no run row is the normal state of a run that is
//! still finishing.
//!
//! A pass acts only on a run-id set that holds at least one run. An empty set makes
//! every tree an orphan, so a database fault and a fresh database beside a populated
//! volume would each reclaim the whole volume on the next pass.
//!
//! Every scheduled pass ends in exactly one log line ([`ScheduledPass::log`]):
//! `artifact sweep pass complete` with its counts, a pass that reclaimed nothing
//! included, or `artifact sweep pass abandoned` with the reason. A pass that did
//! nothing can therefore be told apart from a sweep that is not running.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use time::OffsetDateTime;

/// One stored artifact tree, as the artifact service's `GET /runs` listing reports
/// it.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredTree {
    /// The run id the tree is keyed by (`<root>/<id>/` on the service).
    pub id: String,
    /// When the tree was last written, which is when the driver uploaded it. The
    /// sweep measures the grace window against this.
    #[serde(with = "time::serde::rfc3339")]
    pub modified_at: OffsetDateTime,
}

/// The artifact service's `GET /runs` body.
#[derive(Debug, serde::Deserialize)]
struct TreeListing {
    runs: Vec<StoredTree>,
}

/// What one sweep pass did, for the log line the caller emits.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct SweepOutcome {
    /// Trees the artifact service reported.
    pub listed: usize,
    /// Trees selected for deletion: those with no run row, past the grace window.
    /// Each one ends the pass either reclaimed or failed.
    pub orphans: usize,
    /// Trees deleted this pass.
    pub reclaimed: usize,
    /// Trees selected for deletion whose delete the service refused or did not
    /// answer. They stay listed and are retried next pass.
    pub failed: usize,
}

/// How often the sweep runs and how long a run-less tree is spared.
#[derive(Debug, Clone, Copy)]
pub struct SweepTiming {
    /// Interval between passes. [`Duration::ZERO`] disables the sweep entirely.
    pub interval: Duration,
    /// How old a tree with no run row must be before it is deleted.
    pub grace: Duration,
}

/// How long after startup the first sweep pass runs.
///
/// Not immediate: a backend that has just come up is still migrating, backfilling
/// and seeding, and the sweep is the least urgent thing it does. Short enough that
/// a deploy reclaims a standing backlog without waiting a whole interval for it.
const FIRST_SWEEP_DELAY: Duration = Duration::from_secs(60);

/// Ask the artifact service to delete run `run_id`'s stored tree, presenting the
/// shared control-plane service token. Returns nothing: every outcome is folded
/// into a log line, because the caller treats this as best-effort and never
/// surfaces a failure to the client.
///
/// `artifacts_url` is the **in-cluster** artifact service base URL the backend
/// calls (`TCAB_ARTIFACTS_URL`); `service_token` is the shared secret the service's
/// delete route requires. With either absent the call is skipped — there is no
/// artifact service to prune, or no way to authenticate to it.
pub async fn delete_run_tree(
    http: &reqwest::Client,
    artifacts_url: Option<&str>,
    service_token: Option<&str>,
    run_id: &str,
) {
    let (Some(base), Some(token)) = (artifacts_url, service_token) else {
        // No artifact service configured, or no token to authenticate the delete —
        // nothing to prune (e.g. a single-box dev setup).
        return;
    };
    match delete_tree(http, base, token, run_id).await {
        Ok(()) => {
            tracing::debug!(run.id = %run_id, "pruned run tree from the artifact service");
        }
        Err(TreeDeleteError::Refused(status)) => {
            tracing::warn!(
                run.id = %run_id,
                status = %status,
                "artifact service refused to prune the deleted run's tree; leaving it for a later sweep"
            );
        }
        Err(TreeDeleteError::Transport(err)) => {
            tracing::warn!(
                run.id = %run_id,
                error = %err,
                "could not reach the artifact service to prune the deleted run's tree; leaving it for a later sweep"
            );
        }
    }
}

/// Why one `DELETE /runs/{id}/artifacts` did not succeed.
#[derive(Debug)]
enum TreeDeleteError {
    /// The service answered a non-success status.
    Refused(reqwest::StatusCode),
    /// The request never got an answer.
    Transport(reqwest::Error),
}

/// Issue one `DELETE /runs/{id}/artifacts` against the artifact service. Shared by
/// the delete-time prune and the sweep so both present the token, apply the same
/// timeout, and agree on what counts as success.
async fn delete_tree(
    http: &reqwest::Client,
    base: &str,
    token: &str,
    run_id: &str,
) -> Result<(), TreeDeleteError> {
    let url = format!("{}/runs/{}/artifacts", base.trim_end_matches('/'), run_id);
    let response = http
        .delete(&url)
        .bearer_auth(token)
        // On the delete path the record is already gone, so the user is waiting only
        // on this prune; a short timeout keeps an unresponsive artifact service from
        // stalling the response, the tree being reclaimable by the sweep regardless.
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(TreeDeleteError::Transport)?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(TreeDeleteError::Refused(response.status()))
    }
}

/// List every tree the artifact service is storing (`GET /runs`), presenting the
/// shared control-plane service token the route is gated on.
///
/// The listing is the sweep's whole view of the data plane: the backend never reads
/// the artifact volume, so what a tree *is* and how old it is comes from here.
pub async fn list_run_trees(
    http: &reqwest::Client,
    base: &str,
    token: &str,
) -> Result<Vec<StoredTree>, reqwest::Error> {
    let url = format!("{}/runs", base.trim_end_matches('/'));
    let listing: TreeListing = http
        .get(&url)
        .bearer_auth(token)
        // Generous next to the delete's: the service walks its root and stats every
        // run directory to answer, and no user is waiting on the result.
        .timeout(Duration::from_secs(60))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    Ok(listing.runs)
}

/// Select the trees a sweep should delete: every tree whose id has no run row and
/// which was last written more than `grace` before `now`.
///
/// The whole selection rule, as a pure function, so the decision is testable
/// without a database or an artifact service. `live` is the backend's own set of
/// run ids and is the only thing that protects a tree; the grace window then
/// protects a run that has uploaded its tree but not yet reported terminal, which
/// is a run with no row through no fault of its own.
///
/// An empty `live` spares every tree. A backend that holds no run rows cannot tell
/// an orphan from a tree whose row it failed to see, and the two states it reaches
/// that way — a database fault, and a fresh or restored database sharing a
/// populated volume — would each reclaim the whole volume on the next pass.
pub fn orphaned_trees(
    trees: &[StoredTree],
    live: &HashSet<String>,
    now: OffsetDateTime,
    grace: Duration,
) -> Vec<String> {
    if live.is_empty() {
        return Vec::new();
    }
    // Compare each tree's age against the window rather than each tree against a
    // `now - grace` instant: a grace an operator set past the representable calendar
    // range would make that instant's arithmetic overflow, whereas an unrepresentable
    // window simply spares every tree.
    let Ok(grace) = time::Duration::try_from(grace) else {
        return Vec::new();
    };
    trees
        .iter()
        .filter(|tree| !live.contains(&tree.id) && now - tree.modified_at > grace)
        .map(|tree| tree.id.clone())
        .collect()
}

/// Run one sweep pass against the artifact service: list its stored trees, select
/// the orphans past the grace window, and delete each one.
///
/// `live` is passed in rather than read here so a pass is exercisable without a
/// database. A delete the service refuses is counted and left alone: the tree stays
/// listed and the next pass retries it.
pub async fn sweep_orphaned_trees(
    http: &reqwest::Client,
    base: &str,
    token: &str,
    live: &HashSet<String>,
    now: OffsetDateTime,
    grace: Duration,
) -> Result<SweepOutcome, reqwest::Error> {
    let trees = list_run_trees(http, base, token).await?;
    let mut outcome = SweepOutcome {
        listed: trees.len(),
        ..SweepOutcome::default()
    };
    let orphans = orphaned_trees(&trees, live, now, grace);
    outcome.orphans = orphans.len();
    for id in orphans {
        match delete_tree(http, base, token, &id).await {
            Ok(()) => {
                outcome.reclaimed += 1;
                tracing::info!(run.id = %id, "swept an orphaned run tree from the artifact service");
            }
            Err(err) => {
                outcome.failed += 1;
                tracing::warn!(
                    run.id = %id,
                    error = ?err,
                    "could not sweep an orphaned run tree; retrying next pass"
                );
            }
        }
    }
    Ok(outcome)
}

/// Spawn the periodic reclamation sweep, returning its task handle so the caller
/// can hold it for the server's lifetime (dropping it aborts the loop).
///
/// `None` when the sweep is not configured: no in-cluster artifact URL, no service
/// token, or a zero interval. Each of those is a deliberate way to run without a
/// sweep, so none of them is an error.
///
/// A pass acts only on a run-id set the backend read and found at least one run in.
/// A query that fails and one that comes back empty each abandon the pass, which is
/// retried at the next interval, because an empty set makes every tree an orphan.
/// [`orphaned_trees`] holds the same rule for every other caller of the selection.
pub fn spawn_orphan_sweeper(
    db: Arc<crate::db::Db>,
    http: reqwest::Client,
    artifacts_url: Option<String>,
    service_token: Option<String>,
    timing: SweepTiming,
) -> Option<tokio::task::JoinHandle<()>> {
    let (Some(base), Some(token)) = (artifacts_url, service_token) else {
        return None;
    };
    if timing.interval.is_zero() {
        return None;
    }
    Some(tokio::spawn(async move {
        tokio::time::sleep(FIRST_SWEEP_DELAY).await;
        loop {
            scheduled_pass(
                &db,
                &http,
                &base,
                &token,
                OffsetDateTime::now_utc(),
                timing.grace,
            )
            .await
            .log();
            tokio::time::sleep(timing.interval).await;
        }
    }))
}

/// How one scheduled pass of the sweep ended. Every pass ends as exactly one of
/// these and [logs](Self::log) exactly one line for it, so a pass that did nothing
/// can be told apart from a sweep that is not running.
#[derive(Debug)]
pub enum ScheduledPass {
    /// The pass listed the service's trees and acted on the listing.
    Complete(SweepOutcome),
    /// The pass was abandoned before it changed anything, and is retried at the
    /// next interval.
    Abandoned(AbandonedPass),
}

/// Why a scheduled pass was abandoned.
#[derive(Debug)]
pub enum AbandonedPass {
    /// The backend holds no run rows, which would make every stored tree an
    /// orphan.
    NoRuns,
    /// The stored run ids could not be read.
    RunsUnreadable(crate::error::BackendError),
    /// The artifact service's trees could not be listed.
    ListingFailed(reqwest::Error),
}

impl AbandonedPass {
    /// The reason as the log line's `reason` field spells it.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::NoRuns => "no_runs",
            Self::RunsUnreadable(_) => "runs_unreadable",
            Self::ListingFailed(_) => "listing_failed",
        }
    }
}

impl ScheduledPass {
    /// Log the pass's one line: `info` for a pass that completed, a pass that
    /// reclaimed nothing included, and `warn` for one that was abandoned.
    pub fn log(&self) {
        match self {
            Self::Complete(outcome) => tracing::info!(
                listed = outcome.listed,
                orphans = outcome.orphans,
                reclaimed = outcome.reclaimed,
                failed = outcome.failed,
                "artifact sweep pass complete"
            ),
            Self::Abandoned(why) => {
                let error = match why {
                    AbandonedPass::NoRuns => None,
                    AbandonedPass::RunsUnreadable(err) => Some(err.to_string()),
                    AbandonedPass::ListingFailed(err) => Some(err.to_string()),
                };
                tracing::warn!(
                    reason = why.as_str(),
                    error,
                    "artifact sweep pass abandoned; retrying at the next interval"
                );
            }
        }
    }
}

/// Run one scheduled pass: read the run ids, then [`sweep_orphaned_trees`]
/// against them.
///
/// The pass acts only on a run-id set that was read and holds at least one run,
/// because an empty set makes every tree an orphan.
pub async fn scheduled_pass(
    db: &crate::db::Db,
    http: &reqwest::Client,
    base: &str,
    token: &str,
    now: OffsetDateTime,
    grace: Duration,
) -> ScheduledPass {
    let live = match db.all_run_ids().await {
        Ok(live) if !live.is_empty() => live,
        Ok(_) => return ScheduledPass::Abandoned(AbandonedPass::NoRuns),
        Err(err) => return ScheduledPass::Abandoned(AbandonedPass::RunsUnreadable(err)),
    };
    match sweep_orphaned_trees(http, base, token, &live, now, grace).await {
        Ok(outcome) => ScheduledPass::Complete(outcome),
        Err(err) => ScheduledPass::Abandoned(AbandonedPass::ListingFailed(err)),
    }
}

/// One object of the public dataset, as the artifacts service's
/// `GET /public?prefix=` listing reports it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicObject {
    /// The object's key.
    pub key: String,
    /// The object's size in bytes.
    pub bytes: u64,
    /// When the object was last written, as RFC 3339, when the store reports it.
    #[serde(default)]
    pub modified_at: Option<String>,
}

/// The artifacts service's `GET /public` body.
#[derive(Debug, serde::Deserialize)]
struct PublicListing {
    objects: Vec<PublicObject>,
}

/// What the artifacts service's `POST /runs/{id}/publish-media` answers: the
/// public key of each of the run's media files, in the shapes the run's public
/// document names them by. The backend stores it per run
/// ([`Db::set_public_media`](crate::db::Db::set_public_media)) and composes every
/// later document from the stored copy.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishedMedia {
    /// The proof media, by proof id and kind.
    #[serde(default)]
    pub proof_media: Vec<test_cabinet_contracts::backend_api::snapshot::RunProofOut>,
    /// The synthesized validation outputs and the recordings' image store.
    #[serde(default)]
    pub validation_media: Vec<test_cabinet_contracts::backend_api::snapshot::RunValidationMediaOut>,
    /// An asset-generation run's produced media.
    #[serde(default)]
    pub asset_media: Vec<test_cabinet_contracts::backend_api::snapshot::RunAssetOut>,
    /// The showcase's files.
    #[serde(default)]
    pub showcase_media: Vec<test_cabinet_contracts::backend_api::snapshot::RunShowcaseOut>,
}

/// Why a call to one of the artifacts service's public-dataset routes failed.
#[derive(Debug, thiserror::Error)]
pub enum PublicError {
    /// The service answered a status the route does not succeed with.
    #[error("the artifacts service answered `{method} {path}` with {status}")]
    Refused {
        /// The request's method.
        method: &'static str,
        /// The request's path, below the service's base URL.
        path: String,
        /// The status it answered.
        status: reqwest::StatusCode,
    },
    /// The request never got an answer, or its body was not the route's shape.
    #[error("`{method} {path}` on the artifacts service failed: {source}")]
    Transport {
        /// The request's method.
        method: &'static str,
        /// The request's path, below the service's base URL.
        path: String,
        /// What failed.
        #[source]
        source: reqwest::Error,
    },
}

/// The characters a public key's path segment is percent-encoded over: everything
/// but the URL-unreserved set, so a key reaches the service's route as written.
const KEY_SEGMENT: &percent_encoding::AsciiSet = &percent_encoding::NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'.')
    .remove(b'_')
    .remove(b'~');

/// `key` as the path below `/public/`, each segment percent-encoded and the `/`
/// between them kept.
fn public_path(key: &str) -> String {
    let segments: Vec<String> = key
        .split('/')
        .map(|segment| percent_encoding::utf8_percent_encode(segment, KEY_SEGMENT).to_string())
        .collect();
    format!("/public/{}", segments.join("/"))
}

/// How long one object write may take. A run document or an index object is
/// small, but the case media the backend writes can be a video baseline.
const PUT_TIMEOUT: Duration = Duration::from_secs(120);

/// How long a listing or a media copy may take: the service walks a prefix of
/// the bucket, or copies (and transcodes) a run's media, and no user waits on it.
const SLOW_TIMEOUT: Duration = Duration::from_secs(600);

/// The public dataset as the backend reaches it: the artifacts service's
/// in-cluster base URL and the shared control-plane service token its public
/// routes take. The snapshot writer goes through this for every object; the
/// backend holds no bucket credential.
#[derive(Debug, Clone)]
pub struct PublicDataset {
    http: reqwest::Client,
    base: String,
    token: String,
}

impl PublicDataset {
    /// The public dataset behind the artifacts service at `base`, or `None` when
    /// the URL or the token is unset, in which case nothing is written.
    pub fn new(http: reqwest::Client, base: Option<&str>, token: Option<&str>) -> Option<Self> {
        Some(Self {
            http,
            base: base?.to_string(),
            token: token?.to_string(),
        })
    }

    /// [`put_public`] against this service.
    pub async fn put(
        &self,
        key: &str,
        bytes: Vec<u8>,
        content_type: &str,
        content_encoding: Option<&str>,
    ) -> Result<(), PublicError> {
        put_public(
            &self.http,
            &self.base,
            &self.token,
            key,
            bytes,
            content_type,
            content_encoding,
        )
        .await
    }

    /// [`list_public`] against this service.
    pub async fn list(&self, prefix: &str) -> Result<Vec<PublicObject>, PublicError> {
        list_public(&self.http, &self.base, &self.token, prefix).await
    }

    /// The keys [`list_public`] reports under `prefix`.
    pub async fn list_keys(&self, prefix: &str) -> Result<Vec<String>, PublicError> {
        Ok(self
            .list(prefix)
            .await?
            .into_iter()
            .map(|object| object.key)
            .collect())
    }

    /// [`delete_public`] against this service.
    pub async fn delete(&self, key: &str) -> Result<(), PublicError> {
        delete_public(&self.http, &self.base, &self.token, key).await
    }

    /// [`publish_media`] against this service.
    pub async fn publish_media(&self, run_id: &str) -> Result<Option<PublishedMedia>, PublicError> {
        publish_media(&self.http, &self.base, &self.token, run_id).await
    }
}

/// Write one object of the public dataset (`PUT /public/{key}`), whole, with the
/// labels it is served under, presenting the shared control-plane service token.
/// Succeeds on `201 Created`.
pub async fn put_public(
    http: &reqwest::Client,
    base: &str,
    token: &str,
    key: &str,
    bytes: Vec<u8>,
    content_type: &str,
    content_encoding: Option<&str>,
) -> Result<(), PublicError> {
    let path = public_path(key);
    let url = format!("{}{path}", base.trim_end_matches('/'));
    let mut request = http
        .put(&url)
        .bearer_auth(token)
        .header(reqwest::header::CONTENT_TYPE, content_type)
        .timeout(PUT_TIMEOUT)
        .body(bytes);
    if let Some(encoding) = content_encoding {
        request = request.header(reqwest::header::CONTENT_ENCODING, encoding);
    }
    let response = request
        .send()
        .await
        .map_err(|source| PublicError::Transport {
            method: "PUT",
            path: path.clone(),
            source,
        })?;
    if response.status() == reqwest::StatusCode::CREATED {
        Ok(())
    } else {
        Err(PublicError::Refused {
            method: "PUT",
            path,
            status: response.status(),
        })
    }
}

/// List the public dataset's objects under `prefix` (`GET /public?prefix=`),
/// presenting the shared control-plane service token. The service answers the
/// whole listing in one response.
pub async fn list_public(
    http: &reqwest::Client,
    base: &str,
    token: &str,
    prefix: &str,
) -> Result<Vec<PublicObject>, PublicError> {
    let path = "/public".to_string();
    let url = format!("{}{path}", base.trim_end_matches('/'));
    let transport = |source| PublicError::Transport {
        method: "GET",
        path: format!("{path}?prefix={prefix}"),
        source,
    };
    let response = http
        .get(&url)
        .query(&[("prefix", prefix)])
        .bearer_auth(token)
        .timeout(SLOW_TIMEOUT)
        .send()
        .await
        .map_err(transport)?;
    if !response.status().is_success() {
        return Err(PublicError::Refused {
            method: "GET",
            path: format!("{path}?prefix={prefix}"),
            status: response.status(),
        });
    }
    let listing: PublicListing = response.json().await.map_err(transport)?;
    Ok(listing.objects)
}

/// Delete one object of the public dataset (`DELETE /public/{key}`), presenting
/// the shared control-plane service token. The route answers `204` whether or not
/// the key existed; a `404` is taken as success too, since the object is gone
/// either way.
pub async fn delete_public(
    http: &reqwest::Client,
    base: &str,
    token: &str,
    key: &str,
) -> Result<(), PublicError> {
    let path = public_path(key);
    let url = format!("{}{path}", base.trim_end_matches('/'));
    let response = http
        .delete(&url)
        .bearer_auth(token)
        .timeout(PUT_TIMEOUT)
        .send()
        .await
        .map_err(|source| PublicError::Transport {
            method: "DELETE",
            path: path.clone(),
            source,
        })?;
    match response.status() {
        reqwest::StatusCode::NO_CONTENT | reqwest::StatusCode::NOT_FOUND => Ok(()),
        status if status.is_success() => Ok(()),
        status => Err(PublicError::Refused {
            method: "DELETE",
            path,
            status,
        }),
    }
}

/// Have the artifacts service copy run `run_id`'s publishable media from its
/// stored tree into the public dataset (`POST /runs/{id}/publish-media`),
/// presenting the shared control-plane service token, and answer the key each
/// file was published under.
///
/// `Ok(None)` when the service holds no tree or no run record for the run
/// (`404`): the run has no media to publish there.
pub async fn publish_media(
    http: &reqwest::Client,
    base: &str,
    token: &str,
    run_id: &str,
) -> Result<Option<PublishedMedia>, PublicError> {
    let path = format!(
        "/runs/{}/publish-media",
        percent_encoding::utf8_percent_encode(run_id, KEY_SEGMENT)
    );
    let url = format!("{}{path}", base.trim_end_matches('/'));
    let transport = |source| PublicError::Transport {
        method: "POST",
        path: path.clone(),
        source,
    };
    let response = http
        .post(&url)
        .bearer_auth(token)
        .timeout(SLOW_TIMEOUT)
        .send()
        .await
        .map_err(transport)?;
    match response.status() {
        reqwest::StatusCode::NOT_FOUND => Ok(None),
        status if status.is_success() => Ok(Some(response.json().await.map_err(transport)?)),
        status => Err(PublicError::Refused {
            method: "POST",
            path,
            status,
        }),
    }
}

#[cfg(test)]
#[path = "artifacts.test.rs"]
mod tests;

#[cfg(test)]
#[path = "artifacts.public.test.rs"]
mod public_tests;
