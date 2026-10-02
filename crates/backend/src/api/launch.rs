//! Launch passes: the one serialized read-decide-enqueue loop a filling coverage plan and
//! a running ladder dispatch both launch their runs through, what feeds them when a run
//! finishes, and the passes the backend runs at startup.
//!
//! A pass is prompted by its owner (a plan's All missing or cell Retry, a ladder's Run or
//! climber Retry), by every finished run of the plan or dispatch, and once at startup.
//! Two prompts can otherwise both observe the same shortfall and both enqueue for it, so
//! every pass of one plan or ladder runs under a leased claim on its row. A prompt that
//! finds the claim held leaves a request the holder serves before it lets go, so the
//! evidence that prompted it is never lost. There is no background daemon.

use super::AppState;
use super::coverage::{LaunchPassResult, LaunchSkipped, now};
use crate::coverage::schedule::InFlightLimit;
use crate::error::ApiError;

/// The most launch passes one claim holder runs for the requests that arrived while it
/// held the claim. Each pass sees every run that landed before it started, so a burst of
/// finishes collapses into a pass or two; the bound only stops a pathological stream from
/// pinning one task. A request still standing when the bound is reached is handed to a
/// fresh launch pass of its own ([`spawn_pending`]), never left for a trigger that may not
/// come.
const MAX_LAUNCH_PASSES: u32 = 5;

/// What a launch pass launches for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum LaunchTarget {
    /// A coverage plan, while it is filling.
    Plan,
    /// A ladder, while its dispatch is running.
    Ladder,
}

impl LaunchTarget {
    /// The noun the logs name the target by.
    fn noun(self) -> &'static str {
        match self {
            LaunchTarget::Plan => "plan",
            LaunchTarget::Ladder => "ladder",
        }
    }

    /// Take the target's launch-pass claim.
    async fn claim(self, state: &AppState, user_id: &str, id: &str) -> Result<bool, ApiError> {
        let now = now()?;
        match self {
            LaunchTarget::Plan => state.db.claim_coverage_plan_launch(user_id, id, &now).await,
            LaunchTarget::Ladder => state.db.claim_ladder_launch(user_id, id, &now).await,
        }
        .map_err(ApiError::from)
    }

    /// Release the target's claim, unconditionally.
    async fn release(self, state: &AppState, id: &str) -> Result<(), ApiError> {
        match self {
            LaunchTarget::Plan => state.db.release_coverage_plan_launch(id).await,
            LaunchTarget::Ladder => state.db.release_ladder_launch(id).await,
        }
        .map_err(ApiError::from)
    }

    /// Leave a request for another pass, for the claim holder to serve.
    async fn request(self, state: &AppState, id: &str) -> Result<(), ApiError> {
        match self {
            LaunchTarget::Plan => state.db.request_coverage_plan_launch(id).await,
            LaunchTarget::Ladder => state.db.request_ladder_launch(id).await,
        }
        .map_err(ApiError::from)
    }

    /// Take a standing request, clearing it.
    async fn take_request(self, state: &AppState, id: &str) -> Result<bool, ApiError> {
        match self {
            LaunchTarget::Plan => state.db.take_coverage_plan_launch_request(id).await,
            LaunchTarget::Ladder => state.db.take_ladder_launch_request(id).await,
        }
        .map_err(ApiError::from)
    }

    /// Whether another pass is wanted: one was requested, and the plan is still filling
    /// or the ladder's dispatch still running. A halt or a stop in the meantime ends
    /// that, and must not be followed by a refill.
    async fn pass_requested(self, state: &AppState, id: &str) -> Result<bool, ApiError> {
        let requested = match self {
            LaunchTarget::Plan => state.db.coverage_plan_launch_requested(id).await,
            LaunchTarget::Ladder => state.db.ladder_launch_requested(id).await,
        }
        .map_err(ApiError::from)?;
        if !requested {
            return Ok(false);
        }
        Ok(match self {
            LaunchTarget::Plan => state
                .db
                .coverage_plan_fill(id)
                .await
                .map_err(ApiError::from)?
                .is_some(),
            LaunchTarget::Ladder => state
                .db
                .ladder_dispatch(id)
                .await
                .map_err(ApiError::from)?
                .is_some_and(|dispatch| dispatch.status == "running"),
        })
    }

    /// One launch pass, run while this caller holds the claim. Each pass resolves the
    /// limit it launches under for itself, from what it reads.
    async fn pass(
        self,
        state: &AppState,
        user_id: &str,
        id: &str,
    ) -> Result<LaunchPassResult, ApiError> {
        match self {
            LaunchTarget::Plan => super::coverage::plan_pass_locked(state, user_id, id).await,
            LaunchTarget::Ladder => super::ladders::ladder_pass_locked(state, user_id, id).await,
        }
    }

    /// The target's public entry point: check it is filling or running, then
    /// [`run_launch_passes`]. What a handed-off request is served through.
    async fn launch(
        self,
        state: &AppState,
        user_id: &str,
        id: &str,
    ) -> Result<LaunchPassResult, ApiError> {
        match self {
            LaunchTarget::Plan => super::coverage::launch_plan(state, user_id, id).await,
            LaunchTarget::Ladder => super::ladders::launch_ladder(state, user_id, id).await,
        }
    }
}

