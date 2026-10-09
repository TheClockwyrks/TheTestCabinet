//! A ladder's dispatch, end to end against a real store and database: a Run snapshots
//! the configuration and launches what its first rungs are missing, validators rate the
//! runs, the gate reads each slot's cell as a plan does, and a finished run makes the
//! backend run a launch pass of the dispatch with no console and no review in the loop.
//!
//! Every test here drives the same functions the routes call — [`run`], [`stop`],
//! [`retry_climber`], [`launch_ladder`], [`progress_of`] and the finished-job feed — over
//! an in-memory database and a definition store holding real manifests, so what is under
//! test is the wiring between the gate, the board, the scheduler and the queue rather
//! than any one of them alone.

use test_cabinet_core::review::Rating;
use test_cabinet_core::run_record::{RunRecord, RunState};
use test_cabinet_entities::job;

use super::*;
use crate::api::flow_harness::*;
use crate::db::tests::links;
use sea_orm::EntityTrait;

fn rung(slug: &str) -> LadderRungInput {
    LadderRungInput {
        id: None,
        slug: slug.to_string(),
        version: "v1.0.0".to_string(),
        variant: "base".to_string(),
        engine: None,
        runs: None,
    }
}

fn ladder_input(rungs: &[&str], runs_per_cell: u32, climbers: &[&str]) -> LadderInput {
    LadderInput {
        name: "climb".to_string(),
        runs_per_cell,
        gate: None,
        combo_group_ids: vec![],
        combos: climbers.iter().map(|model| harness_combo(model)).collect(),
        rungs: rungs.iter().map(|slug| rung(slug)).collect(),
        outer_axis: LadderAxis::Rung,
        in_flight_limit: None,
    }
}

/// Create a ladder through the create endpoint, as the console does. Saving launches
/// nothing.
async fn create_ladder(state: &AppState, input: LadderInput) -> Result<Ladder, ApiError> {
    create(State(state.clone()), owner(), Json(input))
        .await
        .map(|Json(out)| out)
}

/// Create a ladder and return its id.
async fn ladder_id(state: &AppState, input: LadderInput) -> String {
    create_ladder(state, input).await.unwrap().id
}

/// Press Run, as the console does.
async fn run_ladder(state: &AppState, id: &str) -> Result<LadderProgress, ApiError> {
    run(State(state.clone()), owner(), Path(id.to_string()))
        .await
        .map(|Json(out)| out)
}

/// Press Stop, as the console does.
async fn stop_ladder(
    state: &AppState,
    id: &str,
    cancel_running: bool,
) -> Result<HaltResult, ApiError> {
    stop(
        State(state.clone()),
        owner(),
        Path(id.to_string()),
        Some(Json(LadderStopInput { cancel_running })),
    )
    .await
    .map(|Json(out)| out)
}

/// One launch pass of the ladder, as a finished run, a retry or the startup prompt runs.
async fn pass(state: &AppState, id: &str) -> LaunchPassResult {
    launch_ladder(state, OWNER, id).await.unwrap()
}

/// The board, as `GET /ladders/{id}/progress` answers it.
async fn board(state: &AppState, id: &str) -> LadderProgress {
    progress_of(state, OWNER, id).await.unwrap()
}

/// The board's dispatch.
fn dispatch(progress: &LadderProgress) -> &LadderDispatch {
    progress
        .dispatch
        .as_ref()
        .expect("the ladder has a dispatch")
}

fn climber<'a>(progress: &'a LadderProgress, model: &str) -> &'a LadderClimber {
    progress
        .climbers
        .iter()
        .find(|climber| climber.model == model)
        .expect("the climber is on the board")
}

fn launched_ids(result: &LaunchPassResult) -> Vec<String> {
    result
        .cells
        .iter()
        .flat_map(|cell| cell.job_ids.iter().cloned())
        .collect()
}

/// Retry the shared climber through the endpoint, as the console does.
async fn retry(state: &AppState, id: &str, model: &str) -> Result<StatusCode, ApiError> {
    retry_climber(
        State(state.clone()),
        owner(),
        Path(id.to_string()),
        Json(LadderRetryInput {
            combination: harness_combo(model),
        }),
    )
    .await
}

// ---- Run -------------------------------------------------------------------

#[tokio::test]
async fn saving_a_ladder_launches_nothing_and_its_board_says_not_run_yet() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong", "carom"], 2, &[SONNET])).await;
    assert!(jobs(&state).await.is_empty());
    let progress = board(&state, &id).await;
    assert!(progress.dispatch.is_none());
    assert!(progress.climbers.is_empty());
    assert_eq!(progress.rungs.len(), 2);
    // Nothing is running, so a pass has nothing to launch for.
    assert_eq!(
        pass(&state, &id).await.skipped,
        Some(LaunchSkipped::NotRunning)
    );
}

#[tokio::test]
async fn a_run_snapshots_the_configuration_and_launches_the_first_rung_under_the_dispatchs_origin()
{
    let (_dir, state) = test_state().await;
    price_opus(&state).await;
    let mut input = ladder_input(&["pong", "carom"], 2, &[SONNET, OPUS]);
    input.in_flight_limit = Some(InFlightLimit::Bounded { runs: 2 });
    let id = ladder_id(&state, input).await;

    let progress = run_ladder(&state, &id).await.unwrap();
    let dispatch = dispatch(&progress);
    assert_eq!(dispatch.status, DispatchStatus::Running);
    assert!(dispatch.ended_at.is_none());
    assert_eq!(dispatch.in_flight_limit, InFlightLimit::Bounded { runs: 2 });
    assert_eq!(dispatch.gate, Gate::default());

    // The limit holds the first pass to one climber's whole shortfall on rung one.
    let launched = jobs(&state).await;
    assert_eq!(launched.len(), 2);
    let rung_id = &progress.rungs[0].rung.id;
    for job in &launched {
        assert_eq!(job.test_case_slug, "pong");
        assert_eq!(
            job.origin.as_deref(),
            Some(format!("ladder:{id}/{}/{rung_id}", dispatch.id).as_str())
        );
        assert_eq!(job.user_id.as_deref(), Some(OWNER));
    }

    // Two climbers × two rungs, two runs each: eight runs, two in flight, none done.
    assert_eq!(
        dispatch.slots,
        SlotCounts {
            total: 4,
            running: 2,
            blocked: 0,
            passed: 0,
            failed: 0,
            pending: 2,
            skipped: 0,
        }
    );
    assert_eq!(
        dispatch.runs,
        DispatchRuns {
            total: 8,
            done: 0,
            in_flight: 2,
        }
    );
    assert_eq!(dispatch.climbers_running, 2);
}

#[tokio::test]
async fn validator_rated_runs_climb_the_dispatch_until_it_finishes_with_its_bar_full() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong", "carom"], 1, &[SONNET])).await;
    run_ladder(&state, &id).await.unwrap();
    let pong = in_flight(&state, "pong").await;
    assert_eq!(pong.len(), 1);
    assert!(in_flight(&state, "carom").await.is_empty());

    // Nobody reviews anything: the finished run itself runs a launch pass, the gate
    // passes the climber, and the next rung is launched.
    finish_and_feed(&state, &pong[0].id, "pong", GREAT).await;
    let carom = in_flight(&state, "carom").await;
    assert_eq!(carom.len(), 1);
    let progress = board(&state, &id).await;
    let standing = climber(&progress, SONNET);
    assert_eq!(standing.status, ClimberStatus::Running);
    assert_eq!(standing.current_rung, Some(1));
    assert_eq!(standing.slots[0].status, SlotStatus::Passed);
    assert!(standing.slots[0].decided_at.is_some());
    assert_eq!(
        standing.slots[0].run_ids,
        vec![format!("run-{}", pong[0].id)]
    );
    assert_eq!(standing.slots[1].job_ids, vec![carom[0].id.clone()]);
    assert_eq!(dispatch(&progress).runs.done, 1);

    // The last run finishing finishes the dispatch, and nothing is left to execute.
    finish_and_feed(&state, &carom[0].id, "carom", GREAT).await;
    let progress = board(&state, &id).await;
    let dispatch = dispatch(&progress);
    assert_eq!(dispatch.status, DispatchStatus::Finished);
    assert!(dispatch.ended_at.is_some());
    assert_eq!(dispatch.runs.done, dispatch.runs.total);
    assert_eq!(dispatch.runs.in_flight, 0);
    assert_eq!(dispatch.climbers_completed, 1);
    assert_eq!(climber(&progress, SONNET).status, ClimberStatus::Completed);
    assert_eq!(climber(&progress, SONNET).current_rung, None);
    assert_eq!(
        state
            .db
            .dispatch_outcomes(&dispatch.id)
            .await
            .unwrap()
            .len(),
        2
    );
}

#[tokio::test]
async fn a_failed_rung_fails_the_climber_and_skips_the_rungs_above_it() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(
        &state,
        ladder_input(&["pong", "carom", "volley"], 1, &[SONNET]),
    )
    .await;
    run_ladder(&state, &id).await.unwrap();
    let pong = in_flight(&state, "pong").await;
    finish_and_feed(&state, &pong[0].id, "pong", BROKEN).await;

    let progress = board(&state, &id).await;
    let standing = climber(&progress, SONNET);
    assert_eq!(standing.status, ClimberStatus::Failed);
    assert_eq!(standing.current_rung, Some(0));
    let statuses: Vec<SlotStatus> = standing.slots.iter().map(|slot| slot.status).collect();
    assert_eq!(
        statuses,
        vec![SlotStatus::Failed, SlotStatus::Skipped, SlotStatus::Skipped]
    );
    let dispatch = dispatch(&progress);
    assert_eq!(dispatch.status, DispatchStatus::Finished);
    assert_eq!((dispatch.slots.failed, dispatch.slots.skipped), (1, 2));
    // A skipped rung needs no executing, so it fills the bar.
    assert_eq!((dispatch.runs.done, dispatch.runs.total), (3, 3));
    assert!(in_flight(&state, "carom").await.is_empty());
}

