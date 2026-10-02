//! The automated climb, end to end against a real store and database: validators rate
//! the runs, the gate reads those ratings, and a finished run makes the backend run a
//! launch pass of the ladder with no console and no review in the loop.
//!
//! Every test here drives the same functions the routes call — [`top_up_ladder`],
//! [`feed_ladders`], [`load_board`] — over an in-memory database and a definition store
//! holding real manifests, so what is under test is the wiring between the gate, the
//! board, the scheduler and the queue rather than any one of them alone.

use std::time::Duration;

use axum::http::HeaderMap;
use sea_orm::EntityTrait;
use test_cabinet_core::job_api::{DriverState, StatusUpdate};
use test_cabinet_core::review::{AestheticRating, Rating};
use test_cabinet_core::run_record::RunRecord;
use test_cabinet_entities::job;

use super::*;
use crate::db::tests::{
    links, override_review, priced_model_write, validator_manifest, validator_record,
};

/// The account every ladder here belongs to.
const OWNER: &str = "owner-1";

/// The model every climber here runs, priced in the catalog so a launch pass can launch it
/// without reaching OpenRouter.
const SONNET: &str = "claude-sonnet-4-5";

/// A backend state over an in-memory database and a temporary store that holds three
/// validator-rated versions (`pong`, `carom`, `volley`), a legacy one (`breakout`), a
/// performance case (`perf`) and a game jam (`jam`), all at `v1.0.0`. Prices point at
/// an address nothing listens on, so a path that reached the network fails loudly.
async fn test_state() -> (tempfile::TempDir, AppState) {
    // nextest runs each test in its own process, so this environment is this test's
    // alone.
    let dir = tempfile::tempdir().unwrap();
    unsafe {
        std::env::set_var("TCAB_BACKEND_CHECKOUT", dir.path());
        std::env::set_var("TCAB_BACKEND_STORE", dir.path().join("store"));
    }
    let config = std::sync::Arc::new(crate::config::Config::from_env().unwrap());
    let db = std::sync::Arc::new(crate::db::Db::connect_in_memory().await.unwrap());
    let store = crate::store::DefinitionStore::open(&config.store).unwrap();
    let publisher = crate::publisher::Publisher::new(
        std::sync::Arc::clone(&db),
        store.clone(),
        None,
        None,
        None,
        std::sync::Arc::new(test_cabinet_core::AccountsClient::new(
            config.auth_url.clone(),
        )),
        crate::publisher::PublisherTiming {
            coalesce: config.coalesce,
            snapshot_retention: config.snapshot_retention,
        },
    );
    let state = AppState {
        db,
        store,
        ready: crate::readiness::Readiness::new(true),
        publisher,
        auth: std::sync::Arc::new(test_cabinet_core::AccountsClient::new(
            config.auth_url.clone(),
        )),
        relay: crate::relay::Relay::new(),
        publish_relay: crate::publish_relay::PublishRelay::new(),
        config,
        http: reqwest::Client::new(),
        prices: test_cabinet_core::OpenRouterPrices::with_endpoint("http://127.0.0.1:0/models"),
        gg_docs: crate::gg_docs::GgDocIndex::new(),
    };

    for slug in ["pong", "carom", "volley"] {
        let mut manifest = validator_manifest();
        manifest.slug = slug.to_string();
        state.store.write_manifest(&manifest).unwrap();
    }
    let mut legacy = validator_manifest();
    legacy.slug = "breakout".to_string();
    legacy.engine_format = false;
    state.store.write_manifest(&legacy).unwrap();
    let mut perf = validator_manifest();
    perf.slug = "perf".to_string();
    perf.test_type = TestType::Performance;
    state.store.write_manifest(&perf).unwrap();
    let mut jam = validator_manifest();
    jam.slug = "jam".to_string();
    jam.test_type = TestType::GameJam;
    state.store.write_manifest(&jam).unwrap();

    state
        .db
        .upsert_model_config(priced_model_write("sonnet", "Claude Sonnet 4.5", &[SONNET]))
        .await
        .unwrap();
    (dir, state)
}

fn owner() -> AuthUser {
    AuthUser(test_cabinet_core::Account {
        id: OWNER.to_string(),
        username: "owner".to_string(),
        display_name: "Owner".to_string(),
        picture_updated_at: None,
    })
}

fn harness_combo(model: &str) -> ReviewPlanCombo {
    ReviewPlanCombo {
        harness: HarnessSlug::Claude,
        model: model.to_string(),
        provider: None,
        gg_config_id: None,
        gg_slot_models: BTreeMap::new(),
        gg_config_name: None,
    }
}

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
        schedule: None,
    }
}

/// Create a ladder through the create endpoint, as the console does.
async fn create_ladder(state: &AppState, input: LadderInput) -> Result<LadderOut, ApiError> {
    create(State(state.clone()), owner(), Json(input))
        .await
        .map(|Json(out)| out)
}

/// Write a ladder's schedule straight to the store: enabled or not, and its buffer
/// target. Unlike the `pause` endpoint it runs no launch pass, so a test decides when
/// one runs.
async fn schedule(state: &AppState, id: &str, enabled: bool, buffer_target: Option<BufferTarget>) {
    let schedule = LadderSchedule {
        outer_axis: LadderAxis::Rung,
        paused: !enabled,
        buffer_target,
    };
    assert!(
        state
            .db
            .set_ladder_schedule(OWNER, id, &schedule.to_db())
            .await
            .unwrap()
    );
}

/// A run record of `slug` on the shared climber, its validators deciding `verdicts`.
fn run_of(id: &str, slug: &str, verdicts: &[(&str, bool)]) -> RunRecord {
    let mut record = validator_record(id, verdicts);
    record.subject.test_case_slug = slug.to_string();
    record.subject.model_id = SONNET.to_string();
    record
}

/// The verdicts that rate a run `great` (the cosmetic point fails).
const GREAT: &[(&str, bool)] = &[("serve", true), ("hud", false)];
/// The verdicts that rate a run `broken` (the gameplay-critical point fails).
const BROKEN: &[(&str, bool)] = &[("serve", false), ("hud", true)];

/// Finish one job as a driver would: push the run it produced (rated by its validators at
/// push, from the store's manifest) and mark the job succeeded. Returns the finished row.
async fn finish(state: &AppState, job_id: &str, record: RunRecord) -> job::Model {
    let manifest = state
        .store
        .read_manifest(
            &record.subject.test_case_slug,
            &record.subject.test_case_version,
        )
        .ok();
    state
        .db
        .push(&record, &links(), None, manifest.as_ref())
        .await
        .unwrap();
    state
        .db
        .set_job_state(
            job_id,
            "succeeded",
            "2026-10-02T00:00:00Z",
            None,
            Some(&record.id),
        )
        .await
        .unwrap()
        .expect("the job exists")
}

/// Finish `job_id` with a run of `slug` rated by `verdicts`, then feed the ladders the
/// way the driver's status report does.
async fn finish_and_feed(state: &AppState, job_id: &str, slug: &str, verdicts: &[(&str, bool)]) {
    let job = finish(
        state,
        job_id,
        run_of(&format!("run-{job_id}"), slug, verdicts),
    )
    .await;
    feed_ladders(state, &job).await;
}

/// Every job, oldest first.
async fn jobs(state: &AppState) -> Vec<job::Model> {
    use sea_orm::QueryOrder;
    job::Entity::find()
        .order_by_asc(job::Column::QueueSeq)
        .all(&state.db.connection())
        .await
        .unwrap()
}

/// The in-flight jobs of one case slug.
async fn in_flight(state: &AppState, slug: &str) -> Vec<job::Model> {
    jobs(state)
        .await
        .into_iter()
        .filter(|job| {
            job.test_case_slug == slug
                && matches!(
                    job.state.as_str(),
                    "queued" | "pending" | "dispatched" | "starting" | "running"
                )
        })
        .collect()
}

async fn progress_of(state: &AppState, id: &str) -> LadderProgress {
    load_board(state, OWNER, id, false).await.unwrap().progress
}

