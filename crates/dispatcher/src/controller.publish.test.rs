//! Tests for the publish lane's claim leases: the pure renewal and lapse decisions,
//! and the control loop driven tick by tick against a stub backend and an in-memory
//! cluster.
//!
//! The stub backend serves the publish-job endpoints the dispatcher calls over a
//! small in-memory table, keeping the backend's rules: a renewal extends the lease of
//! each listed publish job still `dispatched` to two minutes out, and a lost report
//! fails a `dispatched` publish job and leaves any other alone. The run endpoints
//! answer an empty queue and no jobs in flight. A test lapses a lease by writing an
//! expiry in the past into the table, so no test waits on a clock. Every call is
//! recorded with the credential it presented, in order.

use super::*;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::Router;
use axum::extract::{Path as AxumPath, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use k8s_openapi::api::batch::v1::Job;
use time::macros::datetime;
use tokio::net::TcpListener;

use test_cabinet_contracts::job_api::LeaseRenewal;
use test_cabinet_contracts::publish_job_api::PublishResult;

use crate::config::DriverResources;

/// The service token the stub accepts and the dispatcher presents.
const SERVICE_TOKEN: &str = "svc-token";

/// A lease expiry long past.
const LAPSED: &str = "2000-01-01T00:00:00Z";

/// A lease expiry far in the future.
const FUTURE: &str = "2999-01-01T00:00:00Z";

// ---------------------------------------------------------------------------
// The pure decisions
// ---------------------------------------------------------------------------

fn managed(job_id: Option<&str>, kind: JobKind, phase: JobPhase) -> ManagedJob {
    let prefix = match kind {
        JobKind::Run => "tcab-driver-",
        JobKind::Publish => "tcab-publisher-",
    };
    ManagedJob {
        job_id: job_id.map(str::to_string),
        name: format!("{prefix}{}", job_id.unwrap_or("unlabelled")),
        kind,
        phase,
    }
}

fn row(id: &str, state: PublishJobState, lease: Option<&str>) -> ActivePublishJob {
    ActivePublishJob {
        id: id.to_string(),
        run_id: format!("run-{id}"),
        state,
        lease_expires_at: lease.map(str::to_string),
    }
}

/// Only a live publisher `Job` names a publish lease to renew: a driver `Job`, a
/// finished or failed publisher `Job`, and a `Job` without a job id do not.
#[test]
fn publish_renewals_pick_live_publisher_jobs_only() {
    let jobs = vec![
        managed(Some("live"), JobKind::Publish, JobPhase::Active),
        managed(Some("done"), JobKind::Publish, JobPhase::Complete),
        managed(Some("dead"), JobKind::Publish, JobPhase::Failed),
        managed(None, JobKind::Publish, JobPhase::Active),
        managed(Some("run"), JobKind::Run, JobPhase::Active),
    ];
    assert_eq!(publish_lease_renewals(&jobs), vec!["live".to_string()]);
    assert_eq!(lease_renewals(&jobs), vec!["run".to_string()]);
}

/// A `dispatched` publish job whose lease lapsed, is absent or does not parse is
/// lapsed; one leased into the future is not, and a `queued` job never is.
#[test]
fn publish_lapsed_picks_dispatched_jobs_with_a_lapsed_or_missing_lease() {
    let now = datetime!(2026-10-19 11:30:00 UTC);
    let jobs = vec![
        row("lapsed", PublishJobState::Dispatched, Some(LAPSED)),
        row("missing", PublishJobState::Dispatched, None),
        row("garbled", PublishJobState::Dispatched, Some("not a time")),
        row("leased", PublishJobState::Dispatched, Some(FUTURE)),
        row("queued", PublishJobState::Queued, None),
        row("queued-lapsed", PublishJobState::Queued, Some(LAPSED)),
    ];
    assert_eq!(
        publish_lapsed(&jobs, now),
        vec![
            "lapsed".to_string(),
            "missing".to_string(),
            "garbled".to_string()
        ]
    );
}

/// The expiries are compared as instants: an expiry whose text sorts after `now`
/// but whose instant is before it has lapsed, and the reverse has not.
#[test]
fn publish_lapsed_compares_instants_not_strings() {
    let now = datetime!(2026-10-19 11:30:00 UTC);
    let jobs = vec![
        // 11:00:30Z: lapsed, though its text sorts after now's.
        row(
            "behind",
            PublishJobState::Dispatched,
            Some("2026-10-19T12:00:30+01:00"),
        ),
        // 12:00:00Z: still leased, though its text sorts before now's.
        row(
            "ahead",
            PublishJobState::Dispatched,
            Some("2026-10-19T11:00:00-01:00"),
        ),
    ];
    assert_eq!(publish_lapsed(&jobs, now), vec!["behind".to_string()]);
}

// ---------------------------------------------------------------------------
// The stub backend
// ---------------------------------------------------------------------------

/// One publish job in the stub's table.
#[derive(Debug, Clone)]
struct StubPublish {
    id: String,
    state: &'static str,
    lease: Option<String>,
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
    publishes: Vec<StubPublish>,
    calls: Vec<Call>,
    /// Answer `POST /publish-jobs/leases` with a `503`.
    fail_renewal: bool,
    /// Accept `POST /publish-jobs/leases` without extending any lease, as a backend
    /// whose clock runs ahead of the dispatcher's would appear to.
    renewal_extends_nothing: bool,
}

type Shared = Arc<Mutex<Backend>>;

impl Backend {
    fn publish(&mut self, id: &str) -> Option<&mut StubPublish> {
        self.publishes.iter_mut().find(|job| job.id == id)
    }
}

fn bearer(headers: &HeaderMap) -> Option<String> {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::to_string)
}

