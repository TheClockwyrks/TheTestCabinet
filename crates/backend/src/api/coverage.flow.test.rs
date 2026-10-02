//! A plan's fill, end to end against a real store and database: Fill starts it and runs
//! a launch pass, every finished run of one of its cells runs another, and the fill ends
//! once every launchable cell is filled or the plan is halted.
//!
//! Every test drives the functions the routes call — [`create_plan`], [`fill_plan`],
//! [`halt_plan`], [`retry_plan_cell`], [`plan_coverage`] and the finished-job feed — over
//! the shared flow harness.

use test_cabinet_core::run_record::RunState;
use test_cabinet_entities::job;

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

/// Fail a job on infrastructure, with no run, ended now, and feed it.
async fn fail_on_infrastructure(state: &AppState, job_id: &str) -> job::Model {
    let job = state
        .db
        .set_job_state(
            job_id,
            "failed",
            &now().unwrap(),
            Some("harness unavailable"),
            None,
        )
        .await
        .unwrap()
        .expect("the job exists");
    feed(state, &job).await;
    job
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
async fn an_unbounded_fill_launches_every_missing_cell_and_refills_only_infrastructure_failures() {
    let (_dir, state) = test_state().await;
    let id = plan_id(
        &state,
        plan_input(&["pong", "carom", "volley"], 1, InFlightLimit::Unbounded),
    )
    .await;
    let first = fill(&state, &id).await;
    assert_eq!(first.enqueued, 3);
    assert_eq!(launch_plan(&state, OWNER, &id).await.unwrap().enqueued, 0);

    let pong = in_flight(&state, "pong").await;
    fail_on_infrastructure(&state, &pong[0].id).await;
    assert_eq!(
        in_flight(&state, "pong").await.len(),
        1,
        "the cell is relaunched"
    );
    assert_eq!(jobs(&state).await.len(), 4);
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
async fn a_cell_counts_the_models_results_once_and_never_an_infrastructure_failure() {
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
    // A timed-out run is the model's result; a harness error is ours.
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
    assert_eq!(cell(&counts, "carom").counted, 0);
    assert_eq!(cell(&counts, "volley").counted, 1);
}

#[tokio::test]
async fn a_cell_failing_on_infrastructure_is_blocked_until_it_is_retried() {
    let (_dir, state) = test_state().await;
    let id = plan_id(
        &state,
        plan_input(&["pong", "carom"], 1, InFlightLimit::Bounded { runs: 10 }),
    )
    .await;
    fill(&state, &id).await;
    let err = retry_cell(&state, &id, "pong").await.unwrap_err();
    assert_eq!(err.status, StatusCode::CONFLICT, "not blocked yet");

    for _ in 0..3 {
        let pong = in_flight(&state, "pong").await;
        assert_eq!(pong.len(), 1);
        fail_on_infrastructure(&state, &pong[0].id).await;
    }
    assert!(in_flight(&state, "pong").await.is_empty());
    let blocked = matrix(&state, &id).await;
    assert!(cell(&blocked, "pong").blocked);
    assert_eq!(blocked.cells_blocked, 1);
    assert!(
        blocked.filling,
        "a blocked cell waits on its retry, filling"
    );
    let result = launch_plan(&state, OWNER, &id).await.unwrap();
    assert_eq!(result.enqueued, 0);
    assert_eq!(result.unlaunchable.len(), 1);

    // A retry relaunches it through a pass.
    assert_eq!(
        retry_cell(&state, &id, "pong").await.unwrap(),
        StatusCode::NO_CONTENT
    );
    wait_for_in_flight(&state, "pong", 1).await;
    assert!(!cell(&matrix(&state, &id).await, "pong").blocked);

    // Three more failures block it again.
    for _ in 0..3 {
        let pong = in_flight(&state, "pong").await;
        assert_eq!(pong.len(), 1);
        fail_on_infrastructure(&state, &pong[0].id).await;
    }
    assert!(cell(&matrix(&state, &id).await, "pong").blocked);

    // Once the plan is no longer filling, a retry launches the shortfall by hand.
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
