//! The shared harness of the launch-pass flow tests (`ladders.flow.test.rs`,
//! `coverage.flow.test.rs`): a backend state over an in-memory database and a definition
//! store holding real manifests, and the moves a driver, the dispatcher and another
//! launch make on its jobs.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

use axum::Json;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use sea_orm::EntityTrait;
use test_cabinet_core::job_api::{DriverState, StatusUpdate};
use test_cabinet_core::run_record::{HarnessSlug, RunRecord, RunState};
use test_cabinet_core::test_case::TestType;
use test_cabinet_entities::job;

use super::AppState;
use super::coverage::ReviewPlanCombo;
use crate::auth::AuthUser;
use crate::db::JobOrigin;
use crate::db::tests::{links, priced_model_write, validator_manifest, validator_record};
/// The account every ladder here belongs to.
pub(crate) const OWNER: &str = "owner-1";

/// The model every climber here runs, priced in the catalog so a launch pass can launch it
/// without reaching OpenRouter.
pub(crate) const SONNET: &str = "claude-sonnet-4-5";

/// A backend state over an in-memory database and a temporary store that holds three
/// validator-rated versions (`pong`, `carom`, `volley`), a legacy one (`breakout`), a
/// performance case (`perf`) and a game jam (`jam`), all at `v1.0.0`. Prices point at
/// an address nothing listens on, so a path that reached the network fails loudly.
pub(crate) async fn test_state() -> (tempfile::TempDir, AppState) {
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

pub(crate) fn owner() -> AuthUser {
    AuthUser(test_cabinet_core::Account {
        id: OWNER.to_string(),
        username: "owner".to_string(),
        display_name: "Owner".to_string(),
        picture_updated_at: None,
    })
}

pub(crate) fn harness_combo(model: &str) -> ReviewPlanCombo {
    ReviewPlanCombo {
        harness: HarnessSlug::Claude,
        model: model.to_string(),
        provider: None,
        gg_config_id: None,
        gg_slot_models: BTreeMap::new(),
        gg_config_name: None,
    }
}

/// A second priced model, for a dispatch with two climbers.
pub(crate) const OPUS: &str = "claude-opus-4-8";

/// Price [`OPUS`] in the catalog.
pub(crate) async fn price_opus(state: &AppState) {
    state
        .db
        .upsert_model_config(priced_model_write("opus", "Claude Opus 4.8", &[OPUS]))
        .await
        .unwrap();
}

/// Feed a job that just reached a terminal state, as the driver's status report does.
pub(crate) async fn feed(state: &AppState, job: &job::Model) {
    super::launch::feed_finished_job(state, job).await;
}

/// Set a job's state directly, as the dispatcher or a driver moves it.
pub(crate) async fn set_state(state: &AppState, job_id: &str, to: &str) {
    state
        .db
        .set_job_state(job_id, to, "2026-10-02T00:00:00Z", None, None)
        .await
        .unwrap()
        .expect("the job exists");
}

/// Enqueue a job of `slug` on the shared climber with the given origin, as another
/// launch (a hand launch, a plan, another dispatch) would.
pub(crate) async fn enqueue_other(
    state: &AppState,
    job_id: &str,
    slug: &str,
    origin: Option<&str>,
) {
    state
        .db
        .enqueue_job(crate::db::NewJob {
            test_case_slug: slug.to_string(),
            model_id: SONNET.to_string(),
            user_id: Some(OWNER.to_string()),
            origin: origin.and_then(JobOrigin::parse),
            ..crate::db::tests::new_job(job_id, "2026-10-01T00:00:00Z")
        })
        .await
        .unwrap();
}

/// Enqueue a job of `slug` on the shared climber now, as a launch by hand made at this
/// moment would: a launch created after everything that has ended so far.
pub(crate) async fn enqueue_now(state: &AppState, job_id: &str, slug: &str) {
    let now = super::jobs::now_rfc3339().unwrap();
    state
        .db
        .enqueue_job(crate::db::NewJob {
            test_case_slug: slug.to_string(),
            model_id: SONNET.to_string(),
            user_id: Some(OWNER.to_string()),
            ..crate::db::tests::new_job(job_id, &now)
        })
        .await
        .unwrap();
}

/// Enqueue a second job carrying `of`'s cell and origin: the duplicate an automatic retry
/// or a restart's reaping used to leave in flight beside the original.
pub(crate) async fn duplicate(state: &AppState, of: &job::Model, job_id: &str) {
    state
        .db
        .enqueue_job(crate::db::NewJob {
            test_case_slug: of.test_case_slug.clone(),
            test_case_version: of.test_case_version.clone(),
            variant: of.variant.clone(),
            harness_slug: of.harness_slug.clone(),
            model_id: of.model_id.clone(),
            engine_slug: of.engine_slug.clone(),
            user_id: of.user_id.clone(),
            origin: of.origin.as_deref().and_then(JobOrigin::parse),
            ..crate::db::tests::new_job(job_id, "2026-10-01T00:00:00Z")
        })
        .await
        .unwrap();
}

/// Wait for `slug` to have `count` jobs in flight, for a pass running on its own task.
pub(crate) async fn wait_for_in_flight(state: &AppState, slug: &str, count: usize) {
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

/// Report `job_id` finished through the driver's status endpoint with `record`.
pub(crate) async fn report(state: &AppState, job_id: &str, record: RunRecord) {
    let token = state.db.get_job(job_id).await.unwrap().unwrap().job_token;
    let mut headers = HeaderMap::new();
    headers.insert(
        axum::http::header::AUTHORIZATION,
        format!("Bearer {token}").parse().unwrap(),
    );
    let status = super::jobs::update_status(
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

/// Report `job_id` failed with no run, as a driver whose infrastructure broke does: the
/// backend retries it while the launch has retries left. Returns the id of the retry it
/// enqueued, if any.
pub(crate) async fn report_failed(state: &AppState, job_id: &str) -> Option<String> {
    let token = state.db.get_job(job_id).await.unwrap().unwrap().job_token;
    let mut headers = HeaderMap::new();
    headers.insert(
        axum::http::header::AUTHORIZATION,
        format!("Bearer {token}").parse().unwrap(),
    );
    let status = super::jobs::update_status(
        State(state.clone()),
        Path(job_id.to_string()),
        headers,
        Json(StatusUpdate {
            state: DriverState::Failed,
            record: None,
            detail: Some("harness unavailable".to_string()),
        }),
    )
    .await
    .unwrap();
    assert_eq!(status, StatusCode::NO_CONTENT);
    let job = state.db.get_job(job_id).await.unwrap().unwrap();
    assert_eq!(job.state, "failed");
    job.retried_by
}

/// The `retryCount` a job's launch request carries.
pub(crate) fn retry_count_of(job: &job::Model) -> Option<u64> {
    let request: serde_json::Value = serde_json::from_str(&job.request_json).unwrap();
    request
        .get("retryCount")
        .and_then(serde_json::Value::as_u64)
}

/// A run of `slug` that ended on `run_state` rather than completing.
pub(crate) fn ended_run(id: &str, slug: &str, run_state: RunState) -> RunRecord {
    let mut record = run_of(id, slug, GREAT);
    record.status.state = run_state;
    record.validation.loaded = false;
    record
}

/// A run record of `slug` on the shared climber, its validators deciding `verdicts`.
pub(crate) fn run_of(id: &str, slug: &str, verdicts: &[(&str, bool)]) -> RunRecord {
    let mut record = validator_record(id, verdicts);
    record.subject.test_case_slug = slug.to_string();
    record.subject.model_id = SONNET.to_string();
    record
}

/// The verdicts that rate a run `great` (the cosmetic point fails).
pub(crate) const GREAT: &[(&str, bool)] = &[("serve", true), ("hud", false)];
/// The verdicts that rate a run `broken` (the gameplay-critical point fails).
pub(crate) const BROKEN: &[(&str, bool)] = &[("serve", false), ("hud", true)];

/// Finish one job as a driver would: push the run it produced (rated by its validators at
/// push, from the store's manifest) and mark the job succeeded. Returns the finished row.
pub(crate) async fn finish(state: &AppState, job_id: &str, record: RunRecord) -> job::Model {
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
pub(crate) async fn finish_and_feed(
    state: &AppState,
    job_id: &str,
    slug: &str,
    verdicts: &[(&str, bool)],
) {
    // Each run finishes a second after the one before it, as runs finished in turn do.
    // Left on the fixture's one shared instant, two runs of a cell would be ordered by
    // their ids, which are random, and a slot's first runs would differ from run to run.
    static FINISHED: AtomicU32 = AtomicU32::new(0);
    let nth = FINISHED.fetch_add(1, Ordering::Relaxed);
    let mut record = run_of(&format!("run-{job_id}"), slug, verdicts);
    record.finished_at = format!("2026-10-02T00:{:02}:{:02}Z", nth / 60, nth % 60);
    let job = finish(state, job_id, record).await;
    feed(state, &job).await;
}

/// Every publish job, oldest first.
pub(crate) async fn publish_jobs(
    state: &AppState,
) -> Vec<test_cabinet_entities::publish_job::Model> {
    use sea_orm::QueryOrder;
    use test_cabinet_entities::publish_job;
    publish_job::Entity::find()
        .order_by_asc(publish_job::Column::CreatedAt)
        .order_by_asc(publish_job::Column::Id)
        .all(&state.db.connection())
        .await
        .unwrap()
}

/// The ids of the runs that have a publish job, oldest job first.
pub(crate) async fn publishing(state: &AppState) -> Vec<String> {
    publish_jobs(state)
        .await
        .into_iter()
        .map(|job| job.run_id)
        .collect()
}

/// Every job, oldest first.
pub(crate) async fn jobs(state: &AppState) -> Vec<job::Model> {
    use sea_orm::QueryOrder;
    job::Entity::find()
        .order_by_asc(job::Column::QueueSeq)
        .all(&state.db.connection())
        .await
        .unwrap()
}

/// The in-flight jobs of one case slug.
pub(crate) async fn in_flight(state: &AppState, slug: &str) -> Vec<job::Model> {
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
