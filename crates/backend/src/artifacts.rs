//! The backend's ownership of a run's tree on the **artifact service** (the data
//! plane): the delete-time prune, the periodic reclamation sweep, and what the
//! backend knows about whether a run's tree is stored at all.
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
//! The sweep lists the service's stored trees and deletes a tree for one of four
//! reasons. A tree whose id has no run row is an **orphan**, deleted once it is
//! older than a grace window. The grace window is load-bearing: a driver uploads a
//! run's tree *before* it reports the run terminal, so a tree with no run row is
//! the normal state of a run that is still finishing. A tree whose run still exists
//! is deleted by a **retention rule** ([`retention_reason`]): a published run's
//! once a snapshot refresh has confirmed its media in the bucket this backend is
//! configured with, a failed run's and a canceled run's a set time after the later
//! of the run's end and the tree's storing. Every other tree is kept,
//! above all that of a completed run that is not published, which is the only copy
//! of what a release publishes.
//!
//! A pass acts only on a run set that holds at least one run. An empty set makes
//! every tree an orphan, so a database fault and a fresh database beside a populated
//! volume would each reclaim the whole volume on the next pass.
//!
//! A retention delete is decided twice. The pass selects from the run facts it read
//! at its start, and [`reclaim_run_tree`] reads the run again, with its jobs and
//! publish jobs, immediately before the delete. It then records the reclaim on the
//! run, reads the run's jobs once more, and only afterwards asks the service to
//! delete, so a tree is never gone while its run still reads as one whose tree
//! should be there. Only a delete the service refused takes the record back: one
//! that got no answer may have been carried out.
//!
//! The same pass reconciles each run's recorded **artifact presence** against the
//! listing it already holds ([`reconcile_presence`]): the sweep is the one place
//! that has both the stored trees and the run ids, so a run whose tree was lost
//! without the backend being told is found here. Reconciling changes only that
//! record. It selects nothing for deletion, and what the sweep deletes is decided
//! by [`orphaned_trees`] and [`retention_reason`] alone.
//!
//! [`run_tree_stored`] asks the service about one run, for the publish gate
//! (`crate::api::publish_gate`), which must know now rather than as of the last
//! pass.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::db::{ReclaimReason, RetentionRun, past_instant};

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
    /// Trees selected for deletion as orphans: those with no run row, past the
    /// grace window. Each one ends the pass either reclaimed or failed.
    pub orphans: usize,
    /// Trees deleted this pass, for any reason.
    pub reclaimed: usize,
    /// Trees selected for deletion whose delete the service refused or did not
    /// answer, or whose run could not be read again. They stay listed and are
    /// retried next pass.
    pub failed: usize,
    /// Trees of published runs deleted this pass.
    pub reclaimed_published: usize,
    /// Trees of failed runs deleted this pass.
    pub reclaimed_failed: usize,
    /// Trees of canceled runs deleted this pass.
    pub reclaimed_canceled: usize,
    /// Trees a retention rule selected that the read made immediately before the
    /// delete no longer qualified. Nothing was deleted for them.
    pub skipped: usize,
    /// Published runs with a stored tree that no snapshot refresh has confirmed
    /// the media of, which is why their trees are still stored.
    pub unconfirmed: usize,
    /// The free space the pass returned to the volume: the difference between the
    /// store's free bytes read after the pass and before it. `None` when the pass
    /// deleted nothing or either reading failed.
    pub freed_bytes: Option<u64>,
}

/// When the retention rules delete the tree of a run that still exists.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RetentionPolicy {
    /// How long after a failed run ended its tree is deleted
    /// (`TCAB_ARTIFACT_FAILED_RETENTION_HOURS`). [`Duration::ZERO`] keeps every
    /// failed run's tree.
    pub failed: Duration,
    /// How long after a canceled run ended its tree is deleted
    /// (`TCAB_ARTIFACT_CANCELED_RETENTION_HOURS`). [`Duration::ZERO`] keeps every
    /// canceled run's tree, and any other value below
    /// [`CANCELED_RETENTION_FLOOR`] behaves as the floor.
    pub canceled: Duration,
    /// Whether a published run's tree is deleted once its media is confirmed
    /// (`TCAB_ARTIFACT_RECLAIM_PUBLISHED`).
    pub published: bool,
    /// The bucket this backend publishes to, as
    /// [`media_bucket_identity`] names it, or `None` for a backend with no bucket.
    ///
    /// A media confirmation counts only when it was made against this bucket: the
    /// reads that feed the rule are handed it and report no other bucket's
    /// confirmation. With `None` no published run's tree is ever deleted, since
    /// there is no bucket its media could be confirmed in.
    ///
    /// A `&'static str` so the policy stays `Copy`: the configuration resolves the
    /// name once and it lives as long as the process.
    pub bucket: Option<&'static str>,
}

