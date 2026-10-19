//! Tests for the control loop's claim leases, driven tick by tick against a stub
//! backend and an in-memory cluster.
//!
//! The stub backend serves the job endpoints the dispatcher calls over a small
//! in-memory job table, keeping the backend's lease rules: a claim leases the job two
//! minutes out and first returns every `dispatched` job whose lease lapsed to the
//! queue at its original position with a fresh per-job token; a renewal extends the
//! lease of each listed job still driven. A test lapses a lease by writing an expiry
//! in the past into the table, so no test waits on a clock. Every call is recorded
//! with the credential it presented, in order.

use super::*;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::Router;
use axum::extract::{Path as AxumPath, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use k8s_openapi::api::batch::v1::Job;
use time::macros::format_description;
use tokio::net::TcpListener;

use test_cabinet_contracts::job_api::{LaunchBody, LeaseRenewal, StatusUpdate};
use test_cabinet_contracts::run_record::HarnessSlug;

use crate::config::DriverResources;
use crate::job::JOB_ID_LABEL;

/// The service token the stub accepts and the dispatcher presents.
const SERVICE_TOKEN: &str = "svc-token";

/// A lease expiry long past.
const LAPSED: &str = "2000-01-01T00:00:00Z";

// ---------------------------------------------------------------------------
// The stub backend
// ---------------------------------------------------------------------------

/// One job in the stub's table.
#[derive(Debug, Clone)]
struct StubJob {
    id: String,
    queue_seq: i64,
    state: &'static str,
    token: String,
    lease: Option<String>,
    attempt: u32,
}

/// One call the dispatcher made: method and path, the bearer it presented, and the
/// body (as JSON, `Null` for none).
#[derive(Debug, Clone)]
struct Call {
    route: String,
    bearer: Option<String>,
    body: serde_json::Value,
}

/// The stub backend's shared state.
#[derive(Debug, Default)]
struct Backend {
    jobs: Vec<StubJob>,
    calls: Vec<Call>,
    /// Answer `POST /jobs/leases` with a `503`.
    fail_renewal: bool,
    /// Tokens minted so far, to keep each fresh.
    minted: u32,
}

type Shared = Arc<Mutex<Backend>>;

impl Backend {
    fn mint(&mut self, id: &str) -> String {
        self.minted += 1;
        format!("tok-{id}-{}", self.minted)
    }

    fn job(&mut self, id: &str) -> Option<&mut StubJob> {
        self.jobs.iter_mut().find(|job| job.id == id)
    }
}

/// Two minutes past now, in the whole-second form the backend writes.
fn lease_from_now() -> String {
    (OffsetDateTime::now_utc() + time::Duration::minutes(2))
        .format(format_description!(
            "[year]-[month]-[day]T[hour]:[minute]:[second]Z"
        ))
        .expect("format lease")
}

fn lapsed_at(lease: Option<&str>, now: OffsetDateTime) -> bool {
    lease
        .and_then(|lease| OffsetDateTime::parse(lease, &Rfc3339).ok())
        .is_none_or(|expiry| expiry < now)
}

fn bearer(headers: &HeaderMap) -> Option<String> {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::to_string)
}

fn record(backend: &mut Backend, route: String, headers: &HeaderMap, body: serde_json::Value) {
    backend.calls.push(Call {
        route,
        bearer: bearer(headers),
        body,
    });
}

fn is_service(headers: &HeaderMap) -> bool {
    bearer(headers).as_deref() == Some(SERVICE_TOKEN)
}

/// A representative launch request.
fn launch() -> LaunchBody {
    LaunchBody {
        test_case: "pong".to_string(),
        version: "v1.0.0".to_string(),
        variant: "base".to_string(),
        harness: HarnessSlug::Claude,
        model: "anthropic/claude".to_string(),
        orchestrator: None,
        engine: None,
        max_runtime_seconds: None,
        auth_mode: None,
        retry_count: None,
        gg_capability_set: None,
        gg_model_windows: Default::default(),
        gg_model_providers: Default::default(),
        gg_model_modalities: Default::default(),
        gg_model_prices: Default::default(),
        model_prices: None,
    }
}