fn record(shared: &Shared, route: String, headers: &HeaderMap, body: serde_json::Value) {
    shared.lock().expect("lock").calls.push(Call {
        route,
        bearer: bearer(headers),
        body,
    });
}

fn is_service(headers: &HeaderMap) -> bool {
    bearer(headers).as_deref() == Some(SERVICE_TOKEN)
}

/// `POST /jobs/next` and `POST /publish-jobs/next`: both queues are empty.
async fn empty_claim(State(shared): State<Shared>, headers: HeaderMap) -> Response {
    record(
        &shared,
        "POST next".into(),
        &headers,
        serde_json::Value::Null,
    );
    StatusCode::NO_CONTENT.into_response()
}

/// `GET /jobs/active`: no run in flight.
async fn no_runs(State(shared): State<Shared>, headers: HeaderMap) -> Response {
    record(
        &shared,
        "GET /jobs/active".into(),
        &headers,
        serde_json::Value::Null,
    );
    axum::Json(Vec::<serde_json::Value>::new()).into_response()
}

/// `POST /publish-jobs/leases`: extend each listed publish job still `dispatched`.
async fn renew(
    State(shared): State<Shared>,
    headers: HeaderMap,
    axum::Json(body): axum::Json<LeaseRenewal>,
) -> Response {
    record(
        &shared,
        "POST /publish-jobs/leases".into(),
        &headers,
        serde_json::to_value(&body).expect("json"),
    );
    if !is_service(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let mut backend = shared.lock().expect("lock");
    if backend.fail_renewal {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    if !backend.renewal_extends_nothing {
        for id in &body.job_ids {
            if let Some(job) = backend.publish(id)
                && job.state == "dispatched"
            {
                job.lease = Some(FUTURE.to_string());
            }
        }
    }
    StatusCode::NO_CONTENT.into_response()
}

/// `GET /publish-jobs/active`: every `queued` or `dispatched` publish job.
async fn active(State(shared): State<Shared>, headers: HeaderMap) -> Response {
    record(
        &shared,
        "GET /publish-jobs/active".into(),
        &headers,
        serde_json::Value::Null,
    );
    if !is_service(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let backend = shared.lock().expect("lock");
    let rows: Vec<serde_json::Value> = backend
        .publishes
        .iter()
        .filter(|job| matches!(job.state, "queued" | "dispatched"))
        .map(|job| {
            serde_json::json!({
                "id": job.id,
                "runId": format!("run-{}", job.id),
                "state": job.state,
                "leaseExpiresAt": job.lease,
            })
        })
        .collect();
    axum::Json(rows).into_response()
}

/// `POST /publish-jobs/{id}/lost`: fail a `dispatched` publish job.
async fn lost(
    State(shared): State<Shared>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
    axum::Json(body): axum::Json<PublishResult>,
) -> Response {
    record(
        &shared,
        format!("POST /publish-jobs/{id}/lost"),
        &headers,
        serde_json::to_value(&body).expect("json"),
    );
    if !is_service(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let mut backend = shared.lock().expect("lock");
    match backend.publish(&id) {
        Some(job) => {
            if job.state == "dispatched" {
                job.state = "failed";
            }
            StatusCode::NO_CONTENT.into_response()
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

/// Serve the stub backend over `shared`, answering its base URL.
async fn serve(shared: Shared) -> String {
    let app = Router::new()
        .route("/jobs/next", post(empty_claim))
        .route("/jobs/active", get(no_runs))
        .route("/publish-jobs/next", post(empty_claim))
        .route("/publish-jobs/leases", post(renew))
        .route("/publish-jobs/active", get(active))
        .route("/publish-jobs/{id}/lost", post(lost))
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

/// A cluster holding a fixed set of `Job`s.
#[derive(Debug, Clone, Default)]
struct FakeCluster(Arc<Mutex<Vec<ManagedJob>>>);

impl Cluster for FakeCluster {
    async fn create_job(&self, _job: &Job) -> anyhow::Result<()> {
        anyhow::bail!("no test admits a job")
    }

    async fn list_managed(&self) -> anyhow::Result<Vec<ManagedJob>> {
        Ok(self.0.lock().expect("lock").clone())
    }

    async fn failure_detail(&self, job_name: &str) -> String {
        format!("publisher Job `{job_name}` failed: OOMKilled (exit 137)")
    }

    async fn delete_sandbox_pods(&self, _job_id: &str) -> anyhow::Result<usize> {
        Ok(0)
    }
}

/// A publisher `Job` for `job_id` in `phase`.
fn publisher_job(job_id: &str, phase: JobPhase) -> ManagedJob {
    managed(Some(job_id), JobKind::Publish, phase)
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/// A config against the stub at `backend_url`, with publishing on and both lanes
/// held shut so no tick claims.
fn config(backend_url: &str) -> Config {
    Config {
        backend_url: backend_url.to_string(),
        service_token: SERVICE_TOKEN.to_string(),
        driver_image: "registry.example.com/tcab-driver:test".to_string(),
        namespace: "tcab".to_string(),
        sandbox_namespace: "tcab".to_string(),
        driver_service_account: None,
        max_inflight: 0,
        max_publish_inflight: 0,
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
        publisher_image: Some("registry.example.com/tcab-publisher:test".to_string()),
        publisher_secrets: Vec::new(),
        passthrough_publisher_env: Vec::new(),
    }
}

/// A freshly built dispatcher over a stub backend holding `publishes` and a cluster
/// holding `managed`, with the handle to the backend.
async fn fresh(
    publishes: Vec<StubPublish>,
    managed: Vec<ManagedJob>,
) -> (Dispatcher<FakeCluster>, Shared) {
    let shared: Shared = Arc::new(Mutex::new(Backend {
        publishes,
        ..Backend::default()
    }));
    let url = serve(shared.clone()).await;
    let cluster = FakeCluster(Arc::new(Mutex::new(managed)));
    let dispatcher = Dispatcher::new(
        config(&url),
        BackendClient::new(&url, SERVICE_TOKEN),
        cluster,
    );
    (dispatcher, shared)
}

fn stub(id: &str, state: &'static str, lease: Option<&str>) -> StubPublish {
    StubPublish {
        id: id.to_string(),
        state,
        lease: lease.map(str::to_string),
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

/// The publish lost reports made, in order.
fn lost_reports(shared: &Shared) -> Vec<Call> {
    shared
        .lock()
        .expect("lock")
        .calls
        .iter()
        .filter(|call| {
            call.route.starts_with("POST /publish-jobs/") && call.route.ends_with("/lost")
        })
        .cloned()
        .collect()
}

fn state_of(shared: &Shared, id: &str) -> &'static str {
    shared
        .lock()
        .expect("lock")
        .publish(id)
        .expect("publish job")
        .state
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

/// A publish job whose publisher `Job` is live is renewed before any publish lease
/// is judged, even when its lease lapsed while the dispatcher was down; a
/// `dispatched` publish job with no publisher `Job` is reported lost, with the
/// service token and a failed result naming the vanished `Job`.
#[tokio::test]
async fn a_vanished_publisher_is_reported_lost_and_a_live_one_is_renewed() {
    let (mut dispatcher, shared) = fresh(
        vec![
            stub("live", "dispatched", Some(LAPSED)),
            stub("gone", "dispatched", Some(LAPSED)),
        ],
        vec![publisher_job("live", JobPhase::Active)],
    )
    .await;

    dispatcher.tick().await.expect("tick");

    let calls = routes(&shared);
    let renewal = calls
        .iter()
        .position(|route| route == "POST /publish-jobs/leases")
        .expect("the tick renewed the publish leases");
    let read = calls
        .iter()
        .position(|route| route == "GET /publish-jobs/active")
        .expect("the tick read the publish jobs in flight");
    assert!(renewal < read, "renewed before judging: {calls:?}");
    {
        let backend = shared.lock().expect("lock");
        let call = &backend.calls[renewal];
        assert_eq!(call.bearer.as_deref(), Some(SERVICE_TOKEN));
        assert_eq!(call.body, serde_json::json!({ "jobIds": ["live"] }));
        assert_eq!(backend.calls[read].bearer.as_deref(), Some(SERVICE_TOKEN));
    }

    let reports = lost_reports(&shared);
    assert_eq!(reports.len(), 1, "one report: {reports:?}");
    assert_eq!(reports[0].route, "POST /publish-jobs/gone/lost");
    assert_eq!(reports[0].bearer.as_deref(), Some(SERVICE_TOKEN));
    assert_eq!(reports[0].body["state"], "failed");
    let detail = reports[0].body["detail"].as_str().expect("detail");
    assert!(
        detail.contains("publisher's Kubernetes Job no longer exists"),
        "detail: {detail}"
    );
    assert_eq!(state_of(&shared, "gone"), "failed");
    assert_eq!(state_of(&shared, "live"), "dispatched");
}

/// A lost publish job's detail says what the cluster shows of its publisher `Job`:
/// the cluster's failure detail for a failed one (a hung publisher stopped at its
/// deadline among them), and an undelivered result for one that completed. A
/// publish job with no lease at all counts as lapsed.
#[tokio::test]
async fn a_finished_publisher_job_is_reported_lost_with_what_the_cluster_shows() {
    let (mut dispatcher, shared) = fresh(
        vec![
            stub("died", "dispatched", Some(LAPSED)),
            stub("exited", "dispatched", None),
        ],
        vec![
            publisher_job("died", JobPhase::Failed),
            publisher_job("exited", JobPhase::Complete),
        ],
    )
    .await;

    dispatcher.tick().await.expect("tick");

    let lost: Vec<(String, String)> = lost_reports(&shared)
        .into_iter()
        .map(|call| {
            (
                call.route,
                call.body["detail"].as_str().unwrap_or_default().to_string(),
            )
        })
        .collect();
    assert_eq!(lost.len(), 2, "{lost:?}");
    assert!(lost.contains(&(
        "POST /publish-jobs/died/lost".to_string(),
        "publisher Job `tcab-publisher-died` failed: OOMKilled (exit 137)".to_string()
    )));
    assert!(lost.contains(&(
        "POST /publish-jobs/exited/lost".to_string(),
        "the publisher exited without its result reaching the backend".to_string()
    )));
    assert!(
        !routes(&shared)
            .iter()
            .any(|route| route == "POST /publish-jobs/leases"),
        "no live publisher Job, so no renewal call"
    );
}

/// A publish job whose publisher `Job` is live is never reported lost, even when
/// its lease still reads as lapsed after this tick's renewal (a clock disagreement
/// between the dispatcher and the backend).
#[tokio::test]
async fn a_live_publisher_job_is_never_reported_lost() {
    let (mut dispatcher, shared) = fresh(
        vec![stub("live", "dispatched", Some(LAPSED))],
        vec![publisher_job("live", JobPhase::Active)],
    )
    .await;
    shared.lock().expect("lock").renewal_extends_nothing = true;

    dispatcher.tick().await.expect("tick");

    assert!(
        routes(&shared)
            .iter()
            .any(|route| route == "GET /publish-jobs/active"),
        "the publish leases were judged"
    );
    assert!(
        lost_reports(&shared).is_empty(),
        "{:?}",
        lost_reports(&shared)
    );
    assert_eq!(state_of(&shared, "live"), "dispatched");
}

/// A tick whose publish renewal failed judges no publish lease; once a renewal
/// succeeds, only the publish job with no live publisher `Job` is lost.
#[tokio::test]
async fn a_failed_publish_renewal_judges_no_publish_lease_that_tick() {
    let (mut dispatcher, shared) = fresh(
        vec![
            stub("live", "dispatched", Some(LAPSED)),
            stub("gone", "dispatched", Some(LAPSED)),
        ],
        vec![publisher_job("live", JobPhase::Active)],
    )
    .await;
    shared.lock().expect("lock").fail_renewal = true;

    dispatcher.tick().await.expect("tick");

    assert!(
        lost_reports(&shared).is_empty(),
        "{:?}",
        lost_reports(&shared)
    );
    assert!(
        !routes(&shared)
            .iter()
            .any(|route| route == "GET /publish-jobs/active"),
        "the publish leases were not read for judgment"
    );

    shared.lock().expect("lock").fail_renewal = false;
    dispatcher.tick().await.expect("tick");
    let lost: Vec<String> = lost_reports(&shared)
        .into_iter()
        .map(|call| call.route)
        .collect();
    assert_eq!(lost, vec!["POST /publish-jobs/gone/lost".to_string()]);
}

/// A `queued` publish job has no publisher to lose, and a `dispatched` one whose
/// lease still runs is not judged lost.
#[tokio::test]
async fn queued_and_leased_publish_jobs_are_not_reported_lost() {
    let (mut dispatcher, shared) = fresh(
        vec![
            stub("waiting", "queued", None),
            stub("leased", "dispatched", Some(FUTURE)),
        ],
        Vec::new(),
    )
    .await;

    dispatcher.tick().await.expect("tick");

    assert!(
        lost_reports(&shared).is_empty(),
        "{:?}",
        lost_reports(&shared)
    );
    assert_eq!(state_of(&shared, "waiting"), "queued");
    assert_eq!(state_of(&shared, "leased"), "dispatched");
}

/// With publishing disabled the dispatcher touches no publish endpoint: it neither
/// renews nor judges a publish lease.
#[tokio::test]
async fn publishing_disabled_leaves_the_publish_leases_alone() {
    let (mut dispatcher, shared) = fresh(
        vec![stub("gone", "dispatched", Some(LAPSED))],
        vec![publisher_job("live", JobPhase::Active)],
    )
    .await;
    dispatcher.config.publisher_image = None;

    dispatcher.tick().await.expect("tick");

    let calls = routes(&shared);
    assert!(
        !calls.iter().any(|route| route.contains("/publish-jobs/")),
        "{calls:?}"
    );
    assert_eq!(state_of(&shared, "gone"), "dispatched");
}

/// A publisher `Job` is never mistaken for a driver `Job`: the run lane renews no
/// publish job, and a run's lost detection does not report one.
#[tokio::test]
async fn the_run_lane_leaves_publisher_jobs_alone() {
    let (mut dispatcher, shared) = fresh(
        vec![stub("live", "dispatched", Some(FUTURE))],
        vec![publisher_job("live", JobPhase::Active)],
    )
    .await;

    dispatcher.tick().await.expect("tick");

    let calls = routes(&shared);
    assert!(
        !calls.iter().any(|route| route == "POST /jobs/leases"),
        "{calls:?}"
    );
    assert!(
        !calls
            .iter()
            .any(|route| route.starts_with("POST /jobs/") && route.ends_with("/lost")),
        "{calls:?}"
    );
}
