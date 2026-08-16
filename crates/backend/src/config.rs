//! Backend configuration, sourced entirely from environment variables (§5 of
//! `design/v0.2.0-contracts.md`).
//!
//! There is no config file for v0.2.0: every knob is an env var so the backend
//! can be driven from a systemd unit or a container without shipping a file. The
//! required variables fail fast at startup with a precise message naming what is
//! missing, so a misconfigured deployment never starts in a half-usable state.

use std::path::PathBuf;
use std::time::Duration;

/// The default address the Axum server binds when `TCAB_BACKEND_BIND` is unset.
const DEFAULT_BIND: &str = "127.0.0.1:8787";
/// The default database URL when `TCAB_BACKEND_DATABASE_URL` is unset: a local
/// SQLite file, created if missing (`mode=rwc`). Deployments override this with a
/// `postgres://…` URL to run on PostgreSQL.
const DEFAULT_DATABASE_URL: &str = "sqlite://./tcab-backend.sqlite?mode=rwc";
/// The default on-disk definition store when `TCAB_BACKEND_STORE` is unset.
const DEFAULT_STORE: &str = "./tcab-store";
/// The default auth service URL when `TCAB_BACKEND_AUTH_URL` is unset: the auth
/// service's own loopback default, so local dev works with both services up and
/// no extra configuration.
const DEFAULT_AUTH_URL: &str = "http://127.0.0.1:8789";
/// The default coalescing window, in milliseconds, when
/// `TCAB_SNAPSHOT_COALESCE_MS` is unset.
///
/// This is a **sliding** debounce: each publish restarts the window, so a batch is
/// only regenerated once the operator stops publishing. It was 5s, which is shorter
/// than the gap between two console publishes — a sweep of N runs therefore minted N
/// full snapshot generations (and N site rebuilds) instead of one. A minute
/// comfortably spans a hand-driven batch while staying far below the site build it
/// triggers, so a single publish still reaches the gallery about as fast as before.
const DEFAULT_COALESCE_MS: u64 = 60_000;
/// The default retention for superseded snapshot generations, in hours, when
/// `TCAB_SNAPSHOT_RETENTION_HOURS` is unset. Long enough that any site build already
/// reading a just-superseded generation finishes against a complete dataset.
const DEFAULT_SNAPSHOT_RETENTION_HOURS: u64 = 24;

/// The R2 (S3-compatible) credentials and bucket the public snapshot is uploaded
/// to.
///
/// Defined in `core` because `tcab publish-reference` writes the same bucket
/// (an asset-generation reference sheet is regenerated and uploaded rather than
/// committed, so it cannot travel through the backend's git checkout). Re-exported
/// here so `Config`'s field type reads naturally alongside the rest of the
/// backend's configuration.
pub use test_cabinet_core::r2::R2Config;

