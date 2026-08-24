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
use axum::routing::{get, post, put};
use tower_http::compression::CompressionLayer;
use tower_http::cors::{AllowHeaders, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::config::Config;
use crate::db::Db;
use crate::publish_relay::PublishRelay;
use crate::publisher::Publisher;
use crate::readiness::Readiness;
use crate::relay::Relay;
use crate::store::DefinitionStore;

mod comparisons;
mod coverage;
mod game_jams;
mod gg;
mod gg_agent;
mod gg_config;
mod gg_query;
mod gg_reference;
mod gg_view;
mod harness_config;
mod ingest_api;
mod jobs;
mod ladders;
mod model_probes;
mod models;
mod publish_jobs;
mod runs;
mod stats;
mod test_cases;
mod tournaments;

// Re-export the HTTP response contract types so the `contract-codegen` generator
// can name them (the handler modules themselves stay private).
pub use comparisons::ComparisonInput;
// Reused by the snapshot publisher so a published comparison is folded into the
// public snapshot with the exact computation the internal `/comparisons` API uses.
pub use crate::probe::ProbeMessage;
pub(crate) use comparisons::assemble_comparison;
pub use coverage::{
    CoverageAxis, CoverageCell, CoverageGroup, CoverageGroupInput, CoverageGroupKind,
    CoverageMatrix, CoveragePlan, CoveragePlanInput, CoveragePlanOut, CoveragePlanSummary,
    CoverageQueue, CoverageQueueEntry, CoverageSchedule, CoverageSettings, CoverageSettingsInput,
    HaltResult, PauseInput, ReviewPlanCase, ReviewPlanCombo, TopUpLaunch, TopUpResult,
    TopUpSkipped,
};
pub use gg::GgRunRequest;
pub use gg_agent::{GgSavedAgent, GgSavedAgentInput};
pub use gg_config::{GgAgentSource, GgConfig, GgConfigInput};
pub use gg_query::{GG_QUERY_MAX_BATCH, GG_QUERY_MAX_ROWS, GgQueryBatch, GgQueryBatchResponse};
pub use gg_view::{
    DASHBOARD_COLUMNS, GgDashboard, GgDashboardInput, GgDashboardPanel, GgSavedQuery,
    GgSavedQueryInput, MAX_DASHBOARD_PANELS,
};
pub use jobs::{
    ActiveJobOut, BulkCancelOut, ClaimedJob, DriverState, JobState, JobStatusOut, LaunchAck,
    LaunchBatchAck, LaunchBatchBody, LaunchBatchItem, LaunchBody, StatusUpdate, StreamOpened,
    StreamResync, StreamTopicsBody,
};
pub use ladders::{
    ClimberStatus, Ladder, LadderAxis, LadderCell, LadderClimber, LadderClimberInput, LadderInput,
    LadderOut, LadderOutcome, LadderOverrideInput, LadderProgress, LadderProgressRung, LadderRung,
    LadderRungInput, LadderRungOrderInput, LadderRungOutcome, LadderSchedule, RungTally,
    StoredClimberOut,
};
pub use model_probes::{
    ModelProbeDetailResponse, ModelProbeItemOut, ModelProbeOut, ModelProbesResponse,
    ProbeConditionOut, ProbeProviderOut, ProbeProvidersResponse, ProbeTriggerInput,
    ProbeTriggerResponse,
};
pub use models::{
    AliasInput, AliasOut, LogoFetchInput, LogoFetchOut, ModelCatalogResponse, ModelConfigInput,
    ModelListingOut, ModelOut, ModelPricesOut, ModelSeedOut, PriceObservationOut, compose_catalog,
};
pub use test_cases::{CatalogCase, CatalogResponse, VersionResponse, VersionsResponse};
// The `/stats` response contract lives beside its folds in `crate::stats`
// (the handlers in `api::stats` own only the corpus); re-exported here so the
// generator names it the way it names every other response envelope.
pub use crate::stats::{
    ModelAccuracyOut, ModelAccuracyResponse, ProbeProviderModelOut, ProbeProviderStatsOut,
    ProviderCallStatsOut, ProviderModelStatsOut, ProviderStatsOut, ProviderStatsResponse,
    RacAccuracyOut, ToolCallingAccuracyOut,
};

/// Shared application state handed to every handler.
#[derive(Clone)]
pub struct AppState {
    /// The system-of-record SQLite store.
    pub db: Arc<Db>,
    /// The on-disk definition store.
    pub store: DefinitionStore,
    /// Whether the definition store is populated enough to resolve test-case
    /// versions — the signal `GET /readyz` reports (see [`crate::readiness`]).
    pub ready: Readiness,
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
    /// terminal-result ingestion. The publish path's analogue of
    /// [`relay`](Self::relay).
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
    /// The in-memory gg [document index](crate::gg_docs::GgDocIndex) the analysis
    /// query endpoints run over. Loaded lazily on the first query and reconciled per
    /// id thereafter, so a deployment that never opens Discover never pays for it.
    pub gg_docs: crate::gg_docs::GgDocIndex,
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
        // Readiness, split from liveness above: the process is alive and correct
        // from the moment it binds, but cannot resolve anything until its
        // definition store is populated. Point a readinessProbe here and a
        // livenessProbe at /healthz — never both at one endpoint (see `ready`).
        .route("/readyz", get(ready))
        // The console's client configuration: today just the data-plane artifact
        // service base URL, so the console can resolve a pre-publish run's build
        // and media links against it (the control-plane backend never serves the
        // bytes). A single read, no auth.
        .route("/config", get(client_config))
        .route("/ingest", post(ingest_api::ingest))
        // The model catalog: a merged read (curated config ⋃ models derived from
        // runs, with price history) plus operator-driven config CRUD, a
        // seed-from-run authoring helper, the OpenRouter fill-in lookup, and the
        // svgl.app logo fetch. Reads are open; the mutations, the seed, the lookup,
        // and the logo fetch require a token. `/models/seed`, `/models/logo`, and
        // `/models/openrouter` are static, so they outrank the `/models/{slug}`
        // dynamic route regardless of registration order.
        .route("/models", get(models::list).post(models::create))
        .route("/models/seed", get(models::seed))
        .route("/models/openrouter", get(models::openrouter))
        .route("/models/logo", post(models::logo))
        .route(
            "/models/{slug}",
            axum::routing::put(models::update).delete(models::delete),
        )
        // Model probes: RaC-readiness checks of a catalog model (see
        // `crate::probe`). Triggering and the provider enumeration are
        // bearer-gated (they reach OpenRouter on the caller's behalf, the
        // trigger spending real credit); the reads are open like the catalog.
        // History lives under the model, one probe under its own id.
        .route(
            "/models/{slug}/probes",
            get(model_probes::list).post(model_probes::trigger),
        )
        .route(
            "/models/{slug}/probe-providers",
            get(model_probes::providers),
        )
        .route("/model-probes/{id}", get(model_probes::get))
        // The cross-run statistics reads: per-provider health and per-model
        // accuracy, folded from stored gg summaries (through the document
        // index) and the probe store. Open reads like the rest of the catalog
        // — aggregate counts only. `/stats` is its own static namespace, so
        // neither path can collide with a dynamic route.
        .route("/stats/providers", get(stats::providers))
        .route("/stats/model-accuracy", get(stats::model_accuracy))
        // Per-harness configuration (today: max parallelism). The list is an open
        // read; setting a harness's config requires a token.
        .route("/harness-config", get(harness_config::list))
        .route("/harness-config/{slug}", post(harness_config::set))
        .route("/test-cases", get(test_cases::catalog))
        .route("/test-cases/{slug}/versions", get(test_cases::versions))
        .route(
            "/test-cases/{slug}/versions/{version}",
            get(test_cases::resolve_version),
        )
        // A variant's authored reference-implementation URL is recorded through the
        // ingest pull path (the committed reference-builds lockfile the backend reads
        // from its checkout — see `ingest`), not a write endpoint; there is no
        // reference-build route. The version response and public snapshot fold the
        // ingested URL onto the variant via the open resolve/snapshot reads.
        .route(
            "/test-cases/{slug}/versions/{version}/artifacts/{*path}",
            get(test_cases::artifact),
        )
        // A variant's full seeded spec set with each body rendered for that variant
        // (a `.hbs` spec's conditionals resolved, a plain spec verbatim), in seed
        // order — the spec analogue of the rendered prompt on the version response.
        // The console's Inputs tab reads this so it shows handlebars-free text rather
        // than the raw templates the per-key `artifacts` route serves.
        .route(
            "/test-cases/{slug}/versions/{version}/specs/{variant}",
            get(test_cases::variant_specs),
        )
        .route(
            "/test-cases/{slug}/versions/{version}/references/{scope}/{view}",
            get(test_cases::reference),
        )
        // The store-relative keys of every reporter-side automated-validation script
        // file (`validation/`), for a backend-driven run to materialize the whole
        // bundle (scripts plus their shared imports) into its definition store. A read.
        .route(
            "/test-cases/{slug}/versions/{version}/validation-files",
            get(test_cases::validation_files),
        )
        // One reference build's committed baseline validation media
        // (`<item>__<output>.<ext>`), synthesized once at capture-baselines time from
        // the reference implementation and served case-scoped — the invariant
        // counterpart to a run's actual validation media (served run-scoped by the
        // artifact service). Keyed by engine as well as variant, because a variant has
        // one reference implementation per engine. A read.
        .route(
            "/test-cases/{slug}/versions/{version}/validation-baseline/{engine}/{variant}/{file}",
            get(test_cases::validation_baseline),
        )
        // The gameplay READMEs of earlier runs of a game jam (matched on the same
        // harness + model), oldest first. The driver reads this before seeding a
        // repeated jam run so the run can be briefed on earlier entries and asked to
        // build something distinct. A read.
        .route(
            "/game-jams/{slug}/prior-readmes",
            get(game_jams::prior_readmes),
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
        // The signed-in account's own submitted reviews (auth-gated; keyed to the
        // token's account), newest-first with a numbered pager. Backs the account
        // page's Reviews tab. Console-only — the static site carries no token.
        .route("/account/reviews", get(runs::my_reviews))
        // Aggregate breakdowns of the signed-in account's recent reviews (auth-gated;
        // keyed to the token's account): reviews per test case, per model, and per
        // rating given. Backs the account page's Profile tab. Console-only.
        .route("/account/review-stats", get(runs::review_stats))
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
        // A published run's synthesized *actual* validation media (the model build's
        // per-review-item debug-script outputs, `<item>__<output>.<ext>`): mirrored in
        // by the driver (POST) and served for the reviewer's automated-validation
        // side-by-side (GET). The case-scoped baseline counterpart is served by
        // `validation_baseline` under the test-case route.
        .route(
            "/runs/{id}/validation/{file}",
            get(test_cases::run_validation)
                .post(test_cases::put_run_validation)
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
        // A gg run's debug-only session record (the capture of its non-deterministic
        // inputs — each agent's model I/O and every tool result): mirrored in by the
        // driver from the `replay.json.gz` the post-run assembly stage folds the run's
        // capture journal into (POST), and served for a person diagnosing a run the
        // telemetry cannot explain (GET) — nothing in the console reads it, which is the
        // record's stated position rather than an omission. Stored opaquely: the bytes are
        // gzipped and the record is versioned, so what a reader may branch on is the
        // document's own `formatVersion`, never the route.
        .route(
            "/runs/{id}/replay",
            get(test_cases::run_replay)
                .post(test_cases::put_run_replay)
                .layer(DefaultBodyLimit::max(MAX_RUN_UPLOAD_BYTES)),
        )
        // A run's code-analysis document — the unbounded tier of the static read of the
        // code its model wrote (every file, symbol, import edge, cycle and clone group),
        // mirrored in by the driver from the run tree's `code-analysis.json.gz` (POST) and
        // served to the per-run Code tab (GET). Same convention as the session record above,
        // and offered for **every** harness: analysing a directory involves no
        // harness-specific work, so restricting the route would cost coverage for nothing.
        .route(
            "/runs/{id}/code-analysis",
            get(test_cases::run_code_analysis)
                .post(test_cases::put_run_code_analysis)
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
        // The run queue. A console enqueues a run (`POST /jobs`, auth-gated) — or a
        // whole batch in one request (`POST /jobs/batch`, same gate); the dispatcher
        // claims the oldest (`POST /jobs/next`, service-token); a per-run driver
        // streams progress and the terminal record back
        // (`POST /jobs/{id}/events|preview|status`, per-job token). The console
        // observes it via the live stream, the status, and the active-run list.
        // `/jobs/batch`, `/jobs/active`, `/jobs/next`, and the three `/jobs/cancel-*`
        // controls are static, so they outrank the `/jobs/{id}` dynamic route
        // regardless of registration order.
        .route("/jobs", post(jobs::launch))
        .route("/jobs/batch", post(jobs::launch_batch))
        // The gg run mode's own enqueue surface (auth-gated, the same gate as
        // `POST /jobs`). A gg run is configured by a capability set rather than the
        // flat harness+model+orchestrator tuple, so it gets a gg-native request shape
        // (`POST /gg/runs`); the enqueued job drains through the same
        // dispatcher/driver/relay path, so it is observed through the shared
        // `/jobs/{id}` status and `/jobs/{id}/live` monitor.
        .route("/gg/runs", post(gg::launch_gg))
        // The operator's saved gg configurations (auth-gated; keyed to the token's
        // account): named capability sets the new-run form offers once `gg` is
        // picked as the orchestrator. `/gg/configs` is static and `/gg/configs/{id}`
        // is its child, so neither collides with `/gg/runs`.
        .route(
            "/gg/configs",
            get(gg_config::list_configs).post(gg_config::create_config),
        )
        .route(
            "/gg/configs/{id}",
            put(gg_config::update_config).delete(gg_config::delete_config),
        )
        // The operator's saved gg **agents** (auth-gated; keyed to the token's
        // account): agent profiles authored on their own, which a configuration
        // imports and may override locally. Data only — gg never reads this
        // surface, because the console resolves an import into the configuration's
        // own agent list before anything is stored or launched. `/gg/agents` is
        // static and `/gg/agents/{id}` is its child, so neither collides with
        // `/gg/runs` or `/gg/configs`.
        .route(
            "/gg/agents",
            get(gg_agent::list_agents).post(gg_agent::create_agent),
        )
        .route(
            "/gg/agents/{id}",
            put(gg_agent::update_agent).delete(gg_agent::delete_agent),
        )
        // The gg analysis query surface (auth-gated, like the rest of `/gg`, though
        // the corpus itself is deployment-wide rather than per-account): evaluate one
        // TCQ query, evaluate a dashboard's worth of them against a single index
        // read, or read the field catalog the editor's completer and sidebar are
        // built from. `/gg/query/batch` is a child of the static `/gg/query`, and
        // `/gg/fields` is static, so none of the three collides with `/gg/runs` or
        // `/gg/configs`.
        .route("/gg/query", post(gg_query::run_query))
        .route("/gg/query/batch", post(gg_query::run_query_batch))
        .route("/gg/fields", get(gg_query::gg_fields))
        // The operator's saved **views** over that corpus (auth-gated; keyed to the
        // token's account): named queries and the dashboards built from them. The
        // corpus is deployment-wide and the views are personal — that asymmetry is the
        // whole model, and it is why these filter on the token's account while
        // `/gg/query` does not. All four paths are static or children of a static
        // segment, so none collides with `/gg/runs`, `/gg/configs` or `/gg/query`.
        .route(
            "/gg/saved-queries",
            get(gg_view::list_saved_queries).post(gg_view::create_saved_query),
        )
        .route(
            "/gg/saved-queries/{id}",
            get(gg_view::get_saved_query)
                .put(gg_view::update_saved_query)
                .delete(gg_view::delete_saved_query),
        )
        .route(
            "/gg/dashboards",
            get(gg_view::list_dashboards).post(gg_view::create_dashboard),
        )
        .route(
            "/gg/dashboards/{id}",
            get(gg_view::get_dashboard)
                .put(gg_view::update_dashboard)
                .delete(gg_view::delete_dashboard),
        )
        // gg's model-facing reference, in two documents: the index — every tool's real
        // description and parameter schema, grouped into gg's families, plus the arms
        // — and one responses-as-code surface per program language, fetched when a
        // reader picks that arm. Eleven idiomatic SDKs do not fit in one document
        // without either privileging one arm or repeating the tools eleven times, and
        // the console's gg Reference section renders them as a picker over the index.
        //
        // The **one open read under `/gg`**, and deliberately so — the documents are
        // static, identical for every caller, and carry no account, run or deployment
        // data, so they are documentation of the harness in the same class as
        // `/test-cases` and `/config`; a token would buy nothing and would stop a
        // signed-out console or the docs site from linking to them.
        //
        // Read at run time from the directory `TCAB_GG_REFERENCE` names (the image
        // bakes it), because the backend must not depend on `test-cabinet-gg` (`oxc`,
        // `tiktoken-rs`, and eleven language toolchains to build it) and gg is what
        // renders these bytes for a model in the first place — see the module docs for
        // why that beats the committed artifact it replaced. `/gg/reference` is static
        // and `/gg/reference/{language}` its only child, so neither collides with
        // anything else mounted under `/gg`.
        .route("/gg/reference", get(gg_reference::gg_reference))
        .route(
            "/gg/reference/{language}",
            get(gg_reference::gg_reference_api),
        )
        // The operator's saved harness comparisons (auth-gated; keyed to the token's
        // account): named A/B experiments whose per-arm distributions are computed on
        // read from the arms' runs. `/comparisons` is static and `/comparisons/{id}`
        // its child.
        .route(
            "/comparisons",
            get(comparisons::list_comparisons).post(comparisons::create_comparison),
        )
        .route(
            "/comparisons/{id}",
            get(comparisons::get_comparison)
                .put(comparisons::update_comparison)
                .delete(comparisons::delete_comparison),
        )
        .route(
            "/comparisons/{id}/publish",
            post(comparisons::publish_comparison),
        )
        .route("/jobs/active", get(jobs::active))
        .route("/jobs/next", post(jobs::claim))
        // The Runs page's global stop controls, in increasing order of destruction:
        // clear the runs that have not started ("Clear pending"), kill the ones
        // already executing ("Kill active"), or both at once ("Stop all"). Global by
        // design — the scoped equivalent is a coverage plan's or ladder's `halt`, which
        // sweeps only the jobs it launched. Each reports how many runs it stopped.
        .route("/jobs/cancel-waiting", post(jobs::cancel_waiting))
        .route("/jobs/cancel-active", post(jobs::cancel_active))
        .route("/jobs/cancel-all", post(jobs::cancel_all))
        .route("/jobs/{id}", get(jobs::status))
        // Kill one in-flight run: moves it to the terminal `canceled` state and
        // closes its live stream. Bearer-gated like the other job mutations.
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
        // The worker-wide console feed (SSE): completion alerts, so the console can
        // alert on any run finishing without holding a per-run subscription open,
        // multiplexed with the run-lifecycle events it maintains its in-flight list
        // from. A client picks its topics per connection through the companion route
        // below, quoting the stream id the feed hands it on connect.
        .route("/notifications", get(jobs::notifications))
        .route(
            "/notifications/{stream}/topics",
            put(jobs::set_stream_topics),
        )
        // Reviewer coverage tooling (auth-gated; keyed to the token's account):
        // reusable groups, multiple declarative plans, and the coverage matrix a plan
        // expands into. Console-only — the public site carries no token and never
        // calls these.
        .route(
            "/coverage-groups",
            get(coverage::list_groups).post(coverage::create_group),
        )
        .route(
            "/coverage-groups/{id}",
            put(coverage::update_group).delete(coverage::delete_group),
        )
        .route(
            "/coverage-plans",
            get(coverage::list_plans).post(coverage::create_plan),
        )
        .route("/coverage-plans/summary", get(coverage::plans_summary))
        .route(
            "/coverage-plans/{id}",
            put(coverage::update_plan).delete(coverage::delete_plan),
        )
        .route(
            "/coverage-plans/{id}/coverage",
            get(coverage::plan_coverage),
        )
        // The account's review-buffer size: how many runs it wants outstanding
        // (in flight, or completed and not yet reviewed by it) across a plan or ladder
        // before topping up stops. One setting per account, overridable per plan and
        // per ladder below.
        .route(
            "/coverage-settings",
            get(coverage::settings).put(coverage::set_settings),
        )
        // How a plan is *fed*, held apart from what it declares: its emission axis,
        // whether it is paused, whether reviewing triggers a top-up, and its buffer
        // override. Split from `PUT /coverage-plans/{id}` on purpose — saving an
        // edited model list must not be able to un-pause a plan.
        .route(
            "/coverage-plans/{id}/schedule",
            get(coverage::plan_schedule).put(coverage::set_plan_schedule),
        )
        // Enqueue the plan's next slice of missing runs, whole cells at a time, until
        // the review buffer is full. Serialized per plan by a leased claim marker, so
        // two console tabs cannot both observe the same shortfall and both enqueue;
        // otherwise idempotent, since it recomputes what is outstanding every call.
        .route("/coverage-plans/{id}/topup", post(coverage::top_up_plan))
        // The plan's own unreviewed-by-me runs **in the plan's order** — not
        // newest-first like the global Unreviewed page — so reviewing walks the buffer
        // in the order it was deliberately filled.
        .route("/coverage-plans/{id}/queue", get(coverage::plan_queue))
        // The three halting controls, in increasing order of destruction: stop topping
        // up and leave the queue alone (`pause`); that plus cancel this plan's runs
        // that have cost nothing yet (`halt`, the common case); that plus the ones
        // already executing (`halt-all`, rare, must be confirmed). Each cancels only
        // jobs whose `origin` is this plan, so a run launched by hand is never swept
        // up, and each reports how many it stopped.
        .route("/coverage-plans/{id}/pause", post(coverage::pause_plan))
        .route("/coverage-plans/{id}/halt", post(coverage::halt_plan))
        .route("/coverage-plans/{id}/halt-all", post(coverage::halt_all_plan))
        // Ladders: the plan's sibling, an **ordered, gated** climb. Same groups, same
        // resolver, same counts, same buffer, same halting controls; the difference is
        // that a combination only reaches the next rung by clearing the current one,
        // and progress is stored per combination rather than as one ladder-wide
        // pointer. Auth-gated and console-only, like the rest of the coverage surface.
        .route("/ladders", get(ladders::list).post(ladders::create))
        .route(
            "/ladders/{id}",
            get(ladders::get).put(ladders::update).delete(ladders::delete),
        )
        .route(
            "/ladders/{id}/schedule",
            get(ladders::schedule).put(ladders::set_schedule),
        )
        // The board: every climber's position, the tally behind each gate verdict, and
        // the rung each is stuck on. A pure read — a verdict the gate has resolved but
        // nobody has recorded is computed live and flagged as unrecorded; the top-up is
        // what persists it.
        .route("/ladders/{id}/progress", get(ladders::progress))
        .route("/ladders/{id}/topup", post(ladders::top_up))
        .route("/ladders/{id}/queue", get(ladders::queue))
        .route("/ladders/{id}/pause", post(ladders::pause))
        .route("/ladders/{id}/halt", post(ladders::halt))
        .route("/ladders/{id}/halt-all", post(ladders::halt_all))
        // Steering one climber (hold it here, climb it first, focus it) — never its
        // progress, which is derived from its outcomes and has exactly one source.
        .route("/ladders/{id}/climbers", post(ladders::set_climber))
        // A reviewer's manual verdict override in either direction — `promote` past a
        // gate a combination failed, or wall it early. Recorded beside the automatic
        // outcome rather than replacing it, so a recompute can never quietly undo it
        // and clearing the override (`outcome: null`) reverses exactly.
        .route("/ladders/{id}/outcomes", post(ladders::set_outcome))
        // Reorder the rungs. Rungs carry stable opaque ids, so a reorder moves
        // positions without disturbing any climber's recorded progress.
        .route("/ladders/{id}/rungs/order", post(ladders::reorder_rungs))
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
        // Compress responses for callers that advertise `Accept-Encoding: gzip`.
        // Outermost, so it sees the final response of every route. The listings
        // are the reason: `GET /runs` hands back whole run records, which reaches
        // megabytes of JSON on a populated deployment — fast to produce, but slow
        // to *deliver* to a console sitting behind a VPN or any other thin link,
        // where it dominates the page load. JSON compresses roughly an order of
        // magnitude, so this is the difference between a snappy console and one
        // that appears hung.
        //
        // `CompressionLayer`'s default predicate is what makes this safe to apply
        // service-wide rather than per-route: it skips responses under 32 bytes
        // (where a gzip header costs more than it saves), already-compressed image
        // payloads, gRPC, and — critically — `text/event-stream`. This service
        // streams SSE (`/jobs/{id}/live`, `/publish-jobs/{id}/live`,
        // `/notifications`, `/runs/{id}/events`); compressing those would buffer
        // events behind the encoder and stall the live views that depend on them.
        // Keep that predicate intact: narrowing it to "compress everything" would
        // break streaming in a way that only shows up under a real client.
        .layer(CompressionLayer::new().gzip(true))
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

/// `GET /healthz` — **liveness** probe and service identity (§1.1).
///
/// Always `200` while the process is serving: a backend whose definition store is
/// still filling is alive and must not be restarted (see [`ready`] for why the two
/// probes are separate). `storeReady` reports whether that store can resolve
/// test-case versions yet — the same signal `/readyz` gates on, surfaced here so a
/// console can *show* the state without a probe's semantics.
async fn health(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({
        "status": "ok",
        "version": CONTRACT_VERSION,
        "storeReady": state.ready.is_ready(),
    }))
}

/// `GET /readyz` — **readiness** probe: whether this backend can resolve test-case
/// versions yet.
///
/// `200` once the definition store holds versions, `503` while it is still empty.
/// Kept apart from the `/healthz` liveness probe because the unready state is
/// *long*: a deployment with an ephemeral `/state` re-ingests the whole catalog on
/// start, which runs for minutes. Pointing a liveness probe at this signal would
/// kill the pod mid-ingest and never converge; pointing readiness at `/healthz`
/// (which is what let this backend serve an empty store) admits traffic that can
/// only fail with a spurious "is not ingested" 404.
async fn ready(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> (axum::http::StatusCode, axum::Json<serde_json::Value>) {
    let ready = state.ready.is_ready();
    let status = if ready {
        axum::http::StatusCode::OK
    } else {
        axum::http::StatusCode::SERVICE_UNAVAILABLE
    };
    (
        status,
        axum::Json(serde_json::json!({
            "status": if ready { "ready" } else { "ingesting" },
            "storeReady": ready,
        })),
    )
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
///
/// `snapshotUrl` is the **public read** base of the snapshot bucket
/// (`TCAB_SNAPSHOT_PUBLIC_URL`) — not the credentialed S3 write endpoint the backend
/// uploads through. The console joins it with keys it derives itself, today an
/// asset-generation variant's published reference frames; `null` when the deployment
/// publishes no public snapshot, in which case that media is simply not shown.
async fn client_config(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> axum::Json<ClientConfig> {
    axum::Json(ClientConfig {
        artifacts_url: state.config.artifacts_url.clone(),
        arena_url: state.config.arena_url.clone(),
        grafana_url: state.config.grafana_url.clone(),
        snapshot_url: state.config.snapshot_url.clone(),
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
    /// Grafana's base URL, or `null` when the deployment runs no observability
    /// stack. The console uses it to link a run to the traces it emitted; absent,
    /// that link is simply not rendered.
    #[cfg_attr(feature = "contract", ts(optional))]
    pub grafana_url: Option<String>,
    /// The public snapshot bucket's **read** base URL, or `null` when the deployment
    /// publishes no public snapshot. The client joins it with the deterministic keys
    /// it derives — today an asset-generation variant's published reference frames,
    /// `media/references/<slug>/<version>/<variant>/frames/<index>.png`. This is never
    /// the S3 write endpoint (`TCAB_R2_ENDPOINT`), which is credentialed and stays
    /// server-side.
    #[cfg_attr(feature = "contract", ts(optional))]
    pub snapshot_url: Option<String>,
}