/// `POST /jobs/next`: requeue every lapsed `dispatched` job, then claim the queued
/// job with the lowest queue position.
async fn claim(State(shared): State<Shared>, headers: HeaderMap) -> Response {
    let mut backend = shared.lock().expect("lock");
    record(
        &mut backend,
        "POST /jobs/next".into(),
        &headers,
        serde_json::Value::Null,
    );
    if !is_service(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let now = OffsetDateTime::now_utc();
    let lapsed: Vec<String> = backend
        .jobs
        .iter()
        .filter(|job| job.state == "dispatched" && lapsed_at(job.lease.as_deref(), now))
        .map(|job| job.id.clone())
        .collect();
    for id in lapsed {
        let token = backend.mint(&id);
        let job = backend.job(&id).expect("job");
        job.state = "queued";
        job.token = token;
        job.lease = None;
    }
    let Some(next) = backend
        .jobs
        .iter()
        .filter(|job| job.state == "queued")
        .min_by_key(|job| job.queue_seq)
        .map(|job| job.id.clone())
    else {
        return StatusCode::NO_CONTENT.into_response();
    };
    let job = backend.job(&next).expect("job");
    job.state = "dispatched";
    job.lease = Some(lease_from_now());
    let claimed = ClaimedJob {
        job_id: job.id.clone(),
        job_token: job.token.clone(),
        request: launch(),
    };
    axum::Json(claimed).into_response()
}

/// `POST /jobs/leases`: extend each listed job still driven.
async fn renew(
    State(shared): State<Shared>,
    headers: HeaderMap,
    axum::Json(body): axum::Json<LeaseRenewal>,
) -> Response {
    let mut backend = shared.lock().expect("lock");
    record(
        &mut backend,
        "POST /jobs/leases".into(),
        &headers,
        serde_json::to_value(&body).expect("json"),
    );
    if !is_service(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if backend.fail_renewal {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    for id in &body.job_ids {
        if let Some(job) = backend.job(id)
            && matches!(job.state, "dispatched" | "starting" | "running" | "storing")
        {
            job.lease = Some(lease_from_now());
        }
    }
    StatusCode::NO_CONTENT.into_response()
}

/// `GET /jobs/active`: every job not yet terminal, with its lease.
async fn active(State(shared): State<Shared>, headers: HeaderMap) -> Response {
    let mut backend = shared.lock().expect("lock");
    record(
        &mut backend,
        "GET /jobs/active".into(),
        &headers,
        serde_json::Value::Null,
    );
    let rows: Vec<serde_json::Value> = backend
        .jobs
        .iter()
        .filter(|job| !matches!(job.state, "succeeded" | "failed" | "canceled"))
        .map(|job| {
            serde_json::json!({
                "runId": job.id,
                "state": job.state,
                "leaseExpiresAt": job.lease,
            })
        })
        .collect();
    axum::Json(rows).into_response()
}

/// `GET /jobs/{id}`: the job's state.
async fn status_of(
    State(shared): State<Shared>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
) -> Response {
    let mut backend = shared.lock().expect("lock");
    record(
        &mut backend,
        format!("GET /jobs/{id}"),
        &headers,
        serde_json::Value::Null,
    );
    match backend.job(&id) {
        Some(job) => {
            axum::Json(serde_json::json!({ "id": id, "state": job.state })).into_response()
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

/// `POST /jobs/{id}/lost`: fail a job past `dispatched`.
async fn lost(
    State(shared): State<Shared>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
    axum::Json(body): axum::Json<StatusUpdate>,
) -> Response {
    let mut backend = shared.lock().expect("lock");
    record(
        &mut backend,
        format!("POST /jobs/{id}/lost"),
        &headers,
        serde_json::to_value(&body).expect("json"),
    );
    if !is_service(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if let Some(job) = backend.job(&id)
        && matches!(job.state, "starting" | "running" | "storing")
    {
        job.state = "failed";
    }
    StatusCode::NO_CONTENT.into_response()
}

/// `POST /jobs/{id}/status`: recorded only; no test expects one.
async fn status(
    State(shared): State<Shared>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
    axum::Json(body): axum::Json<StatusUpdate>,
) -> Response {
    let mut backend = shared.lock().expect("lock");
    record(
        &mut backend,
        format!("POST /jobs/{id}/status"),
        &headers,
        serde_json::to_value(&body).expect("json"),
    );
    StatusCode::NO_CONTENT.into_response()
}

/// Serve the stub backend over `shared`, answering its base URL.
async fn serve(shared: Shared) -> String {
    let app = Router::new()
        .route("/jobs/next", post(claim))
        .route("/jobs/leases", post(renew))
        .route("/jobs/active", get(active))
        .route("/jobs/{id}", get(status_of))
        .route("/jobs/{id}/lost", post(lost))
        .route("/jobs/{id}/status", post(status))
        .with_state(shared);
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("addr");
    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("serve");
    });
    format!("http://{addr}")
}

// ---------------------------------------------------------------------------
// The in-memory cluster
// ---------------------------------------------------------------------------

/// The in-memory cluster's state.
#[derive(Debug, Default)]
struct ClusterState {
    managed: Vec<ManagedJob>,
    /// How many of the next `create_job` calls fail.
    failing_creates: usize,
    /// Every `Job` created, in order.
    created: Vec<Job>,
}

/// A cluster held in memory, shared with the test that inspects it.
#[derive(Debug, Clone, Default)]
struct FakeCluster(Arc<Mutex<ClusterState>>);

impl Cluster for FakeCluster {
    async fn create_job(&self, job: &Job) -> anyhow::Result<()> {
        let mut state = self.0.lock().expect("lock");
        if state.failing_creates > 0 {
            state.failing_creates -= 1;
            anyhow::bail!("the API server refused the Job");
        }
        let job_id = job
            .metadata
            .labels
            .as_ref()
            .and_then(|labels| labels.get(JOB_ID_LABEL))
            .cloned();
        state.managed.push(ManagedJob {
            job_id,
            name: job.metadata.name.clone().unwrap_or_default(),
            kind: JobKind::Run,
            phase: JobPhase::Active,
        });
        state.created.push(job.clone());
        Ok(())
    }

    async fn list_managed(&self) -> anyhow::Result<Vec<ManagedJob>> {
        Ok(self.0.lock().expect("lock").managed.clone())
    }

    async fn failure_detail(&self, job_name: &str) -> String {
        format!("driver Job `{job_name}` failed")
    }

    async fn delete_sandbox_pods(&self, _job_id: &str) -> anyhow::Result<usize> {
        Ok(0)
    }
}

/// A driver `Job` for `job_id` in `phase`.
fn driver_job(job_id: &str, phase: JobPhase) -> ManagedJob {
    ManagedJob {
        job_id: Some(job_id.to_string()),
        name: format!("tcab-driver-{job_id}"),
        kind: JobKind::Run,
        phase,
    }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/// A config against the stub at `backend_url`, with publishing off.
fn config(backend_url: &str) -> Config {
    Config {
        backend_url: backend_url.to_string(),
        service_token: SERVICE_TOKEN.to_string(),
        driver_image: "registry.example.com/tcab-driver:test".to_string(),
        namespace: "tcab".to_string(),
        sandbox_namespace: "tcab".to_string(),
        driver_service_account: None,
        max_inflight: 8,
        max_publish_inflight: 2,
        poll_interval: Duration::from_secs(1),
        job_ttl_seconds: 300,
        driver_termination_grace_seconds: 120,
        driver_resources: DriverResources::default(),
        publisher_resources: DriverResources::default(),
        driver_secrets: Vec::new(),
        driver_subscription_secret: None,
        subscription_dir: "/var/run/tcab/subscription".to_string(),
        driver_auth_mode: None,
        passthrough_k8s_env: Vec::new(),
        publisher_image: None,
        publisher_secrets: Vec::new(),
        passthrough_publisher_env: Vec::new(),
    }
}

/// A freshly built dispatcher over a stub backend holding `jobs` and a cluster
/// holding `managed`, with the handles to both.
async fn fresh(
    jobs: Vec<StubJob>,
    managed: Vec<ManagedJob>,
) -> (Dispatcher<FakeCluster>, Shared, FakeCluster) {
    let shared: Shared = Arc::new(Mutex::new(Backend {
        jobs,
        ..Backend::default()
    }));
    let url = serve(shared.clone()).await;
    let cluster = FakeCluster::default();
    cluster.0.lock().expect("lock").managed = managed;
    let dispatcher = Dispatcher::new(
        config(&url),
        BackendClient::new(&url, SERVICE_TOKEN),
        cluster.clone(),
    );
    (dispatcher, shared, cluster)
}

fn stub_job(id: &str, queue_seq: i64, state: &'static str, lease: Option<&str>) -> StubJob {
    StubJob {
        id: id.to_string(),
        queue_seq,
        state,
        token: format!("tok-{id}-0"),
        lease: lease.map(str::to_string),
        attempt: 0,
    }
}

fn routes(shared: &Shared) -> Vec<String> {
    shared
        .lock()
        .expect("lock")
        .calls
        .iter()
        .map(|call| call.route.clone())
        .collect()
}

/// The calls that report a job's outcome: a lost report or a status report.
fn reports(shared: &Shared) -> Vec<Call> {
    shared
        .lock()
        .expect("lock")
        .calls
        .iter()
        .filter(|call| call.route.ends_with("/lost") || call.route.ends_with("/status"))
        .cloned()
        .collect()
}

fn env_of(job: &Job, name: &str) -> Option<String> {
    job.spec
        .as_ref()?
        .template
        .spec
        .as_ref()?
        .containers
        .first()?
        .env
        .as_ref()?
        .iter()
        .find(|var| var.name == name)?
        .value
        .clone()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/// A claim whose `Job` creation failed is recovered by its lease: once the lease
/// lapses, the next claim hands the same job back ahead of work queued after it,
/// under a fresh token, and nothing reports it or counts an attempt.
#[tokio::test]
async fn a_claim_whose_job_creation_failed_returns_to_the_queue_at_its_position() {
    let (mut dispatcher, shared, cluster) = fresh(
        vec![
            stub_job("first", 1, "queued", None),
            stub_job("second", 2, "queued", None),
        ],
        Vec::new(),
    )
    .await;
    cluster.0.lock().expect("lock").failing_creates = 1;

    // Tick 1 claims `first`; its `Job` creation fails, so nothing is admitted.
    let admitted = dispatcher.tick().await.expect("tick");
    assert!(!admitted, "a failed Job creation admitted nothing");
    let first_token = {
        let backend = shared.lock().expect("lock");
        let first = backend
            .jobs
            .iter()
            .find(|job| job.id == "first")
            .expect("first");
        assert_eq!(first.state, "dispatched");
        assert!(first.lease.is_some(), "the claim leased the job");
        first.token.clone()
    };

    // A live `Job` would have been renewed; this one has none, so its lease lapses.
    shared
        .lock()
        .expect("lock")
        .job("first")
        .expect("first")
        .lease = Some(LAPSED.into());

    // Tick 2: the backend's claim returns `first` to the queue and hands it back at
    // its position, ahead of `second`.
    let admitted = dispatcher.tick().await.expect("tick");
    assert!(admitted);
    let created = cluster.0.lock().expect("lock").created.clone();
    assert_eq!(created.len(), 1);
    assert_eq!(env_of(&created[0], "TCAB_JOB_ID").as_deref(), Some("first"));
    let new_token = env_of(&created[0], "TCAB_JOB_TOKEN").expect("token");
    assert_ne!(
        new_token, first_token,
        "the reclaimed job carries a fresh token"
    );

    let backend = shared.lock().expect("lock");
    let first = backend
        .jobs
        .iter()
        .find(|job| job.id == "first")
        .expect("first");
    assert_eq!(first.queue_seq, 1, "the job kept its queue position");
    assert_eq!(first.attempt, 0, "no attempt was counted");
    assert_eq!(first.token, new_token);
    let second = backend
        .jobs
        .iter()
        .find(|job| job.id == "second")
        .expect("second");
    assert_eq!(
        second.state, "queued",
        "work queued later still waits behind it"
    );
    assert_eq!(backend.jobs.len(), 2, "no retry was enqueued");
    drop(backend);
    assert!(
        reports(&shared).is_empty(),
        "nothing reported the recovered claim: {:?}",
        reports(&shared)
    );
}

/// A lease that lapsed while the dispatcher was down is renewed for a job whose
/// `Job` is live, before any lease is judged, so a freshly built dispatcher reports
/// nothing lost.
#[tokio::test]
async fn a_fresh_dispatcher_renews_a_lapsed_lease_whose_job_is_live() {
    let (mut dispatcher, shared, _cluster) = fresh(
        vec![stub_job("live", 1, "running", Some(LAPSED))],
        vec![driver_job("live", JobPhase::Active)],
    )
    .await;

    dispatcher.tick().await.expect("tick");

    let calls = routes(&shared);
    let renewal = calls
        .iter()
        .position(|route| route == "POST /jobs/leases")
        .expect("the tick renewed the leases");
    let read = calls
        .iter()
        .position(|route| route == "GET /jobs/active")
        .expect("the tick read the jobs in flight");
    assert!(renewal < read, "renewed before judging: {calls:?}");

    let backend = shared.lock().expect("lock");
    let call = &backend.calls[renewal];
    assert_eq!(call.bearer.as_deref(), Some(SERVICE_TOKEN));
    assert_eq!(call.body, serde_json::json!({ "jobIds": ["live"] }));
    let live = backend
        .jobs
        .iter()
        .find(|job| job.id == "live")
        .expect("live");
    assert_eq!(live.state, "running");
    assert!(
        !lapsed_at(live.lease.as_deref(), OffsetDateTime::now_utc()),
        "the lease was extended"
    );
    drop(backend);
    assert!(reports(&shared).is_empty(), "nothing was reported lost");
}

/// A driven job with a lapsed lease and no `Job` is lost: a freshly built dispatcher
/// reports it on its first tick, with the service token, waiting out no grace.
#[tokio::test]
async fn a_fresh_dispatcher_reports_a_lapsed_lease_with_no_job_lost_at_once() {
    let (mut dispatcher, shared, _cluster) = fresh(
        vec![stub_job("gone", 1, "running", Some(LAPSED))],
        Vec::new(),
    )
    .await;

    dispatcher.tick().await.expect("tick");

    let reports = reports(&shared);
    assert_eq!(reports.len(), 1, "one report: {reports:?}");
    assert_eq!(reports[0].route, "POST /jobs/gone/lost");
    assert_eq!(reports[0].bearer.as_deref(), Some(SERVICE_TOKEN));
    assert_eq!(reports[0].body["state"], "failed");
    let detail = reports[0].body["detail"].as_str().expect("detail");
    assert!(detail.contains("no longer exists"), "detail: {detail}");
    assert_eq!(
        shared
            .lock()
            .expect("lock")
            .job("gone")
            .expect("gone")
            .state,
        "failed"
    );
}

/// A job with no lease at all (one in flight when leases were introduced) counts as
/// lapsed, and its detail says what the cluster shows of a `Job` that finished.
#[tokio::test]
async fn a_driven_job_with_no_lease_and_a_finished_job_is_reported_lost() {
    let (mut dispatcher, shared, _cluster) = fresh(
        vec![
            stub_job("exited", 1, "storing", None),
            stub_job("died", 2, "starting", None),
        ],
        vec![
            driver_job("exited", JobPhase::Complete),
            driver_job("died", JobPhase::Failed),
        ],
    )
    .await;

    dispatcher.tick().await.expect("tick");

    let lost: Vec<(String, String)> = reports(&shared)
        .into_iter()
        .filter(|call| call.route.ends_with("/lost"))
        .map(|call| {
            (
                call.route,
                call.body["detail"].as_str().unwrap_or_default().to_string(),
            )
        })
        .collect();
    assert_eq!(lost.len(), 2, "{lost:?}");
    assert!(
        lost.iter()
            .any(|(route, detail)| route == "POST /jobs/exited/lost"
                && detail.contains("exited without its final status"))
    );
    assert!(
        lost.iter()
            .any(|(route, detail)| route == "POST /jobs/died/lost"
                && detail == "driver Job `tcab-driver-died` failed")
    );
}

/// A tick whose renewal failed judges no lease: a lease it should have extended may
/// read as lapsed, so nothing is reported lost until a renewal succeeds.
#[tokio::test]
async fn a_failed_renewal_judges_no_lease_that_tick() {
    let (mut dispatcher, shared, _cluster) = fresh(
        vec![
            stub_job("live", 1, "running", Some(LAPSED)),
            stub_job("gone", 2, "running", Some(LAPSED)),
        ],
        vec![driver_job("live", JobPhase::Active)],
    )
    .await;
    shared.lock().expect("lock").fail_renewal = true;

    dispatcher.tick().await.expect("tick");

    assert!(
        reports(&shared).is_empty(),
        "nothing reported lost: {:?}",
        reports(&shared)
    );
    assert!(
        !routes(&shared)
            .iter()
            .any(|route| route == "GET /jobs/active"),
        "the leases were not read for judgment"
    );

    // Once a renewal succeeds, only the job with no live `Job` is lost.
    shared.lock().expect("lock").fail_renewal = false;
    dispatcher.tick().await.expect("tick");
    let lost: Vec<String> = reports(&shared)
        .into_iter()
        .map(|call| call.route)
        .collect();
    assert_eq!(lost, vec!["POST /jobs/gone/lost".to_string()]);
}

/// A lapsed `dispatched` job is the backend's to return to the queue, never the
/// dispatcher's to report lost.
#[tokio::test]
async fn a_lapsed_dispatched_job_is_never_reported_lost() {
    let (mut dispatcher, shared, cluster) = fresh(
        vec![stub_job("claimed", 1, "dispatched", Some(LAPSED))],
        Vec::new(),
    )
    .await;
    // Admission takes no slot from it: hold the run lane shut so the claim that
    // would requeue it is not made and the job stays `dispatched` through the tick.
    dispatcher.config.max_inflight = 0;

    dispatcher.tick().await.expect("tick");

    assert!(
        routes(&shared)
            .iter()
            .any(|route| route == "GET /jobs/active"),
        "the leases were judged"
    );
    assert!(reports(&shared).is_empty(), "{:?}", reports(&shared));
    assert_eq!(
        shared
            .lock()
            .expect("lock")
            .job("claimed")
            .expect("claimed")
            .state,
        "dispatched"
    );
    assert!(cluster.0.lock().expect("lock").created.is_empty());
}

/// Only a live driver `Job`'s lease is renewed: a finished `Job`, a publish `Job`
/// and a `Job` without a job id name nothing to renew, and with nothing to renew no
/// renewal call is made.
#[tokio::test]
async fn only_live_driver_jobs_are_renewed() {
    let (mut dispatcher, shared, _cluster) = fresh(
        Vec::new(),
        vec![
            driver_job("done", JobPhase::Complete),
            driver_job("dead", JobPhase::Failed),
            ManagedJob {
                job_id: Some("pub".into()),
                name: "tcab-publisher-pub".into(),
                kind: JobKind::Publish,
                phase: JobPhase::Active,
            },
        ],
    )
    .await;

    dispatcher.tick().await.expect("tick");

    assert!(
        !routes(&shared)
            .iter()
            .any(|route| route == "POST /jobs/leases"),
        "{:?}",
        routes(&shared)
    );
}