#[tokio::test]
async fn a_run_refuses_a_ladder_it_cannot_climb() {
    let (_dir, state) = test_state().await;

    // A dispatch already running.
    let id = ladder_id(&state, ladder_input(&["pong"], 1, &[SONNET])).await;
    run_ladder(&state, &id).await.unwrap();
    let err = run_ladder(&state, &id).await.unwrap_err();
    assert_eq!(err.status, StatusCode::CONFLICT);
    assert_eq!(
        jobs(&state).await.len(),
        1,
        "the refused Run launched nothing"
    );

    // No climbers.
    let lonely = ladder_id(&state, ladder_input(&["pong"], 1, &[])).await;
    let err = run_ladder(&state, &lonely).await.unwrap_err();
    assert_eq!(err.status, StatusCode::BAD_REQUEST);
    assert!(err.message.contains("no climbers"), "{}", err.message);
    assert!(state.db.ladder_dispatch(&lonely).await.unwrap().is_none());

    // No rungs, and a legacy rung, stored as a ladder saved before either check existed.
    for (ladder, slugs) in [("empty", &[][..]), ("legacy", &["pong", "breakout"][..])] {
        let mut stored = ladder_from_input(
            ladder.to_string(),
            ladder_input(&["pong"], 1, &[SONNET]),
            "2026-10-01T00:00:00Z",
        )
        .unwrap();
        stored.rungs = slugs
            .iter()
            .enumerate()
            .map(|(n, slug)| StoredLadderRung {
                id: format!("{ladder}-{n}"),
                slug: slug.to_string(),
                version: "v1.0.0".to_string(),
                variant: "base".to_string(),
                engine: None,
                runs_override: None,
            })
            .collect();
        state.db.insert_ladder(OWNER, &stored).await.unwrap();
        let err = run_ladder(&state, ladder).await.unwrap_err();
        assert_eq!(err.status, StatusCode::BAD_REQUEST, "{ladder}");
        assert!(state.db.ladder_dispatch(ladder).await.unwrap().is_none());
    }
    let err = run_ladder(&state, "legacy").await.unwrap_err();
    assert!(
        err.message
            .contains("`breakout` v1.0.0 is a legacy case version"),
        "{}",
        err.message
    );

    // Somebody else's ladder is not found.
    let err = run_ladder(&state, "no-such-ladder").await.unwrap_err();
    assert_eq!(err.status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn a_rung_that_is_not_validator_rated_is_refused_when_the_ladder_is_saved() {
    let (_dir, state) = test_state().await;
    let err = create_ladder(&state, ladder_input(&["pong", "breakout"], 1, &[SONNET]))
        .await
        .expect_err("a legacy rung is refused");
    assert_eq!(err.status, StatusCode::BAD_REQUEST);
    assert!(err.message.contains("validator-rated"), "{}", err.message);
    for slug in ["perf", "jam"] {
        let err = create_ladder(&state, ladder_input(&[slug], 1, &[SONNET]))
            .await
            .expect_err("performance and game-jam rungs are refused");
        assert_eq!(err.status, StatusCode::BAD_REQUEST);
    }
}

// ---- A dispatch counts the runs that exist ------------------------------------

/// Store a run on the shared climber that no job of any dispatch produced, as a plan, a
/// hand launch or an earlier dispatch would have left it.
async fn existing_run(state: &AppState, record: RunRecord) {
    let manifest = state.store.read_manifest("pong", "v1.0.0").unwrap();
    state
        .db
        .push(&record, &links(), None, Some(&manifest))
        .await
        .unwrap();
}

/// The jobs a dispatch of the ladder launched: the ones whose origin names it.
async fn launched_by_ladder(state: &AppState, id: &str) -> Vec<job::Model> {
    jobs(state)
        .await
        .into_iter()
        .filter(|job| {
            job.origin
                .as_deref()
                .is_some_and(|origin| origin.starts_with(&format!("ladder:{id}/")))
        })
        .collect()
}

#[tokio::test]
async fn a_rung_existing_passing_runs_already_fill_launches_nothing_and_the_climber_advances() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong", "carom"], 1, &[SONNET])).await;
    // A great run of the very cell, launched by hand and finished before the Run.
    enqueue_other(&state, "hand", "pong", None).await;
    finish(&state, "hand", run_of("run-hand", "pong", GREAT)).await;

    let progress = run_ladder(&state, &id).await.unwrap();
    // The first pass decides pong on the run that exists, and launches carom in the
    // same pass.
    assert!(in_flight(&state, "pong").await.is_empty());
    let launched = launched_by_ladder(&state, &id).await;
    assert_eq!(launched.len(), 1);
    assert_eq!(launched[0].test_case_slug, "carom");
    let standing = climber(&progress, SONNET);
    assert_eq!(standing.status, ClimberStatus::Running);
    assert_eq!(standing.current_rung, Some(1));
    assert_eq!(standing.slots[0].status, SlotStatus::Passed);
    assert_eq!(standing.slots[0].run_ids, vec!["run-hand".to_string()]);
    assert!(standing.slots[0].job_ids.is_empty());
    let tally = standing.slots[0].tally.unwrap();
    assert_eq!((tally.counted, tally.passing, tally.in_flight), (1, 1, 0));
    // The run that was already there is done from the first pass.
    assert_eq!(
        dispatch(&progress).runs,
        DispatchRuns {
            total: 2,
            done: 1,
            in_flight: 1,
        }
    );
}

#[tokio::test]
async fn existing_failing_runs_stop_the_climber_with_nothing_launched() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong", "carom"], 2, &[SONNET])).await;
    existing_run(&state, run_of("run-a", "pong", BROKEN)).await;
    existing_run(&state, run_of("run-b", "pong", BROKEN)).await;

    let progress = run_ladder(&state, &id).await.unwrap();
    assert!(jobs(&state).await.is_empty());
    let standing = climber(&progress, SONNET);
    assert_eq!(standing.status, ClimberStatus::Failed);
    assert_eq!(standing.current_rung, Some(0));
    assert_eq!(standing.slots[0].status, SlotStatus::Failed);
    assert_eq!(standing.slots[1].status, SlotStatus::Skipped);
    let dispatch = dispatch(&progress);
    assert_eq!(dispatch.status, DispatchStatus::Finished);
    assert_eq!((dispatch.runs.done, dispatch.runs.total), (4, 4));
}

#[tokio::test]
async fn a_dispatch_decided_entirely_by_existing_runs_finishes_having_launched_nothing() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong", "carom"], 1, &[SONNET])).await;
    existing_run(&state, run_of("run-pong", "pong", GREAT)).await;
    existing_run(&state, run_of("run-carom", "carom", GREAT)).await;

    let progress = run_ladder(&state, &id).await.unwrap();
    assert!(jobs(&state).await.is_empty());
    let standing = climber(&progress, SONNET);
    assert_eq!(standing.status, ClimberStatus::Completed);
    assert_eq!(standing.slots[0].run_ids, vec!["run-pong".to_string()]);
    assert_eq!(standing.slots[1].run_ids, vec!["run-carom".to_string()]);
    let finished = dispatch(&progress);
    assert_eq!(finished.status, DispatchStatus::Finished);
    assert!(finished.ended_at.is_some());
    assert_eq!(
        finished.runs,
        DispatchRuns {
            total: 2,
            done: 2,
            in_flight: 0,
        }
    );
    assert_eq!(finished.slots.passed, 2);
    // Both verdicts are recorded, as a climb that launched its runs records them.
    assert_eq!(
        state
            .db
            .dispatch_outcomes(&finished.id)
            .await
            .unwrap()
            .len(),
        2
    );
    // The ladders list counts the inherited runs the same way.
    let Json(list) = summary(State(state.clone()), owner()).await.unwrap();
    let listed = list[0].dispatch.as_ref().unwrap();
    assert_eq!(listed.status, DispatchStatus::Finished);
    assert_eq!((listed.runs.done, listed.runs.total), (2, 2));
    assert_eq!(listed.slots.passed, 2);
}

#[tokio::test]
async fn a_rung_with_some_existing_runs_launches_only_the_remainder() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong"], 3, &[SONNET])).await;
    // One run launched by hand and one a plan launched, whoever and whenever.
    for (job_id, origin) in [("hand", None), ("planned", Some("plan:p1"))] {
        enqueue_other(&state, job_id, "pong", origin).await;
        finish(
            &state,
            job_id,
            run_of(&format!("run-{job_id}"), "pong", GREAT),
        )
        .await;
    }

    let progress = run_ladder(&state, &id).await.unwrap();
    let launched = launched_by_ladder(&state, &id).await;
    assert_eq!(launched.len(), 1, "the rung was missing one run of three");
    let standing = climber(&progress, SONNET);
    assert_eq!(standing.status, ClimberStatus::Running);
    let tally = standing.slots[0].tally.unwrap();
    assert_eq!((tally.counted, tally.in_flight, tally.pending), (2, 1, 1));
    assert_eq!(
        standing.slots[0].run_ids,
        vec!["run-hand".to_string(), "run-planned".to_string()]
    );
    assert_eq!(
        dispatch(&progress).runs,
        DispatchRuns {
            total: 3,
            done: 2,
            in_flight: 1,
        }
    );

    // Its own run lands beside them and the three decide the rung.
    finish_and_feed(&state, &launched[0].id, "pong", GREAT).await;
    let progress = board(&state, &id).await;
    assert_eq!(dispatch(&progress).status, DispatchStatus::Finished);
    assert_eq!(climber(&progress, SONNET).slots[0].run_ids.len(), 3);
    assert_eq!(launched_by_ladder(&state, &id).await.len(), 1);
}

#[tokio::test]
async fn a_slot_takes_only_the_first_runs_up_to_its_target() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong"], 2, &[SONNET])).await;
    // Three runs exist. The two that finished first are broken, the latest is great.
    for (run_id, at, verdicts) in [
        ("run-1", "2026-09-01T00:00:01Z", BROKEN),
        ("run-2", "2026-09-01T00:00:02Z", BROKEN),
        ("run-3", "2026-09-01T00:00:03Z", GREAT),
    ] {
        let mut record = run_of(run_id, "pong", verdicts);
        record.finished_at = at.to_string();
        existing_run(&state, record).await;
    }

    let progress = run_ladder(&state, &id).await.unwrap();
    assert!(jobs(&state).await.is_empty());
    let standing = climber(&progress, SONNET);
    // The run beyond the target is not the slot's, as it is not a plan cell's.
    assert_eq!(
        standing.slots[0].run_ids,
        vec!["run-1".to_string(), "run-2".to_string()]
    );
    assert_eq!(standing.slots[0].status, SlotStatus::Failed);
}