/// The fully resolved backend configuration.
#[derive(Debug, Clone)]
pub struct Config {
    /// Address the Axum server binds (`TCAB_BACKEND_BIND`).
    pub bind: String,
    /// The database connection URL (`TCAB_BACKEND_DATABASE_URL`). The scheme picks
    /// the backend: `sqlite://…` (local/dev) or `postgres://…` (deployment).
    pub database_url: String,
    /// Whether to authenticate to Postgres with a Microsoft Entra managed-identity
    /// token instead of a password (`TCAB_BACKEND_DB_AZURE_AD`, truthy to enable).
    /// When set, `database_url` must be a passwordless `postgres://` URL naming the
    /// Entra Postgres role as its username. Defaults to `false` (password / SQLite).
    pub db_azure_ad: bool,
    /// The deployment environment name (`TCAB_ENV`; `prod`/`staging`/`local`/…,
    /// default `local` — the same value telemetry labels spans with). It selects
    /// which environment's entries this backend reads from the committed
    /// reference-builds lockfile at ingest: prod and staging deploy references to
    /// different Cloudflare Pages projects, so the one shared lockfile holds a
    /// URL per environment and each backend takes only its own.
    pub env: String,
    /// Path to the repo checkout ingested on `POST /ingest` (`TCAB_BACKEND_CHECKOUT`).
    pub checkout: PathBuf,
    /// On-disk definition store (`TCAB_BACKEND_STORE`).
    pub store: PathBuf,
    /// The standalone auth service's base URL (`TCAB_BACKEND_AUTH_URL`). The
    /// backend verifies each mutating request's bearer token against it. Defaults
    /// to the auth service's loopback address for local dev.
    pub auth_url: String,
    /// The shared service token the **dispatcher** authenticates with to claim
    /// queued jobs (`TCAB_BACKEND_SERVICE_TOKEN`). `None` disables the dispatcher
    /// endpoints (the job queue cannot be drained until it is set) — a deployment
    /// supplies it from the same secret the dispatcher reads. Per-job driver
    /// tokens are minted at enqueue and need no configuration.
    pub service_token: Option<String>,
    /// R2 upload configuration, or `None` when snapshot upload is disabled
    /// because the R2 variables were not all supplied (only valid in dev: see
    /// [`Config::from_env`]).
    pub r2: Option<R2Config>,
    /// The Cloudflare Pages deploy-hook fired after each upload
    /// (`TCAB_SITE_DEPLOY_HOOK_URL`). `None` disables the hook (dev only).
    pub deploy_hook_url: Option<String>,
    /// The coalescing window for bursts of publishes (`TCAB_SNAPSHOT_COALESCE_MS`).
    pub coalesce: Duration,
    /// How long a superseded snapshot generation is kept in the bucket before the
    /// refresh prunes it (`TCAB_SNAPSHOT_RETENTION_HOURS`). The generation
    /// `index.json` points at is never pruned regardless of this value; it bounds
    /// only how long the ones nothing references any more are retained. `0` prunes
    /// every superseded generation on the next refresh.
    pub snapshot_retention: Duration,
    /// Whether **experimental** test-case versions are offered to the UI
    /// (`TCAB_BACKEND_ALLOW_EXPERIMENTAL`, truthy to enable). Defaults to `false`:
    /// an experimental version (a case still being iterated on) is hidden from the
    /// catalog and cannot be resolved, so it is treated as if it does not exist. A
    /// deployment that wants to run experimental cases — the local k3d cluster —
    /// sets this truthy; production leaves it unset so experimental cases are never
    /// offered and thus never run or published.
    pub allow_experimental: bool,
    /// Optional override for the headless browser used to render references at
    /// ingest (`TCAB_REFERENCE_BROWSER`). Forwarded to the bundled driver as
    /// `TCAB_CHROMIUM_EXECUTABLE`; unset, the driver uses the Chromium baked into
    /// the backend image.
    pub reference_browser: Option<String>,
    /// The public base URL of the **artifact service** (`TCAB_ARTIFACTS_PUBLIC_URL`),
    /// reported to the console via `GET /config` so it can resolve a pre-publish
    /// run's `links.playable_build` (and its proof/asset media) against the data
    /// plane. `None` when artifacts are not served separately (e.g. a single-box
    /// dev setup with no artifact service) — the console then leaves those links
    /// unresolved. This is the one data-plane URL the control plane exposes; the
    /// artifact bytes themselves never transit the backend.
    pub artifacts_url: Option<String>,
    /// The public base URL of the **arena service** (`TCAB_ARENA_PUBLIC_URL`),
    /// reported to the console via `GET /config` so it can POST adversarial
    /// matches/tournaments and stream live tournament progress against the data
    /// plane. `None` when no arena service is configured (e.g. a single-box dev
    /// setup) — the console then degrades the adversarial run UI. Like
    /// `artifacts_url` this is a data-plane URL the control plane merely advertises;
    /// the arena talks HTTP back to this backend for its inputs and results.
    pub arena_url: Option<String>,
    /// The base URL of the deployment's **Grafana** (`TCAB_GRAFANA_PUBLIC_URL`),
    /// reported to the console via `GET /config` so a run can link out to the traces
    /// it emitted. `None` when the deployment runs no observability stack (the local
    /// and desktop setups, and any overlay that omits the observability component) —
    /// the console then simply hides the link.
    ///
    /// Unlike `artifacts_url` and `arena_url` this is not a data-plane URL: the
    /// backend never calls Grafana, and Grafana never calls the backend. It is
    /// advertised here purely because `GET /config` is already how the console
    /// learns per-environment URLs, and threading one more through the console
    /// image's nginx template would duplicate that mechanism for no gain.
    pub grafana_url: Option<String>,
    /// The **public read** base URL of the snapshot bucket
    /// (`TCAB_SNAPSHOT_PUBLIC_URL`) — an `r2.dev` URL or the custom domain in front
    /// of it — reported to the console via `GET /config`. `None` when the deployment
    /// serves no public snapshot (a single-box dev setup), in which case a client
    /// simply cannot resolve snapshot-hosted media.
    ///
    /// Do not confuse this with [`R2Config::endpoint`](test_cabinet_core::r2::R2Config)
    /// (`TCAB_R2_ENDPOINT`): that is the S3-compatible **write** endpoint the backend
    /// authenticates against with SigV4 to upload a snapshot, and it is a credentialed
    /// control-plane URL that must never reach a browser. This one is the anonymous
    /// read side of the same bucket. The two are different hosts even when they front
    /// identical bytes.
    ///
    /// The console needs it because some snapshot objects are addressed by a
    /// *derivable* key rather than a stored URL — an asset-generation variant's
    /// published reference frames (see `test_cabinet_core::asset_reference`), whose
    /// keys the client builds itself from the case triple and a frame index. Joining
    /// them onto a base is the client's job; the backend only advertises the base,
    /// exactly as it does for `artifacts_url` and `arena_url`.
    ///
    /// The static gallery reaches the same base under its own build-time name
    /// (`TCAB_SNAPSHOT_URL`, see `.env.site.example`); it bakes the value in at build
    /// rather than fetching `GET /config`, so the two are set to the same URL but
    /// consumed by different processes. The name here follows the backend's own
    /// `TCAB_*_PUBLIC_URL` convention for the URLs it advertises.
    pub snapshot_url: Option<String>,
    /// The base URL of the **short-link domain** (`TCAB_SHARE_BASE_URL`, e.g.
    /// `https://tcab.ai`), reported to the console via `GET /config`. `None` when the
    /// deployment fronts no short-link resolver, in which case the console simply
    /// offers no share control.
    ///
    /// This is advertised rather than compiled into the console for the same reason
    /// `grafana_url` is: it is per-environment. A staging console must not hand out
    /// production short links — a code minted against production would resolve to
    /// some other run, or to none — so the environment that knows which resolver
    /// fronts it is the one that says so.
    ///
    /// The backend never calls it and it never calls the backend; like
    /// `grafana_url` this is a convenience URL on an endpoint that already carries
    /// the console's per-environment configuration.
    pub share_base_url: Option<String>,
}

