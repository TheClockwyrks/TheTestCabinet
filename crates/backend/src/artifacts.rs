//! Best-effort cleanup of a deleted run's tree in the **artifact service** (the
//! data plane).
//!
//! The backend is the system of record: deleting a run removes its row (and the
//! backend's own proof/asset/controller media). A run's *playable build* and the
//! recorded logs, though, live in the separate artifact service, which the backend
//! never otherwise calls. When a run is deleted we ask that service to drop the
//! tree too, so no orphaned bytes linger.
//!
//! This is **best-effort**: the authoritative record is already gone, so a deleted
//! run has vanished from every listing and the snapshot regardless. A failure here
//! (the service is down, unreachable, or rejects us) is logged and swallowed — it
//! must never fail the user's delete, and the worst case is an unreferenced tree a
//! later sweep can reclaim. It runs only when both the artifact service URL
//! (`artifacts_url`) and the shared service token are configured; a single-box dev
//! setup has neither and simply skips it.

/// Ask the artifact service to delete run `run_id`'s stored tree, presenting the
/// shared control-plane service token. Returns nothing: every outcome is folded
/// into a log line, because the caller treats this as best-effort and never
/// surfaces a failure to the client.
///
/// `artifacts_url` is the artifact service base URL the backend already holds (the
/// in-cluster service address it advertises to the console); `service_token` is the
/// shared secret the service's delete route requires. With either absent the call
/// is skipped — there is no artifact service to prune, or no way to authenticate to
/// it.
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
    let url = format!("{}/runs/{}/artifacts", base.trim_end_matches('/'), run_id);
    let result = http
        .delete(&url)
        .bearer_auth(token)
        // The record is already deleted, so the user is waiting only on this prune;
        // a short timeout keeps an unresponsive artifact service from stalling the
        // response, the tree being reclaimable later regardless.
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await;
    match result {
        Ok(response) if response.status().is_success() => {
            tracing::debug!(run.id = %run_id, "pruned run tree from the artifact service");
        }
        Ok(response) => {
            tracing::warn!(
                run.id = %run_id,
                status = %response.status(),
                "artifact service refused to prune the deleted run's tree; leaving it for a later sweep"
            );
        }
        Err(err) => {
            tracing::warn!(
                run.id = %run_id,
                error = %err,
                "could not reach the artifact service to prune the deleted run's tree; leaving it for a later sweep"
            );
        }
    }
}