#[tokio::test]
async fn a_job_someone_else_has_in_flight_for_the_cell_holds_the_slots_launch() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong"], 1, &[SONNET])).await;
    enqueue_other(&state, "hand", "pong", None).await;

    let progress = run_ladder(&state, &id).await.unwrap();
    // The dispatch launches nothing on top of the queued run, and waits for it.
    assert!(launched_by_ladder(&state, &id).await.is_empty());
    assert_eq!(pass(&state, &id).await.enqueued, 0);
    let standing = climber(&progress, SONNET);
    assert_eq!(standing.status, ClimberStatus::Running);
    let tally = standing.slots[0].tally.unwrap();
    assert_eq!((tally.counted, tally.in_flight), (0, 1));
    assert!(standing.slots[0].job_ids.is_empty());
    // The job is not the dispatch's, so it is not under its limit.
    assert_eq!(dispatch(&progress).runs.in_flight, 0);
    assert_eq!(dispatch(&progress).status, DispatchStatus::Running);

    // Its run finishing feeds the dispatch, which decides the rung on it.
    finish_and_feed(&state, "hand", "pong", GREAT).await;
    let progress = board(&state, &id).await;
    assert_eq!(dispatch(&progress).status, DispatchStatus::Finished);
    assert_eq!(climber(&progress, SONNET).status, ClimberStatus::Completed);
    assert!(launched_by_ladder(&state, &id).await.is_empty());
}

#[tokio::test]
async fn a_held_slot_is_launched_once_the_other_job_is_cancelled() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong"], 1, &[SONNET])).await;
    enqueue_other(&state, "hand", "pong", None).await;
    run_ladder(&state, &id).await.unwrap();
    assert!(launched_by_ladder(&state, &id).await.is_empty());

    // The job that held the slot is cancelled: the cell is missing again, and the
    // cancel feeds the dispatch that was waiting on it.
    set_state(&state, "hand", "canceled").await;
    let canceled = state.db.get_job("hand").await.unwrap().unwrap();
    crate::api::launch::feed_canceled_jobs(&state, &[canceled]).await;
    assert_eq!(launched_by_ladder(&state, &id).await.len(), 1);
}

#[tokio::test]
async fn runs_of_another_version_variant_engine_harness_or_model_do_not_count() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong"], 1, &[SONNET])).await;
    let mut version = run_of("run-version", "pong", GREAT);
    version.subject.test_case_version = "v1.1.0".to_string();
    let mut variant = run_of("run-variant", "pong", GREAT);
    variant.subject.variant = "hard".to_string();
    let mut engine = run_of("run-engine", "pong", GREAT);
    engine.subject.engine_slug = "ember".to_string();
    let mut model = run_of("run-model", "pong", GREAT);
    model.subject.model_id = OPUS.to_string();
    let mut harness = run_of("run-harness", "pong", GREAT);
    harness.subject.harness_slug = HarnessSlug::Codex;
    for record in [version, variant, engine, model, harness] {
        existing_run(&state, record).await;
    }
    existing_run(&state, run_of("run-carom", "carom", GREAT)).await;

    let progress = run_ladder(&state, &id).await.unwrap();
    // None of them is a run of the rung's cell, so the rung launches its own.
    assert_eq!(launched_by_ladder(&state, &id).await.len(), 1);
    let standing = climber(&progress, SONNET);
    assert_eq!(standing.status, ClimberStatus::Running);
    assert!(standing.slots[0].run_ids.is_empty());
    let tally = standing.slots[0].tally.unwrap();
    assert_eq!((tally.counted, tally.in_flight), (0, 1));
    assert_eq!(dispatch(&progress).runs.done, 0);
}

#[tokio::test]
async fn a_rung_the_climber_has_not_reached_reads_no_runs() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong", "carom"], 1, &[SONNET])).await;
    existing_run(&state, run_of("run-carom", "carom", GREAT)).await;

    let progress = run_ladder(&state, &id).await.unwrap();
    let pong = in_flight(&state, "pong").await;
    assert_eq!(pong.len(), 1);
    let standing = climber(&progress, SONNET);
    assert_eq!(standing.slots[1].status, SlotStatus::Pending);
    assert!(standing.slots[1].run_ids.is_empty());
    assert!(standing.slots[1].tally.is_none());
    assert_eq!(dispatch(&progress).runs.done, 0);
    assert_eq!(progress.runs_unreviewed, 0);

    // Reaching it reads the run that was there all along, and nothing is launched.
    finish_and_feed(&state, &pong[0].id, "pong", GREAT).await;
    let progress = board(&state, &id).await;
    assert_eq!(dispatch(&progress).status, DispatchStatus::Finished);
    assert_eq!(
        climber(&progress, SONNET).slots[1].run_ids,
        vec!["run-carom".to_string()]
    );
    assert!(in_flight(&state, "carom").await.is_empty());

    // A climber that fails below it never reads it.
    let failing = ladder_id(&state, ladder_input(&["volley", "carom"], 1, &[SONNET])).await;
    existing_run(&state, run_of("run-volley", "volley", BROKEN)).await;
    let progress = run_ladder(&state, &failing).await.unwrap();
    let standing = climber(&progress, SONNET);
    assert_eq!(standing.status, ClimberStatus::Failed);
    assert_eq!(standing.slots[1].status, SlotStatus::Skipped);
    assert!(standing.slots[1].run_ids.is_empty());
}

#[tokio::test]
async fn an_existing_run_stored_without_its_rating_is_rated_when_the_gate_reads_it() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong"], 1, &[SONNET])).await;
    // Pushed by another launch while the store lacked the version: no rating, though
    // validator-rated.
    existing_run(&state, run_of("run-late", "pong", GREAT)).await;
    test_cabinet_entities::run::Entity::update_many()
        .col_expr(
            test_cabinet_entities::run::Column::ValidatorRating,
            sea_orm::sea_query::Expr::value(None::<String>),
        )
        .exec(&state.db.connection())
        .await
        .unwrap();

    let progress = run_ladder(&state, &id).await.unwrap();
    assert!(jobs(&state).await.is_empty());
    assert_eq!(
        climber(&progress, SONNET).slots[0].status,
        SlotStatus::Passed
    );
    assert_eq!(dispatch(&progress).status, DispatchStatus::Finished);
}

#[tokio::test]
async fn an_existing_run_nothing_can_rate_blocks_the_rung_as_unrated() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong"], 1, &[SONNET])).await;
    // Pushed with no manifest at all, so it is not validator-rated and never will be.
    state
        .db
        .push(&run_of("run-unrated", "pong", GREAT), &links(), None, None)
        .await
        .unwrap();

    let progress = run_ladder(&state, &id).await.unwrap();
    assert!(jobs(&state).await.is_empty());
    let standing = climber(&progress, SONNET);
    assert_eq!(standing.status, ClimberStatus::Blocked);
    assert_eq!(standing.blocked, Some(ClimberBlock::Unrated { runs: 1 }));
    assert_eq!(dispatch(&progress).status, DispatchStatus::Running);
}

#[tokio::test]
async fn two_rungs_pinning_one_case_read_the_same_runs() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong", "pong"], 1, &[SONNET])).await;
    run_ladder(&state, &id).await.unwrap();
    let first = in_flight(&state, "pong").await;
    assert_eq!(first.len(), 1);
    finish_and_feed(&state, &first[0].id, "pong", GREAT).await;

    // The one run passes both rungs: the second is the same cell, and launches nothing.
    assert!(in_flight(&state, "pong").await.is_empty());
    assert_eq!(jobs(&state).await.len(), 1);
    let progress = board(&state, &id).await;
    let standing = climber(&progress, SONNET);
    assert_eq!(standing.status, ClimberStatus::Completed);
    assert_eq!(standing.slots[0].status, SlotStatus::Passed);
    assert_eq!(standing.slots[1].status, SlotStatus::Passed);
    assert_eq!(standing.slots[0].run_ids, standing.slots[1].run_ids);
    assert_eq!(dispatch(&progress).status, DispatchStatus::Finished);
    // The shared run is one run to review, listed once, under the lower rung.
    assert_eq!(progress.runs_unreviewed, 1);
    let Json(listed) = queue(State(state.clone()), owner(), Path(id.clone()))
        .await
        .unwrap();
    assert_eq!(listed.runs.len(), 1);
    assert_eq!(
        listed.runs[0].rung_id,
        Some(progress.rungs[0].rung.id.clone())
    );
}

#[tokio::test]
async fn running_a_ladder_again_reads_the_same_runs_and_launches_only_what_is_missing() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong"], 1, &[SONNET])).await;
    let first = dispatch(&run_ladder(&state, &id).await.unwrap()).id.clone();
    let pong = in_flight(&state, "pong").await;
    finish_and_feed(&state, &pong[0].id, "pong", GREAT).await;
    assert_eq!(
        dispatch(&board(&state, &id).await).status,
        DispatchStatus::Finished
    );

    // The second Run reads the first one's run and reaches the same standing with
    // nothing launched.
    let progress = run_ladder(&state, &id).await.unwrap();
    let second = dispatch(&progress);
    assert_ne!(second.id, first);
    assert_eq!(second.status, DispatchStatus::Finished);
    // The earlier dispatch's verdict is gone with it, and the new one recorded its own.
    assert!(state.db.dispatch_outcomes(&first).await.unwrap().is_empty());
    assert_eq!(
        state.db.dispatch_outcomes(&second.id).await.unwrap().len(),
        1
    );
    let standing = climber(&progress, SONNET);
    assert_eq!(standing.slots[0].status, SlotStatus::Passed);
    assert_eq!(
        standing.slots[0].run_ids,
        vec![format!("run-{}", pong[0].id)]
    );
    assert_eq!(jobs(&state).await.len(), 1);

    // Raising the target is what makes a Run launch again, and only the difference.
    let _ = update(
        State(state.clone()),
        owner(),
        Path(id.clone()),
        Json(ladder_input(&["pong"], 3, &[SONNET])),
    )
    .await
    .unwrap();
    let progress = run_ladder(&state, &id).await.unwrap();
    assert_eq!(dispatch(&progress).status, DispatchStatus::Running);
    assert_eq!(in_flight(&state, "pong").await.len(), 2);
    assert_eq!(
        climber(&progress, SONNET).slots[0].tally.unwrap().counted,
        1
    );
}