/// A missing or invalid configuration variable.
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    /// A required variable was not set.
    #[error("required environment variable `{0}` is not set")]
    Missing(&'static str),
}

impl Config {
    /// Resolve the configuration from the process environment.
    ///
    /// `TCAB_BACKEND_CHECKOUT` is the only unconditionally required variable. The
    /// R2 group and the deploy hook are required for production publishing, but
    /// the backend is allowed to start without them so a developer can exercise
    /// ingest and the read API offline; in that mode a publish still records into
    /// SQLite and regenerates the snapshot on disk, only skipping the R2 upload
    /// and the deploy-hook fire. Production deployments supply the full set.
    pub fn from_env() -> Result<Self, ConfigError> {
        let bind = env_or("TCAB_BACKEND_BIND", DEFAULT_BIND);
        let env = env_or("TCAB_ENV", "local");
        let database_url = env_or("TCAB_BACKEND_DATABASE_URL", DEFAULT_DATABASE_URL);
        let db_azure_ad = truthy("TCAB_BACKEND_DB_AZURE_AD");
        let checkout = PathBuf::from(require("TCAB_BACKEND_CHECKOUT")?);
        let store = PathBuf::from(env_or("TCAB_BACKEND_STORE", DEFAULT_STORE));
        let auth_url = env_or("TCAB_BACKEND_AUTH_URL", DEFAULT_AUTH_URL);
        let service_token = nonempty("TCAB_BACKEND_SERVICE_TOKEN");

        let r2 = R2Config::from_env();
        let deploy_hook_url = std::env::var("TCAB_SITE_DEPLOY_HOOK_URL")
            .ok()
            .filter(|v| !v.is_empty());

        let coalesce_ms = std::env::var("TCAB_SNAPSHOT_COALESCE_MS")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(DEFAULT_COALESCE_MS);

        let snapshot_retention_hours = std::env::var("TCAB_SNAPSHOT_RETENTION_HOURS")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(DEFAULT_SNAPSHOT_RETENTION_HOURS);

        let reference_browser = std::env::var("TCAB_REFERENCE_BROWSER")
            .ok()
            .filter(|v| !v.is_empty());

        let allow_experimental = truthy("TCAB_BACKEND_ALLOW_EXPERIMENTAL");

        let artifacts_url =
            nonempty("TCAB_ARTIFACTS_PUBLIC_URL").map(|url| url.trim_end_matches('/').to_string());

        let arena_url =
            nonempty("TCAB_ARENA_PUBLIC_URL").map(|url| url.trim_end_matches('/').to_string());

        let grafana_url =
            nonempty("TCAB_GRAFANA_PUBLIC_URL").map(|url| url.trim_end_matches('/').to_string());

        let snapshot_url =
            nonempty("TCAB_SNAPSHOT_PUBLIC_URL").map(|url| url.trim_end_matches('/').to_string());

        let share_base_url =
            nonempty("TCAB_SHARE_BASE_URL").map(|url| url.trim_end_matches('/').to_string());

        Ok(Self {
            bind,
            env,
            database_url,
            db_azure_ad,
            checkout,
            store,
            auth_url,
            service_token,
            r2,
            deploy_hook_url,
            coalesce: Duration::from_millis(coalesce_ms),
            snapshot_retention: Duration::from_secs(snapshot_retention_hours * 3600),
            reference_browser,
            artifacts_url,
            arena_url,
            grafana_url,
            snapshot_url,
            share_base_url,
            allow_experimental,
        })
    }

