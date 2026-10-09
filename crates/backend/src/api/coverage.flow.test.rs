//! A plan's fill, end to end against a real store and database: Fill starts it and runs
//! a launch pass, every finished run of one of its cells runs another, and the fill ends
//! once every launchable cell is filled or the plan is halted.
//!
//! Every test drives the functions the routes call — [`create_plan`], [`fill_plan`],
//! [`halt_plan`], [`retry_plan_cell`], [`plan_coverage`] and the finished-job feed — over
//! the shared flow harness.

use test_cabinet_core::run_record::RunState;

use super::*;
use crate::api::flow_harness::*;

fn case(slug: &str) -> ReviewPlanCase {
    ReviewPlanCase {
        slug: slug.to_string(),
        version: "v1.0.0".to_string(),
        variant: "base".to_string(),
        engine: None,
    }
}

fn plan_input(cases: &[&str], runs_per_cell: u32, limit: InFlightLimit) -> CoveragePlanInput {
    CoveragePlanInput {
        name: "sweep".to_string(),
        runs_per_cell,
        combo_group_ids: vec![],
        case_group_ids: vec![],
        combos: vec![harness_combo(SONNET)],
        cases: cases.iter().map(|slug| case(slug)).collect(),
        outer_axis: CoverageAxis::Case,
        in_flight_limit: Some(limit),
        retry_count: None,
    }
}

/// Create a plan through the endpoint and return its id. A new plan is not filling.
async fn plan_id(state: &AppState, input: CoveragePlanInput) -> String {
    let Json(out) = create_plan(State(state.clone()), owner(), Json(input))
        .await
        .unwrap();
    assert!(!out.filling);
    out.plan.id
}

/// Press Fill.
async fn fill(state: &AppState, id: &str) -> LaunchPassResult {
    let Json(result) = fill_plan(State(state.clone()), owner(), Path(id.to_string()))
        .await
        .unwrap();
    result
}

/// The plan's coverage matrix.
async fn matrix(state: &AppState, id: &str) -> CoverageMatrix {
    let Json(matrix) = plan_coverage(State(state.clone()), owner(), Path(id.to_string()))
        .await
        .unwrap();
    matrix
}

fn cell<'a>(matrix: &'a CoverageMatrix, slug: &str) -> &'a CoverageCell {
    matrix
        .cells
        .iter()
        .find(|cell| cell.slug == slug)
        .expect("the cell is on the plan")
}