impl RetentionPolicy {
    /// A policy that deletes the tree of no run that still exists, which leaves
    /// the sweep with the orphan rule alone.
    pub const KEEP_EVERYTHING: Self = Self {
        failed: Duration::ZERO,
        canceled: Duration::ZERO,
        published: false,
        bucket: None,
    };
}

/// The name a media confirmation records its bucket under: the S3 endpoint and
/// the bucket name, which together say which objects a refresh looked at.
///
/// Two backends configured with the same endpoint and bucket see the same
/// objects, so a confirmation one made holds for the other. Anything else —
/// another account, another bucket, a database restored into another
/// environment — is a different name, and a confirmation made there deletes
/// nothing here.
pub fn media_bucket_identity(endpoint: &str, bucket: &str) -> String {
    format!("{}/{bucket}", endpoint.trim_end_matches('/'))
}

/// The shortest canceled retention the sweep applies, whatever the setting says.
///
/// A canceled run's driver may still be uploading the run's partial tree for ten
/// minutes after the cancel. A tree deleted inside that window would be written
/// again by the upload still in flight, so the retention stays clear of it.
pub const CANCELED_RETENTION_FLOOR: Duration = Duration::from_secs(15 * 60);

/// What a sweep pass deletes by: the orphan rule's grace window and the retention
/// rules' policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SweepRules {
    /// How old a tree with no run row must be before it is deleted.
    pub grace: Duration,
    /// When the tree of a run that still exists is deleted.
    pub retention: RetentionPolicy,
}

/// How often the sweep runs and what a pass deletes by.
#[derive(Debug, Clone, Copy)]
pub struct SweepTiming {
    /// Time between the end of one pass and the start of the next.
    /// [`Duration::ZERO`] disables the sweep entirely.
    pub interval: Duration,
    /// The rules every pass deletes by.
    pub rules: SweepRules,
}

/// How long after startup the first sweep pass runs.
///
/// Not immediate: a backend that has just come up is still migrating, backfilling
/// and seeding, and the sweep is the least urgent thing it does. Short enough that
/// a deploy reclaims a standing backlog without waiting a whole interval for it.
const FIRST_SWEEP_DELAY: Duration = Duration::from_secs(60);

/// How long the delete-time prune waits for the artifact service. The record is
/// already gone and the user is waiting only on this prune, so a short timeout
/// keeps an unresponsive service from stalling the response; the sweep reclaims
/// the tree regardless.
const PRUNE_DELETE_TIMEOUT: Duration = Duration::from_secs(10);

/// How long the sweep waits for one delete. Nobody is waiting on a pass, and
/// removing a large tree from a busy volume takes a while. A delete that outlasts
/// the wait may still be carried out by the service, which is why
/// [`reclaim_run_tree`] keeps the reclaim record of a delete that got no answer;
/// a generous wait keeps that case rare.
const SWEEP_DELETE_TIMEOUT: Duration = Duration::from_secs(120);

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
    match delete_tree(http, base, token, run_id, PRUNE_DELETE_TIMEOUT).await {
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
    /// The request never got an answer. The service carries a delete through once
    /// it has started one, so the tree may be gone all the same.
    Transport(reqwest::Error),
}