#[tokio::test]
async fn editing_the_configuration_never_touches_a_running_dispatch() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong", "carom"], 1, &[SONNET])).await;
    run_ladder(&state, &id).await.unwrap();

    // Add a rung, triple the runs, and change the gate, mid-dispatch.
    let mut edit = ladder_input(&["pong", "carom", "volley"], 3, &[SONNET]);
    edit.gate = Some(Gate {
        early_stop: true,
        threshold: GateThreshold::Count { runs: 2 },
        ..Gate::default()
    });
    let _ = update(State(state.clone()), owner(), Path(id.clone()), Json(edit))
        .await
        .unwrap();

    let progress = board(&state, &id).await;
    assert_eq!(progress.rungs.len(), 2);
    assert_eq!(dispatch(&progress).gate, Gate::default());
    assert_eq!(dispatch(&progress).runs.total, 2);
    assert_eq!(
        pass(&state, &id).await.enqueued,
        0,
        "the edit launched nothing"
    );

    // The dispatch climbs as it was run: one run decides pong, one carom run follows.
    let pong = in_flight(&state, "pong").await;
    assert_eq!(pong.len(), 1);
    finish_and_feed(&state, &pong[0].id, "pong", GREAT).await;
    assert_eq!(in_flight(&state, "carom").await.len(), 1);
    let carom = in_flight(&state, "carom").await;
    finish_and_feed(&state, &carom[0].id, "carom", GREAT).await;
    assert!(in_flight(&state, "volley").await.is_empty());
    assert_eq!(
        dispatch(&board(&state, &id).await).status,
        DispatchStatus::Finished
    );

    // The next Run takes the edit, and launches what the raised target is missing beside
    // the run pong already has.
    let progress = run_ladder(&state, &id).await.unwrap();
    assert_eq!(progress.rungs.len(), 3);
    assert_eq!(dispatch(&progress).runs.total, 9);
    assert_eq!(in_flight(&state, "pong").await.len(), 2);
}

// ---- Stop --------------------------------------------------------------------

#[tokio::test]
async fn stopping_cancels_only_the_dispatchs_waiting_jobs_and_skips_what_is_left() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong", "carom"], 2, &[SONNET])).await;
    let other = ladder_id(&state, ladder_input(&["volley"], 1, &[SONNET])).await;
    run_ladder(&state, &id).await.unwrap();
    run_ladder(&state, &other).await.unwrap();
    enqueue_other(&state, "planned", "pong", Some("plan:p1")).await;
    let pong: Vec<job::Model> = in_flight(&state, "pong")
        .await
        .into_iter()
        .filter(|job| job.id != "planned")
        .collect();
    assert_eq!(pong.len(), 2);
    set_state(&state, &pong[0].id, "running").await;

    let halted = stop_ladder(&state, &id, false).await.unwrap();
    assert_eq!(halted.canceled, 1);
    assert!(!halted.included_active);
    let after = in_flight(&state, "pong").await;
    let mut ids: Vec<&str> = after.iter().map(|job| job.id.as_str()).collect();
    ids.sort_unstable();
    let mut expected = vec![pong[0].id.as_str(), "planned"];
    expected.sort_unstable();
    assert_eq!(ids, expected, "the running job and the plan's job survive");
    assert_eq!(
        in_flight(&state, "volley").await.len(),
        1,
        "another ladder's job survives"
    );

    let progress = board(&state, &id).await;
    let dispatch_now = dispatch(&progress);
    assert_eq!(dispatch_now.status, DispatchStatus::Stopped);
    assert!(dispatch_now.ended_at.is_some());
    assert_eq!(dispatch_now.slots.skipped, 2);
    assert_eq!(dispatch_now.slots.running, 0);
    // The stopped slots are done but for the run still in flight.
    assert_eq!(
        (
            dispatch_now.runs.done,
            dispatch_now.runs.total,
            dispatch_now.runs.in_flight
        ),
        (3, 4, 1)
    );

    // Nothing more launches: not a pass, and not the remaining run finishing.
    assert_eq!(
        pass(&state, &id).await.skipped,
        Some(LaunchSkipped::NotRunning)
    );
    finish_and_feed(&state, &pong[0].id, "pong", GREAT).await;
    assert!(in_flight(&state, "carom").await.is_empty());
    let progress = board(&state, &id).await;
    assert_eq!(dispatch(&progress).runs.done, 4);
    assert_eq!(
        climber(&progress, SONNET).slots[0].status,
        SlotStatus::Skipped
    );

    // There is nothing left to stop.
    let err = stop_ladder(&state, &id, false).await.unwrap_err();
    assert_eq!(err.status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn stopping_with_cancel_running_also_cancels_the_started_jobs() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong"], 2, &[SONNET])).await;
    run_ladder(&state, &id).await.unwrap();
    let pong = in_flight(&state, "pong").await;
    set_state(&state, &pong[0].id, "running").await;
    let halted = stop_ladder(&state, &id, true).await.unwrap();
    assert_eq!(halted.canceled, 2);
    assert!(halted.included_active);
    assert!(in_flight(&state, "pong").await.is_empty());
    let progress = board(&state, &id).await;
    assert_eq!(
        dispatch(&progress).runs.done,
        dispatch(&progress).runs.total
    );
}

#[tokio::test]
async fn a_pass_that_finds_the_dispatch_stopped_enqueues_nothing() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong"], 1, &[SONNET])).await;
    run_ladder(&state, &id).await.unwrap();
    // Free the rung's room, so a pass would launch.
    let pong = in_flight(&state, "pong").await;
    set_state(&state, &pong[0].id, "canceled").await;

    // A pass holds the claim when the stop lands: the stop does not wait for it.
    assert!(
        state
            .db
            .claim_ladder_launch(OWNER, &id, &now().unwrap())
            .await
            .unwrap()
    );
    stop_ladder(&state, &id, false).await.unwrap();
    let result = ladder_pass_locked(&state, OWNER, &id).await.unwrap();
    state.db.release_ladder_launch(&id).await.unwrap();
    assert_eq!(result.skipped, Some(LaunchSkipped::NotRunning));
    assert!(in_flight(&state, "pong").await.is_empty());
}

#[tokio::test]
async fn a_claim_holder_serving_a_new_dispatch_launches_it_under_its_own_limit() {
    let (_dir, state) = test_state().await;
    price_opus(&state).await;
    let mut input = ladder_input(&["pong"], 1, &[SONNET, OPUS]);
    input.in_flight_limit = Some(InFlightLimit::Unbounded);
    let id = ladder_id(&state, input).await;
    run_ladder(&state, &id).await.unwrap();
    assert_eq!(in_flight(&state, "pong").await.len(), 2);

    // A pass of the first dispatch holds the claim while the owner stops it, lowers the
    // limit and runs the ladder again: the new Run's pass finds the claim busy.
    assert!(
        state
            .db
            .claim_ladder_launch(OWNER, &id, &now().unwrap())
            .await
            .unwrap()
    );
    stop_ladder(&state, &id, true).await.unwrap();
    let mut edit = ladder_input(&["pong"], 1, &[SONNET, OPUS]);
    edit.in_flight_limit = Some(InFlightLimit::Bounded { runs: 1 });
    let _ = update(State(state.clone()), owner(), Path(id.clone()), Json(edit))
        .await
        .unwrap();
    run_ladder(&state, &id).await.unwrap();
    assert!(in_flight(&state, "pong").await.is_empty());

    // The holder serves the request under the new dispatch's limit, not the old one.
    let result = ladder_pass_locked(&state, OWNER, &id).await.unwrap();
    state.db.release_ladder_launch(&id).await.unwrap();
    assert_eq!(result.in_flight_limit, InFlightLimit::Bounded { runs: 1 });
    assert_eq!(result.enqueued, 1);
    assert_eq!(in_flight(&state, "pong").await.len(), 1);
}

#[tokio::test]
async fn a_retry_is_withheld_once_its_dispatch_has_ended() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong"], 1, &[SONNET])).await;
    run_ladder(&state, &id).await.unwrap();
    let attempt = in_flight(&state, "pong").await[0].id.clone();
    set_state(&state, &attempt, "running").await;
    stop_ladder(&state, &id, false).await.unwrap();
    // A new Run replaces the stopped dispatch while the old attempt is still running.
    run_ladder(&state, &id).await.unwrap();
    let before = jobs(&state).await.len();

    // The old attempt ends catastrophic, which would be retried: its dispatch has ended.
    report(
        &state,
        &attempt,
        ended_run("run-old", "pong", RunState::Catastrophic),
    )
    .await;
    let job = state.db.get_job(&attempt).await.unwrap().unwrap();
    assert!(
        job.retried_by.is_none(),
        "an ended dispatch's run is not retried"
    );
    assert_eq!(jobs(&state).await.len(), before);
    // Its run is the cell's all the same, so the new dispatch counts it like any other
    // run of the cell: the model's own failure, which fails the rung.
    let progress = board(&state, &id).await;
    let standing = climber(&progress, SONNET);
    assert_eq!(standing.slots[0].run_ids, vec!["run-old".to_string()]);
    assert_eq!(standing.slots[0].status, SlotStatus::Failed);
}