/// A launch pass of the plan that ran to its end. A driver's report runs the plan's pass
/// on a task of its own, which can hold the claim when this one asks for it; a pass that
/// completes after it reads everything that pass did, and a pass that runs later finds
/// nothing left to do.
async fn settled_pass(state: &AppState, id: &str) -> LaunchPassResult {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(20);
    loop {
        let result = launch_plan(state, OWNER, id).await.unwrap();
        if result.skipped != Some(LaunchSkipped::Busy) {
            return result;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "the plan's launch claim was never released"
        );
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
}

/// The plan's entry on the plans summary.
async fn summary_of(state: &AppState, id: &str) -> CoveragePlanSummary {
    let Json(plans) = plans_summary(State(state.clone()), owner()).await.unwrap();
    plans
        .into_iter()
        .find(|plan| plan.id == id)
        .expect("the plan is on the summary")
}

async fn retry_cell(state: &AppState, id: &str, slug: &str) -> Result<StatusCode, ApiError> {
    retry_plan_cell(
        State(state.clone()),
        owner(),
        Path(id.to_string()),
        Json(PlanCellRetryInput {
            case: case(slug),
            combination: harness_combo(SONNET),
        }),
    )
    .await
}

#[tokio::test]
async fn a_fill_launches_under_its_limit_and_finishing_runs_launch_the_rest_until_it_ends() {
    let (_dir, state) = test_state().await;
    let id = plan_id(
        &state,
        plan_input(&["pong", "carom"], 2, InFlightLimit::Bounded { runs: 2 }),
    )
    .await;
    assert!(jobs(&state).await.is_empty(), "saving launches nothing");

    let first = fill(&state, &id).await;
    assert_eq!(first.enqueued, 2);
    let pong = in_flight(&state, "pong").await;
    assert_eq!(pong.len(), 2);
    let fill_id = state.db.coverage_plan_fill(&id).await.unwrap().unwrap();
    for job in &pong {
        assert_eq!(
            job.origin.as_deref(),
            Some(format!("plan:{id}/{fill_id}").as_str())
        );
    }
    assert!(
        in_flight(&state, "carom").await.is_empty(),
        "the limit is full"
    );
    assert!(matrix(&state, &id).await.filling);

    for job in &pong {
        finish_and_feed(&state, &job.id, "pong", GREAT).await;
    }
    let carom = in_flight(&state, "carom").await;
    assert_eq!(carom.len(), 2);
    finish_and_feed(&state, &carom[0].id, "carom", BROKEN).await;
    assert!(
        matrix(&state, &id).await.filling,
        "a cell is still unfilled"
    );
    finish_and_feed(&state, &carom[1].id, "carom", GREAT).await;

    let after = matrix(&state, &id).await;
    assert!(!after.filling, "every cell is filled, so the fill ended");
    assert_eq!((after.cells_filled, after.cells_total), (2, 2));
    assert_eq!((after.runs_done, after.runs_total), (4, 4));
    // A pass of a plan that is not filling launches nothing.
    let result = launch_plan(&state, OWNER, &id).await.unwrap();
    assert_eq!(result.skipped, Some(LaunchSkipped::NotFilling));
}

#[tokio::test]
async fn an_unbounded_fill_launches_every_missing_cell_once() {
    let (_dir, state) = test_state().await;
    let id = plan_id(
        &state,
        plan_input(&["pong", "carom", "volley"], 1, InFlightLimit::Unbounded),
    )
    .await;
    let first = fill(&state, &id).await;
    assert_eq!(first.enqueued, 3);
    assert_eq!(launch_plan(&state, OWNER, &id).await.unwrap().enqueued, 0);
    assert_eq!(jobs(&state).await.len(), 3);
}

#[tokio::test]
async fn a_plan_launches_every_run_with_its_retry_limit() {
    let (_dir, state) = test_state().await;
    // A plan saved without a retry limit gets one retry.
    let Json(saved) = create_plan(
        State(state.clone()),
        owner(),
        Json(plan_input(&["pong"], 2, InFlightLimit::Unbounded)),
    )
    .await
    .unwrap();
    assert_eq!(saved.plan.retry_count, 1);
    fill(&state, &saved.plan.id).await;
    let launched = in_flight(&state, "pong").await;
    assert_eq!(launched.len(), 2);
    assert!(launched.iter().all(|job| retry_count_of(job) == Some(1)));

    // A configured limit rides on every launch request, and an automatic retry inherits
    // it with the request.
    let mut input = plan_input(&["carom"], 1, InFlightLimit::Unbounded);
    input.retry_count = Some(3);
    let Json(saved) = create_plan(State(state.clone()), owner(), Json(input.clone()))
        .await
        .unwrap();
    assert_eq!(saved.plan.retry_count, 3);
    fill(&state, &saved.plan.id).await;
    let attempt = in_flight(&state, "carom").await[0].clone();
    assert_eq!(retry_count_of(&attempt), Some(3));
    let retry_id = report_failed(&state, &attempt.id)
        .await
        .expect("the attempt has retries left");
    let retry_job = state.db.get_job(&retry_id).await.unwrap().unwrap();
    assert_eq!(retry_count_of(&retry_job), Some(3));

    // An edit is read by the next pass, and a limit above the range is clamped into it.
    input.retry_count = Some(99);
    let Json(edited) = update_plan(
        State(state.clone()),
        owner(),
        Path(saved.plan.id.clone()),
        Json(input),
    )
    .await
    .unwrap();
    assert_eq!(edited.plan.retry_count, 10);
}

#[tokio::test]
async fn a_halt_ends_the_fill_cancels_the_plans_waiting_jobs_and_withholds_its_fills_retries() {
    let (_dir, state) = test_state().await;
    let id = plan_id(
        &state,
        plan_input(&["pong", "carom"], 2, InFlightLimit::Bounded { runs: 2 }),
    )
    .await;
    fill(&state, &id).await;
    let pong = in_flight(&state, "pong").await;
    set_state(&state, &pong[0].id, "running").await;
    // A hand launch from the plan's Tests tab, running; one waiting; and an unrelated job.
    enqueue_other(&state, "tests-tab", "volley", Some(&format!("plan:{id}"))).await;
    set_state(&state, "tests-tab", "running").await;
    enqueue_other(
        &state,
        "tests-tab-waiting",
        "volley",
        Some(&format!("plan:{id}")),
    )
    .await;
    enqueue_other(&state, "unrelated", "volley", None).await;

    let Json(halted) = halt_plan(State(state.clone()), owner(), Path(id.clone()))
        .await
        .unwrap();
    assert_eq!(
        halted.canceled, 2,
        "the fill's waiting job and the hand launch's"
    );
    assert!(!matrix(&state, &id).await.filling);
    let left: Vec<String> = jobs(&state)
        .await
        .into_iter()
        .filter(|job| matches!(job.state.as_str(), "queued" | "running"))
        .map(|job| job.id)
        .collect();
    assert!(left.contains(&"unrelated".to_string()));
    assert!(left.contains(&pong[0].id));
    assert!(left.contains(&"tests-tab".to_string()));

    // The fill's running job ends catastrophic: the fill has ended, so it is not retried.
    report(
        &state,
        &pong[0].id,
        ended_run("run-fill", "pong", RunState::Catastrophic),
    )
    .await;
    let fill_job = state.db.get_job(&pong[0].id).await.unwrap().unwrap();
    assert!(fill_job.retried_by.is_none());
    // The Tests tab's is a hand launch, which a halt does not withhold.
    report(
        &state,
        "tests-tab",
        ended_run("run-tab", "volley", RunState::Catastrophic),
    )
    .await;
    let tab_job = state.db.get_job("tests-tab").await.unwrap().unwrap();
    assert!(tab_job.retried_by.is_some());
}

#[tokio::test]
async fn a_cell_counts_the_models_results_once_a_harness_error_among_them() {
    let (_dir, state) = test_state().await;
    let id = plan_id(
        &state,
        plan_input(
            &["pong", "carom", "volley"],
            1,
            InFlightLimit::Bounded { runs: 10 },
        ),
    )
    .await;
    // A timed-out run is the model's result, and so is a harness error.
    enqueue_other(&state, "timed-out", "pong", None).await;
    finish(
        &state,
        "timed-out",
        ended_run("run-t", "pong", RunState::TimedOut),
    )
    .await;
    enqueue_other(&state, "harness-error", "carom", None).await;
    finish(
        &state,
        "harness-error",
        ended_run("run-h", "carom", RunState::HarnessError),
    )
    .await;
    // A retried attempt and its retry are one run.
    enqueue_other(&state, "attempt", "volley", Some(&format!("plan:{id}"))).await;
    set_state(&state, "attempt", "running").await;
    report(
        &state,
        "attempt",
        ended_run("run-a", "volley", RunState::Catastrophic),
    )
    .await;
    let retry = state
        .db
        .get_job("attempt")
        .await
        .unwrap()
        .unwrap()
        .retried_by
        .expect("the attempt was retried");
    finish(&state, &retry, run_of("run-r", "volley", GREAT)).await;

    let counts = matrix(&state, &id).await;
    assert_eq!(cell(&counts, "pong").counted, 1);
    assert!(cell(&counts, "pong").filled);
    assert_eq!(cell(&counts, "carom").counted, 1);
    assert!(cell(&counts, "carom").filled);
    assert_eq!(cell(&counts, "volley").counted, 1);

    // Nothing is short, so a fill launches nothing for the harness error.
    assert_eq!(fill(&state, &id).await.enqueued, 0);
}

#[tokio::test]
async fn a_cell_whose_launch_uses_up_its_retries_is_blocked_until_it_is_retried() {
    let (_dir, state) = test_state().await;
    let id = plan_id(
        &state,
        plan_input(&["pong", "carom"], 1, InFlightLimit::Bounded { runs: 10 }),
    )
    .await;
    fill(&state, &id).await;
    let err = retry_cell(&state, &id, "pong").await.unwrap_err();
    assert_eq!(err.status, StatusCode::CONFLICT, "not blocked yet");

    // The first failure is retried: the retry holds the cell, and no pass launches
    // another run beside it.
    let attempt = in_flight(&state, "pong").await[0].id.clone();
    let retry_id = report_failed(&state, &attempt)
        .await
        .expect("the attempt has one retry");
    assert_eq!(settled_pass(&state, &id).await.enqueued, 0);
    assert_eq!(in_flight(&state, "pong").await.len(), 1);
    assert!(!cell(&matrix(&state, &id).await, "pong").blocked);

    // The retry fails too: the allowance is spent, and the cell blocks.
    assert_eq!(report_failed(&state, &retry_id).await, None);
    let result = settled_pass(&state, &id).await;
    assert_eq!(result.enqueued, 0);
    // Reported by every pass that skipped it, and a pass serving a request left by the
    // report's own runs twice.
    assert!(!result.unlaunchable.is_empty());
    assert!(result.unlaunchable.iter().all(|cell| cell.slug == "pong"));
    assert!(in_flight(&state, "pong").await.is_empty());
    assert_eq!(
        jobs(&state).await.len(),
        3,
        "two attempts of pong, one of carom"
    );
    let blocked = matrix(&state, &id).await;
    assert!(cell(&blocked, "pong").blocked);
    assert_eq!(blocked.cells_blocked, 1);
    assert!(
        blocked.filling,
        "a blocked cell waits on its retry, filling"
    );

    // A retry relaunches it through a pass.
    assert_eq!(
        retry_cell(&state, &id, "pong").await.unwrap(),
        StatusCode::NO_CONTENT
    );
    wait_for_in_flight(&state, "pong", 1).await;
    assert!(!cell(&matrix(&state, &id).await, "pong").blocked);

    // The relaunched run has the same allowance, and using it up blocks the cell again.
    let relaunched = in_flight(&state, "pong").await[0].id.clone();
    let retry_id = report_failed(&state, &relaunched)
        .await
        .expect("a relaunched run has its own retry");
    assert_eq!(report_failed(&state, &retry_id).await, None);
    settled_pass(&state, &id).await;
    assert!(cell(&matrix(&state, &id).await, "pong").blocked);

    // Once the plan is no longer filling, a retry launches the shortfall by hand, with
    // the plan's retry limit.
    let _ = halt_plan(State(state.clone()), owner(), Path(id.clone()))
        .await
        .unwrap();
    assert_eq!(
        retry_cell(&state, &id, "pong").await.unwrap(),
        StatusCode::NO_CONTENT
    );
    let pong = in_flight(&state, "pong").await;
    assert_eq!(pong.len(), 1);
    assert_eq!(
        pong[0].origin.as_deref(),
        Some(format!("plan:{id}").as_str())
    );
    assert_eq!(retry_count_of(&pong[0]), Some(1));
}

#[tokio::test]
async fn with_no_retries_one_infrastructure_failure_blocks_the_cell_and_nothing_relaunches() {
    let (_dir, state) = test_state().await;
    let mut input = plan_input(&["pong"], 1, InFlightLimit::Bounded { runs: 10 });
    input.retry_count = Some(0);
    let id = plan_id(&state, input).await;
    fill(&state, &id).await;
    let attempt = in_flight(&state, "pong").await[0].id.clone();

    assert_eq!(report_failed(&state, &attempt).await, None);
    assert_eq!(settled_pass(&state, &id).await.enqueued, 0);
    assert!(in_flight(&state, "pong").await.is_empty());
    assert_eq!(jobs(&state).await.len(), 1, "no replacement was launched");
    assert!(cell(&matrix(&state, &id).await, "pong").blocked);
}

#[tokio::test]
async fn a_run_that_uses_up_its_retries_among_runs_launched_together_blocks_the_cell() {
    let (_dir, state) = test_state().await;
    let mut input = plan_input(&["pong"], 5, InFlightLimit::Bounded { runs: 10 });
    input.retry_count = Some(0);
    let id = plan_id(&state, input).await;
    fill(&state, &id).await;
    let launched: Vec<String> = in_flight(&state, "pong")
        .await
        .into_iter()
        .map(|job| job.id)
        .collect();
    assert_eq!(launched.len(), 5);

    // One of the five fails with no retry left. The cell is blocked with the other four
    // still running, and no pass launches a run in the failed one's place.
    assert_eq!(report_failed(&state, &launched[0]).await, None);
    assert_eq!(settled_pass(&state, &id).await.enqueued, 0);
    let board = matrix(&state, &id).await;
    assert!(cell(&board, "pong").blocked);
    assert_eq!(cell(&board, "pong").in_flight, 4);
    assert!(!board.needs_attention, "its own runs are still in flight");

    // The four complete, one at a time. The cell stays blocked after each, and nothing is
    // launched.
    for job_id in &launched[1..] {
        finish_and_feed(&state, job_id, "pong", GREAT).await;
        assert_eq!(settled_pass(&state, &id).await.enqueued, 0);
        assert!(cell(&matrix(&state, &id).await, "pong").blocked);
    }
    assert_eq!(jobs(&state).await.len(), 5, "no replacement was launched");
    let board = matrix(&state, &id).await;
    assert_eq!(cell(&board, "pong").counted, 4);
    assert!(board.filling && board.needs_attention);

    // A retry launches the one run that is missing, and a failure of it blocks again.
    assert_eq!(
        retry_cell(&state, &id, "pong").await.unwrap(),
        StatusCode::NO_CONTENT
    );
    wait_for_in_flight(&state, "pong", 1).await;
    assert!(!cell(&matrix(&state, &id).await, "pong").blocked);
    let relaunched = in_flight(&state, "pong").await[0].id.clone();
    assert_eq!(report_failed(&state, &relaunched).await, None);
    assert_eq!(settled_pass(&state, &id).await.enqueued, 0);
    assert!(cell(&matrix(&state, &id).await, "pong").blocked);
    assert_eq!(jobs(&state).await.len(), 6);
}

#[tokio::test]
async fn a_launch_made_after_a_failure_ended_replaces_it() {
    let (_dir, state) = test_state().await;
    let mut input = plan_input(&["pong"], 1, InFlightLimit::Bounded { runs: 10 });
    input.retry_count = Some(0);
    let id = plan_id(&state, input.clone()).await;
    fill(&state, &id).await;
    let attempt = in_flight(&state, "pong").await[0].id.clone();
    assert_eq!(report_failed(&state, &attempt).await, None);
    settled_pass(&state, &id).await;
    assert!(cell(&matrix(&state, &id).await, "pong").blocked);

    // A launch by hand takes the failure's place: the cell is no longer blocked, and it
    // waits on that run instead of launching one of its own.
    enqueue_now(&state, "by-hand", "pong").await;
    let board = matrix(&state, &id).await;
    assert!(!cell(&board, "pong").blocked);
    assert_eq!(cell(&board, "pong").in_flight, 1);
    assert_eq!(settled_pass(&state, &id).await.enqueued, 0);

    // Its run fills the cell, and the fill ends.
    finish_and_feed(&state, "by-hand", "pong", GREAT).await;
    let board = matrix(&state, &id).await;
    assert!(cell(&board, "pong").filled);
    assert!(!cell(&board, "pong").blocked);
    assert!(!board.filling);

    // The target is raised later. The old failure does not block the cell, and a fill
    // launches the run it is now missing.
    input.runs_per_cell = 2;
    let _ = update_plan(State(state.clone()), owner(), Path(id.clone()), Json(input))
        .await
        .unwrap();
    assert!(!cell(&matrix(&state, &id).await, "pong").blocked);
    assert_eq!(fill(&state, &id).await.enqueued, 1);
    assert!(!cell(&matrix(&state, &id).await, "pong").blocked);
}

#[tokio::test]
async fn a_canceled_job_does_not_block_its_cell() {
    let (_dir, state) = test_state().await;
    let mut input = plan_input(&["pong"], 1, InFlightLimit::Bounded { runs: 10 });
    input.retry_count = Some(0);
    let id = plan_id(&state, input).await;
    fill(&state, &id).await;
    for _ in 0..3 {
        let pong = in_flight(&state, "pong").await;
        set_state(&state, &pong[0].id, "canceled").await;
        launch_plan(&state, OWNER, &id).await.unwrap();
    }
    assert_eq!(in_flight(&state, "pong").await.len(), 1);
    assert!(!cell(&matrix(&state, &id).await, "pong").blocked);
}

#[tokio::test]
async fn a_filling_plan_left_with_only_blocked_cells_needs_attention_until_one_is_retried() {
    let (_dir, state) = test_state().await;
    let mut input = plan_input(&["pong", "carom"], 1, InFlightLimit::Bounded { runs: 10 });
    input.retry_count = Some(0);
    let id = plan_id(&state, input).await;
    assert!(!matrix(&state, &id).await.needs_attention, "not filling");
    fill(&state, &id).await;

    // One cell blocks while the other's run is still in flight: the plan is filling.
    let pong = in_flight(&state, "pong").await[0].id.clone();
    report_failed(&state, &pong).await;
    settled_pass(&state, &id).await;
    let board = matrix(&state, &id).await;
    assert!(cell(&board, "pong").blocked);
    assert!(!board.needs_attention);
    assert!(!summary_of(&state, &id).await.needs_attention);

    // The other cell fills: nothing is in flight and only the blocked cell is left.
    let carom = in_flight(&state, "carom").await[0].id.clone();
    finish_and_feed(&state, &carom, "carom", GREAT).await;
    let board = matrix(&state, &id).await;
    assert!(board.filling, "it is a filling plan all the same");
    assert!(board.needs_attention);
    let listed = summary_of(&state, &id).await;
    assert!(listed.filling && listed.needs_attention);
    assert_eq!(launch_plan(&state, OWNER, &id).await.unwrap().enqueued, 0);

    // A retry relaunches the cell, and the plan no longer needs attention.
    assert_eq!(
        retry_cell(&state, &id, "pong").await.unwrap(),
        StatusCode::NO_CONTENT
    );
    wait_for_in_flight(&state, "pong", 1).await;
    assert!(!matrix(&state, &id).await.needs_attention);

    // It blocks again, and a run of the cell someone else launched fills it: the fill
    // ends with nothing waiting.
    let relaunched = in_flight(&state, "pong").await[0].id.clone();
    report_failed(&state, &relaunched).await;
    settled_pass(&state, &id).await;
    assert!(matrix(&state, &id).await.needs_attention);
    enqueue_other(&state, "by-hand", "pong", None).await;
    finish_and_feed(&state, "by-hand", "pong", GREAT).await;
    let board = matrix(&state, &id).await;
    assert!(!board.needs_attention);
    assert!(!board.filling);
}

#[tokio::test]
async fn a_filling_plan_gets_a_pass_at_startup() {
    let (_dir, state) = test_state().await;
    let id = plan_id(
        &state,
        plan_input(&["pong"], 1, InFlightLimit::Bounded { runs: 10 }),
    )
    .await;
    fill(&state, &id).await;
    let pong = in_flight(&state, "pong").await;
    set_state(&state, &pong[0].id, "canceled").await;
    crate::api::spawn_startup_passes(state.clone());
    wait_for_in_flight(&state, "pong", 1).await;
}

#[tokio::test]
async fn a_finished_hand_launch_of_a_plans_cell_feeds_the_filling_plan() {
    let (_dir, state) = test_state().await;
    let id = plan_id(
        &state,
        plan_input(&["pong", "carom"], 1, InFlightLimit::Bounded { runs: 1 }),
    )
    .await;
    fill(&state, &id).await;
    // The fill's run is lost without a feed, so the plan has nothing left to prompt it.
    let pong = in_flight(&state, "pong").await;
    set_state(&state, &pong[0].id, "canceled").await;

    // A finished run of another case feeds nothing.
    enqueue_other(&state, "elsewhere", "volley", None).await;
    let job = finish(&state, "elsewhere", run_of("run-v", "volley", GREAT)).await;
    feed(&state, &job).await;
    assert!(in_flight(&state, "pong").await.is_empty());

    // A finished hand launch of one of its cells does.
    enqueue_other(&state, "hand", "carom", None).await;
    let job = finish(&state, "hand", run_of("run-c", "carom", GREAT)).await;
    feed(&state, &job).await;
    assert_eq!(in_flight(&state, "pong").await.len(), 1);
    assert!(cell(&matrix(&state, &id).await, "carom").filled);
}

#[tokio::test]
async fn cancelling_a_filling_plans_run_by_hand_feeds_the_plan() {
    let (_dir, state) = test_state().await;
    let id = plan_id(
        &state,
        plan_input(&["pong"], 1, InFlightLimit::Bounded { runs: 1 }),
    )
    .await;
    fill(&state, &id).await;
    let first = in_flight(&state, "pong").await;
    assert_eq!(first.len(), 1);

    // Cancelled from the Runs page: the cell is missing again, and the plan launches it
    // rather than sitting filling with nothing in flight.
    let Json(canceled) =
        crate::api::jobs::cancel(State(state.clone()), owner(), Path(first[0].id.clone()))
            .await
            .unwrap();
    assert_eq!(canceled.state, test_cabinet_core::JobState::Canceled);
    wait_for_in_flight(&state, "pong", 1).await;
    let relaunched = in_flight(&state, "pong").await;
    assert_ne!(relaunched[0].id, first[0].id);
    assert!(matrix(&state, &id).await.filling);
}

/// Report a job lost, as the dispatcher does.
async fn report_lost(state: &AppState, job_id: &str) -> StatusCode {
    crate::api::jobs::report_lost(
        State(state.clone()),
        crate::auth::ServiceAuth,
        Path(job_id.to_string()),
        Json(test_cabinet_core::StatusUpdate {
            state: test_cabinet_core::DriverState::Failed,
            record: None,
            detail: Some("the driver Job no longer exists".to_string()),
        }),
    )
    .await
    .unwrap()
}

#[tokio::test]
async fn a_job_whose_driver_is_lost_fails_and_its_retry_keeps_the_plan_filling() {
    let (_dir, state) = test_state().await;
    let id = plan_id(
        &state,
        plan_input(&["pong"], 1, InFlightLimit::Bounded { runs: 1 }),
    )
    .await;
    fill(&state, &id).await;
    let first = in_flight(&state, "pong").await;

    // Still queued: no driver exists to lose, so the report leaves it alone.
    assert_eq!(
        report_lost(&state, &first[0].id).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        state.db.get_job(&first[0].id).await.unwrap().unwrap().state,
        "queued"
    );

    // Running, with its driver gone after a whole-box restart.
    set_state(&state, &first[0].id, "running").await;
    assert_eq!(
        report_lost(&state, &first[0].id).await,
        StatusCode::NO_CONTENT
    );
    let lost = state.db.get_job(&first[0].id).await.unwrap().unwrap();
    assert_eq!(lost.state, "failed");
    assert_eq!(
        lost.detail.as_deref(),
        Some("the driver Job no longer exists")
    );
    // The automatic retry takes its place in flight, under the fill's origin.
    let now = in_flight(&state, "pong").await;
    assert_eq!(now.len(), 1);
    assert_eq!(lost.retried_by.as_deref(), Some(now[0].id.as_str()));
    assert_eq!(now[0].origin, first[0].origin);
    assert!(matrix(&state, &id).await.filling);

    // A record cannot ride along: the dispatcher has none.
    let err = crate::api::jobs::report_lost(
        State(state.clone()),
        crate::auth::ServiceAuth,
        Path(now[0].id.clone()),
        Json(test_cabinet_core::StatusUpdate {
            state: test_cabinet_core::DriverState::Succeeded,
            record: None,
            detail: None,
        }),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
}

/// Push a run of one cell straight into the store, as another launch's driver would, that
/// finished at `finished_at`.
async fn landed_run(state: &AppState, id: &str, slug: &str, model: &str, finished_at: &str) {
    landed_as(state, id, slug, model, finished_at, RunState::Completed).await;
}

async fn landed_as(
    state: &AppState,
    id: &str,
    slug: &str,
    model: &str,
    finished_at: &str,
    run_state: RunState,
) {
    let mut record = run_of(id, slug, GREAT);
    record.subject.model_id = model.to_string();
    record.finished_at = finished_at.to_string();
    record.status.state = run_state;
    let manifest = state.store.read_manifest(slug, "v1.0.0").ok();
    state
        .db
        .push(&record, &crate::db::tests::links(), None, manifest.as_ref())
        .await
        .unwrap();
}

fn cell_of<'a>(matrix: &'a CoverageMatrix, slug: &str, model: &str) -> &'a CoverageCell {
    matrix
        .cells
        .iter()
        .find(|cell| cell.slug == slug && cell.model == model)
        .expect("the cell is on the plan")
}