/// Issue one `DELETE /runs/{id}/artifacts` against the artifact service, waiting
/// `timeout` for the answer. Shared by the delete-time prune and the sweep so both
/// present the token and agree on what counts as success.
async fn delete_tree(
    http: &reqwest::Client,
    base: &str,
    token: &str,
    run_id: &str,
    timeout: Duration,
) -> Result<(), TreeDeleteError> {
    let url = format!("{}/runs/{}/artifacts", base.trim_end_matches('/'), run_id);
    let response = http
        .delete(&url)
        .bearer_auth(token)
        .timeout(timeout)
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

/// Why the artifact service could not say whether a run's tree is stored. Never
/// read as "not stored": the caller must be able to tell a run with no tree from a
/// service it could not ask.
#[derive(Debug, thiserror::Error)]
pub enum TreePresenceError {
    /// The service answered a non-success status.
    #[error("the artifact service answered HTTP {0}")]
    Refused(reqwest::StatusCode),
    /// The request got no answer, or an answer that could not be read.
    #[error("the artifact service could not be reached: {0}")]
    Transport(#[from] reqwest::Error),
}

/// The artifact service's `GET /runs/{id}/artifacts` body.
#[derive(Debug, serde::Deserialize)]
struct TreePresence {
    stored: bool,
}

/// Ask the artifact service whether it holds a tree for run `run_id`
/// (`GET /runs/{id}/artifacts`), presenting the shared control-plane service token.
///
/// `Ok(false)` is the service saying the run has no tree. Everything else that is
/// not a clear answer is an `Err`, including a `404`: the service answers absence
/// in the body of a `200`, so a `404` is a route that is not there.
pub async fn run_tree_stored(
    http: &reqwest::Client,
    base: &str,
    token: &str,
    run_id: &str,
) -> Result<bool, TreePresenceError> {
    let url = format!("{}/runs/{}/artifacts", base.trim_end_matches('/'), run_id);
    let response = http
        .get(&url)
        .bearer_auth(token)
        // A person's publish waits on this, and the answer is one `stat` on the
        // service's side, so a slow one is a service that is not answering.
        .timeout(Duration::from_secs(10))
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(TreePresenceError::Refused(response.status()));
    }
    let presence: TreePresence = response.json().await?;
    Ok(presence.stored)
}

/// Reconcile every run's recorded artifact presence against `trees`, the listing a
/// sweep pass just took: each run in `runs` whose tree is listed is recorded as
/// stored and each other run of `runs` as not stored.
///
/// `runs` must have been read **before** `trees` was listed; see
/// [`Db::reconcile_artifacts_stored`](crate::db::Db::reconcile_artifacts_stored)
/// for why that order is what makes "not stored" a safe conclusion.
///
/// An empty listing reconciles nothing, for the reason an empty run-id set sweeps
/// nothing. A service started against the wrong or an unmounted volume lists no
/// trees, and taking that at its word would record every run in the cabinet as
/// having lost its tree. The publish gate asks about each run directly, so nothing
/// depends on this pass to keep such a run from being released.
pub async fn reconcile_presence(
    db: &crate::db::Db,
    runs: &HashSet<String>,
    trees: &[StoredTree],
) -> crate::error::Result<crate::db::ArtifactReconciliation> {
    if trees.is_empty() {
        return Ok(crate::db::ArtifactReconciliation::default());
    }
    let listed: HashSet<String> = trees.iter().map(|tree| tree.id.clone()).collect();
    db.reconcile_artifacts_stored(runs, &listed).await
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

/// Decide whether the tree of `run`, a run that still exists, is to be deleted at
/// `now`, and for which reason. `busy` is whether a job of the run is queued,
/// running or storing, or a publish job for it is queued or dispatched, and
/// `stored_at` is when the tree was stored, as the service's listing reports it.
///
/// The whole retention rule, as a pure function:
///
/// - A busy run's tree is kept.
/// - A **published** run is governed by its media confirmation alone, whatever
///   state it ended in: its tree is deleted once a snapshot refresh has recorded
///   that every media file of the run is in the bucket this backend is configured
///   with, and only while `policy.published` is on and `policy.bucket` names one.
///   The tree is the refresh's fallback source for media not yet in the bucket,
///   so the end time of a published run decides nothing.
/// - An unpublished **completed** run's tree is the only copy of what a release
///   publishes, and is kept whatever its age.
/// - An unpublished **canceled** run's tree is deleted `policy.canceled` after the
///   later of the run's end and `stored_at`, and never sooner than
///   [`CANCELED_RETENTION_FLOOR`].
/// - Every other unpublished run **failed**, and its tree is deleted
///   `policy.failed` after the later of the run's end and `stored_at`.
///
/// The retention runs from the later of the two instants because a tree can land
/// long after its run ended: a run that waited in `storing` through an outage of
/// the store longer than the retention would otherwise lose its tree to the first
/// pass that saw it.
///
/// An instant that is absent, does not parse or lies after `now` never qualifies a
/// tree ([`past_instant`]); that holds for `stored_at` as for the run's own
/// instants. Neither does a state this build does not know. A zero retention
/// keeps every tree of its kind.
///
/// The rule reads the run's state and never whether its tree was reclaimed before.
/// A tree that lands for a run already reclaimed (a canceled run's upload that
/// outlived the retention) therefore qualifies again once the retention has run
/// from its landing, and is deleted by the pass that follows.
pub fn retention_reason(
    run: &RetentionRun,
    busy: bool,
    stored_at: OffsetDateTime,
    now: OffsetDateTime,
    policy: &RetentionPolicy,
) -> Option<ReclaimReason> {
    use test_cabinet_core::run_record::RunState;

    if busy {
        return None;
    }
    if run.published {
        let confirmed = past_instant(run.media_confirmed_at.as_deref(), now).is_some();
        return (policy.published && policy.bucket.is_some() && confirmed)
            .then_some(ReclaimReason::Published);
    }
    // The state as the contract names it, so a state added to the contract is
    // matched here on purpose and a string this build cannot name keeps its tree.
    let state: RunState =
        serde_json::from_value(serde_json::Value::String(run.run_state.clone())).ok()?;
    let (reason, retention) = match state {
        RunState::Completed => return None,
        RunState::Canceled => {
            if policy.canceled.is_zero() {
                return None;
            }
            (
                ReclaimReason::Canceled,
                policy.canceled.max(CANCELED_RETENTION_FLOOR),
            )
        }
        RunState::Catastrophic
        | RunState::TimedOut
        | RunState::HarnessError
        | RunState::LimitExceeded
        | RunState::Hung
        | RunState::Infrastructure => (ReclaimReason::Failed, policy.failed),
    };
    if retention.is_zero() {
        return None;
    }
    let ended = past_instant(Some(&run.finished_at), now)?;
    // A tree written after `now` is one whose clock, or ours, is wrong.
    if stored_at > now {
        return None;
    }
    let kept_from = ended.max(stored_at);
    // An unrepresentable retention spares the tree, as an unrepresentable grace
    // window does in [`orphaned_trees`].
    let retention = time::Duration::try_from(retention).ok()?;
    (now - kept_from > retention).then_some(reason)
}

/// What [`retention_trees`] selected from one listing.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct RetentionSelection {
    /// The trees to delete, each with the rule that selected it, in listing order.
    pub reclaim: Vec<(String, ReclaimReason)>,
    /// How many listed trees belong to a published run whose media no refresh has
    /// confirmed, counted only while the published rule is on.
    pub unconfirmed: usize,
}

/// Select, among `trees`, the trees of runs that still exist which a retention
/// rule deletes at `now`. Only a listed tree is ever selected: a run with no tree
/// in the listing has nothing to delete, whatever its state.
///
/// `runs` are the run facts read before the listing was taken and `busy` the ids
/// of the runs something is still working on. A tree whose id is in neither is
/// not this function's: it has no run row, and [`orphaned_trees`] decides it.
pub fn retention_trees(
    trees: &[StoredTree],
    runs: &[RetentionRun],
    busy: &HashSet<String>,
    now: OffsetDateTime,
    policy: &RetentionPolicy,
) -> RetentionSelection {
    let by_id: HashMap<&str, &RetentionRun> =
        runs.iter().map(|run| (run.id.as_str(), run)).collect();
    let mut selection = RetentionSelection::default();
    for tree in trees {
        let Some(run) = by_id.get(tree.id.as_str()) else {
            continue;
        };
        match retention_reason(run, busy.contains(&run.id), tree.modified_at, now, policy) {
            Some(reason) => selection.reclaim.push((tree.id.clone(), reason)),
            None if run.published && policy.published => selection.unconfirmed += 1,
            None => {}
        }
    }
    selection
}

/// How [`reclaim_run_tree`] ended for one tree.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reclaim {
    /// The reclaim was recorded on the run and the service deleted the tree.
    Reclaimed,
    /// The run, read again, no longer qualified for `reason`. Nothing was written
    /// and nothing deleted.
    Skipped,
    /// The run could not be read again, or the service did not delete the tree.
    /// The next pass tries again. The run's record is as it was, except after a
    /// delete that got no answer, whose reclaim record is kept.
    Failed,
}