fn climber<'a>(progress: &'a LadderProgress, model: &str) -> &'a LadderClimber {
    progress
        .climbers
        .iter()
        .find(|climber| climber.model == model)
        .expect("the climber is on the board")
}

fn job_ids(result: &TopUpResult) -> Vec<String> {
    result
        .cells
        .iter()
        .flat_map(|cell| cell.job_ids.iter().cloned())
        .collect()
}

// ---- The automated climb ---------------------------------------------------

#[tokio::test]
async fn validator_rated_runs_carry_a_climber_up_the_ladder_with_no_review() {
    let (_dir, state) = test_state().await;
    let ladder = create_ladder(&state, ladder_input(&["pong", "carom"], 2, &[SONNET]))
        .await
        .unwrap();
    let id = ladder.ladder.id.clone();
    // A new ladder is disabled, and climbs by itself once enabled.
    assert!(ladder.schedule.paused);
    schedule(&state, &id, true, None).await;

    // The first launch pass launches the first rung.
    let first = top_up_ladder(&state, OWNER, &id).await.unwrap();
    assert_eq!(first.enqueued, 2);
    assert!(first.cells.iter().all(|cell| cell.slug == "pong"));
    let pong_jobs = job_ids(&first);

    // One run finishes broken: the rung still has a run to complete, so nothing new is
    // launched and the climber is running.
    finish_and_feed(&state, &pong_jobs[0], "pong", BROKEN).await;
    let board = progress_of(&state, &id).await;
    assert_eq!(climber(&board, SONNET).status, ClimberStatus::Running);
    assert!(in_flight(&state, "carom").await.is_empty());

    // The second finishes great. Nobody reviews anything: the finished run itself runs a
    // launch pass, the gate passes the climber, and the next rung is launched.
    finish_and_feed(&state, &pong_jobs[1], "pong", GREAT).await;
    assert_eq!(in_flight(&state, "carom").await.len(), 2);
    let board = progress_of(&state, &id).await;
    let standing = climber(&board, SONNET);
    assert_eq!(standing.status, ClimberStatus::Running);
    assert_eq!(standing.current_rung.as_ref().unwrap().position, 1);
    assert_eq!(standing.outcomes[0].outcome, LadderOutcome::Passed);
    assert!(
        standing.outcomes[0].recorded,
        "the launch pass wrote the verdict down"
    );
    assert_eq!(
        board.runs_unreviewed, 2,
        "reviews are optional labels, never a gate"
    );

    // Both of the second rung's runs come back broken: it fails there.
    let carom: Vec<String> = in_flight(&state, "carom")
        .await
        .into_iter()
        .map(|job| job.id)
        .collect();
    finish_and_feed(&state, &carom[0], "carom", BROKEN).await;
    finish_and_feed(&state, &carom[1], "carom", BROKEN).await;
    let board = progress_of(&state, &id).await;
    let standing = climber(&board, SONNET);
    assert_eq!(standing.status, ClimberStatus::Failed);
    assert_eq!(board.climbers_failed, 1);
    assert_eq!(board.runs_in_flight, 0);
}

#[tokio::test]
async fn a_climber_that_passes_every_rung_completes() {
    let (_dir, state) = test_state().await;
    let id = create_ladder(&state, ladder_input(&["pong", "carom"], 1, &[SONNET]))
        .await
        .unwrap()
        .ladder
        .id;
    schedule(&state, &id, true, None).await;
    let first = top_up_ladder(&state, OWNER, &id).await.unwrap();
    finish_and_feed(&state, &job_ids(&first)[0], "pong", GREAT).await;
    let carom = in_flight(&state, "carom").await;
    assert_eq!(carom.len(), 1);
    finish_and_feed(&state, &carom[0].id, "carom", GREAT).await;

    let board = progress_of(&state, &id).await;
    assert_eq!(climber(&board, SONNET).status, ClimberStatus::Completed);
    assert_eq!(board.climbers_completed, 1);
    assert!(
        jobs(&state)
            .await
            .iter()
            .all(|job| job.state == "succeeded")
    );
}

#[tokio::test]
async fn a_run_whose_build_never_loaded_counts_as_broken() {
    let (_dir, state) = test_state().await;
    let id = create_ladder(&state, ladder_input(&["pong", "carom"], 1, &[SONNET]))
        .await
        .unwrap()
        .ladder
        .id;
    schedule(&state, &id, true, None).await;
    let first = top_up_ladder(&state, OWNER, &id).await.unwrap();
    // Its validators passed every point, but the build never loaded.
    let mut record = run_of("run-unloaded", "pong", &[("serve", true), ("hud", true)]);
    record.validation.loaded = false;
    let job = finish(&state, &job_ids(&first)[0], record).await;
    feed_ladders(&state, &job).await;

    let board = progress_of(&state, &id).await;
    assert_eq!(climber(&board, SONNET).status, ClimberStatus::Failed);
    assert!(in_flight(&state, "carom").await.is_empty());
}

#[tokio::test]
async fn reviews_and_their_overrides_never_move_the_gate() {
    let (_dir, state) = test_state().await;
    let id = create_ladder(&state, ladder_input(&["pong", "carom"], 1, &[SONNET]))
        .await
        .unwrap()
        .ladder
        .id;
    schedule(&state, &id, true, None).await;
    let first = top_up_ladder(&state, OWNER, &id).await.unwrap();
    let pong_job = job_ids(&first)[0].clone();
    finish_and_feed(&state, &pong_job, "pong", BROKEN).await;
    let run_id = format!("run-{pong_job}");
    assert_eq!(
        climber(&progress_of(&state, &id).await, SONNET).status,
        ClimberStatus::Failed
    );

    // The owner overrides the failing point to a pass. The run's stored rating follows
    // the override; the climb does not.
    state
        .db
        .add_review(
            &run_id,
            &override_review(OWNER, AestheticRating::Good, &[("serve", true)]),
            None,
            Some(&state.store.read_manifest("pong", "v1.0.0").unwrap()),
        )
        .await
        .unwrap();
    let stored = state.db.get_run(&run_id).await.unwrap().unwrap();
    assert_eq!(stored.rating, Some(Rating::Flawless));
    let result = top_up_ladder(&state, OWNER, &id).await.unwrap();
    assert_eq!(result.enqueued, 0);
    let board = progress_of(&state, &id).await;
    let standing = climber(&board, SONNET);
    assert_eq!(standing.status, ClimberStatus::Failed);
    assert_eq!(standing.outcomes[0].outcome, LadderOutcome::Failed);
    assert_eq!(standing.current_rung.as_ref().unwrap().tally.passing, 0);
}

// ---- What a finished run feeds ---------------------------------------------

/// A ladder on `pong` then `carom` for the shared climber, with its first rung's single
/// run already enqueued by hand (no origin), so only the trigger under test can launch
/// the second rung.
async fn climb_with_a_hand_launched_run(state: &AppState, enabled: bool) -> (String, job::Model) {
    let id = create_ladder(state, ladder_input(&["pong", "carom"], 1, &[SONNET]))
        .await
        .unwrap()
        .ladder
        .id;
    schedule(state, &id, enabled, None).await;
    state
        .db
        .enqueue_job(crate::db::NewJob {
            model_id: SONNET.to_string(),
            ..crate::db::tests::new_job("hand", "2026-10-01T00:00:00Z")
        })
        .await
        .unwrap();
    let job = finish(state, "hand", run_of("run-hand", "pong", GREAT)).await;
    (id, job)
}

#[tokio::test]
async fn a_finished_run_feeds_a_ladder_that_pins_its_case_even_when_another_launch_made_it() {
    let (_dir, state) = test_state().await;
    let (id, job) = climb_with_a_hand_launched_run(&state, true).await;
    feed_ladders(&state, &job).await;
    let carom = in_flight(&state, "carom").await;
    assert_eq!(carom.len(), 1, "the next rung was launched server-side");
    assert_eq!(
        carom[0].origin.as_deref(),
        Some(format!("ladder:{id}").as_str())
    );
    assert_eq!(carom[0].user_id.as_deref(), Some(OWNER));
}