/// The report: a plan of 4 cells × 3 runs whose cells other launches overfilled. Each cell
/// holds the first 3 counted runs to land, and nothing on the plan reads the rest.
#[tokio::test]
async fn a_cell_holds_the_first_runs_to_land_and_the_plan_never_reads_past_its_target() {
    let (_dir, state) = test_state().await;
    price_opus(&state).await;
    let mut input = plan_input(&["pong", "carom"], 3, InFlightLimit::Bounded { runs: 10 });
    input.combos = vec![harness_combo(SONNET), harness_combo(OPUS)];
    let id = plan_id(&state, input.clone()).await;

    for (slug, model) in [
        ("pong", SONNET),
        ("pong", OPUS),
        ("carom", SONNET),
        ("carom", OPUS),
    ] {
        for i in 1..=3 {
            // carom × opus has an infrastructure failure landing among its runs; it takes
            // no place in the order, so the cell still holds its first three counted runs.
            if slug == "carom" && model == OPUS && i == 2 {
                landed_as(
                    &state,
                    "carom-opus-infra",
                    slug,
                    model,
                    "2026-09-01T00:00:02.500Z",
                    RunState::Infrastructure,
                )
                .await;
            }
            landed_run(
                &state,
                &format!("{slug}-{model}-{i}"),
                slug,
                model,
                &format!("2026-09-01T00:00:0{i}Z"),
            )
            .await;
        }
    }
    // The extras: two on carom × sonnet, and one each on pong × sonnet and carom × opus.
    // The first lands half a second after carom × sonnet's third run, with an id that sorts
    // before it: read as text, `03.500Z` sorts before `03Z`, so only reading the finish as a
    // time keeps it out.
    landed_run(
        &state,
        "a-extra-1",
        "carom",
        SONNET,
        "2026-09-01T00:00:03.500Z",
    )
    .await;
    landed_run(
        &state,
        "carom-extra-2",
        "carom",
        SONNET,
        "2026-09-03T00:00:00Z",
    )
    .await;
    landed_run(&state, "pong-extra", "pong", SONNET, "2026-09-02T00:00:00Z").await;
    landed_run(
        &state,
        "carom-opus-extra",
        "carom",
        OPUS,
        "2026-09-02T00:00:00Z",
    )
    .await;
    // And a job of a filled cell still in flight elsewhere.
    enqueue_other(&state, "elsewhere", "pong", None).await;

    let board = matrix(&state, &id).await;
    for cell in &board.cells {
        assert_eq!(cell.counted, 3, "{} × {}", cell.slug, cell.model);
        assert!(cell.filled);
        assert_eq!(cell.in_flight, 0, "a filled cell shows nothing in flight");
        assert_eq!(cell.pending, 0);
        assert_eq!(cell.remaining, 0);
        assert_eq!(cell.unreviewed, 3);
    }
    assert_eq!(
        cell_of(&board, "carom", SONNET).run_ids,
        vec![
            "carom-claude-sonnet-4-5-1",
            "carom-claude-sonnet-4-5-2",
            "carom-claude-sonnet-4-5-3"
        ]
    );
    assert_eq!(
        cell_of(&board, "carom", OPUS).run_ids,
        vec![
            "carom-claude-opus-4-8-1",
            "carom-claude-opus-4-8-2",
            "carom-claude-opus-4-8-3"
        ]
    );
    assert_eq!((board.cells_filled, board.cells_total), (4, 4));
    assert_eq!((board.runs_done, board.runs_total), (12, 12));
    assert_eq!(board.runs_unreviewed, 12);
    assert_eq!(board.runs_missing, 0);

    // The plans list reads the same.
    let Json(summaries) = plans_summary(State(state.clone()), owner()).await.unwrap();
    let summary = summaries.iter().find(|s| s.id == id).unwrap();
    assert_eq!((summary.runs_done, summary.runs_total), (12, 12));
    assert_eq!(summary.runs_unreviewed, 12);

    let plan_run_ids: Vec<String> = board
        .cells
        .iter()
        .flat_map(|cell| cell.run_ids.clone())
        .collect();
    let extras = [
        "a-extra-1",
        "carom-extra-2",
        "pong-extra",
        "carom-opus-extra",
    ];

    // The review queue offers the plan's runs and none of the extras.
    let Json(queue) = plan_queue(State(state.clone()), owner(), Path(id.clone()))
        .await
        .unwrap();
    let queued: Vec<String> = queue.runs.iter().map(|run| run.run_id.clone()).collect();
    assert_eq!(queued, plan_run_ids);
    assert!(!queue.truncated);

    // A reviewed run leaves the queue and the count; an extra's review changes nothing.
    for run in ["pong-claude-sonnet-4-5-1", "pong-extra"] {
        state
            .db
            .add_review(
                run,
                &crate::db::tests::review_by(OWNER, test_cabinet_core::review::Rating::Great),
                None,
                None,
            )
            .await
            .unwrap();
    }
    assert_eq!(matrix(&state, &id).await.runs_unreviewed, 11);

    // The run cards the dashboard's breakdowns read are the plan's runs, in cell order.
    let Json(runs) = plan_runs(State(state.clone()), owner(), Path(id.clone()))
        .await
        .unwrap();
    let carded: Vec<String> = runs.runs.iter().map(|run| run.id.clone()).collect();
    assert_eq!(carded, plan_run_ids);
    assert!(
        extras
            .iter()
            .all(|extra| !carded.contains(&extra.to_string()))
    );

    // Raising the target takes in the next run to land on each cell, and only that one.
    input.runs_per_cell = 4;
    let _ = update_plan(State(state.clone()), owner(), Path(id.clone()), Json(input))
        .await
        .unwrap();
    let board = matrix(&state, &id).await;
    assert_eq!(
        cell_of(&board, "carom", SONNET)
            .run_ids
            .last()
            .map(String::as_str),
        Some("a-extra-1")
    );
    assert_eq!(
        cell_of(&board, "carom", OPUS)
            .run_ids
            .last()
            .map(String::as_str),
        Some("carom-opus-extra")
    );
    assert_eq!(
        cell_of(&board, "pong", SONNET)
            .run_ids
            .last()
            .map(String::as_str),
        Some("pong-extra")
    );
    // pong × opus has no fourth run; the job in flight on pong × sonnet's cell is now
    // wanted by nothing (the cell holds 4), so it still shows none.
    assert_eq!(cell_of(&board, "pong", OPUS).counted, 3);
    assert_eq!(cell_of(&board, "pong", SONNET).in_flight, 0);
    assert_eq!((board.runs_done, board.runs_total), (15, 16));
    assert_eq!(board.cells_filled, 3);
}