/// Delete `tree`, the tree of a run a pass selected for `reason`, once the run
/// still qualifies as it stands now.
///
/// In order: read the run's facts and whether anything is working on it, decide
/// the rule again, record the reclaim on the run, read once more whether anything
/// is working on the run, and only then ask the service to delete.
///
/// Recording first means a run is never left reading as stored, or as lost, over
/// a tree the backend removed on purpose. The second read of the run's jobs
/// closes the instant between the first and the record: a publish enqueued in it
/// saw no reclaim record, so the record is taken back and the tree kept for it. A
/// publish enqueued after the record reads the record and is refused
/// (`crate::api::publish_gate`), so one of the two always sees the other.
///
/// A delete the service **refused** left the tree in place, and the record is
/// taken back. A delete that got **no answer** may have been carried out, so the
/// record is kept: taking it back would leave a run whose tree the backend
/// removed reading as one whose tree was lost. The next pass deletes the tree
/// again if it is still listed.
///
/// A run that already carries a reclaim record is one whose tree landed again
/// after it was reclaimed. Its tree is deleted and its record left as it was first
/// written.
#[allow(clippy::too_many_arguments)]
pub async fn reclaim_run_tree(
    db: &crate::db::Db,
    http: &reqwest::Client,
    base: &str,
    token: &str,
    tree: &StoredTree,
    reason: ReclaimReason,
    now: OffsetDateTime,
    policy: &RetentionPolicy,
) -> Reclaim {
    let run_id = tree.id.as_str();
    let Ok(at) = now.format(&Rfc3339) else {
        return Reclaim::Failed;
    };
    let fresh = match db.retention_run(run_id, policy.bucket).await {
        Ok(Some(run)) => run,
        // Deleted since the pass read it. Its tree is now an orphan, which the
        // orphan rule reclaims once the grace window has passed.
        Ok(None) => return Reclaim::Skipped,
        Err(error) => {
            tracing::warn!(run.id = %run_id, %error, "could not read a run again before reclaiming its tree; retrying next pass");
            return Reclaim::Failed;
        }
    };
    let busy = match db.run_is_busy(run_id, &at).await {
        Ok(busy) => busy,
        Err(error) => {
            tracing::warn!(run.id = %run_id, %error, "could not read a run's jobs before reclaiming its tree; retrying next pass");
            return Reclaim::Failed;
        }
    };
    if retention_reason(&fresh, busy, tree.modified_at, now, policy) != Some(reason) {
        tracing::info!(
            run.id = %run_id,
            reason = reason.as_str(),
            "kept a run tree selected for reclaiming: the run no longer qualifies"
        );
        return Reclaim::Skipped;
    }
    // A run reclaimed before keeps the record of that reclaim; nothing is written
    // for it, and so nothing is taken back either.
    let marked = fresh.artifacts_reclaimed_at.is_none();
    if marked {
        match db.mark_artifacts_reclaimed(&fresh, reason, &at).await {
            Ok(true) => {}
            // The row moved between the read and the write.
            Ok(false) => return Reclaim::Skipped,
            Err(error) => {
                tracing::warn!(run.id = %run_id, %error, "could not record a run tree's reclaim; retrying next pass");
                return Reclaim::Failed;
            }
        }
    }
    let restore = async || {
        if !marked {
            return;
        }
        if let Err(error) = db.restore_artifact_record(&fresh, &at).await {
            tracing::warn!(
                run.id = %run_id,
                %error,
                "could not restore the record of a run whose tree was not reclaimed; \
                 the next pass reclaims the tree"
            );
        }
    };
    // Anything enqueued for the run between the first read of its jobs and the
    // record did not see the record. Keep the tree for it.
    match db.run_is_busy(run_id, &at).await {
        Ok(false) => {}
        Ok(true) => {
            restore().await;
            tracing::info!(
                run.id = %run_id,
                reason = reason.as_str(),
                "kept a run tree selected for reclaiming: work on the run began as it was recorded"
            );
            return Reclaim::Skipped;
        }
        Err(error) => {
            restore().await;
            tracing::warn!(run.id = %run_id, %error, "could not read a run's jobs after recording its tree's reclaim; retrying next pass");
            return Reclaim::Failed;
        }
    }
    match delete_tree(http, base, token, run_id, SWEEP_DELETE_TIMEOUT).await {
        Ok(()) => {
            crate::metrics::record_tree_reclaimed(reason.as_str());
            tracing::info!(
                run.id = %run_id,
                reason = reason.as_str(),
                ended_at = %fresh.finished_at,
                "reclaimed a run tree from the artifact service"
            );
            Reclaim::Reclaimed
        }
        Err(TreeDeleteError::Refused(status)) => {
            tracing::warn!(
                run.id = %run_id,
                reason = reason.as_str(),
                %status,
                "the artifact service refused to reclaim a run tree; retrying next pass"
            );
            restore().await;
            Reclaim::Failed
        }
        Err(TreeDeleteError::Transport(error)) => {
            tracing::warn!(
                run.id = %run_id,
                reason = reason.as_str(),
                %error,
                "a run tree's reclaim got no answer from the artifact service; the tree \
                 may be gone, so the run stays recorded as reclaimed and the next pass \
                 deletes the tree again if it is still listed"
            );
            Reclaim::Failed
        }
    }
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
    Ok(reclaim_orphans(http, base, token, &trees, live, now, grace).await)
}