#[tokio::test]
async fn a_retried_model_failure_waits_for_its_retry_and_counts_once() {
    let (_dir, state) = test_state().await;
    let mut input = ladder_input(&["pong", "carom"], 1, &[SONNET]);
    input.gate = Some(Gate {
        early_stop: true,
        ..Gate::default()
    });
    let id = ladder_id(&state, input).await;
    run_ladder(&state, &id).await.unwrap();
    let attempt = in_flight(&state, "pong").await[0].clone();

    // The attempt ends catastrophic, and the backend retries it with the same origin.
    report(
        &state,
        &attempt.id,
        ended_run("run-attempt", "pong", RunState::Catastrophic),
    )
    .await;
    let retry_id = state
        .db
        .get_job(&attempt.id)
        .await
        .unwrap()
        .unwrap()
        .retried_by
        .expect("the attempt was retried");
    let retry_job = state.db.get_job(&retry_id).await.unwrap().unwrap();
    assert_eq!(retry_job.origin, attempt.origin);

    // The retry takes the attempt's place: the rung is undecided and nothing else is
    // launched.
    let again = pass(&state, &id).await;
    assert_eq!((again.enqueued, again.early_stop_canceled), (0, 0));
    let progress = board(&state, &id).await;
    let standing = climber(&progress, SONNET);
    assert_eq!(standing.status, ClimberStatus::Running);
    let tally = standing.slots[0].tally.unwrap();
    assert_eq!((tally.counted, tally.in_flight, tally.pending), (0, 1, 1));

    // The retry passes: one run, and the climber advances.
    let job = finish(&state, &retry_id, run_of("run-retry", "pong", GREAT)).await;
    feed(&state, &job).await;
    let progress = board(&state, &id).await;
    let standing = climber(&progress, SONNET);
    assert_eq!(standing.slots[0].status, SlotStatus::Passed);
    assert_eq!(standing.slots[0].run_ids, vec!["run-retry".to_string()]);
    assert_eq!(in_flight(&state, "carom").await.len(), 1);
}

// ---- The gate and runs still in flight ---------------------------------------

/// A slot holds the first `target` runs of its cell, as a plan's cell does: a second run
/// in flight beside the one the rung asked for would land beyond the target, so it is
/// not the slot's. It neither holds the rung undecided nor changes the verdict when it
/// lands, and the dispatch only waits for it to finish.
#[tokio::test]
async fn a_run_in_flight_beyond_the_target_is_not_the_slots_and_never_moves_its_verdict() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong", "carom"], 1, &[SONNET])).await;
    run_ladder(&state, &id).await.unwrap();
    let first = in_flight(&state, "pong").await[0].clone();
    duplicate(&state, &first, "second").await;

    finish_and_feed(&state, &first.id, "pong", BROKEN).await;
    let progress = board(&state, &id).await;
    let standing = climber(&progress, SONNET);
    assert_eq!(standing.status, ClimberStatus::Failed);
    let tally = standing.slots[0].tally.unwrap();
    assert_eq!(
        (
            tally.counted,
            tally.passing,
            tally.in_flight,
            tally.pending,
            tally.required
        ),
        (1, 0, 0, 0, 1)
    );
    assert!(in_flight(&state, "carom").await.is_empty());
    let dispatch_id = dispatch(&progress).id.clone();
    let outcomes = state.db.dispatch_outcomes(&dispatch_id).await.unwrap();
    assert_eq!(outcomes.len(), 1);
    assert_eq!(outcomes[0].outcome, LadderOutcomeKind::Failed);
    // The dispatch still has a job of its own in flight, so it has not finished.
    assert_eq!(dispatch(&progress).status, DispatchStatus::Running);
    assert_eq!(dispatch(&progress).runs.in_flight, 1);

    // The second lands beyond the target: the verdict stands and the dispatch finishes.
    finish_and_feed(&state, "second", "pong", GREAT).await;
    let progress = board(&state, &id).await;
    let standing = climber(&progress, SONNET);
    assert_eq!(standing.slots[0].status, SlotStatus::Failed);
    assert_eq!(standing.slots[0].run_ids, vec![format!("run-{}", first.id)]);
    assert!(in_flight(&state, "carom").await.is_empty());
    assert_eq!(dispatch(&progress).status, DispatchStatus::Finished);
}

#[tokio::test]
async fn without_early_stop_a_rung_waits_for_every_run_it_started() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong", "carom"], 2, &[SONNET])).await;
    run_ladder(&state, &id).await.unwrap();
    let pong = in_flight(&state, "pong").await;
    // One great run already clears a one-run bar, but the rung waits for its other run.
    finish_and_feed(&state, &pong[0].id, "pong", GREAT).await;
    let progress = board(&state, &id).await;
    assert_eq!(
        climber(&progress, SONNET).slots[0].status,
        SlotStatus::Running
    );
    assert!(in_flight(&state, "carom").await.is_empty());
    finish_and_feed(&state, &pong[1].id, "pong", BROKEN).await;
    let progress = board(&state, &id).await;
    assert_eq!(
        climber(&progress, SONNET).slots[0].status,
        SlotStatus::Passed
    );
    assert_eq!(in_flight(&state, "carom").await.len(), 2);
}

#[tokio::test]
async fn early_stop_decides_with_runs_in_flight_and_cancels_only_the_waiting_ones() {
    let (_dir, state) = test_state().await;
    let mut input = ladder_input(&["pong", "carom"], 3, &[SONNET]);
    input.gate = Some(Gate {
        early_stop: true,
        ..Gate::default()
    });
    input.in_flight_limit = Some(InFlightLimit::Unbounded);
    let id = ladder_id(&state, input).await;
    run_ladder(&state, &id).await.unwrap();
    let pong = in_flight(&state, "pong").await;
    assert_eq!(pong.len(), 3);
    set_state(&state, &pong[1].id, "running").await;

    // One great run decides the rung: the waiting run is cancelled, the running one is
    // left to finish, and the next rung launches.
    let job = finish(&state, &pong[0].id, run_of("run-0", "pong", GREAT)).await;
    let result = launch_ladder(&state, OWNER, &id).await.unwrap();
    assert_eq!(result.early_stop_canceled, 1);
    assert_eq!(result.enqueued, 3);
    feed(&state, &job).await;
    let left: Vec<String> = in_flight(&state, "pong")
        .await
        .into_iter()
        .map(|job| job.id)
        .collect();
    assert_eq!(left, vec![pong[1].id.clone()]);
    assert_eq!(in_flight(&state, "carom").await.len(), 3);

    let progress = board(&state, &id).await;
    let standing = climber(&progress, SONNET);
    assert_eq!(standing.slots[0].status, SlotStatus::Passed);
    let dispatch_now = dispatch(&progress);
    // Pong is done but for its run still in flight; carom has done nothing yet.
    assert_eq!(dispatch_now.runs.done, 2);
    assert_eq!(dispatch_now.runs.in_flight, 4);

    // The running run finishing completes pong's share of the bar, and changes no verdict.
    finish_and_feed(&state, &pong[1].id, "pong", BROKEN).await;
    let progress = board(&state, &id).await;
    assert_eq!(
        climber(&progress, SONNET).slots[0].status,
        SlotStatus::Passed
    );
    assert_eq!(dispatch(&progress).runs.done, 3);
}

#[tokio::test]
async fn early_stop_fails_a_rung_once_its_runs_in_flight_cannot_reach_the_bar() {
    let (_dir, state) = test_state().await;
    let mut input = ladder_input(&["pong", "carom"], 3, &[SONNET]);
    input.gate = Some(Gate {
        early_stop: true,
        threshold: GateThreshold::Count { runs: 3 },
        ..Gate::default()
    });
    let id = ladder_id(&state, input).await;
    run_ladder(&state, &id).await.unwrap();
    let pong = in_flight(&state, "pong").await;
    finish_and_feed(&state, &pong[0].id, "pong", BROKEN).await;
    // Three passing runs of three are now out of reach.
    let progress = board(&state, &id).await;
    let standing = climber(&progress, SONNET);
    assert_eq!(standing.status, ClimberStatus::Failed);
    assert!(
        in_flight(&state, "pong").await.is_empty(),
        "the waiting runs were cancelled"
    );
    assert_eq!(dispatch(&progress).status, DispatchStatus::Finished);
}

#[tokio::test]
async fn model_failures_fill_a_rung_and_fail_it_instead_of_relaunching() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong", "carom"], 2, &[SONNET])).await;
    run_ladder(&state, &id).await.unwrap();
    let pong = in_flight(&state, "pong").await;

    let job = finish(
        &state,
        &pong[0].id,
        ended_run("run-0", "pong", RunState::TimedOut),
    )
    .await;
    feed(&state, &job).await;
    assert_eq!(
        in_flight(&state, "pong").await.len(),
        1,
        "nothing is relaunched"
    );
    let progress = board(&state, &id).await;
    let tally = climber(&progress, SONNET).slots[0].tally.unwrap();
    assert_eq!((tally.counted, tally.rated), (1, 1));

    let job = finish(
        &state,
        &pong[1].id,
        ended_run("run-1", "pong", RunState::LimitExceeded),
    )
    .await;
    feed(&state, &job).await;
    let progress = board(&state, &id).await;
    assert_eq!(climber(&progress, SONNET).status, ClimberStatus::Failed);
    assert_eq!(jobs(&state).await.len(), 2, "the rung was never relaunched");
}

#[tokio::test]
async fn a_catastrophic_run_is_broken_even_when_unloaded_builds_are_not() {
    let (_dir, state) = test_state().await;
    let mut input = ladder_input(&["pong", "carom"], 1, &[SONNET]);
    input.gate = Some(Gate {
        unloaded_counts_as_broken: false,
        ..Gate::default()
    });
    let id = ladder_id(&state, input).await;
    run_ladder(&state, &id).await.unwrap();
    let pong = in_flight(&state, "pong").await;
    let job = finish(
        &state,
        &pong[0].id,
        ended_run("run-0", "pong", RunState::Catastrophic),
    )
    .await;
    feed(&state, &job).await;
    let progress = board(&state, &id).await;
    assert_eq!(climber(&progress, SONNET).status, ClimberStatus::Failed);
}

// ---- Blocked climbers ----------------------------------------------------------