#[tokio::test]
async fn a_finished_run_does_not_feed_a_disabled_ladder() {
    let (_dir, state) = test_state().await;
    let (id, job) = climb_with_a_hand_launched_run(&state, false).await;
    feed_ladders(&state, &job).await;
    assert!(in_flight(&state, "carom").await.is_empty());
    // Nor does it record anything: a disabled ladder is not touched at all.
    assert!(state.db.list_ladder_outcomes(&id).await.unwrap().is_empty());
}

#[tokio::test]
async fn a_finished_run_of_another_case_feeds_nothing() {
    let (_dir, state) = test_state().await;
    let (_id, mut job) = climb_with_a_hand_launched_run(&state, true).await;
    // The same job, but of a case no rung pins and with no ladder origin.
    job.test_case_slug = "volley".to_string();
    feed_ladders(&state, &job).await;
    assert!(in_flight(&state, "carom").await.is_empty());
}

#[tokio::test]
async fn the_driver_reporting_a_finished_run_climbs_the_ladder_with_no_console_open() {
    let (_dir, state) = test_state().await;
    let id = create_ladder(&state, ladder_input(&["pong", "carom"], 1, &[SONNET]))
        .await
        .unwrap()
        .ladder
        .id;
    schedule(&state, &id, true, None).await;
    let first = top_up_ladder(&state, OWNER, &id).await.unwrap();
    let job_id = job_ids(&first)[0].clone();
    let token = state.db.get_job(&job_id).await.unwrap().unwrap().job_token;

    let mut headers = HeaderMap::new();
    headers.insert(
        axum::http::header::AUTHORIZATION,
        format!("Bearer {token}").parse().unwrap(),
    );
    let status = super::super::jobs::update_status(
        State(state.clone()),
        Path(job_id.clone()),
        headers,
        Json(StatusUpdate {
            state: DriverState::Succeeded,
            record: Some(run_of("run-driver", "pong", GREAT)),
            detail: None,
        }),
    )
    .await
    .unwrap();
    assert_eq!(status, StatusCode::NO_CONTENT);

    // The launch pass runs on a task of its own after the report is stored, so wait for it.
    let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
    loop {
        if in_flight(&state, "carom").await.len() == 1 {
            break;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "the finished run never launched the next rung"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let board = progress_of(&state, &id).await;
    assert_eq!(
        climber(&board, SONNET).outcomes[0].outcome,
        LadderOutcome::Passed
    );
}

// ---- Concurrency -----------------------------------------------------------

#[tokio::test]
async fn concurrent_top_ups_never_enqueue_one_shortfall_twice() {
    let (_dir, state) = test_state().await;
    let id = create_ladder(
        &state,
        ladder_input(&["pong"], 3, &[SONNET, "claude-opus-4-8"]),
    )
    .await
    .unwrap()
    .ladder
    .id;
    state
        .db
        .upsert_model_config(priced_model_write(
            "opus",
            "Claude Opus 4.8",
            &["claude-opus-4-8"],
        ))
        .await
        .unwrap();
    schedule(&state, &id, true, Some(BufferTarget::Unbounded)).await;

    let (a, b, c, d) = tokio::join!(
        top_up_ladder(&state, OWNER, &id),
        top_up_ladder(&state, OWNER, &id),
        top_up_ladder(&state, OWNER, &id),
        top_up_ladder(&state, OWNER, &id),
    );
    let enqueued: u32 = [a, b, c, d].into_iter().map(|r| r.unwrap().enqueued).sum();
    assert_eq!(enqueued, 6, "two climbers × three runs, each enqueued once");
    assert_eq!(in_flight(&state, "pong").await.len(), 6);
    assert!(!state.db.ladder_top_up_requested(&id).await.unwrap());
}

#[tokio::test]
async fn a_run_that_finishes_while_the_claim_is_held_is_served_by_another_pass() {
    let (_dir, state) = test_state().await;
    let id = create_ladder(&state, ladder_input(&["pong", "carom"], 1, &[SONNET]))
        .await
        .unwrap()
        .ladder
        .id;
    schedule(&state, &id, true, None).await;
    let first = top_up_ladder(&state, OWNER, &id).await.unwrap();

    // Another launch pass is mid-pass when the rung's run finishes.
    assert!(
        state
            .db
            .claim_ladder_top_up(OWNER, &id, &now().unwrap())
            .await
            .unwrap()
    );
    let job = finish(&state, &job_ids(&first)[0], run_of("run-1", "pong", GREAT)).await;
    let busy = top_up_ladder(&state, OWNER, &id).await.unwrap();
    assert_eq!(busy.skipped, Some(TopUpSkipped::Busy));
    assert!(
        state.db.ladder_top_up_requested(&id).await.unwrap(),
        "the finished run asked the holder for another pass"
    );
    assert!(in_flight(&state, "carom").await.is_empty());

    // The holder checks for requests before it lets go, and serves this one.
    let mut passes = 0;
    let mut merged = None;
    top_up_passes(
        &state,
        OWNER,
        &id,
        BufferTarget::Bounded { runs: 10 },
        &mut passes,
        &mut merged,
    )
    .await
    .unwrap();
    state.db.release_ladder_top_up(&id).await.unwrap();
    assert_eq!(passes, 1);
    assert_eq!(in_flight(&state, "carom").await.len(), 1);
    assert!(!state.db.ladder_top_up_requested(&id).await.unwrap());
    // A second finish report of the same job is a no-op for the ladder.
    feed_ladders(&state, &job).await;
    assert_eq!(in_flight(&state, "carom").await.len(), 1);
}

#[tokio::test]
async fn a_request_left_after_the_release_is_served_by_the_caller_that_released() {
    let (_dir, state) = test_state().await;
    let id = create_ladder(&state, ladder_input(&["pong"], 1, &[SONNET]))
        .await
        .unwrap()
        .ladder
        .id;
    schedule(&state, &id, true, None).await;
    // A request that is already standing when a launch pass starts is taken by its first
    // pass, and nothing is left behind for nobody to serve.
    state.db.request_ladder_top_up(&id).await.unwrap();
    let result = top_up_ladder(&state, OWNER, &id).await.unwrap();
    assert_eq!(result.enqueued, 1);
    assert!(!state.db.ladder_top_up_requested(&id).await.unwrap());
}

// ---- Runs in flight ----------------------------------------------------------

#[tokio::test]
async fn a_ladders_buffer_caps_runs_in_flight_and_completed_runs_never_occupy_it() {
    let (_dir, state) = test_state().await;
    let id = create_ladder(&state, ladder_input(&["pong"], 3, &[SONNET]))
        .await
        .unwrap()
        .ladder
        .id;
    schedule(&state, &id, true, Some(BufferTarget::Bounded { runs: 2 })).await;
    // Two of the rung's three runs completed, and nobody has reviewed either.
    for n in 0..2 {
        let job_id = format!("done-{n}");
        state
            .db
            .enqueue_job(crate::db::NewJob {
                model_id: SONNET.to_string(),
                ..crate::db::tests::new_job(&job_id, "2026-10-01T00:00:00Z")
            })
            .await
            .unwrap();
        finish(&state, &job_id, run_of(&format!("run-{n}"), "pong", BROKEN)).await;
    }
    let board = progress_of(&state, &id).await;
    assert_eq!(board.runs_unreviewed, 2);
    assert_eq!(board.runs_in_flight, 0);
    // Under a plan's semantics those two would fill a buffer of two. A ladder's buffer
    // counts only what is in flight, so the third run is launched.
    let result = top_up_ladder(&state, OWNER, &id).await.unwrap();
    assert_eq!(result.outstanding, Some(0));
    assert_eq!(result.enqueued, 1);
}

#[tokio::test]
async fn a_full_in_flight_cap_launches_nothing_more() {
    let (_dir, state) = test_state().await;
    let id = create_ladder(&state, ladder_input(&["pong", "carom"], 2, &[SONNET]))
        .await
        .unwrap()
        .ladder
        .id;
    state
        .db
        .upsert_model_config(priced_model_write(
            "opus",
            "Claude Opus 4.8",
            &["claude-opus-4-8"],
        ))
        .await
        .unwrap();
    let mut input = ladder_input(&["pong"], 2, &[SONNET, "claude-opus-4-8"]);
    input.name = "two".to_string();
    let two = create_ladder(&state, input).await.unwrap().ladder.id;
    schedule(&state, &two, true, Some(BufferTarget::Bounded { runs: 2 })).await;
    // The first climber's whole cell fills the cap; the second waits for it to drain.
    let first = top_up_ladder(&state, OWNER, &two).await.unwrap();
    assert_eq!(first.enqueued, 2);
    let again = top_up_ladder(&state, OWNER, &two).await.unwrap();
    assert_eq!(again.outstanding, Some(2));
    assert_eq!(again.enqueued, 0);
    assert_eq!(progress_of(&state, &two).await.runs_in_flight, 2);
    let _ = id;
}

#[tokio::test]
async fn a_plans_buffer_still_counts_unreviewed_runs() {
    let (_dir, state) = test_state().await;
    let Json(plan) = super::super::coverage::create_plan(
        State(state.clone()),
        owner(),
        Json(
            serde_json::from_value(serde_json::json!({
                "name": "sweep",
                "runsPerCell": 3,
                "comboGroupIds": [],
                "caseGroupIds": [],
                "combos": [{ "harness": "claude", "model": SONNET }],
                "cases": [{ "slug": "pong", "version": "v1.0.0", "variant": "base" }],
                "schedule": {
                    "outerAxis": "case",
                    "paused": false,
                    "autoTopUp": false,
                    "bufferTarget": { "kind": "bounded", "runs": 2 },
                },
            }))
            .unwrap(),
        ),
    )
    .await
    .unwrap();
    for n in 0..2 {
        let job_id = format!("done-{n}");
        state
            .db
            .enqueue_job(crate::db::NewJob {
                model_id: SONNET.to_string(),
                ..crate::db::tests::new_job(&job_id, "2026-10-01T00:00:00Z")
            })
            .await
            .unwrap();
        finish(&state, &job_id, run_of(&format!("run-{n}"), "pong", GREAT)).await;
    }
    let Json(result) =
        super::super::coverage::top_up_plan(State(state.clone()), owner(), Path(plan.plan.id))
            .await
            .unwrap();
    assert_eq!(result.outstanding, Some(2), "in flight plus unreviewed");
    assert_eq!(
        result.enqueued, 0,
        "the reviewer's backlog fills the buffer"
    );
    assert_eq!(result.early_stop_canceled, 0);
}

// ---- Early stop ------------------------------------------------------------

#[tokio::test]
async fn early_stop_cancels_only_the_decided_cells_waiting_jobs() {
    let (_dir, state) = test_state().await;
    state
        .db
        .upsert_model_config(priced_model_write(
            "opus",
            "Claude Opus 4.8",
            &["claude-opus-4-8"],
        ))
        .await
        .unwrap();
    let mut input = ladder_input(&["pong", "carom"], 3, &[SONNET, "claude-opus-4-8"]);
    input.gate = Some(Gate {
        early_stop: true,
        ..Gate::default()
    });
    let id = create_ladder(&state, input).await.unwrap().ladder.id;
    schedule(&state, &id, true, Some(BufferTarget::Unbounded)).await;
    let first = top_up_ladder(&state, OWNER, &id).await.unwrap();
    assert_eq!(first.enqueued, 6);
    let mine: Vec<job::Model> = jobs(&state)
        .await
        .into_iter()
        .filter(|job| job.model_id == SONNET)
        .collect();
    // One of the climber's runs is already executing, and one has finished great.
    state
        .db
        .set_job_state(&mine[1].id, "running", "2026-10-02T00:00:00Z", None, None)
        .await
        .unwrap();
    // A run of the same cell somebody launched by hand is waiting too.
    state
        .db
        .enqueue_job(crate::db::NewJob {
            model_id: SONNET.to_string(),
            ..crate::db::tests::new_job("by-hand", "2026-10-01T00:00:00Z")
        })
        .await
        .unwrap();
    let job = finish(&state, &mine[0].id, run_of("run-0", "pong", GREAT)).await;

    // The finished run decides the rung early (one great run clears the default gate).
    let result = top_up_ladder(&state, OWNER, &id).await.unwrap();
    assert_eq!(result.early_stop_canceled, 1);
    let state_of = |all: &[job::Model], id: &str| {
        all.iter()
            .find(|job| job.id == id)
            .map(|job| job.state.clone())
            .unwrap()
    };
    let all = jobs(&state).await;
    assert_eq!(
        state_of(&all, &mine[2].id),
        "canceled",
        "waiting, so cancelled"
    );
    assert_eq!(
        state_of(&all, &mine[1].id),
        "running",
        "never kill a running job"
    );
    assert_eq!(state_of(&all, "by-hand"), "queued", "not this ladder's job");
    assert!(
        all.iter()
            .filter(|job| job.model_id == "claude-opus-4-8" && job.test_case_slug == "pong")
            .all(|job| job.state == "queued"),
        "another climber's undecided cell is untouched"
    );
    // The climber moved on: its next rung was launched by the same launch pass, and the run
    // still executing on the decided rung counts against the in-flight cap.
    assert_eq!(in_flight(&state, "carom").await.len(), 3);
    let board = progress_of(&state, &id).await;
    assert_eq!(
        climber(&board, SONNET)
            .current_rung
            .as_ref()
            .unwrap()
            .position,
        1
    );
    // A cancelled job feeds nothing, and a repeat report cancels nothing more.
    feed_ladders(&state, &job).await;
    let again = top_up_ladder(&state, OWNER, &id).await.unwrap();
    assert_eq!(again.early_stop_canceled, 0);
}

#[tokio::test]
async fn without_early_stop_a_rung_runs_everything_it_started() {
    let (_dir, state) = test_state().await;
    let id = create_ladder(&state, ladder_input(&["pong", "carom"], 3, &[SONNET]))
        .await
        .unwrap()
        .ladder
        .id;
    schedule(&state, &id, true, Some(BufferTarget::Unbounded)).await;
    let first = top_up_ladder(&state, OWNER, &id).await.unwrap();
    finish_and_feed(&state, &job_ids(&first)[0], "pong", GREAT).await;
    assert_eq!(in_flight(&state, "pong").await.len(), 2);
    assert!(in_flight(&state, "carom").await.is_empty());
}

// ---- Rungs that cannot be climbed ------------------------------------------

#[tokio::test]
async fn a_rung_that_is_not_validator_rated_is_refused_when_the_ladder_is_saved() {
    let (_dir, state) = test_state().await;
    let err = create_ladder(&state, ladder_input(&["pong", "breakout"], 1, &[SONNET]))
        .await
        .expect_err("a legacy rung is refused");
    assert_eq!(err.status, StatusCode::BAD_REQUEST);
    assert!(
        err.message
            .contains("`breakout` v1.0.0 is a legacy case version"),
        "{}",
        err.message
    );
    assert!(err.message.contains("validator-rated"), "{}", err.message);

    for slug in ["perf", "jam"] {
        let err = create_ladder(&state, ladder_input(&[slug], 1, &[SONNET]))
            .await
            .expect_err("performance and game-jam rungs are refused");
        assert_eq!(err.status, StatusCode::BAD_REQUEST);
        assert!(
            err.message.contains("case and cannot be a ladder rung"),
            "{}",
            err.message
        );
    }

    // A version the backend has not ingested is allowed: the driver reports that.
    let mut unknown = ladder_input(&["pong"], 1, &[SONNET]);
    unknown.rungs[0].version = "v9.9.9".to_string();
    create_ladder(&state, unknown).await.unwrap();

    // Saving an existing ladder re-runs the check, so the edit has to replace the rung.
    let id = create_ladder(&state, ladder_input(&["pong"], 1, &[SONNET]))
        .await
        .unwrap()
        .ladder
        .id;
    let err = update(
        State(state.clone()),
        owner(),
        Path(id),
        Json(ladder_input(&["pong", "breakout"], 1, &[SONNET])),
    )
    .await
    .expect_err("an edit adding a legacy rung is refused");
    assert_eq!(err.status, StatusCode::BAD_REQUEST);
}

/// Store a ladder whose second rung is the legacy `breakout`, as one saved before the
/// check existed would be.
async fn ladder_with_a_legacy_rung(state: &AppState) -> StoredLadder {
    let stored = ladder_from_input(
        "legacy-ladder".to_string(),
        ladder_input(&["pong", "breakout", "carom"], 1, &[SONNET]),
        "2026-10-01T00:00:00Z",
    )
    .unwrap();
    let schedule = LadderSchedule {
        paused: false,
        ..LadderSchedule::default()
    };
    state
        .db
        .insert_ladder(OWNER, &stored, &schedule.to_db())
        .await
        .unwrap();
    stored
}

#[tokio::test]
async fn a_stored_legacy_rung_is_reported_unsupported_and_blocks_without_failing() {
    let (_dir, state) = test_state().await;
    let stored = ladder_with_a_legacy_rung(&state).await;
    let id = stored.id.clone();
    let first = top_up_ladder(&state, OWNER, &id).await.unwrap();
    assert_eq!(first.enqueued, 1);
    finish_and_feed(&state, &job_ids(&first)[0], "pong", GREAT).await;

    let board = progress_of(&state, &id).await;
    assert!(board.rungs[0].supported);
    assert!(!board.rungs[1].supported);
    let standing = climber(&board, SONNET);
    assert_eq!(standing.status, ClimberStatus::Blocked);
    assert_eq!(
        standing.blocked,
        Some(ClimberBlock::UnsupportedRung {
            rung_id: stored.rungs[1].id.clone()
        })
    );
    assert_eq!(standing.current_rung.as_ref().unwrap().position, 1);
    assert_eq!(board.climbers_blocked, 1);
    assert_eq!(board.climbers_failed, 0, "an unsupported rung fails nobody");
    // Nothing is ever launched for it, and no verdict is recorded on it.
    let again = top_up_ladder(&state, OWNER, &id).await.unwrap();
    assert_eq!(again.enqueued, 0);
    assert!(in_flight(&state, "breakout").await.is_empty());
    let outcomes = state.db.list_ladder_outcomes(&id).await.unwrap();
    assert!(
        outcomes
            .iter()
            .all(|outcome| outcome.rung_id != stored.rungs[1].id)
    );

    // A verdict recorded at that rung's pin before it became unsupported still governs:
    // the climber carries on past it.
    state
        .db
        .record_ladder_outcome(
            &id,
            &stored.rungs[1].id,
            &climber_key(&harness_combo(SONNET)),
            "v1.0.0",
            LadderOutcomeKind::Passed,
            "2026-10-01T00:00:00Z",
        )
        .await
        .unwrap();
    let past = top_up_ladder(&state, OWNER, &id).await.unwrap();
    assert_eq!(past.enqueued, 1);
    assert_eq!(in_flight(&state, "carom").await.len(), 1);
    assert_eq!(
        climber(&progress_of(&state, &id).await, SONNET).status,
        ClimberStatus::Running
    );
}

// ---- Runs without a validator rating ----------------------------------------

#[tokio::test]
async fn a_rung_left_with_unrated_runs_short_of_its_bar_is_blocked_as_unrated() {
    let (_dir, state) = test_state().await;
    let id = create_ladder(&state, ladder_input(&["pong"], 2, &[SONNET]))
        .await
        .unwrap()
        .ladder
        .id;
    schedule(&state, &id, true, None).await;
    // One run is rated broken; the other was pushed while the backend did not hold the
    // version, so nothing rated it.
    let broken = run_of("run-broken", "pong", BROKEN);
    state
        .db
        .push(
            &broken,
            &links(),
            None,
            Some(&state.store.read_manifest("pong", "v1.0.0").unwrap()),
        )
        .await
        .unwrap();
    state
        .db
        .push(&run_of("run-unrated", "pong", GREAT), &links(), None, None)
        .await
        .unwrap();

    let board = progress_of(&state, &id).await;
    let standing = climber(&board, SONNET);
    assert_eq!(standing.status, ClimberStatus::Blocked);
    assert_eq!(standing.blocked, Some(ClimberBlock::Unrated { runs: 1 }));
    let tally = standing.current_rung.as_ref().unwrap().tally;
    assert_eq!((tally.rated, tally.unrated, tally.pending), (1, 1, 0));
    // Nothing a launch pass launches can decide it.
    let result = top_up_ladder(&state, OWNER, &id).await.unwrap();
    assert_eq!(result.enqueued, 0);
}

#[tokio::test]
async fn a_validator_rated_run_stored_before_the_column_is_rated_when_the_gate_reads_it() {
    let (_dir, state) = test_state().await;
    let id = create_ladder(&state, ladder_input(&["pong", "carom"], 1, &[SONNET]))
        .await
        .unwrap()
        .ladder
        .id;
    schedule(&state, &id, true, None).await;
    let manifest = state.store.read_manifest("pong", "v1.0.0").unwrap();
    state
        .db
        .push(
            &run_of("old", "pong", GREAT),
            &links(),
            None,
            Some(&manifest),
        )
        .await
        .unwrap();
    // As the row reads after the migration, before any backfill could reach it.
    test_cabinet_entities::run::Entity::update_many()
        .col_expr(
            test_cabinet_entities::run::Column::ValidatorRating,
            sea_orm::sea_query::Expr::value(None::<String>),
        )
        .exec(&state.db.connection())
        .await
        .unwrap();

    let result = top_up_ladder(&state, OWNER, &id).await.unwrap();
    assert_eq!(result.enqueued, 1);
    assert_eq!(in_flight(&state, "carom").await.len(), 1);
    assert_eq!(
        climber(&progress_of(&state, &id).await, SONNET).outcomes[0].outcome,
        LadderOutcome::Passed
    );
}

// ---- A rung whose runs keep failing ------------------------------------------

/// Enqueue and fail three jobs of the shared climber on `pong`, each with no run, ended
/// at `{prefix}:0{n}:00Z`, returning the last one.
async fn fail_three_on_infrastructure(state: &AppState, tag: &str, prefix: &str) -> job::Model {
    let mut last = None;
    for n in 0..3 {
        let job_id = format!("{tag}-{n}");
        state
            .db
            .enqueue_job(crate::db::NewJob {
                model_id: SONNET.to_string(),
                ..crate::db::tests::new_job(&job_id, "2026-10-01T00:00:00Z")
            })
            .await
            .unwrap();
        last = state
            .db
            .set_job_state(
                &job_id,
                "failed",
                &format!("{prefix}:0{n}:00Z"),
                Some("harness unavailable"),
                None,
            )
            .await
            .unwrap();
    }
    last.unwrap()
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

#[tokio::test]
async fn a_failing_rung_stops_relaunching_itself_until_its_climber_is_retried() {
    let (_dir, state) = test_state().await;
    let id = create_ladder(&state, ladder_input(&["pong"], 1, &[SONNET]))
        .await
        .unwrap()
        .ladder
        .id;
    schedule(&state, &id, true, None).await;
    let last = fail_three_on_infrastructure(&state, "failed", "2026-10-01T00").await;

    // The third failure finishing does not relaunch the rung, and says why.
    let result = top_up_ladder(&state, OWNER, &id).await.unwrap();
    assert_eq!(result.enqueued, 0);
    assert!(
        result.unlaunchable[0]
            .reason
            .contains("last 3 runs failed; retry the climber"),
        "{:?}",
        result.unlaunchable
    );
    feed_ladders(&state, &last).await;
    assert!(in_flight(&state, "pong").await.is_empty());
    let board = progress_of(&state, &id).await;
    let standing = climber(&board, SONNET);
    assert_eq!(standing.status, ClimberStatus::Blocked);
    assert_eq!(
        standing.blocked,
        Some(ClimberBlock::Failing {
            attempts: FAILING_STREAK
        })
    );
    assert_eq!(board.climbers_blocked, 1);
    assert_eq!(board.climbers_running, 0);

    // Retrying the climber starts its streak afresh, and the launch pass the retry runs
    // relaunches the rung.
    assert_eq!(
        retry(&state, &id, SONNET).await.unwrap(),
        StatusCode::NO_CONTENT
    );
    wait_for_in_flight(&state, "pong", 1).await;
    let board = progress_of(&state, &id).await;
    assert_eq!(
        climber(&board, SONNET).status,
        ClimberStatus::Running,
        "a run in flight may yet complete"
    );
    assert_eq!(climber(&board, SONNET).blocked, None);

    // Three more failures after the retry block it again.
    let relaunched = in_flight(&state, "pong").await;
    state
        .db
        .set_job_state(
            &relaunched[0].id,
            "canceled",
            "2099-01-01T00:00:00Z",
            Some("cleared for the test"),
            None,
        )
        .await
        .unwrap();
    let last = fail_three_on_infrastructure(&state, "again", "2099-01-01T01").await;
    feed_ladders(&state, &last).await;
    assert!(in_flight(&state, "pong").await.is_empty());
    let board = progress_of(&state, &id).await;
    assert_eq!(climber(&board, SONNET).status, ClimberStatus::Blocked);
    assert_eq!(
        climber(&board, SONNET).blocked,
        Some(ClimberBlock::Failing {
            attempts: FAILING_STREAK
        })
    );
}

#[tokio::test]
async fn a_retry_relaunches_only_the_retried_climbers_rung() {
    let (_dir, state) = test_state().await;
    state
        .db
        .upsert_model_config(priced_model_write(
            "opus",
            "Claude Opus 4.8",
            &["claude-opus-4-8"],
        ))
        .await
        .unwrap();
    const OPUS: &str = "claude-opus-4-8";
    let id = create_ladder(&state, ladder_input(&["pong"], 1, &[SONNET, OPUS]))
        .await
        .unwrap()
        .ladder
        .id;
    schedule(&state, &id, true, None).await;
    // Both climbers' rungs keep failing.
    fail_three_on_infrastructure(&state, "sonnet", "2026-10-01T00").await;
    for n in 0..3 {
        let job_id = format!("opus-{n}");
        state
            .db
            .enqueue_job(crate::db::NewJob {
                model_id: OPUS.to_string(),
                ..crate::db::tests::new_job(&job_id, "2026-10-01T00:00:00Z")
            })
            .await
            .unwrap();
        state
            .db
            .set_job_state(
                &job_id,
                "failed",
                &format!("2026-10-01T01:0{n}:00Z"),
                Some("harness unavailable"),
                None,
            )
            .await
            .unwrap();
    }
    let board = progress_of(&state, &id).await;
    assert_eq!(board.climbers_blocked, 2);

    assert_eq!(
        retry(&state, &id, OPUS).await.unwrap(),
        StatusCode::NO_CONTENT
    );
    wait_for_in_flight(&state, "pong", 1).await;
    let launched = in_flight(&state, "pong").await;
    assert_eq!(
        launched[0].model_id, OPUS,
        "only the retried climber relaunched"
    );
    let board = progress_of(&state, &id).await;
    assert_eq!(climber(&board, SONNET).status, ClimberStatus::Blocked);
    assert_eq!(climber(&board, OPUS).status, ClimberStatus::Running);
}

#[tokio::test]
async fn retrying_a_climber_that_is_not_failing_is_a_conflict() {
    let (_dir, state) = test_state().await;
    let id = create_ladder(&state, ladder_input(&["pong"], 1, &[SONNET]))
        .await
        .unwrap()
        .ladder
        .id;
    // A running climber has nothing to retry.
    let err = retry(&state, &id, SONNET).await.unwrap_err();
    assert_eq!(err.status, StatusCode::CONFLICT);
    assert!(err.message.contains("running"), "{}", err.message);
    // A combination that is not on the ladder is not one of its climbers.
    let err = retry(&state, &id, "claude-opus-4-8").await.unwrap_err();
    assert_eq!(err.status, StatusCode::NOT_FOUND);
    // Nor is anything recorded for either.
    assert!(state.db.list_ladder_climbers(&id).await.unwrap().is_empty());
    // A ladder that is not the caller's is not found at all.
    let err = retry(&state, "no-such-ladder", SONNET).await.unwrap_err();
    assert_eq!(err.status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn a_retry_survives_a_full_in_flight_cap() {
    let (_dir, state) = test_state().await;
    let id = create_ladder(&state, ladder_input(&["pong"], 1, &[SONNET]))
        .await
        .unwrap()
        .ladder
        .id;
    // A cap of zero: the retry's own launch pass can launch nothing.
    schedule(&state, &id, true, Some(BufferTarget::Bounded { runs: 0 })).await;
    fail_three_on_infrastructure(&state, "failed", "2026-10-01T00").await;
    assert_eq!(
        retry(&state, &id, SONNET).await.unwrap(),
        StatusCode::NO_CONTENT
    );
    let result = top_up_ladder(&state, OWNER, &id).await.unwrap();
    assert_eq!(result.enqueued, 0);
    // The retry is recorded rather than spent, so the climber stays running, and the next
    // pass with room launches the rung.
    assert_eq!(
        climber(&progress_of(&state, &id).await, SONNET).status,
        ClimberStatus::Running
    );
    schedule(&state, &id, true, None).await;
    let result = top_up_ladder(&state, OWNER, &id).await.unwrap();
    assert_eq!(result.enqueued, 1);
}

#[tokio::test]
async fn enabling_a_ladder_starts_its_climb_with_no_second_call() {
    let (_dir, state) = test_state().await;
    let ladder = create_ladder(&state, ladder_input(&["pong", "carom"], 2, &[SONNET]))
        .await
        .unwrap();
    let id = ladder.ladder.id;
    assert!(ladder.schedule.paused, "a new ladder starts disabled");
    assert!(jobs(&state).await.is_empty());
    let Json(enabled) = pause(
        State(state.clone()),
        owner(),
        Path(id.clone()),
        Json(PauseInput { paused: false }),
    )
    .await
    .unwrap();
    assert!(!enabled.paused);
    wait_for_in_flight(&state, "pong", 2).await;
    // Disabling launches nothing more and leaves the queue alone.
    let Json(disabled) = pause(
        State(state.clone()),
        owner(),
        Path(id.clone()),
        Json(PauseInput { paused: true }),
    )
    .await
    .unwrap();
    assert!(disabled.paused);
    assert_eq!(in_flight(&state, "pong").await.len(), 2);
}

#[tokio::test]
async fn two_failures_are_not_yet_a_failing_rung() {
    let (_dir, state) = test_state().await;
    let id = create_ladder(&state, ladder_input(&["pong"], 1, &[SONNET]))
        .await
        .unwrap()
        .ladder
        .id;
    schedule(&state, &id, true, None).await;
    for n in 0..2 {
        let job_id = format!("failed-{n}");
        state
            .db
            .enqueue_job(crate::db::NewJob {
                model_id: SONNET.to_string(),
                ..crate::db::tests::new_job(&job_id, "2026-10-01T00:00:00Z")
            })
            .await
            .unwrap();
        state
            .db
            .set_job_state(&job_id, "failed", "2026-10-01T00:00:00Z", None, None)
            .await
            .unwrap();
    }
    let result = top_up_ladder(&state, OWNER, &id).await.unwrap();
    assert_eq!(result.enqueued, 1);
}

// ---- A model that fails a rung without completing ---------------------------

/// Finish `job_id` with a run of `slug` that ended on the model's own failure `state`,
/// then feed the ladders the way the driver's status report does.
async fn fail_and_feed(
    state: &AppState,
    job_id: &str,
    slug: &str,
    run_state: test_cabinet_core::run_record::RunState,
) {
    let mut record = run_of(&format!("run-{job_id}"), slug, GREAT);
    record.status.state = run_state;
    record.validation.loaded = false;
    let job = finish(state, job_id, record).await;
    assert_eq!(
        job.state, "succeeded",
        "the model's failure lands as a succeeded job"
    );
    feed_ladders(state, &job).await;
}

#[tokio::test]
async fn a_rung_whose_every_run_times_out_fails_the_climber_instead_of_relaunching() {
    use test_cabinet_core::run_record::RunState;
    let (_dir, state) = test_state().await;
    let id = create_ladder(&state, ladder_input(&["pong", "carom"], 2, &[SONNET]))
        .await
        .unwrap()
        .ladder
        .id;
    schedule(&state, &id, true, None).await;
    let first = top_up_ladder(&state, OWNER, &id).await.unwrap();
    let pong = job_ids(&first);
    assert_eq!(pong.len(), 2);

    // The first timed-out run used one of the rung's two runs: nothing is relaunched.
    fail_and_feed(&state, &pong[0], "pong", RunState::TimedOut).await;
    assert_eq!(in_flight(&state, "pong").await.len(), 1);
    let board = progress_of(&state, &id).await;
    let tally = climber(&board, SONNET).current_rung.as_ref().unwrap().tally;
    assert_eq!(tally.completed, 1);
    assert_eq!(tally.rated, 1, "a run that never completed is rated broken");

    // The second one ends the rung: failed, and nothing more is ever launched.
    fail_and_feed(&state, &pong[1], "pong", RunState::LimitExceeded).await;
    let board = progress_of(&state, &id).await;
    assert_eq!(climber(&board, SONNET).status, ClimberStatus::Failed);
    assert_eq!(board.climbers_failed, 1);
    assert!(in_flight(&state, "pong").await.is_empty());
    assert!(in_flight(&state, "carom").await.is_empty());
    assert_eq!(jobs(&state).await.len(), 2, "the rung was never relaunched");
}

#[tokio::test]
async fn a_catastrophic_run_is_broken_even_when_unloaded_builds_are_not() {
    use test_cabinet_core::run_record::RunState;
    let (_dir, state) = test_state().await;
    let mut input = ladder_input(&["pong", "carom"], 1, &[SONNET]);
    input.gate = Some(Gate {
        unloaded_counts_as_broken: false,
        ..Gate::default()
    });
    let id = create_ladder(&state, input).await.unwrap().ladder.id;
    schedule(&state, &id, true, None).await;
    let first = top_up_ladder(&state, OWNER, &id).await.unwrap();
    fail_and_feed(&state, &job_ids(&first)[0], "pong", RunState::Catastrophic).await;
    let board = progress_of(&state, &id).await;
    let standing = climber(&board, SONNET);
    assert_eq!(
        standing.status,
        ClimberStatus::Failed,
        "not blocked as unrated"
    );
    assert!(in_flight(&state, "pong").await.is_empty());
}

// ---- Early stop on a ladder that pins one case twice ------------------------

#[tokio::test]
async fn early_stop_never_cancels_the_runs_of_a_later_rung_sharing_a_decided_cell() {
    let (_dir, state) = test_state().await;
    let mut input = ladder_input(&["pong", "carom", "pong"], 1, &[SONNET]);
    input.rungs[2].runs = Some(3);
    input.gate = Some(Gate {
        floor: Rating::Scuffed,
        threshold: GateThreshold::Fraction { fraction: 0.5 },
        unloaded_counts_as_broken: true,
        early_stop: true,
    });
    let id = create_ladder(&state, input).await.unwrap().ladder.id;
    schedule(&state, &id, true, Some(BufferTarget::Unbounded)).await;
    let first = top_up_ladder(&state, OWNER, &id).await.unwrap();
    finish_and_feed(&state, &job_ids(&first)[0], "pong", GREAT).await;
    let carom = in_flight(&state, "carom").await;
    assert_eq!(carom.len(), 1);
    finish_and_feed(&state, &carom[0].id, "carom", GREAT).await;

    // The third rung shares the first rung's cell: one great run is in hand, 1.5 are
    // needed of three, so two more were launched.
    let waiting = in_flight(&state, "pong").await;
    assert_eq!(waiting.len(), 2);
    let board = progress_of(&state, &id).await;
    assert_eq!(
        climber(&board, SONNET)
            .current_rung
            .as_ref()
            .unwrap()
            .position,
        2
    );

    // Passes the first rung's recorded verdict on every walk; its cell's waiting jobs are
    // the third rung's runs, and stay.
    let again = top_up_ladder(&state, OWNER, &id).await.unwrap();
    assert_eq!(again.early_stop_canceled, 0);
    assert_eq!(in_flight(&state, "pong").await.len(), 2);
}

// ---- Edits and restarts feed a ladder with nothing in flight ----------------

/// Wait for `slug` to have `count` jobs in flight, for a feed running on its own task.
async fn wait_for_in_flight(state: &AppState, slug: &str, count: usize) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
    loop {
        if in_flight(state, slug).await.len() == count {
            return;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "{slug} never reached {count} runs in flight"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

#[tokio::test]
async fn resuming_a_paused_climber_resumes_a_climb_with_nothing_in_flight() {
    let (_dir, state) = test_state().await;
    let id = create_ladder(&state, ladder_input(&["pong"], 1, &[SONNET]))
        .await
        .unwrap()
        .ladder
        .id;
    // Enabled, with its only climber paused and so nothing in flight.
    schedule(&state, &id, true, None).await;
    state
        .db
        .set_ladder_climber(
            &id,
            &StoredLadderClimber {
                combination_key: climber_key(&harness_combo(SONNET)),
                priority: 0,
                focused: false,
                paused: true,
                updated_at: "2026-10-01T00:00:00Z".to_string(),
                retried_at: None,
            },
        )
        .await
        .unwrap();
    assert!(
        top_up_ladder(&state, OWNER, &id)
            .await
            .unwrap()
            .cells
            .is_empty()
    );
    let _steered = set_climber(
        State(state.clone()),
        owner(),
        Path(id.clone()),
        Json(LadderClimberInput {
            combination: harness_combo(SONNET),
            priority: 0,
            focused: false,
            paused: false,
        }),
    )
    .await
    .unwrap();
    wait_for_in_flight(&state, "pong", 1).await;
}

#[tokio::test]
async fn creating_an_enabled_ladder_starts_its_climb() {
    let (_dir, state) = test_state().await;
    let mut input = ladder_input(&["pong", "carom"], 2, &[SONNET]);
    input.schedule = Some(LadderSchedule {
        outer_axis: LadderAxis::Rung,
        paused: false,
        buffer_target: None,
    });
    let ladder = create_ladder(&state, input).await.unwrap();
    assert!(!ladder.schedule.paused);
    wait_for_in_flight(&state, "pong", 2).await;
    assert!(in_flight(&state, "carom").await.is_empty());
}

#[tokio::test]
async fn an_edit_feeds_an_enabled_ladder_and_never_a_disabled_one() {
    let (_dir, state) = test_state().await;
    let id = create_ladder(&state, ladder_input(&["pong"], 1, &[SONNET]))
        .await
        .unwrap()
        .ladder
        .id;
    // A new ladder is disabled: an edit launches nothing.
    refeed(&state, OWNER, &id, "a test").await;
    assert!(in_flight(&state, "pong").await.is_empty());
    // Enabled, it feeds itself: there is no second switch to turn on.
    schedule(&state, &id, true, None).await;
    refeed(&state, OWNER, &id, "a test").await;
    assert_eq!(in_flight(&state, "pong").await.len(), 1);
}

#[tokio::test]
async fn the_backend_feeds_every_enabled_ladder_at_startup() {
    let (_dir, state) = test_state().await;
    let fed = create_ladder(&state, ladder_input(&["pong"], 1, &[SONNET]))
        .await
        .unwrap()
        .ladder
        .id;
    schedule(&state, &fed, true, None).await;
    let disabled = create_ladder(&state, ladder_input(&["carom"], 1, &[SONNET]))
        .await
        .unwrap()
        .ladder
        .id;
    schedule(&state, &disabled, false, None).await;
    spawn_startup_feed(state.clone());
    wait_for_in_flight(&state, "pong", 1).await;
    assert!(in_flight(&state, "carom").await.is_empty());
}

#[tokio::test]
async fn a_pass_that_finds_the_ladder_halted_enqueues_nothing() {
    let (_dir, state) = test_state().await;
    let id = create_ladder(&state, ladder_input(&["pong"], 1, &[SONNET]))
        .await
        .unwrap()
        .ladder
        .id;
    // Disabled after the pass took its claim, as a halt landing mid-pass does.
    schedule(&state, &id, false, None).await;
    let result = top_up_locked(&state, OWNER, &id, BufferTarget::Unbounded)
        .await
        .unwrap();
    assert_eq!(result.skipped, Some(TopUpSkipped::Paused));
    assert!(jobs(&state).await.is_empty());
}

// ---- Requests the claim holder cannot serve -----------------------------------

#[tokio::test]
async fn a_request_handed_off_by_a_holder_is_served_by_a_launch_pass_of_its_own() {
    let (_dir, state) = test_state().await;
    let id = create_ladder(&state, ladder_input(&["pong"], 1, &[SONNET]))
        .await
        .unwrap()
        .ladder
        .id;
    schedule(&state, &id, true, None).await;
    state.db.request_ladder_top_up(&id).await.unwrap();
    spawn_pending_top_up(&state, OWNER, &id);
    wait_for_in_flight(&state, "pong", 1).await;
    assert!(!state.db.ladder_top_up_requested(&id).await.unwrap());
}

#[tokio::test]
async fn a_claim_left_by_a_dead_process_does_not_turn_the_startup_feed_away() {
    let (_dir, state) = test_state().await;
    let id = create_ladder(&state, ladder_input(&["pong"], 1, &[SONNET]))
        .await
        .unwrap()
        .ladder
        .id;
    schedule(&state, &id, true, None).await;
    // The previous process died mid-pass, inside the claim's lease.
    assert!(
        state
            .db
            .claim_ladder_top_up(OWNER, &id, &now().unwrap())
            .await
            .unwrap()
    );
    assert_eq!(state.db.release_all_ladder_top_ups().await.unwrap(), 1);
    spawn_startup_feed(state.clone());
    wait_for_in_flight(&state, "pong", 1).await;
}

// ---- What counts toward a failing rung ----------------------------------------

/// Enqueue three jobs of the shared climber on `pong` and fail them one after another,
/// each with `detail`, and each with a run in `run_state` when one is given.
async fn fail_three_jobs(
    state: &AppState,
    detail: Option<&str>,
    run_state: Option<test_cabinet_core::run_record::RunState>,
) {
    for n in 0..3 {
        let job_id = format!("failed-{n}");
        state
            .db
            .enqueue_job(crate::db::NewJob {
                model_id: SONNET.to_string(),
                ..crate::db::tests::new_job(&job_id, "2026-10-01T00:00:00Z")
            })
            .await
            .unwrap();
        let record_id = match run_state {
            Some(run_state) => {
                let mut record = run_of(&format!("run-{job_id}"), "pong", GREAT);
                record.status.state = run_state;
                record.validation.loaded = false;
                state.db.push(&record, &links(), None, None).await.unwrap();
                Some(record.id)
            }
            None => None,
        };
        state
            .db
            .set_job_state(
                &job_id,
                "failed",
                &format!("2026-10-01T00:0{n}:00Z"),
                detail,
                record_id.as_deref(),
            )
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn jobs_a_restart_reaped_never_make_a_rung_failing() {
    let (_dir, state) = test_state().await;
    let id = create_ladder(&state, ladder_input(&["pong"], 1, &[SONNET]))
        .await
        .unwrap()
        .ladder
        .id;
    schedule(&state, &id, true, None).await;
    fail_three_jobs(&state, Some(crate::db::REAPED_DETAIL), None).await;
    let result = top_up_ladder(&state, OWNER, &id).await.unwrap();
    assert_eq!(result.enqueued, 1, "{:?}", result.unlaunchable);
    assert!(result.unlaunchable.is_empty());
}

#[tokio::test]
async fn model_failures_are_evidence_and_never_a_failing_rung() {
    use test_cabinet_core::run_record::RunState;
    let (_dir, state) = test_state().await;
    let id = create_ladder(&state, ladder_input(&["pong", "carom"], 5, &[SONNET]))
        .await
        .unwrap()
        .ladder
        .id;
    schedule(&state, &id, true, Some(BufferTarget::Unbounded)).await;
    // Three timeouts land as failed jobs carrying the model's run.
    fail_three_jobs(&state, Some("run failed"), Some(RunState::TimedOut)).await;

    let result = top_up_ladder(&state, OWNER, &id).await.unwrap();
    assert_eq!(result.enqueued, 2, "the rung's last two runs are launched");
    assert!(result.unlaunchable.is_empty(), "{:?}", result.unlaunchable);
    let board = progress_of(&state, &id).await;
    let standing = climber(&board, SONNET);
    assert_eq!(standing.status, ClimberStatus::Running);
    assert_eq!(standing.current_rung.as_ref().unwrap().tally.completed, 3);
}

// ---- A model failure the backend retries ---------------------------------------

/// Report `job_id` finished through the driver's status endpoint with `record`.
async fn report(state: &AppState, job_id: &str, record: RunRecord) {
    let token = state.db.get_job(job_id).await.unwrap().unwrap().job_token;
    let mut headers = HeaderMap::new();
    headers.insert(
        axum::http::header::AUTHORIZATION,
        format!("Bearer {token}").parse().unwrap(),
    );
    let status = super::super::jobs::update_status(
        State(state.clone()),
        Path(job_id.to_string()),
        headers,
        Json(StatusUpdate {
            state: DriverState::Succeeded,
            record: Some(record),
            detail: None,
        }),
    )
    .await
    .unwrap();
    assert_eq!(status, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn a_retried_model_failure_waits_for_its_retry_and_counts_once() {
    use test_cabinet_core::run_record::RunState;
    let (_dir, state) = test_state().await;
    let mut input = ladder_input(&["pong", "carom"], 1, &[SONNET]);
    input.gate = Some(Gate {
        early_stop: true,
        ..Gate::default()
    });
    let id = create_ladder(&state, input).await.unwrap().ladder.id;
    schedule(&state, &id, true, None).await;
    let first = top_up_ladder(&state, OWNER, &id).await.unwrap();
    let attempt = job_ids(&first)[0].clone();

    // The attempt ends catastrophic, and the backend retries it.
    let mut record = run_of("run-attempt", "pong", GREAT);
    record.status.state = RunState::Catastrophic;
    record.validation.loaded = false;
    report(&state, &attempt, record).await;
    let retry = state
        .db
        .get_job(&attempt)
        .await
        .unwrap()
        .unwrap()
        .retried_by
        .expect("the attempt was retried");

    // The retry takes the attempt's place: the rung is undecided, nothing early-stops it,
    // and nothing else is launched.
    let again = top_up_ladder(&state, OWNER, &id).await.unwrap();
    assert_eq!(again.enqueued, 0);
    assert_eq!(again.early_stop_canceled, 0);
    let board = progress_of(&state, &id).await;
    let standing = climber(&board, SONNET);
    assert_eq!(standing.status, ClimberStatus::Running);
    let tally = standing.current_rung.as_ref().unwrap().tally;
    assert_eq!((tally.completed, tally.pending), (0, 1));
    let pong = in_flight(&state, "pong").await;
    assert_eq!(pong.len(), 1);
    assert_eq!(pong[0].id, retry);

    // The retry passes: one launch, one run, and the climber advances.
    let job = finish(&state, &retry, run_of("run-retry", "pong", GREAT)).await;
    feed_ladders(&state, &job).await;
    let board = progress_of(&state, &id).await;
    let standing = climber(&board, SONNET);
    assert_eq!(standing.outcomes[0].outcome, LadderOutcome::Passed);
    let counted: u32 = state
        .db
        .count_model_runs_by_cell(&["pong".to_string()])
        .await
        .unwrap()
        .values()
        .copied()
        .sum();
    assert_eq!(
        counted, 1,
        "the attempt and its retry are one of the rung's runs"
    );
    assert_eq!(in_flight(&state, "carom").await.len(), 1);
}