/// Delete the orphans among `trees`, a listing the caller already holds: the half
/// of a sweep pass that follows the listing. Split from [`sweep_orphaned_trees`] so
/// a pass can list once and both reclaim and [reconcile](reconcile_presence) from
/// the same listing.
pub async fn reclaim_orphans(
    http: &reqwest::Client,
    base: &str,
    token: &str,
    trees: &[StoredTree],
    live: &HashSet<String>,
    now: OffsetDateTime,
    grace: Duration,
) -> SweepOutcome {
    let mut outcome = SweepOutcome {
        listed: trees.len(),
        ..SweepOutcome::default()
    };
    let orphans = orphaned_trees(trees, live, now, grace);
    outcome.orphans = orphans.len();
    for id in orphans {
        match delete_tree(http, base, token, &id, SWEEP_DELETE_TIMEOUT).await {
            Ok(()) => {
                outcome.reclaimed += 1;
                crate::metrics::record_tree_reclaimed("orphan");
                tracing::info!(
                    run.id = %id,
                    reason = "orphan",
                    "reclaimed a run tree from the artifact service"
                );
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
    outcome
}

/// Run one whole pass: list the service's trees once, reclaim the orphans among
/// them, reclaim the trees a retention rule selects, and reconcile each run's
/// recorded artifact presence against the same listing.
///
/// `runs` are the retention facts of every stored run and `busy` the ids of the
/// runs something is working on, both read by the caller before this is called.
/// The ids of `runs` are the live set the orphan rule protects a tree with.
///
/// A reconciliation that fails is logged and does not fail the pass: the trees
/// were already reclaimed, and the next pass reconciles again.
#[allow(clippy::too_many_arguments)]
pub async fn sweep_pass(
    db: &crate::db::Db,
    http: &reqwest::Client,
    base: &str,
    token: &str,
    runs: &[RetentionRun],
    busy: &HashSet<String>,
    now: OffsetDateTime,
    rules: &SweepRules,
) -> Result<(SweepOutcome, crate::db::ArtifactReconciliation), reqwest::Error> {
    let live: HashSet<String> = runs.iter().map(|run| run.id.clone()).collect();
    let trees = list_run_trees(http, base, token).await?;
    // An empty run set selects nothing here, for the reason it selects no orphan.
    let selection = if live.is_empty() {
        RetentionSelection::default()
    } else {
        retention_trees(&trees, runs, busy, now, &rules.retention)
    };
    let deleting = !selection.reclaim.is_empty()
        || !orphaned_trees(&trees, &live, now, rules.grace).is_empty();
    let free_before = if deleting {
        free_bytes(http, base, token).await
    } else {
        None
    };

    let mut outcome = reclaim_orphans(http, base, token, &trees, &live, now, rules.grace).await;
    outcome.unconfirmed = selection.unconfirmed;
    let listed: HashMap<&str, &StoredTree> =
        trees.iter().map(|tree| (tree.id.as_str(), tree)).collect();
    for (run_id, reason) in &selection.reclaim {
        // Every selected id came from this listing.
        let Some(tree) = listed.get(run_id.as_str()) else {
            continue;
        };
        match reclaim_run_tree(db, http, base, token, tree, *reason, now, &rules.retention).await {
            Reclaim::Reclaimed => {
                outcome.reclaimed += 1;
                match reason {
                    ReclaimReason::Published => outcome.reclaimed_published += 1,
                    ReclaimReason::Failed => outcome.reclaimed_failed += 1,
                    ReclaimReason::Canceled => outcome.reclaimed_canceled += 1,
                }
            }
            Reclaim::Skipped => outcome.skipped += 1,
            Reclaim::Failed => outcome.failed += 1,
        }
    }
    if outcome.reclaimed > 0
        && let Some(before) = free_before
        && let Some(after) = free_bytes(http, base, token).await
    {
        outcome.freed_bytes = Some(after.saturating_sub(before));
    }

    let reconciled = match reconcile_presence(db, &live, &trees).await {
        Ok(reconciled) => reconciled,
        Err(err) => {
            tracing::warn!(
                error = %err,
                "could not reconcile the runs' artifact presence; retrying next pass"
            );
            crate::db::ArtifactReconciliation::default()
        }
    };
    Ok((outcome, reconciled))
}

/// The store volume's free bytes as the artifact service reports them now, or
/// `None` when the reading fails. Only the pass's `freed_bytes` figure rests on
/// it, so a failure costs the figure and nothing else.
async fn free_bytes(http: &reqwest::Client, base: &str, token: &str) -> Option<u64> {
    crate::capacity::read_capacity(http, base, token)
        .await
        .ok()
        .map(|capacity| capacity.free_bytes)
}

/// Spawn the periodic reclamation sweep, returning its task handle so the caller
/// can hold it for the server's lifetime (dropping it aborts the loop).
///
/// `None` when the sweep is not configured: no in-cluster artifact URL, no service
/// token, or a zero interval. Each of those is a deliberate way to run without a
/// sweep, so none of them is an error.
///
/// A pass acts only on a run set the backend read and found at least one run in.
/// A query that fails and one that comes back empty each abandon the pass, which is
/// retried at the next interval, because an empty set makes every tree an orphan.
/// [`orphaned_trees`] holds the same rule for every other caller of the selection.
///
/// One task runs every pass and sleeps the interval after each, so a pass never
/// overlaps the one before it however long that one took.
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
                &timing.rules,
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
    Complete(SweepOutcome, crate::db::ArtifactReconciliation),
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
            Self::Complete(outcome, reconciled) => tracing::info!(
                listed = outcome.listed,
                orphans = outcome.orphans,
                reclaimed = outcome.reclaimed,
                failed = outcome.failed,
                reclaimed_published = outcome.reclaimed_published,
                reclaimed_failed = outcome.reclaimed_failed,
                reclaimed_canceled = outcome.reclaimed_canceled,
                skipped = outcome.skipped,
                unconfirmed = outcome.unconfirmed,
                freed_bytes = outcome.freed_bytes,
                marked_stored = reconciled.marked_stored,
                marked_not_stored = reconciled.marked_not_stored,
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

/// Run one scheduled pass: read every run's retention facts and the runs
/// something is working on, then [`sweep_pass`] against them.
///
/// The pass acts only on a run set that was read and holds at least one run,
/// because an empty set makes every tree an orphan. A failure to read which runs
/// are busy abandons the pass the same way: without it a retention rule could
/// select the tree of a run a publish job is reading.
pub async fn scheduled_pass(
    db: &crate::db::Db,
    http: &reqwest::Client,
    base: &str,
    token: &str,
    now: OffsetDateTime,
    rules: &SweepRules,
) -> ScheduledPass {
    let runs = match db.retention_runs(rules.retention.bucket).await {
        Ok(runs) if !runs.is_empty() => runs,
        Ok(_) => return ScheduledPass::Abandoned(AbandonedPass::NoRuns),
        Err(err) => return ScheduledPass::Abandoned(AbandonedPass::RunsUnreadable(err)),
    };
    let busy = match now.format(&Rfc3339) {
        Ok(at) => db.busy_run_ids(&at).await,
        Err(err) => Err(err.into()),
    };
    let busy = match busy {
        Ok(busy) => busy,
        Err(err) => return ScheduledPass::Abandoned(AbandonedPass::RunsUnreadable(err)),
    };
    match sweep_pass(db, http, base, token, &runs, &busy, now, rules).await {
        Ok((outcome, reconciled)) => ScheduledPass::Complete(outcome, reconciled),
        Err(err) => ScheduledPass::Abandoned(AbandonedPass::ListingFailed(err)),
    }
}

#[cfg(test)]
#[path = "artifacts.test.rs"]
mod tests;

#[cfg(test)]
#[path = "artifacts.presence.test.rs"]
pub(crate) mod presence_tests;

#[cfg(test)]
#[path = "artifacts.retention.test.rs"]
mod retention_tests;
