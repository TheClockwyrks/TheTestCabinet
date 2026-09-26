//! The backend's ownership of a run's tree on the **artifact service** (the data
//! plane): the delete-time prune, and the periodic reclamation sweep.
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
    for id in orphaned_trees(&trees, live, now, grace) {
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
            let live = match db.all_run_ids().await {
                Ok(live) if !live.is_empty() => live,
                Ok(_) => {
                    tracing::warn!(
                        "skipping the artifact sweep: the backend holds no run rows, \
                         which would make every stored tree an orphan"
                    );
                    tokio::time::sleep(timing.interval).await;
                    continue;
                }
                Err(err) => {
                    tracing::warn!(
                        error = %err,
                        "skipping the artifact sweep: could not read the stored run ids"
                    );
                    tokio::time::sleep(timing.interval).await;
                    continue;
                }
            };
            match sweep_orphaned_trees(
                &http,
                &base,
                &token,
                &live,
                OffsetDateTime::now_utc(),
                timing.grace,
            )
            .await
            {
                Ok(outcome) if outcome.reclaimed > 0 || outcome.failed > 0 => {
                    tracing::info!(
                        listed = outcome.listed,
                        reclaimed = outcome.reclaimed,
                        failed = outcome.failed,
                        "swept orphaned run trees from the artifact service"
                    );
                }
                Ok(outcome) => {
                    tracing::debug!(
                        listed = outcome.listed,
                        "artifact sweep found no orphaned run trees"
                    );
                }
                Err(err) => {
                    tracing::warn!(
                        error = %err,
                        "could not list the artifact service's run trees; skipping this sweep"
                    );
                }
            }
            tokio::time::sleep(timing.interval).await;
        }
    }))
}

#[cfg(test)]
#[path = "artifacts.test.rs"]
mod tests;