/// Run launch passes of one plan or ladder as `user_id`, its owner, under its claim.
///
/// When another pass holds the claim, this one leaves a request for another pass and
/// tries the claim once more: the holder checks for requests after it releases the
/// claim, so a request is always seen either by the holder or, when the claim came free
/// in between, by this caller, which then serves it itself. Only when the second attempt
/// also finds the claim held does it answer `skipped: busy`. The passes one call runs are
/// merged into one result. `limit` is only what a `busy` answer reports; every pass
/// resolves the limit it launches under itself.
pub(super) async fn run_launch_passes(
    state: &AppState,
    target: LaunchTarget,
    user_id: &str,
    id: &str,
    limit: InFlightLimit,
) -> Result<LaunchPassResult, ApiError> {
    let mut merged: Option<LaunchPassResult> = None;
    let mut passes = 0u32;
    let mut requested = false;
    loop {
        if !target.claim(state, user_id, id).await? {
            if requested {
                return Ok(merged
                    .unwrap_or_else(|| LaunchPassResult::skipped_by(LaunchSkipped::Busy, limit)));
            }
            target.request(state, id).await?;
            requested = true;
            continue;
        }

        // Everything from here to the release runs under the claim. The release is
        // unconditional: a claim nobody releases only expires after the store's lease,
        // and stalling the target that long because one pass failed would turn a bad
        // moment into a wedged plan or ladder.
        let worked = passes_under_claim(state, target, user_id, id, &mut passes, &mut merged).await;
        let released = target.release(state, id).await;

        // A request that landed between the last check and the release found the claim
        // still held, so it is this caller's to serve. One this caller cannot serve — its
        // passes are spent, or the last one failed — goes to a fresh pass rather than
        // waiting on a trigger that may never come: the last runs finishing together are
        // exactly when nothing else will.
        let pending = match released {
            Ok(()) => target.pass_requested(state, id).await,
            Err(err) => Err(err),
        };
        match (worked, pending) {
            (Ok(()), Ok(true)) if passes < MAX_LAUNCH_PASSES => {
                requested = false;
                continue;
            }
            (worked, Ok(true)) => {
                spawn_pending(state, target, user_id, id);
                worked?;
            }
            (worked, pending) => {
                worked?;
                pending?;
            }
        }
        break;
    }
    Ok(merged.unwrap_or_else(|| LaunchPassResult::skipped_by(LaunchSkipped::Busy, limit)))
}

/// Run passes while the claim is held: one, and another for every request that arrived
/// meanwhile, up to [`MAX_LAUNCH_PASSES`] in all.
async fn passes_under_claim(
    state: &AppState,
    target: LaunchTarget,
    user_id: &str,
    id: &str,
    passes: &mut u32,
    merged: &mut Option<LaunchPassResult>,
) -> Result<(), ApiError> {
    loop {
        // Taken before the pass reads anything, so a request made during the pass is
        // still standing when it ends.
        target.take_request(state, id).await?;
        let result = target.pass(state, user_id, id).await?;
        *merged = Some(match merged.take() {
            None => result,
            Some(earlier) => earlier.merged_with(result),
        });
        *passes += 1;
        if *passes >= MAX_LAUNCH_PASSES || !target.pass_requested(state, id).await? {
            return Ok(());
        }
    }
}

/// Serve a pending launch-pass request on a task of its own, for a holder that has to
/// let it go: its passes are spent, or its last pass failed.
///
/// It cannot loop: it only runs a pass when it takes a request, and a request is only
/// left by a trigger, so a target nobody is feeding settles after one more pass.
fn spawn_pending(state: &AppState, target: LaunchTarget, user_id: &str, id: &str) {
    let state = state.clone();
    let user_id = user_id.to_string();
    let id = id.to_string();
    let task: std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> =
        Box::pin(async move {
            log_pass(
                target,
                &id,
                "a pending request",
                target.launch(&state, &user_id, &id).await,
            );
        });
    tokio::spawn(task);
}

/// Log one launch pass's outcome. `cause` names what prompted it.
fn log_pass(
    target: LaunchTarget,
    id: &str,
    cause: &str,
    result: Result<LaunchPassResult, ApiError>,
) {
    match result {
        Ok(result) => tracing::info!(
            target = target.noun(),
            id,
            cause,
            enqueued = result.enqueued,
            skipped = ?result.skipped,
            early_stop_canceled = result.early_stop_canceled,
            "ran a launch pass"
        ),
        Err(err) => tracing::warn!(
            target = target.noun(),
            id,
            cause,
            error = %err.message,
            "could not run a launch pass"
        ),
    }
}

