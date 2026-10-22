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

/// Release every launch-pass claim whose lease has lapsed, logging rather than failing:
/// a claim left in place still expires out under the lease, so a pass that finds it is
/// only delayed.
async fn release_lapsed_claims(state: &AppState) {
    let released = match now() {
        Ok(now) => state.db.release_lapsed_launch_claims(&now).await,
        Err(err) => {
            tracing::warn!(error = ?err, "could not read the clock to release lapsed launch-pass claims");
            return;
        }
    };
    match released {
        Ok(0) => {}
        Ok(released) => tracing::info!(released, "released lapsed launch-pass claims"),
        Err(err) => {
            tracing::warn!(error = %err, "could not release the lapsed launch-pass claims at startup")
        }
    }
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

/// Feed what a job that just reached a terminal state belongs to: every running ladder
/// dispatch one of whose rung slots is the job's cell, and every filling plan one of whose
/// cells it is — whoever launched it, since both count globally. Each gets a launch pass
/// as its owner.
///
/// This is what makes a plan fill and a ladder climb by themselves: the run that finishes
/// is the evidence that may fill a cell or decide a rung, so its arrival is the moment to
/// launch the next. Never fails: a pass that fails is logged and retried
/// ([`launch_fed`]), and the rest are still fed, because this runs after a driver's status
/// report is stored and must never be the reason that report fails.
///
/// A job of a harness with a parallelism cap freed one of that harness's slots, and a
/// launch pass enqueues for a capped harness only into its free slots, so while the
/// harness has a free slot the job also feeds every other running dispatch and filling
/// plan, in [turn order](in_turn_order): one whose cells wait on that slot holds no job of
/// this cell and would otherwise never notice.
pub(super) async fn feed_finished_job(state: &AppState, job: &test_cabinet_entities::job::Model) {
    let ladders = super::ladders::dispatches_fed_by(state, job).await;
    let plans = super::coverage::plans_fed_by(state, job).await;
    feed(
        state,
        std::slice::from_ref(job),
        ladders,
        plans,
        "a finished run",
    )
    .await;
}

/// Feed what a batch of cancelled jobs belonged to, each dispatch and plan once: every
/// running dispatch and every filling plan one of whose cells a job sat in. A cancelled
/// job was in flight, so it held its cell (and a place under its plan's or dispatch's
/// limit) for every plan and dispatch counting it; once it is gone, that cell is missing
/// again, and nothing else would notice — the job never finishes to feed anything.
///
/// A pass only launches what is missing, so feeding what was just halted or stopped does
/// nothing: its fill or dispatch has ended. Never fails; a pass that fails is logged and
/// retried.
///
/// A cancelled job of a capped harness freed a slot of it, so it feeds every running
/// dispatch and filling plan while that harness has a free slot, as a finished one does
/// ([`feed_finished_job`]).
pub(super) async fn feed_canceled_jobs(
    state: &AppState,
    jobs: &[test_cabinet_entities::job::Model],
) {
    let mut ladders: Vec<(String, String)> = Vec::new();
    let mut plans: Vec<(String, String)> = Vec::new();
    let mut cells = std::collections::HashSet::new();
    for job in jobs {
        // Dispatches and plans are fed by a job's cell, so one job per cell is enough to
        // find them.
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
        for fed in super::ladders::dispatches_fed_by(state, job).await {
            if !ladders.contains(&fed) {
                ladders.push(fed);
            }
        }
        for fed in super::coverage::plans_fed_by(state, job).await {
            if !plans.contains(&fed) {
                plans.push(fed);
            }
        }
    }
    feed(state, jobs, ladders, plans, "a cancelled run").await;
}

/// Run the passes jobs that just ended call for: one of each of `ladders` and `plans`,
/// which hold the jobs' cells, and, while a capped harness one of the jobs ran on has a
/// free slot, one of every other running dispatch and filling plan, all in turn order.
async fn feed(
    state: &AppState,
    jobs: &[test_cabinet_entities::job::Model],
    ladders: Vec<(String, String)>,
    plans: Vec<(String, String)>,
    cause: &'static str,
) {
    let mut targets: Vec<(LaunchTarget, String, String)> = ladders
        .into_iter()
        .map(|(id, owner)| (LaunchTarget::Ladder, id, owner))
        .chain(
            plans
                .into_iter()
                .map(|(id, owner)| (LaunchTarget::Plan, id, owner)),
        )
        .collect();
    let freed = capped_harnesses_with_room(state, jobs).await;
    if !freed.is_empty() {
        add_every_running(state, &mut targets).await;
        targets = in_turn_order(state, &freed, targets).await;
    }
    for (target, id, owner) in targets {
        launch_fed(state, target, &owner, &id, cause).await;
    }
}

/// The capped harnesses among those `jobs` ran on that have a free slot now: what a job of
/// theirs ending can hand to a plan or dispatch waiting on it. A harness still full after
/// the job ended, such as one with a backlog of runs queued for it, hands nothing to
/// anyone, and its end calls for no extra pass.
///
/// A cap or a queue that cannot be read counts every harness the jobs ran on as having
/// room: an extra pass launches only what is missing, and a pass left out could leave a
/// plan waiting on a slot that is already free.
async fn capped_harnesses_with_room(
    state: &AppState,
    jobs: &[test_cabinet_entities::job::Model],
) -> Vec<String> {
    let mut ran_on: Vec<String> = jobs.iter().map(|job| job.harness_slug.clone()).collect();
    ran_on.sort_unstable();
    ran_on.dedup();
    if ran_on.is_empty() {
        return ran_on;
    }
    let caps = match state.db.list_harness_configs().await {
        Ok(configs) => configs,
        Err(error) => {
            tracing::warn!(%error, "could not read the harness parallelism caps; feeding every running ladder and filling plan");
            return ran_on;
        }
    };
    let capped: Vec<(String, u32)> = ran_on
        .into_iter()
        .filter_map(|slug| {
            let max = caps
                .iter()
                .find(|config| config.harness_slug == slug)?
                .max_parallelism?;
            Some((slug, u32::try_from(max).unwrap_or(0)))
        })
        .collect();
    if capped.is_empty() {
        return Vec::new();
    }
    let occupancy = match state.db.active_jobs().await {
        Ok(active) => super::coverage::harness_occupancy(&active),
        Err(error) => {
            tracing::warn!(%error, "could not read the queue; feeding every running ladder and filling plan");
            return capped.into_iter().map(|(slug, _)| slug).collect();
        }
    };
    capped
        .into_iter()
        .filter(|(slug, max)| occupancy.get(slug).copied().unwrap_or(0) < *max)
        .map(|(slug, _)| slug)
        .collect()
}

/// Add every running ladder dispatch and every filling plan not already in `targets`.
/// Never fails: a list that cannot be read is logged and the rest are still added.
async fn add_every_running(state: &AppState, targets: &mut Vec<(LaunchTarget, String, String)>) {
    let mut add = |target: LaunchTarget, (id, owner): (String, String)| {
        if !targets.iter().any(|(t, i, _)| *t == target && *i == id) {
            targets.push((target, id, owner));
        }
    };
    match state.db.running_dispatches().await {
        Ok(running) => running
            .into_iter()
            .for_each(|fed| add(LaunchTarget::Ladder, fed)),
        Err(error) => tracing::warn!(%error, "could not list the running ladder dispatches"),
    }
    match state.db.filling_coverage_plans().await {
        Ok(filling) => filling
            .into_iter()
            .for_each(|fed| add(LaunchTarget::Plan, fed)),
        Err(error) => tracing::warn!(%error, "could not list the filling plans"),
    }
}

/// `targets` in the order a freed slot of `harnesses` is offered in: the plan or dispatch
/// that least recently got a run onto any of them first, and one that never did ahead of
/// all of them. The passes run one after another and the first to want the slot takes
/// it, so plans and ladders waiting on the same capped harness take turns at it. Targets
/// that tie keep their order. A queue that cannot be read leaves the order as it is.
async fn in_turn_order(
    state: &AppState,
    harnesses: &[String],
    mut targets: Vec<(LaunchTarget, String, String)>,
) -> Vec<(LaunchTarget, String, String)> {
    let last = match state.db.last_enqueued_by_owner(harnesses).await {
        Ok(last) => last,
        Err(error) => {
            tracing::warn!(%error, "could not read when each plan and ladder last enqueued; feeding in the usual order");
            return targets;
        }
    };
    let owner_prefix = |target: LaunchTarget, id: &str| match target {
        LaunchTarget::Plan => crate::db::JobOrigin::plan(id).owner_prefix(),
        LaunchTarget::Ladder => crate::db::JobOrigin::dispatch(id, "", "").owner_prefix(),
    };
    targets.sort_by_key(|(target, id, _)| last.get(&owner_prefix(*target, id)).copied());
    targets
}

/// How long after a failed pass a job's end, a cap change or a startup prompted each
/// retry of it waits. A pass those prompted is often the only one coming: a plan waiting
/// on a capped harness has nothing of that harness in flight to feed it again.
const RETRY_DELAYS: [std::time::Duration; 3] = [
    std::time::Duration::from_secs(30),
    std::time::Duration::from_secs(120),
    std::time::Duration::from_secs(600),
];

/// The plans and ladders with a [retry](launch_fed) chain waiting, by target noun and id.
/// A failure while one waits starts no second chain: the waiting chain's next pass reads
/// everything the failed one would have.
static RETRYING: std::sync::LazyLock<
    std::sync::Mutex<std::collections::HashSet<(&'static str, String)>>,
> = std::sync::LazyLock::new(Default::default);

/// Run a pass of `target` that something other than its owner prompted, logging it under
/// `cause`. A pass that fails is retried on a task of its own after each of
/// [`RETRY_DELAYS`] until one succeeds, unless a chain of retries is already waiting for
/// the target.
async fn launch_fed(state: &AppState, target: LaunchTarget, owner: &str, id: &str, cause: &str) {
    let result = target.launch(state, owner, id).await;
    let failed = result.is_err();
    log_pass(target, id, cause, result);
    if !failed {
        return;
    }
    let key = (target.noun(), id.to_string());
    let started = RETRYING
        .lock()
        .map(|mut retrying| retrying.insert(key.clone()))
        .unwrap_or(false);
    if !started {
        return;
    }
    let state = state.clone();
    let owner = owner.to_string();
    let id = id.to_string();
    let task: std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> =
        Box::pin(async move {
            for delay in RETRY_DELAYS {
                tokio::time::sleep(delay).await;
                let result = target.launch(&state, &owner, &id).await;
                let succeeded = result.is_ok();
                log_pass(target, &id, "a retry of a failed pass", result);
                if succeeded {
                    break;
                }
            }
            if let Ok(mut retrying) = RETRYING.lock() {
                retrying.remove(&key);
            }
        });
    tokio::spawn(task);
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
///
/// Before the passes it releases every launch-pass claim whose lease has lapsed: such a
/// claim was held by a pass that died, and left in place it would turn a startup pass away
/// as busy with no holder left to serve the request that leaves behind. A claim still
/// within its lease belongs to a pass another replica is running and is left to it.
pub(crate) fn spawn_startup_passes(state: AppState) {
    tokio::spawn(async move {
        while !state.ready.is_ready() {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
        release_lapsed_claims(&state).await;
        launch_every_running(&state, "startup").await;
    });
}

/// Run one launch pass of every running ladder dispatch and every filling plan, in
/// [turn order](in_turn_order) for harness `slug`, on a task of its own, for a change to
/// that harness's parallelism cap. A launch pass enqueues for a capped harness only into
/// its free slots, so a raised or cleared cap opens room that no finishing run would
/// announce. Spawned rather than awaited, so the write answers at once and never fails
/// because of a pass.
pub(super) fn spawn_cap_change_passes(state: &AppState, slug: &str) {
    let state = state.clone();
    let slug = slug.to_string();
    tokio::spawn(async move {
        let mut targets = Vec::new();
        add_every_running(&state, &mut targets).await;
        for (target, id, owner) in in_turn_order(&state, &[slug], targets).await {
            launch_fed(
                &state,
                target,
                &owner,
                &id,
                "a harness's parallelism cap changed",
            )
            .await;
        }
    });
}

/// One launch pass of every running ladder dispatch and every filling plan, each as its
/// owner. `cause` names what prompted them in the log. Never fails: a list that cannot be
/// read and a pass that fails are logged.
async fn launch_every_running(state: &AppState, cause: &str) {
    let mut targets = Vec::new();
    add_every_running(state, &mut targets).await;
    for (target, id, owner) in targets {
        launch_fed(state, target, &owner, &id, cause).await;
    }
}
