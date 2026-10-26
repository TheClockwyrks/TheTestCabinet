//! The Test Cabinet backend: the centralized source of truth for v0.2.0.
//!
//! See `design/v0.2.0-contracts.md` (authoritative) and the backend overview at
//! `apps/docs/src/content/docs/components/backend/overview.md`. The backend:
//!
//! - serves test-case version definitions resolved from a repo checkout it is
//!   pointed at, copied into an immutable on-disk store on ingest (with reference
//!   screenshots rendered on the backend so every runner shares one baseline);
//! - plays **no part in container distribution**: every run executes in one
//!   shared base run-container image that runners pull by digest from a registry
//!   per their own configuration (and install the harness CLI into at run time);
//! - is the **system of record** for published runs + reviews in a SeaORM store
//!   (SQLite locally and in tests, PostgreSQL in deployments); and
//! - owns the **synchronized publish path**: a publish is recorded in the
//!   database, then a coalesced background task regenerates the full public
//!   dataset and writes it through the artifacts service, swapping its
//!   `index.json` pointer last.
//!
//! Every request identifies its caller, by the Cloudflare Access assertion the
//! edge attaches or by a token the backend minted; see [`auth`].

pub mod access;
pub mod api;
pub mod artifacts;
pub mod auth;
pub mod bootstrap;
pub mod comparison;
pub mod comparison_aggregate;
pub mod comparison_stats;
pub mod config;
pub mod coverage;
pub mod db;
pub mod error;
pub mod gg_docs;
pub mod gg_query;
pub mod ingest;
pub mod ingest_refresh;
pub mod logo;
pub mod metrics;
pub mod model_id;
pub mod model_seed;
pub mod pricing;
pub mod probe;
pub mod prompt;
pub mod publish_relay;
pub mod publish_retry;
pub mod publisher;
pub mod readiness;
pub mod relay;
pub mod render;
pub mod review;
pub mod snapshot;
pub mod state_move;
pub mod stats;
pub mod store;
pub mod suite_store;

use std::sync::Arc;

use crate::api::AppState;
use crate::config::Config;
use crate::db::Db;
use crate::publisher::Publisher;
use crate::store::DefinitionStore;

/// A fully wired, runnable backend: the Axum router plus the spawned background
/// refresher that keeps the snapshot up to date.
pub struct Backend {
    /// The Axum router, ready to be served.
    pub router: axum::Router,
    /// The bind address resolved from configuration.
    pub bind: String,
    /// The background refresher handle; kept alive for the server's lifetime.
    pub refresher: crate::publisher::RefresherHandle,
    /// The periodic refresher of list prices and catalog facts; kept alive for the
    /// server's lifetime (dropping it aborts the 24-hour loop).
    pub price_refresher: tokio::task::JoinHandle<()>,
    /// The periodic [artifact reclamation sweep](crate::artifacts); kept alive for
    /// the server's lifetime (dropping it aborts the loop). `None` when the sweep is
    /// not configured: no in-cluster artifact URL, no service token, or a zero
    /// interval.
    pub artifact_sweeper: Option<tokio::task::JoinHandle<()>>,
    /// The [probe resumer](crate::probe::spawn_resumer), which resumes every `running`
    /// model probe whose lease has lapsed; kept alive for the server's lifetime.
    pub probe_resumer: tokio::task::JoinHandle<()>,
    /// The [retry of failed publishes](crate::publish_retry), which every 30 seconds
    /// records the publish jobs whose publishers never reported as failed and
    /// enqueues another publish job for each failed run that is due one; kept alive
    /// for the server's lifetime.
    pub publish_retry: tokio::task::JoinHandle<()>,
    /// The start's [move](crate::state_move) of an earlier release's on-disk state,
    /// which holds the backend unready until it finishes.
    pub state_move: tokio::task::JoinHandle<()>,
}

/// Assemble a backend from a configuration: open the definition store, connect
/// the database and migrate its schema, build the publisher (writing the public
/// dataset through the artifacts service when it is configured), spawn the coalescing refresher, and construct the router. The
/// `TCAB_REFERENCE_BROWSER` override, when set, is forwarded to the bundled driver
/// as `TCAB_CHROMIUM_EXECUTABLE` (the variable it reads), so ingest renders with
/// that explicit Chromium.
pub async fn build(config: Config) -> error::Result<Backend> {
    build_with_prices(
        config,
        crate::pricing::OpenRouterPrices::new(),
        crate::probe::DEFAULT_COMPLETIONS_ENDPOINT,
    )
    .await
}

