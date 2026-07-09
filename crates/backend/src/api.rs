//! The Axum HTTP surface: shared state and router wiring (§1 of
//! `design/v0.2.0-contracts.md`).
//!
//! There is **no app-level auth** — the backend trusts every caller that can
//! reach it (the private-network model). Handlers are grouped by area into the
//! submodules below; this module owns the shared [`AppState`] and assembles the
//! router every endpoint is mounted on.

use std::sync::Arc;

use axum::Router;
use axum::extract::{DefaultBodyLimit, Request};
use axum::routing::{get, post};
use tower_http::cors::{AllowHeaders, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::config::Config;
use crate::db::Db;
use crate::publish_relay::PublishRelay;
use crate::publisher::Publisher;
use crate::relay::Relay;
use crate::store::DefinitionStore;

mod ingest_api;
mod jobs;
mod models;
mod publish_jobs;
mod runs;
mod test_cases;
mod tournaments;

// Re-export the HTTP response contract types so the `contract-codegen` generator
// can name them (the handler modules themselves stay private).
pub use jobs::{
    ActiveJobOut, ClaimedJob, DriverState, JobState, JobStatusOut, LaunchAck, LaunchBody,
    StatusUpdate,
};
pub use models::{
    LogoFetchInput, LogoFetchOut, ModelCatalogResponse, ModelConfigInput, ModelOut, ModelPricesOut,
    ModelSeedOut, PriceObservationOut, compose_catalog,
};
pub use test_cases::{CatalogCase, CatalogResponse, VersionResponse, VersionsResponse};

/// Shared application state handed to every handler.
#[derive(Clone)]
pub struct AppState {
    /// The system-of-record SQLite store.
    pub db: Arc<Db>,
    /// The on-disk definition store.
    pub store: DefinitionStore,
    /// The coalescing snapshot publisher.
    pub publisher: Publisher,
    /// Verifies bearer tokens against the standalone auth service. The mutating
    /// run endpoints require a valid token (see [`crate::auth::AuthUser`]).
    pub auth: Arc<test_cabinet_core::AccountsClient>,
    /// The live event/preview fan-out for in-flight runs (the `/jobs/{id}/live`
    /// and `/notifications` streams), fed by the drivers' progress ingestion.
    pub relay: Relay,
    /// The live progress fan-out for in-flight publish jobs (the
    /// `/publish-jobs/{id}/live` stream), fed by the publisher's progress and
    /// terminal-result ingestion. The publish path's analogue of [`relay`].
    pub publish_relay: PublishRelay,
    /// The resolved configuration (checkout path for ingest, etc.).
    pub config: Arc<Config>,
    /// The HTTP client for the backend's own outbound calls — today the best-effort
    /// prune of a deleted run's tree in the artifact service (see
    /// [`crate::artifacts`]) and the svgl.app model-logo fetch.
    pub http: reqwest::Client,
    /// The OpenRouter price source used to record a model's price history when a
    /// run completes and on the periodic refresh.
    pub prices: test_cabinet_core::OpenRouterPrices,
}

/// The maximum body size, in bytes, accepted on the run-media and tournament-replay
/// upload routes (proof media, asset media, the controller wasm, a tournament match
/// replay).
///
/// Axum's default request-body limit is 2 MiB, which is far too small for these:
/// an adversarial run's proof replay serializes to tens of MiB (a full-length
/// time-limit Pac-Man match is ~20 MiB), and a proof video clip is comparable.
/// Without this raised ceiling those POSTs are rejected with `413` — and because
/// the adversarial upload sequences the controller wasm *after* the replays, a
/// rejected canonical replay silently aborted the whole upload before the
/// controller landed, leaving a completed run's controller out of the backend store
/// and so invisible in the arena (Quick Match / tournaments). The artifact service
/// raises its own (whole-tarball) limit for the same reason.
const MAX_RUN_UPLOAD_BYTES: usize = 512 * 1024 * 1024;

/// Build the Axum router with every contract endpoint mounted.
pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(health))
        // The console's client configuration: today just the data-plane artifact
        // service base URL, so the console can resolve a pre-publish run's build
        // and media links against it (the control-plane backend never serves the
        // bytes). A single read, no auth.
        .route("/config", get(client_config))
        .route("/ingest", post(ingest_api::ingest))
        // The model catalog: a merged read (curated config ⋃ models derived from
        // runs, with price history) plus operator-driven config CRUD, a
        // seed-from-run authoring helper, and the svgl.app logo fetch. Reads are
        // open; the mutations, the seed, and the logo fetch require a token.
        // `/models/seed` and `/models/logo` are static, so they outrank the
        // `/models/{slug}` dynamic route regardless of registration order.
        .route("/models", get(models::list).post(models::create))
        .route("/models/seed", get(models::seed))
        .route("/models/logo", post(models::logo))
        .route(
            "/models/{slug}",
            axum::routing::put(models::update).delete(models::delete),
        )
        .route("/test-cases", get(test_cases::catalog))
        .route("/test-cases/{slug}/versions", get(test_cases::versions))
        .route(
            "/test-cases/{slug}/versions/{version}",
            get(test_cases::resolve_version),
        )
        // Record a variant's authored reference-implementation URL (auth-gated,
        // same bearer guard as the other write paths). The `tcab publish-reference`
        // CLI builds and deploys the variant's static site out-of-band, then PUTs
        // the served URL here; the version response and public snapshot fold it onto
        // the variant. Reads stay open via the resolve/snapshot paths.
        .route(
            "/test-cases/{slug}/versions/{version}/reference-builds/{variant}",
            axum::routing::put(test_cases::put_reference_build),
        )
        .route(
            "/test-cases/{slug}/versions/{version}/artifacts/{*path}",
            get(test_cases::artifact),
        )
        .route(
            "/test-cases/{slug}/versions/{version}/references/{scope}/{view}",
            get(test_cases::reference),
        )
        // List runs. `GET /runs` lists published runs by default; `?state=review`
        // lists all runs (pending + published) for the reviewer worklist. A run's
        // record is stored on the backend by the driver when the run finishes (via
        // `POST /jobs/{id}/status`); there is no operator-driven push.
        .route("/runs", get(runs::list))
        // The adversarial controllers for a case (id + model label), so the arena
        // can pit a produced implementation from any host. A read.
        .route("/adversarial/controllers", get(runs::adversarial_controllers))
        // Read one run, or delete it (auth-gated; refused for a published run).
        .route("/runs/{id}", get(runs::get).delete(runs::delete))
        // Submit a review for a run (requires auth; attributed to the token's
        // account). A run may carry many reviews, one per account.
        .route("/runs/{id}/reviews", post(runs::add_review))
        // Publish a run (requires auth; refused with no reviews). Flips it public.
        .route("/runs/{id}/publish", post(runs::publish))
        // A published run's proof-of-implementation media (`<proof-id>.<ext>`):
        // uploaded by the publisher (POST) and served as-is for the reviewer UI's
        // submitted-evidence panes (GET).
        .route(
            "/runs/{id}/proof/{file}",
            get(test_cases::run_proof)
                .post(test_cases::put_run_proof)
                .layer(DefaultBodyLimit::max(MAX_RUN_UPLOAD_BYTES)),
        )
        // A published asset-generation run's media (regenerated image, final
        // preview, target, action log): uploaded by the publisher (POST) and
        // served for the gallery's result view (GET).
        .route(
            "/runs/{id}/asset/{file}",
            get(test_cases::run_asset)
                .post(test_cases::put_run_asset)
                .layer(DefaultBodyLimit::max(MAX_RUN_UPLOAD_BYTES)),
        )
        // An adversarial run's pushed controller wasm: uploaded by the publisher at
        // push (POST) and served so the arena can pit a pushed implementation from
        // any host (GET).
        .route(
            "/runs/{id}/controller.wasm",
            get(test_cases::run_controller)
                .post(test_cases::put_run_controller)
                .layer(DefaultBodyLimit::max(MAX_RUN_UPLOAD_BYTES)),
        )
        // The published run's recorded, normalized event stream (TTC events only;
        // raw harness output is never published). Backs the run-detail Events tab
        // for the web console reading published runs.
        .route("/runs/{id}/events", get(runs::events))
        // Adversarial tournaments: a persisted field's standings + per-match
        // summaries (live-only — not folded into the public-site snapshot), with
        // each match's replay served on demand for browser playback.
        .route(
            "/tournaments",
            post(tournaments::publish).get(tournaments::list),
        )
        .route("/tournaments/{id}", get(tournaments::get))
        .route(
            "/tournaments/{id}/matches/{matchId}/replay.json",
            get(tournaments::match_replay)
                .post(tournaments::put_match_replay)
                .layer(DefaultBodyLimit::max(MAX_RUN_UPLOAD_BYTES)),
        )
        // The run queue. A console enqueues a run (`POST /jobs`, auth-gated); the
        // dispatcher claims the oldest (`POST /jobs/next`, service-token); a
        // per-run driver streams progress and the terminal record back
        // (`POST /jobs/{id}/events|preview|status`, per-job token). The console
        // observes it via the live stream, the status, and the active-run list.
        // `/jobs/active` and `/jobs/next` are static, so they outrank the
        // `/jobs/{id}` dynamic route regardless of registration order.
        .route("/jobs", post(jobs::launch))
        .route("/jobs/active", get(jobs::active))
        .route("/jobs/next", post(jobs::claim))
        .route("/jobs/{id}", get(jobs::status))
        // Kill an in-flight run: moves it to the terminal `canceled` state and
        // closes its live stream. Gated on the launching account (bearer token).
        .route("/jobs/{id}/cancel", post(jobs::cancel))
        .route("/jobs/{id}/live", get(jobs::live))
        .route("/jobs/{id}/events", post(jobs::ingest_events))
        .route("/jobs/{id}/preview", post(jobs::ingest_preview))
        .route("/jobs/{id}/status", post(jobs::update_status))
        // The artifact service's internal job-token verify call: it forwards the
        // driver's per-job token here (the backend is the token authority) before
        // accepting an upload. The presented token is the secret, so this needs no
        // other auth.
        .route("/jobs/{id}/verify-token", post(jobs::verify_token))
        // The publish queue. A console enqueues a publish (`POST /runs/{id}/publish`,
        // auth-gated, in `runs`); the dispatcher claims the oldest
        // (`POST /publish-jobs/next`, service-token); a per-publish `tcab-publisher`
        // pod streams progress and the terminal result back
        // (`POST /publish-jobs/{id}/events|result`, per-job token). The console
        // observes it via the live NDJSON stream, which ends with the result.
        // `/publish-jobs/next` is static, so it outranks the `/publish-jobs/{id}`
        // dynamic route regardless of registration order.
        .route("/publish-jobs/next", post(publish_jobs::claim))
        .route("/publish-jobs/{id}", get(publish_jobs::status))
        .route("/publish-jobs/{id}/live", get(publish_jobs::live))
        .route("/publish-jobs/{id}/events", post(publish_jobs::ingest_events))
        .route("/publish-jobs/{id}/result", post(publish_jobs::report_result))
        // The artifact service's internal publish-job-token verify call: it forwards
        // the publisher's per-job token here (the backend is the token authority)
        // before serving the run's `tree.tar`. The presented token is the secret, so
        // this needs no other auth.
        .route(
            "/publish-jobs/{id}/verify-token",
            post(publish_jobs::verify_token),
        )
        // The worker-wide run-completion feed (SSE), so the console can alert on
        // any run finishing without holding a per-run subscription open.
        .route("/notifications", get(jobs::notifications))
        .route("/snapshot/refresh", post(runs::refresh))
        // Telemetry. Layers wrap from the bottom up, so `TraceLayer` (added last)
        // is outermost: it creates one server span per request and enters it for
        // the inner stack. `trace_and_measure` (added first, thus nested inside)
        // therefore runs *within* that span — it grafts the caller's W3C trace
        // context onto the span (so server spans join the client's trace) and
        // records request metrics. Both degrade to no-ops when telemetry is off.
        .layer(axum::middleware::from_fn(trace_and_measure))
        .layer(TraceLayer::new_for_http())
        // The browser UIs (gallery web app, Tauri dev server) run on a different
        // localhost origin than this backend, so every request is cross-origin.
        // The backend already trusts every caller that can reach it (the
        // private-network, no-auth model in this module's docs); a permissive CORS
        // policy keeps the browser from blocking those callers without narrowing
        // that model. No credentials are sent, so a wildcard origin is valid.
        // `permissive()` sets `Access-Control-Allow-Headers: *`, but per the Fetch
        // spec `*` does not cover `Authorization`, so a browser rejects a preflight
        // for a request carrying our bearer token. Mirror the request's headers
        // instead, which echoes `Authorization` back explicitly.
        .layer(CorsLayer::permissive().allow_headers(AllowHeaders::mirror_request()))
        .with_state(state)
}