#[tokio::test]
async fn harness_errors_block_a_rung_as_failing_and_never_fail_it_until_a_retry() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong"], 1, &[SONNET])).await;
    run_ladder(&state, &id).await.unwrap();

    // Three attempts end harness_error (retries exhausted): each is relaunched until the
    // third, which marks the slot failing.
    for n in 0..3 {
        let pong = in_flight(&state, "pong").await;
        assert_eq!(pong.len(), 1, "attempt {n}");
        let job = finish(
            &state,
            &pong[0].id,
            ended_run(&format!("run-{n}"), "pong", RunState::HarnessError),
        )
        .await;
        feed(&state, &job).await;
    }
    assert!(in_flight(&state, "pong").await.is_empty());
    let progress = board(&state, &id).await;
    let standing = climber(&progress, SONNET);
    assert_eq!(standing.status, ClimberStatus::Blocked);
    assert_eq!(
        standing.blocked,
        Some(ClimberBlock::Failing { attempts: 3 })
    );
    assert_eq!(standing.slots[0].status, SlotStatus::Blocked);
    assert_eq!(standing.slots[0].tally.unwrap().counted, 0);
    assert_eq!(dispatch(&progress).status, DispatchStatus::Running);
    let result = pass(&state, &id).await;
    assert_eq!(result.enqueued, 0);
    assert!(
        result.unlaunchable[0].reason.contains("retry"),
        "{:?}",
        result.unlaunchable
    );

    // A retry starts the streak afresh and relaunches the rung.
    assert_eq!(
        retry(&state, &id, SONNET).await.unwrap(),
        StatusCode::NO_CONTENT
    );
    wait_for_in_flight(&state, "pong", 1).await;
    let progress = board(&state, &id).await;
    assert_eq!(climber(&progress, SONNET).status, ClimberStatus::Running);
    // A running climber has nothing to retry.
    let err = retry(&state, &id, SONNET).await.unwrap_err();
    assert_eq!(err.status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn a_canceled_job_is_not_an_infrastructure_failure() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong"], 1, &[SONNET])).await;
    run_ladder(&state, &id).await.unwrap();
    for _ in 0..3 {
        let pong = in_flight(&state, "pong").await;
        set_state(&state, &pong[0].id, "canceled").await;
        pass(&state, &id).await;
    }
    assert_eq!(in_flight(&state, "pong").await.len(), 1);
    assert_eq!(
        climber(&board(&state, &id).await, SONNET).status,
        ClimberStatus::Running
    );
}

#[tokio::test]
async fn retrying_needs_a_running_dispatch_and_one_of_its_climbers() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong"], 1, &[SONNET])).await;
    let err = retry(&state, &id, SONNET).await.unwrap_err();
    assert_eq!(err.status, StatusCode::CONFLICT, "not run yet");
    run_ladder(&state, &id).await.unwrap();
    let err = retry(&state, &id, OPUS).await.unwrap_err();
    assert_eq!(err.status, StatusCode::NOT_FOUND);
    let err = retry(&state, "no-such-ladder", SONNET).await.unwrap_err();
    assert_eq!(err.status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn a_climber_that_cannot_launch_is_blocked_and_the_dispatch_keeps_running() {
    let (_dir, state) = test_state().await;
    // A gg climber whose configuration was deleted after the ladder was saved.
    let gone = ReviewPlanCombo {
        harness: HarnessSlug::Gg,
        model: String::new(),
        provider: None,
        gg_config_id: Some("saved:gone".to_string()),
        gg_slot_models: BTreeMap::from([("primary".to_string(), SONNET.to_string())]),
        gg_config_name: None,
    };
    let mut input = ladder_input(&["pong"], 1, &[SONNET]);
    input.combos.push(gone.clone());
    let stored = ladder_from_input("gone".to_string(), input, "2026-10-01T00:00:00Z").unwrap();
    state.db.insert_ladder(OWNER, &stored).await.unwrap();

    run_ladder(&state, "gone").await.unwrap();
    // The harness climber launched; the gg one did not.
    assert_eq!(in_flight(&state, "pong").await.len(), 1);
    let progress = board(&state, "gone").await;
    let blocked = progress
        .climbers
        .iter()
        .find(|climber| climber.harness == HarnessSlug::Gg)
        .unwrap();
    assert_eq!(blocked.status, ClimberStatus::Blocked);
    assert!(
        matches!(&blocked.blocked, Some(ClimberBlock::Unlaunchable { reason }) if reason.contains("no longer on this account")),
        "{:?}",
        blocked.blocked
    );
    assert_eq!(dispatch(&progress).status, DispatchStatus::Running);
    assert_eq!(dispatch(&progress).climbers_blocked, 1);

    // A retry is accepted (the owner may have fixed it) and still launches nothing.
    let status = retry_climber(
        State(state.clone()),
        owner(),
        Path("gone".to_string()),
        Json(LadderRetryInput { combination: gone }),
    )
    .await
    .unwrap();
    assert_eq!(status, StatusCode::NO_CONTENT);

    // The harness climber finishing does not finish a dispatch with a blocked climber;
    // a stop ends it.
    let pong = in_flight(&state, "pong").await;
    finish_and_feed(&state, &pong[0].id, "pong", GREAT).await;
    assert_eq!(
        dispatch(&board(&state, "gone").await).status,
        DispatchStatus::Running
    );
    stop_ladder(&state, "gone", false).await.unwrap();
    let progress = board(&state, "gone").await;
    assert_eq!(dispatch(&progress).status, DispatchStatus::Stopped);
    assert_eq!(
        dispatch(&progress).runs.done,
        dispatch(&progress).runs.total
    );
}

#[tokio::test]
async fn a_rung_left_with_unrated_runs_short_of_its_bar_is_blocked_as_unrated() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong"], 2, &[SONNET])).await;
    run_ladder(&state, &id).await.unwrap();
    let pong = in_flight(&state, "pong").await;
    finish_and_feed(&state, &pong[0].id, "pong", BROKEN).await;
    // The other was pushed while the backend did not hold the version, so nothing rated
    // it: pushed with no manifest.
    let record = run_of("run-unrated", "pong", GREAT);
    state.db.push(&record, &links(), None, None).await.unwrap();
    let job = state
        .db
        .set_job_state(
            &pong[1].id,
            "succeeded",
            "2026-10-02T00:00:00Z",
            None,
            Some(&record.id),
        )
        .await
        .unwrap()
        .unwrap();
    feed(&state, &job).await;

    let progress = board(&state, &id).await;
    let standing = climber(&progress, SONNET);
    assert_eq!(standing.status, ClimberStatus::Blocked);
    assert_eq!(standing.blocked, Some(ClimberBlock::Unrated { runs: 1 }));
    assert_eq!(standing.slots[0].status, SlotStatus::Blocked);
    let tally = standing.slots[0].tally.unwrap();
    assert_eq!((tally.rated, tally.unrated, tally.pending), (1, 1, 0));
    // Nothing a launch pass launches can decide it, and a retry cannot help.
    assert_eq!(pass(&state, &id).await.enqueued, 0);
    let err = retry(&state, &id, SONNET).await.unwrap_err();
    assert_eq!(err.status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn a_run_stored_without_its_rating_is_rated_when_the_gate_reads_it() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong", "carom"], 1, &[SONNET])).await;
    run_ladder(&state, &id).await.unwrap();
    let pong = in_flight(&state, "pong").await;
    // Pushed while the store lacked the version: no rating, though validator-rated.
    let record = run_of("run-late", "pong", GREAT);
    let manifest = state.store.read_manifest("pong", "v1.0.0").unwrap();
    state
        .db
        .push(&record, &links(), None, Some(&manifest))
        .await
        .unwrap();
    test_cabinet_entities::run::Entity::update_many()
        .col_expr(
            test_cabinet_entities::run::Column::ValidatorRating,
            sea_orm::sea_query::Expr::value(None::<String>),
        )
        .exec(&state.db.connection())
        .await
        .unwrap();
    let job = state
        .db
        .set_job_state(
            &pong[0].id,
            "succeeded",
            "2026-10-02T00:00:00Z",
            None,
            Some(&record.id),
        )
        .await
        .unwrap()
        .unwrap();
    feed(&state, &job).await;
    assert_eq!(in_flight(&state, "carom").await.len(), 1);
    assert_eq!(
        climber(&board(&state, &id).await, SONNET).slots[0].status,
        SlotStatus::Passed
    );
}

// ---- Feeding, claims and restarts ---------------------------------------------------

#[tokio::test]
async fn the_driver_reporting_a_finished_run_climbs_the_dispatch_with_no_console_open() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong", "carom"], 1, &[SONNET])).await;
    run_ladder(&state, &id).await.unwrap();
    let pong = in_flight(&state, "pong").await;
    report(&state, &pong[0].id, run_of("run-driver", "pong", GREAT)).await;
    // The launch pass runs on a task of its own after the report is stored.
    wait_for_in_flight(&state, "carom", 1).await;
}

#[tokio::test]
async fn a_finished_run_of_another_launch_feeds_the_dispatch_that_holds_its_cell() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong"], 3, &[SONNET])).await;
    run_ladder(&state, &id).await.unwrap();
    // Free the dispatch's room, so a pass would launch.
    for job in in_flight(&state, "pong").await {
        set_state(&state, &job.id, "canceled").await;
    }
    // A job of another cell feeds nothing: another case, and another model's pong.
    enqueue_other(&state, "other-case", "carom", None).await;
    let job = finish(&state, "other-case", run_of("run-other", "carom", GREAT)).await;
    assert!(dispatches_fed_by(&state, &job).await.is_empty());
    let mut record = run_of("run-opus", "pong", GREAT);
    record.subject.model_id = OPUS.to_string();
    state
        .db
        .enqueue_job(crate::db::NewJob {
            test_case_slug: "pong".to_string(),
            model_id: OPUS.to_string(),
            ..crate::db::tests::new_job("other-model", "2026-10-01T00:00:00Z")
        })
        .await
        .unwrap();
    let job = finish(&state, "other-model", record).await;
    assert!(dispatches_fed_by(&state, &job).await.is_empty());
    feed(&state, &job).await;
    assert!(in_flight(&state, "pong").await.is_empty());

    // A run of the slot's cell feeds the dispatch, whoever launched it: by hand, under
    // the legacy origin, or as an earlier dispatch of this very ladder.
    for (n, (job_id, origin)) in [
        ("hand", None),
        ("legacy", Some(format!("ladder:{id}"))),
        ("elsewhere", Some(format!("ladder:{id}/old-dispatch/r"))),
    ]
    .into_iter()
    .enumerate()
    {
        enqueue_other(&state, job_id, "pong", origin.as_deref()).await;
        let job = finish(
            &state,
            job_id,
            run_of(&format!("run-{job_id}"), "pong", GREAT),
        )
        .await;
        assert_eq!(
            dispatches_fed_by(&state, &job).await,
            vec![(id.clone(), OWNER.to_string())],
            "{job_id}"
        );
        feed(&state, &job).await;
        // Each pass launches what the rung still misses beside the runs that exist.
        let missing = 3 - (n + 1);
        assert_eq!(in_flight(&state, "pong").await.len(), missing, "{job_id}");
        for job in in_flight(&state, "pong").await {
            set_state(&state, &job.id, "canceled").await;
        }
    }
    assert_eq!(
        dispatch(&board(&state, &id).await).status,
        DispatchStatus::Finished
    );

    // An ended dispatch is fed by nothing.
    enqueue_other(&state, "late", "pong", None).await;
    let job = finish(&state, "late", run_of("run-late", "pong", GREAT)).await;
    assert!(dispatches_fed_by(&state, &job).await.is_empty());
}