/// [`build`], reading model prices from `prices` rather than OpenRouter's public
/// catalog and resuming model probes against `probe_endpoint` rather than
/// OpenRouter's chat/completions, so a test assembles a backend without reaching
/// the network.
async fn build_with_prices(
    config: Config,
    prices: crate::pricing::OpenRouterPrices,
    probe_endpoint: &str,
) -> error::Result<Backend> {
    use test_cabinet_migration::MigratorTrait;

    if let Some(browser) = &config.reference_browser {
        // Forward the operator's explicit Chromium to the bundled driver under the
        // name the driver actually reads (`TCAB_CHROMIUM_EXECUTABLE`); it launches
        // that binary via Playwright's `executablePath`. Without this override the
        // driver falls back to the Playwright-managed Chromium baked into the image.
        // SAFETY: set once at startup, before any threads render references.
        unsafe {
            std::env::set_var("TCAB_CHROMIUM_EXECUTABLE", browser);
        }
    }

    // gg's reference documents are read from disk on first request, not compiled in, so a
    // deployment that never points TCAB_GG_REFERENCE anywhere real would otherwise learn
    // about it from a `503` the first time somebody opened the console's gg Reference
    // section. Say it at boot instead, where an operator is already reading. A WARNING and
    // not an error: the reference is a documentation page, and a backend with no reference
    // still serves runs, reviews and the catalog perfectly.
    if !config.gg_reference.join("index.json").exists() {
        tracing::warn!(
            directory = %config.gg_reference.display(),
            "no gg reference documents (index.json), so GET /gg/reference answers 503; \
             write them with `scripts/gg-reference.sh` in the gg checkout and point \
             TCAB_GG_REFERENCE at them, or at any `gg reference --out` directory"
        );
    }

    let store = DefinitionStore::open(&config.store)?;
    // An ingest that stopped part way (the process died, or the pod was replaced) left
    // its half-built version in the staging area. Nothing serves or ingests yet, so
    // every entry there is such a leftover: empty it before anything can.
    match store.clear_staging()? {
        0 => {}
        removed => tracing::info!(removed, "emptied the ingest staging area"),
    }
    let db = if config.db_azure_ad {
        Db::connect_azure_ad(&config.database_url).await?
    } else {
        Db::connect(&config.database_url).await?
    };
    // Apply the schema before serving. The migration is idempotent, so an
    // already-migrated store (a restart, or a shared deployment database) is a
    // no-op beyond the version check.
    test_cabinet_migration::Migrator::up(&db.connection(), None).await?;

    // Backfill the run row's sort/filter columns for any rows that predate them
    // (the migration stamps them with defaults; this fills the real record- and
    // review-derived values). Idempotent, so a restart or an already-populated
    // store is a no-op; best-effort, so it never blocks startup.
    match db.backfill_sort_columns().await {
        Ok(0) => {}
        Ok(backfilled) => tracing::info!(backfilled, "backfilled run sort/filter columns"),
        Err(err) => tracing::warn!(error = %err, "skipping run sort-column backfill"),
    }

    // The validators' own rating a ladder's gate reads, for the validator-rated runs
    // stored before the column existed. Deciding it needs each version's checklist, so it
    // reads the definition store; a run whose version the store does not hold yet (a
    // deployment whose store starts empty) is left for the gate to rate when it next
    // reads it. Idempotent, best-effort, never blocks startup.
    match db.backfill_validator_rating(&store, None).await {
        Ok(0) => {}
        Ok(backfilled) => tracing::info!(backfilled, "backfilled run validator ratings"),
        Err(err) => tracing::warn!(error = %err, "skipping run validator-rating backfill"),
    }

    // The stored functional ratings of completed validator-rated runs, recomputed once
    // under the current validator rating rule, so the columns the console's sort, the
    // stats board and a ladder's gate read agree with the snapshot, which recomputes on
    // every refresh. A run whose version the store does not hold yet leaves the pass
    // unmarked, and the ingest that supplies the version (or the next boot) finishes
    // it. Best-effort, never blocks startup.
    match db.recompute_validator_ratings(&store).await {
        Ok(0) => {}
        Ok(rewritten) => tracing::info!(rewritten, "recomputed run validator ratings"),
        Err(err) => tracing::warn!(error = %err, "skipping run validator-rating recompute"),
    }

    // The static analyzer's generation, lifted out of records that already carry a code
    // analysis but were stored before the column existed. This lifts a number the record
    // blob already holds — it never *analyses* anything, because a historical run's tree
    // can only be re-read post-validation and those are not comparable figures. Same
    // contract as the one above: idempotent, best-effort, never blocks startup.
    match db.backfill_code_analyzer_version().await {
        Ok(0) => {}
        Ok(backfilled) => tracing::info!(backfilled, "backfilled run code-analyzer versions"),
        Err(err) => tracing::warn!(error = %err, "skipping run code-analyzer-version backfill"),
    }

    // The two segments of a gg run's coverage cell, lifted out of records (and out of the
    // capability sets of the jobs still in flight) that were stored before the columns
    // existed. Without it the whole gg backlog counts toward no gg cell, and every plan
    // built on a configuration re-buys runs it already has. Same contract as the backfills
    // above: idempotent, best-effort, never blocks startup.
    match db.backfill_gg_models().await {
        Ok(0) => {}
        Ok(backfilled) => tracing::info!(backfilled, "backfilled run gg cell identities"),
        Err(err) => tracing::warn!(error = %err, "skipping run gg-cell backfill"),
    }
    match db.backfill_in_flight_gg_cells().await {
        Ok(0) => {}
        Ok(backfilled) => tracing::info!(backfilled, "backfilled in-flight gg cell identities"),
        Err(err) => tracing::warn!(error = %err, "skipping in-flight gg-cell backfill"),
    }

    // The configuration a gg run came from, for the runs (and in-flight jobs) recorded
    // before the id was a column. It is resolved rather than lifted: an older run records
    // only the configuration's name, so the account that launched it is traced through the
    // job that produced it and the name matched against that account's configurations. A run
    // that resolves to no configuration, or to two, keeps its `NULL` and counts toward no gg
    // cell — an under-count the next launch pass fills, where a guess would merge two
    // configurations' histories for good. Best-effort and never blocks startup, as the
    // backfills above are, and unlike them it runs exactly once: the name it resolves
    // through belongs to a library the operator keeps editing, so a later pass would answer
    // with configurations that never ran the runs it would stamp.
    match db.backfill_gg_config_id().await {
        Ok(0) => {}
        Ok(backfilled) => tracing::info!(backfilled, "backfilled run gg configuration ids"),
        Err(err) => tracing::warn!(error = %err, "skipping run gg-configuration-id backfill"),
    }
    match db.backfill_in_flight_gg_config_ids().await {
        Ok(0) => {}
        Ok(backfilled) => {
            tracing::info!(backfilled, "backfilled in-flight gg configuration ids")
        }
        Err(err) => {
            tracing::warn!(error = %err, "skipping in-flight gg-configuration-id backfill")
        }
    }

    // The engine slug, lifted out of records stored before the `engine_slug` column
    // existed (pre-engine-era records deserialize to `none`, which is lifted too — it
    // is what the engineless filter matches). Same contract as the two above:
    // idempotent, best-effort, never blocks startup.
    match db.backfill_engine_slug().await {
        Ok(0) => {}
        Ok(backfilled) => tracing::info!(backfilled, "backfilled run engine slugs"),
        Err(err) => tracing::warn!(error = %err, "skipping run engine-slug backfill"),
    }

    // The same slug on the jobs still in flight across the deploy, re-derived from each
    // one's launch request. A `NULL` column counts as the `none` engine, so only a job
    // that named a real engine needs filling — and that is the one that would otherwise
    // count toward a cell its run will never join, letting the plan buy a second set of
    // runs on top of the ones already coming. Same contract as the backfills above:
    // idempotent, best-effort, never blocks startup.
    match db.backfill_in_flight_engine_slugs().await {
        Ok(0) => {}
        Ok(backfilled) => tracing::info!(backfilled, "backfilled in-flight engine slugs"),
        Err(err) => tracing::warn!(error = %err, "skipping in-flight engine-slug backfill"),
    }

    // Re-decide which stored records this build can read, for the rows whose marker
    // was decided under a different record-format generation. Zero rows in the steady
    // state and one bounded pass at the boot of a build that bumped
    // `db::RUN_RECORD_FORMAT`. It runs before the router serves because every run
    // listing counts and serves through that marker, so the invariant has to hold
    // from the first request. Same contract as the backfills above: idempotent,
    // best-effort, never blocks startup.
    match db.revalidate_run_records().await {
        Ok(0) => {}
        Ok(decided) => tracing::info!(decided, "revalidated stored run records"),
        Err(err) => tracing::warn!(error = %err, "skipping stored run-record revalidation"),
    }

    let db = Arc::new(db);

    // In-flight jobs are never reaped at startup. No deployment runs drivers inside the
    // backend's lifecycle: the dispatcher creates a Kubernetes Job per run, which keeps
    // running across a backend restart and reports when it is done. A driver that dies
    // without reporting — one `Job` or, after a whole-machine restart, all of them — is
    // found by the dispatcher, which compares the jobs this backend holds in flight with
    // the driver `Job`s the cluster actually runs and reports each lost one
    // (`POST /jobs/{id}/lost`). Failing in-flight jobs here instead would fail runs that
    // are still executing.

    // The public dataset, written through the artifacts service with the service
    // token; with either unset the dataset is composed but not written.
    let public = crate::artifacts::PublicDataset::new(
        reqwest::Client::new(),
        config.artifacts_internal_url.as_deref(),
        config.service_token.as_deref(),
    );

    // The Access assertion check, or `None` for a backend with no Access application
    // (the local overlay), which takes the identity from the local header instead.
    let access = config.access.as_ref().map(|access| {
        tracing::info!(
            team_domain = %access.team_domain,
            "verifying Cloudflare Access assertions"
        );
        Arc::new(crate::access::AccessVerifier::new(
            access,
            reqwest::Client::new(),
        ))
    });
    if access.is_none() {
        tracing::warn!(
            "no Access application configured (TCAB_ACCESS_TEAM_DOMAIN and \
             TCAB_ACCESS_AUDIENCE unset): taking the identity from \
             Cf-Access-Authenticated-User-Email as presented"
        );
    }

    let publisher = Publisher::new(
        Arc::clone(&db),
        store.clone(),
        public,
        crate::publisher::PublisherTiming {
            coalesce: config.coalesce,
            snapshot_retention: config.snapshot_retention,
        },
    );
    let refresher = publisher.spawn();

    // Model catalog bootstrap: seed the curated configs into an empty store and
    // re-associate any legacy `:free`-tagged runs to their base model. Both are
    // idempotent, so a restart or a shared deployment database is a safe no-op.
    crate::bootstrap::seed_models_if_empty(&db).await?;
    if let Err(err) = crate::bootstrap::backfill_alias_families(&db).await {
        // Best-effort: a stale harness family only mis-filters a run form's model
        // dropdown, never blocks startup.
        tracing::warn!(error = %err, "skipping model-alias harness-family backfill");
    }
    if let Err(err) = crate::bootstrap::backfill_coverage_plans(&db).await {
        // Best-effort: a reviewer whose legacy plan did not migrate this boot keeps
        // their `migrated = false` row and it is retried next startup; never blocks.
        tracing::warn!(error = %err, "skipping legacy coverage-plan backfill");
    }
    if let Err(err) = crate::bootstrap::normalize_free_runs(&db).await {
        // Never block startup on this best-effort normalization.
        tracing::warn!(error = %err, "skipping :free run normalization");
    }
    // Observe every known model the catalog holds no observation for, so a freshly
    // seeded deployment knows its models' context windows and developer providers
    // before the first run rather than after it completes. Missing-only (a
    // steady-state boot fetches nothing) and best-effort: an unreachable OpenRouter
    // leaves the models to the launch-time and completion-time observations.
    match crate::bootstrap::seed_catalog_facts(&db, &prices).await {
        Ok(seeded) if seeded > 0 => {
            tracing::info!(seeded, "seeded missing model catalog facts at startup");
        }
        Ok(_) => {}
        Err(err) => tracing::warn!(error = %err, "skipping startup model catalog fact seeding"),
    }
    // The periodic refresher reads every list price from OpenRouter shortly after
    // this start and every 24 hours after, in the background: a start never waits
    // on OpenRouter. A changed rate changes the catalog the public snapshot shows.
    let price_refresher = {
        let publisher = publisher.clone();
        crate::bootstrap::spawn_price_refresher(Arc::clone(&db), prices.clone(), move || {
            // The callback is synchronous (it fires from a drop guard, so a
            // cancelled refresh still reports its changes).
            publisher.queue_refresh_detached();
        })
    };

    let http = reqwest::Client::new();
    // Reclaim the artifact trees no run row references (see `crate::artifacts`). The
    // delete-time prune is best-effort, so this is what bounds how long a tree whose
    // prune failed — or whose run never reached the record store at all — occupies
    // the artifact volume.
    let artifact_sweeper = crate::artifacts::spawn_orphan_sweeper(
        Arc::clone(&db),
        http.clone(),
        config.artifacts_internal_url.clone(),
        config.service_token.clone(),
        crate::artifacts::SweepTiming {
            interval: config.artifact_sweep_interval,
            grace: config.artifact_sweep_grace,
        },
    );

    // A model probe runs inside a backend, so one whose backend restarted or died is left
    // `running` with a lease nobody renews. Every backend resumes such probes, as it starts
    // and periodically after, issuing only the calls each has no item for.
    let probe_resumer = crate::probe::spawn_resumer(
        Arc::clone(&db),
        crate::probe::ResumerConfig {
            http: http.clone(),
            endpoint: probe_endpoint.to_string(),
            api_key: config.openrouter_api_key.clone(),
            interval: crate::probe::PROBE_RESUME_INTERVAL,
        },
    );

    let bind = config.bind.clone();
    // Every test-case resolution reads the definition store, and on a deployment
    // whose /state is ephemeral it starts EMPTY — the ingest sidecar refills it, but
    // that takes minutes on a cold catalog. Hold the backend out of its Service until
    // then, or every run launched in the gap dies on a spurious "is not ingested"
    // 404. A store that already holds readable versions has nothing to wait for.
    let readiness = crate::readiness::Readiness::new(store.is_servable());
    if !readiness.is_ready() {
        // A store written in another record format is held out for the same reason an
        // empty one is, and says so distinctly: it looks full, and serving it would
        // answer with whatever subset an ingest has since rewritten.
        let reason = if store.needs_reingest() {
            "definition store was written in another record format; staying unready \
             until an ingest rewrites it"
        } else {
            "definition store is empty; staying unready until an ingest populates it"
        };
        tracing::info!(store = %store.root().display(), "{reason}");
    }
    // Move what an earlier release kept on the pod's disk into its durable home: each
    // pushed controller into its run's row, each match replay through the artifact
    // service. It runs beside the server rather than before it binds, holding only
    // readiness until it finishes: it makes one artifact-service call per replay, and
    // a start held off its liveness probe for that long would be killed mid-move. It
    // never fails: what cannot move stays for the next start (see `crate::state_move`).
    readiness.mark_state_moving();
    let state_move = tokio::spawn({
        let db = Arc::clone(&db);
        let store_root = store.root().to_path_buf();
        let artifacts = crate::artifacts::ArtifactsClient::from_config(
            http.clone(),
            config.artifacts_internal_url.as_deref(),
            config.service_token.as_deref(),
        );
        let readiness = readiness.clone();
        async move {
            crate::state_move::move_legacy_state(&store_root, &db, artifacts.as_ref()).await;
            readiness.mark_state_moved();
        }
    });
    let state = AppState {
        db,
        store,
        ready: readiness,
        publisher,
        access,
        relay: crate::relay::Relay::new(),
        publish_relay: crate::publish_relay::PublishRelay::new(),
        config: Arc::new(config),
        http,
        prices,
        gg_docs: crate::gg_docs::GgDocIndex::new(),
    };
    // A running ladder dispatch and a filling plan are fed when one of their runs
    // finishes, and a restart loses some of those moments: a feed that was spawned but had
    // not finished dies with the process. Run a launch pass of each once, as soon as the
    // store can be served, after releasing every launch-pass claim whose lease lapsed.
    api::spawn_startup_passes(state.clone());
    // A publish that fails, or whose publisher dies, is retried by the backend on its
    // own schedule, so a transient release failure never needs a person.
    let publish_retry = api::spawn_failed_publish_retry(state.clone());
    let router = api::router(state);

    Ok(Backend {
        router,
        bind,
        refresher,
        price_refresher,
        artifact_sweeper,
        probe_resumer,
        publish_retry,
        state_move,
    })
}

#[cfg(test)]
#[path = "lib.test.rs"]
mod tests;

#[cfg(test)]
mod test_paths;