    /// Whether this backend runs single-box: the control plane, the dispatcher,
    /// and every driver share one machine's lifecycle. Inferred from a SQLite
    /// database URL — the local/desktop deployment — as opposed to the
    /// `postgres://` of a remote deployment whose backend can restart
    /// independently while drivers keep running.
    ///
    /// Gates the startup reconciliation that fails orphaned in-flight jobs (see
    /// [`crate::build`]): on a single box a backend restart means every driver
    /// died with it, so reaping is correct; a remote backend must never do it.
    pub fn is_single_box(&self) -> bool {
        self.database_url.starts_with("sqlite:")
    }
}

/// Read an environment variable, falling back to a default when unset or empty.
fn env_or(key: &str, default: &str) -> String {
    std::env::var(key)
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| default.to_string())
}

/// Read a required environment variable, erroring with its name when unset.
fn require(key: &'static str) -> Result<String, ConfigError> {
    std::env::var(key)
        .ok()
        .filter(|v| !v.is_empty())
        .ok_or(ConfigError::Missing(key))
}

/// Read a non-empty environment variable, returning `None` when unset or empty.
fn nonempty(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|v| !v.is_empty())
}

#[cfg(test)]
#[path = "config.test.rs"]
mod tests;

/// Read a boolean flag environment variable, treating a **truthy** value as
/// `true` and anything else — including unset, empty, or an unrecognized value —
/// as `false`. The accepted truthy spellings (case-insensitive) are `1`, `true`,
/// `yes`, and `on`, so an operator can enable a flag with whichever idiom their
/// tooling favors without the flag silently flipping on for an unrelated value.
fn truthy(key: &str) -> bool {
    std::env::var(key)
        .ok()
        .map(|v| {
            matches!(
                v.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}