#[tokio::test]
async fn concurrent_passes_never_enqueue_one_shortfall_twice() {
    let (_dir, state) = test_state().await;
    price_opus(&state).await;
    let mut input = ladder_input(&["pong"], 3, &[SONNET, OPUS]);
    input.in_flight_limit = Some(InFlightLimit::Unbounded);
    let id = ladder_id(&state, input).await;
    run_ladder(&state, &id).await.unwrap();
    // Free every slot again, so each pass below sees the whole shortfall.
    for job in in_flight(&state, "pong").await {
        set_state(&state, &job.id, "canceled").await;
    }
    let (a, b, c, d) = tokio::join!(
        launch_ladder(&state, OWNER, &id),
        launch_ladder(&state, OWNER, &id),
        launch_ladder(&state, OWNER, &id),
        launch_ladder(&state, OWNER, &id),
    );
    let enqueued: u32 = [a, b, c, d].into_iter().map(|r| r.unwrap().enqueued).sum();
    assert_eq!(enqueued, 6, "two climbers × three runs, each enqueued once");
    assert_eq!(in_flight(&state, "pong").await.len(), 6);
    assert!(!state.db.ladder_launch_requested(&id).await.unwrap());
}

#[tokio::test]
async fn a_run_that_finishes_while_the_claim_is_held_leaves_a_request_that_is_served() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong", "carom"], 1, &[SONNET])).await;
    run_ladder(&state, &id).await.unwrap();
    let pong = in_flight(&state, "pong").await;

    assert!(
        state
            .db
            .claim_ladder_launch(OWNER, &id, &now().unwrap())
            .await
            .unwrap()
    );
    finish(&state, &pong[0].id, run_of("run-1", "pong", GREAT)).await;
    let busy = pass(&state, &id).await;
    assert_eq!(busy.skipped, Some(LaunchSkipped::Busy));
    assert!(state.db.ladder_launch_requested(&id).await.unwrap());
    assert!(in_flight(&state, "carom").await.is_empty());

    // Once the claim is free, the standing request is served.
    state.db.release_ladder_launch(&id).await.unwrap();
    let served = pass(&state, &id).await;
    assert_eq!(served.enqueued, 1);
    assert_eq!(launched_ids(&served).len(), 1);
    assert!(!state.db.ladder_launch_requested(&id).await.unwrap());
}

#[tokio::test]
async fn the_backend_passes_every_running_dispatch_at_startup_and_no_ended_one() {
    let (_dir, state) = test_state().await;
    let running = ladder_id(&state, ladder_input(&["pong"], 1, &[SONNET])).await;
    run_ladder(&state, &running).await.unwrap();
    let stopped = ladder_id(&state, ladder_input(&["carom"], 1, &[SONNET])).await;
    run_ladder(&state, &stopped).await.unwrap();
    // Both lose their run; one is stopped too. A claim the dead process held is
    // released at boot.
    for job in jobs(&state).await {
        set_state(&state, &job.id, "canceled").await;
    }
    stop_ladder(&state, &stopped, false).await.unwrap();
    assert!(
        state
            .db
            .claim_ladder_launch(OWNER, &running, &now().unwrap())
            .await
            .unwrap()
    );
    assert!(state.db.release_all_launch_claims().await.unwrap() >= 1);

    crate::api::spawn_startup_passes(state.clone());
    wait_for_in_flight(&state, "pong", 1).await;
    assert!(in_flight(&state, "carom").await.is_empty());
}

// ---- Reads -------------------------------------------------------------------

#[tokio::test]
async fn the_summary_totals_the_whole_ladder_and_never_breaks_it_down_by_climber() {
    let (_dir, state) = test_state().await;
    price_opus(&state).await;
    let id = ladder_id(&state, ladder_input(&["pong", "carom"], 1, &[SONNET, OPUS])).await;
    let Json(before) = summary(State(state.clone()), owner()).await.unwrap();
    assert_eq!(before.len(), 1);
    assert!(before[0].dispatch.is_none());
    assert_eq!((before[0].rungs, before[0].climbers), (2, 2));

    run_ladder(&state, &id).await.unwrap();
    let pong = in_flight(&state, "pong").await;
    let sonnet = pong.iter().find(|job| job.model_id == SONNET).unwrap();
    let opus = pong.iter().find(|job| job.model_id == OPUS).unwrap();
    finish_and_feed(&state, &sonnet.id, "pong", GREAT).await;
    // The other climber's run is a run of its own model, as the cell reads it.
    let mut broken = run_of(&format!("run-{}", opus.id), "pong", BROKEN);
    broken.subject.model_id = OPUS.to_string();
    let job = finish(&state, &opus.id, broken).await;
    feed(&state, &job).await;

    let Json(after) = summary(State(state.clone()), owner()).await.unwrap();
    let dispatch = after[0].dispatch.as_ref().unwrap();
    assert_eq!(dispatch.status, DispatchStatus::Running);
    assert_eq!(
        dispatch.slots,
        SlotCounts {
            total: 4,
            running: 1,
            blocked: 0,
            passed: 1,
            failed: 1,
            pending: 0,
            skipped: 1,
        }
    );
    assert_eq!(
        dispatch.runs,
        DispatchRuns {
            total: 4,
            done: 3,
            in_flight: 1,
        }
    );
}

#[tokio::test]
async fn the_queue_offers_the_completed_runs_the_board_counts_whoever_launched_them() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong", "carom"], 2, &[SONNET])).await;
    let Json(empty) = queue(State(state.clone()), owner(), Path(id.clone()))
        .await
        .unwrap();
    assert!(empty.runs.is_empty());
    // A run launched by hand, a run of the model's own failure (which counts and is
    // nothing to review), and a carom run on a rung the climber has not reached.
    enqueue_other(&state, "hand", "pong", None).await;
    finish(&state, "hand", run_of("run-hand", "pong", GREAT)).await;
    enqueue_other(&state, "carom-hand", "carom", None).await;
    finish(&state, "carom-hand", run_of("run-carom", "carom", GREAT)).await;
    run_ladder(&state, &id).await.unwrap();
    let pong = in_flight(&state, "pong").await;
    assert_eq!(pong.len(), 1, "the rung was missing one run of two");

    // Before the dispatch's own run lands, the inherited one is already offered.
    let Json(listed) = queue(State(state.clone()), owner(), Path(id.clone()))
        .await
        .unwrap();
    let ids: Vec<&str> = listed.runs.iter().map(|run| run.run_id.as_str()).collect();
    assert_eq!(ids, vec!["run-hand"]);
    assert_eq!(board(&state, &id).await.runs_unreviewed, 1);

    // Reviewing it takes it out, like any run of the board.
    state
        .db
        .add_review(
            "run-hand",
            &crate::db::tests::review_by(OWNER, Rating::Great),
            None,
            None,
        )
        .await
        .unwrap();
    assert_eq!(board(&state, &id).await.runs_unreviewed, 0);

    // The dispatch's own run passes pong, which reaches carom and its existing run.
    finish_and_feed(&state, &pong[0].id, "pong", GREAT).await;
    let Json(listed) = queue(State(state.clone()), owner(), Path(id.clone()))
        .await
        .unwrap();
    let ids: Vec<String> = listed.runs.iter().map(|run| run.run_id.clone()).collect();
    assert_eq!(
        ids,
        vec![format!("run-{}", pong[0].id), "run-carom".to_string()]
    );
    assert_eq!(board(&state, &id).await.runs_unreviewed, 2);
}

#[tokio::test]
async fn a_dispatch_reads_rating_floors_from_its_snapshot() {
    let (_dir, state) = test_state().await;
    let mut input = ladder_input(&["pong"], 1, &[SONNET]);
    input.gate = Some(Gate {
        floor: Rating::Great,
        ..Gate::default()
    });
    let id = ladder_id(&state, input).await;
    let progress = run_ladder(&state, &id).await.unwrap();
    assert_eq!(dispatch(&progress).gate.floor, Rating::Great);
}

// ---- Pinned climbers --------------------------------------------------------

/// A gg climber of the saved configuration `cfg-pin`, which runs [`SONNET`] at its root.
fn pinned_gg_combo() -> ReviewPlanCombo {
    ReviewPlanCombo {
        harness: HarnessSlug::Gg,
        model: String::new(),
        provider: None,
        gg_config_id: Some("saved:cfg-pin".to_string()),
        gg_slot_models: BTreeMap::new(),
        gg_config_name: None,
    }
}

/// A one-agent set running `model` at its root.
fn root_set(model: &str) -> test_cabinet_core::gg::GgCapabilitySet {
    let mut set = test_cabinet_core::gg::GgCapabilitySet::minimal(model);
    set.agents[0].id = Some("k-root".to_string());
    set
}