/// Middleware run inside the per-request server span: graft the caller's inbound
/// W3C trace context onto the current span so the backend's spans join the
/// client's trace, then time the request and record its metrics. Both halves are
/// no-ops when telemetry is disabled.
async fn trace_and_measure(
    request: Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    // Recover the caller's parent context from the inbound headers and attach it
    // to the current (TraceLayer-created) span. A no-op when no propagator is
    // installed (telemetry disabled).
    test_cabinet_telemetry::propagation::accept_inbound(request.headers());
    crate::metrics::record_request(request, next).await
}

/// The contract version this backend implements, reported by `/healthz`. This
/// is the API contract milestone (§1.1's literal `"0.2.0"`), independent of the
/// crate's `version` (the workspace pins all crates at a placeholder `0.0.0`).
const CONTRACT_VERSION: &str = "0.2.0";

/// `GET /healthz` — liveness/readiness probe (§1.1).
async fn health() -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({
        "status": "ok",
        "version": CONTRACT_VERSION,
        "store": "ready",
    }))
}

/// `GET /config` — the console's client configuration.
///
/// The console talks to one backend URL, but a *pre-publish* run's playable build
/// and proof/asset media live behind the separate **artifact service** (the data
/// plane — see `crates/artifacts`). Its base URL is reported here so the console
/// can prefix the root-relative `links.playable_build` (and the `/runs/{id}/proof|asset/…`
/// paths) a driver sets. `artifactsUrl` is `null` when no artifact service is
/// configured (`TCAB_ARTIFACTS_PUBLIC_URL` unset) — e.g. a single-box dev setup —
/// in which case the console leaves those links unresolved. `arenaUrl` likewise
/// reports the **arena service** (`TCAB_ARENA_PUBLIC_URL`) the console POSTs
/// adversarial matches/tournaments to and streams live tournament progress from;
/// `null` degrades the adversarial run UI.
async fn client_config(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> axum::Json<ClientConfig> {
    axum::Json(ClientConfig {
        artifacts_url: state.config.artifacts_url.clone(),
        arena_url: state.config.arena_url.clone(),
    })
}

/// The body of `GET /config`: the console's client-side configuration.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ClientConfig {
    /// The artifact service's public base URL, or `null` when artifacts are not
    /// served separately. The console resolves a pre-publish run's build and media
    /// links against it.
    #[cfg_attr(feature = "contract", ts(optional))]
    pub artifacts_url: Option<String>,
    /// The arena service's public base URL, or `null` when adversarial execution is
    /// not served separately. The console POSTs matches/tournaments and streams live
    /// tournament progress against it; the adversarial run UI degrades when absent.
    #[cfg_attr(feature = "contract", ts(optional))]
    pub arena_url: Option<String>,
}