/// Feed what a job that just reached a terminal state belongs to: the ladder dispatch its
/// origin names, while that dispatch is running, and every filling plan one of whose
/// cells is the job's — whoever launched it, since a plan counts globally. Each gets a
/// launch pass as its owner.
///
/// This is what makes a plan fill and a ladder climb by themselves: the run that finishes
/// is the evidence that may fill a cell or decide a rung, so its arrival is the moment to
/// launch the next. Never fails: a pass that fails is logged and the rest are still fed,
/// because this runs after a driver's status report is stored and must never be the reason
/// that report fails.
pub(super) async fn feed_finished_job(state: &AppState, job: &test_cabinet_entities::job::Model) {
    if let Some((ladder_id, owner)) = super::ladders::dispatch_fed_by(state, job).await {
        let result = LaunchTarget::Ladder.launch(state, &owner, &ladder_id).await;
        log_pass(LaunchTarget::Ladder, &ladder_id, "a finished run", result);
    }
    for (plan_id, owner) in super::coverage::plans_fed_by(state, job).await {
        let result = LaunchTarget::Plan.launch(state, &owner, &plan_id).await;
        log_pass(LaunchTarget::Plan, &plan_id, "a finished run", result);
    }
}

/// Feed what a batch of cancelled jobs belonged to, each dispatch and plan once: the
/// running dispatch an origin names, and every filling plan one of whose cells a job sat
/// in. A cancelled job was in flight, so it held its cell (and a place under its plan's
/// or dispatch's limit) for every plan counting it; once it is gone, that cell is missing
/// again, and nothing else would notice — the job never finishes to feed anything.
///
/// A pass only launches what is missing, so feeding what was just halted or stopped does
/// nothing: its fill or dispatch has ended. Never fails; a pass that fails is logged.
pub(super) async fn feed_canceled_jobs(
    state: &AppState,
    jobs: &[test_cabinet_entities::job::Model],
) {
    let mut ladders: Vec<(String, String)> = Vec::new();
    let mut plans: Vec<(String, String)> = Vec::new();
    let mut cells = std::collections::HashSet::new();
    for job in jobs {
        if let Some(fed) = super::ladders::dispatch_fed_by(state, job).await
            && !ladders.contains(&fed)
        {
            ladders.push(fed);
        }
        // Plans are fed by a job's cell, so one job per cell is enough to find them.
        let cell = (
            job.test_case_slug.clone(),
            job.test_case_version.clone(),
            job.variant.clone(),
            job.engine_slug.clone(),
            job.harness_slug.clone(),
            job.model_id.clone(),
            job.gg_config_id.clone(),
            job.gg_models.clone(),
        );
        if !cells.insert(cell) {
            continue;
        }
        for fed in super::coverage::plans_fed_by(state, job).await {
            if !plans.contains(&fed) {
                plans.push(fed);
            }
        }
    }
    for (ladder_id, owner) in ladders {
        let result = LaunchTarget::Ladder.launch(state, &owner, &ladder_id).await;
        log_pass(LaunchTarget::Ladder, &ladder_id, "a cancelled run", result);
    }
    for (plan_id, owner) in plans {
        let result = LaunchTarget::Plan.launch(state, &owner, &plan_id).await;
        log_pass(LaunchTarget::Plan, &plan_id, "a cancelled run", result);
    }
}

/// Run a launch pass of `target` on a task of its own, for a write that may open work
/// with nothing in flight to feed it (a cell retry, an edit of a filling plan). Spawned
/// rather than awaited, so the write answers at once and never fails because of the pass.
pub(super) fn spawn_launch(state: &AppState, target: LaunchTarget, user_id: &str, id: &str) {
    let state = state.clone();
    let user_id = user_id.to_string();
    let id = id.to_string();
    let task: std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> =
        Box::pin(async move {
            log_pass(
                target,
                &id,
                "an owner's write",
                target.launch(&state, &user_id, &id).await,
            );
        });
    tokio::spawn(task);
}

/// Run one launch pass of every running ladder dispatch and every filling plan, on a task
/// of its own, as soon as the definition store is servable.
///
/// A dispatch or a plan is otherwise fed only when one of its runs finishes, and a restart
/// loses some of those moments: a feed that was spawned but had not finished dies with the
/// process. A pass at boot puts each back to where its runs say it should be, and costs
/// nothing for one that is already fed: a pass only launches what is missing. It waits for
/// the store, because a pass reads manifests and an empty store would misjudge them.
pub(crate) fn spawn_startup_passes(state: AppState) {
    tokio::spawn(async move {
        while !state.ready.is_ready() {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
        match state.db.running_dispatches().await {
            Ok(ladders) => {
                for (id, owner) in ladders {
                    let result = LaunchTarget::Ladder.launch(&state, &owner, &id).await;
                    log_pass(LaunchTarget::Ladder, &id, "startup", result);
                }
            }
            Err(err) => {
                tracing::warn!(error = %err, "could not list the running ladder dispatches at startup")
            }
        }
        match state.db.filling_coverage_plans().await {
            Ok(plans) => {
                for (id, owner) in plans {
                    let result = LaunchTarget::Plan.launch(&state, &owner, &id).await;
                    log_pass(LaunchTarget::Plan, &id, "startup", result);
                }
            }
            Err(err) => {
                tracing::warn!(error = %err, "could not list the filling plans at startup")
            }
        }
    });
}