/// Save `cfg-pin` on the owner's account.
async fn save_pinned_config(state: &AppState) {
    state
        .db
        .insert_gg_config(
            OWNER,
            &crate::api::GgConfig {
                id: "cfg-pin".to_string(),
                name: "Pinned".to_string(),
                description: String::new(),
                capability_set: root_set(SONNET),
                agent_sources: Vec::new(),
                updated_at: "2026-10-01T00:00:00Z".to_string(),
            },
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn a_dispatch_finds_a_gg_climbers_runs_after_its_configuration_is_deleted() {
    let (_dir, state) = test_state().await;
    save_pinned_config(&state).await;
    let mut input = ladder_input(&["pong"], 1, &[]);
    input.combos.push(pinned_gg_combo());
    // Nothing launches by itself: the test enqueues the dispatch's run by hand.
    input.in_flight_limit = Some(InFlightLimit::Bounded { runs: 0 });
    let id = ladder_id(&state, input).await;
    let progress = run_ladder(&state, &id).await.unwrap();
    let dispatch_id = dispatch(&progress).id.clone();
    let rung_id = progress.rungs[0].rung.id.clone();

    // The Run pinned the climber's cells.
    let climbers = state.db.dispatch_climbers(&dispatch_id).await.unwrap();
    let [harness, model, config_id, models]: [String; 4] = serde_json::from_str(
        climbers[0]
            .cell_json
            .as_deref()
            .unwrap_or_else(|| panic!("not pinned: {:?}", progress.climbers)),
    )
    .unwrap();
    assert_eq!(harness, "gg");
    assert_eq!(model, SONNET);
    assert_eq!(config_id, "cfg-pin");

    // One run of the dispatch, in the pinned cell.
    state
        .db
        .enqueue_job(crate::db::NewJob {
            test_case_slug: "pong".to_string(),
            harness_slug: harness,
            model_id: model,
            gg_config_id: Some(config_id),
            gg_models: Some(models),
            user_id: Some(OWNER.to_string()),
            origin: Some(JobOrigin::dispatch(&id, &dispatch_id, &rung_id)),
            ..crate::db::tests::new_job("gg-1", "2026-10-01T00:00:00Z")
        })
        .await
        .unwrap();

    // The configuration is deleted mid-dispatch. The climber's run is still its own: in
    // flight, it keeps the climber running rather than blocked with nothing.
    assert!(state.db.delete_gg_config(OWNER, "cfg-pin").await.unwrap());
    let progress = board(&state, &id).await;
    assert_eq!(progress.climbers[0].status, ClimberStatus::Running);
    assert_eq!(dispatch(&progress).runs.in_flight, 1);

    // And once it finishes it counts, and the climber completes.
    let mut record = run_of("run-gg-1", "pong", GREAT);
    record.subject.harness_slug = HarnessSlug::Gg;
    // The run names the configuration it was launched from and the models it bound,
    // which is what puts it in the pinned cell.
    let mut set = root_set(SONNET);
    set.preset_id = Some("cfg-pin".to_string());
    record.subject.gg_capability_set = Some(set);
    let job = finish(&state, "gg-1", record).await;
    feed(&state, &job).await;
    let progress = board(&state, &id).await;
    assert_eq!(progress.climbers[0].status, ClimberStatus::Completed);
    assert_eq!(dispatch(&progress).status, DispatchStatus::Finished);
}

#[tokio::test]
async fn a_gg_climber_whose_configuration_moves_its_cells_is_not_launched_into_them() {
    let (_dir, state) = test_state().await;
    save_pinned_config(&state).await;
    price_opus(&state).await;
    let mut input = ladder_input(&["pong"], 1, &[]);
    input.combos.push(pinned_gg_combo());
    input.in_flight_limit = Some(InFlightLimit::Bounded { runs: 0 });
    let id = ladder_id(&state, input).await;
    run_ladder(&state, &id).await.unwrap();

    // The configuration now runs another model at its root: its runs would land in cells
    // this dispatch never looks at.
    let mut moved = state
        .db
        .get_gg_config(OWNER, "cfg-pin")
        .await
        .unwrap()
        .unwrap();
    moved.capability_set = root_set(OPUS);
    assert!(state.db.update_gg_config(OWNER, &moved).await.unwrap());
    let progress = board(&state, &id).await;
    assert_eq!(progress.climbers[0].status, ClimberStatus::Blocked);
    assert!(
        matches!(&progress.climbers[0].blocked, Some(ClimberBlock::Unlaunchable { reason }) if reason.contains("different runs")),
        "{:?}",
        progress.climbers[0].blocked
    );
}

#[tokio::test]
async fn two_climbers_that_ask_for_the_same_runs_are_one_climber_of_a_dispatch() {
    let (_dir, state) = test_state().await;
    let mut input = ladder_input(&["pong"], 1, &[SONNET]);
    // The same model behind its provider-qualified spelling launches the same runs.
    let mut twin = harness_combo(SONNET);
    twin.provider = Some("anthropic".to_string());
    input.combos.push(twin);
    let id = ladder_id(&state, input).await;
    let progress = run_ladder(&state, &id).await.unwrap();
    assert_eq!(progress.climbers.len(), 1, "{:?}", progress.climbers);
    assert_eq!(in_flight(&state, "pong").await.len(), 1);
}

// ---- A dispatch publishes the runs it counts ----------------------------------

#[tokio::test]
async fn a_dispatch_publishes_an_unpublished_run_it_inherited_toward_a_rung() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong", "carom"], 1, &[SONNET])).await;
    // Stored with no status report behind it, so nothing has published it.
    existing_run(&state, run_of("run-a", "pong", GREAT)).await;
    assert!(publish_jobs(&state).await.is_empty());

    let progress = run_ladder(&state, &id).await.unwrap();
    assert_eq!(climber(&progress, SONNET).slots[0].run_ids, ["run-a"]);

    let queued = publish_jobs(&state).await;
    assert_eq!(queued.len(), 1);
    assert_eq!(queued[0].run_id, "run-a");
    assert_eq!(queued[0].state, "queued");
}

#[tokio::test]
async fn a_dispatch_publishes_only_the_runs_its_slot_takes() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong"], 2, &[SONNET])).await;
    for (run_id, at) in [
        ("run-1", "2026-09-01T00:00:01Z"),
        ("run-2", "2026-09-01T00:00:02Z"),
        ("run-3", "2026-09-01T00:00:03Z"),
    ] {
        let mut record = run_of(run_id, "pong", GREAT);
        record.finished_at = at.to_string();
        existing_run(&state, record).await;
    }

    run_ladder(&state, &id).await.unwrap();

    // The run beyond the target is not the slot's, so the dispatch leaves it alone.
    let mut published = publishing(&state).await;
    published.sort();
    assert_eq!(published, ["run-1", "run-2"]);
}

#[tokio::test]
async fn a_dispatch_does_not_publish_a_run_on_a_rung_no_climber_has_reached() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong", "carom"], 1, &[SONNET])).await;
    existing_run(&state, run_of("run-c", "carom", GREAT)).await;

    let progress = run_ladder(&state, &id).await.unwrap();
    // The climber is on pong, whose run was just launched.
    assert_eq!(climber(&progress, SONNET).current_rung, Some(0));
    assert_eq!(in_flight(&state, "pong").await.len(), 1);
    assert!(publish_jobs(&state).await.is_empty());
}

#[tokio::test]
async fn a_dispatch_does_not_publish_an_inherited_run_that_did_not_complete() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong", "carom"], 1, &[SONNET])).await;
    existing_run(&state, ended_run("run-a", "pong", RunState::Catastrophic)).await;

    let progress = run_ladder(&state, &id).await.unwrap();
    // The failure is the slot's run, and it is the board's to count, not to publish.
    assert_eq!(climber(&progress, SONNET).slots[0].run_ids, ["run-a"]);
    assert!(publish_jobs(&state).await.is_empty());
}

#[tokio::test]
async fn a_dispatch_does_not_publish_an_inherited_run_that_is_already_public() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong", "carom"], 1, &[SONNET])).await;
    existing_run(&state, run_of("run-a", "pong", GREAT)).await;
    state
        .db
        .publish("run-a", "2026-09-02T00:00:00Z")
        .await
        .unwrap();

    run_ladder(&state, &id).await.unwrap();
    assert!(publish_jobs(&state).await.is_empty());
}

#[tokio::test]
async fn later_passes_enqueue_nothing_more_for_a_run_whose_publish_is_under_way() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong", "carom"], 1, &[SONNET])).await;
    existing_run(&state, run_of("run-a", "pong", GREAT)).await;
    run_ladder(&state, &id).await.unwrap();
    assert_eq!(publishing(&state).await, ["run-a"]);

    pass(&state, &id).await;
    pass(&state, &id).await;
    assert_eq!(publishing(&state).await, ["run-a"]);
}

/// One automatic attempt per run. A publish that failed is a person's to retry, so
/// the passes that keep reading the same board do not enqueue it again.
#[tokio::test]
async fn a_failed_publish_is_not_enqueued_again_by_the_passes_that_follow() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong", "carom"], 1, &[SONNET])).await;
    existing_run(&state, run_of("run-a", "pong", GREAT)).await;
    run_ladder(&state, &id).await.unwrap();
    let job = publish_jobs(&state).await.remove(0);
    state
        .db
        .set_publish_job_state(&job.id, "failed", "2026-10-02T00:00:00Z", Some("boom"))
        .await
        .unwrap();

    pass(&state, &id).await;
    pass(&state, &id).await;

    let all = publish_jobs(&state).await;
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].state, "failed");
}

#[tokio::test]
async fn a_run_a_dispatch_launched_is_published_once_by_its_report_and_the_pass_after_it() {
    let (_dir, state) = test_state().await;
    let id = ladder_id(&state, ladder_input(&["pong", "carom"], 1, &[SONNET])).await;
    run_ladder(&state, &id).await.unwrap();
    let launched = launched_by_ladder(&state, &id).await.remove(0);

    report(&state, &launched.id, run_of("run-a", "pong", GREAT)).await;
    assert_eq!(publishing(&state).await, ["run-a"]);

    pass(&state, &id).await;
    assert_eq!(publishing(&state).await, ["run-a"]);
}
