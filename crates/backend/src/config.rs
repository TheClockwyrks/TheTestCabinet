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
const DEFAULT_COALESCE_MS: u64 = 5000;

/// The R2 (S3-compatible) credentials and bucket the public snapshot is uploaded
/// to. The backend holds the only credential that can write the bucket.
#[derive(Debug, Clone)]
pub struct R2Config {
    /// Cloudflare account id (`TCAB_R2_ACCOUNT_ID`); also derives the endpoint.
    pub account_id: String,
    /// The bucket the snapshot is uploaded to (`TCAB_R2_BUCKET`).
    pub bucket: String,
    /// The S3-API access key id (`TCAB_R2_ACCESS_KEY_ID`).
    pub access_key_id: String,
    /// The S3-API secret (`TCAB_R2_SECRET_ACCESS_KEY`).
    pub secret_access_key: String,
    /// The S3 endpoint. Derived from the account id unless overridden by
    /// `TCAB_R2_ENDPOINT`. Has no trailing slash.
    pub endpoint: String,
    /// The region SigV4 signs against. R2 ignores the region but the S3 signing
    /// recipe requires one; `auto` is Cloudflare's documented value.
    pub region: String,
}

/// The fully resolved backend configuration.
#[derive(Debug, Clone)]
pub struct Config {
    /// Address the Axum server binds (`TCAB_BACKEND_BIND`).
    pub bind: String,
    /// The database connection URL (`TCAB_BACKEND_DATABASE_URL`). The scheme picks
    /// the backend: `sqlite://…` (local/dev) or `postgres://…` (deployment).
    pub database_url: String,
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
    /// Optional override for the headless browser used to render references at
    /// ingest (`TCAB_REFERENCE_BROWSER`). Consumed by the bundled driver.
    pub reference_browser: Option<String>,
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
        let database_url = env_or("TCAB_BACKEND_DATABASE_URL", DEFAULT_DATABASE_URL);
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

        let reference_browser = std::env::var("TCAB_REFERENCE_BROWSER")
            .ok()
            .filter(|v| !v.is_empty());

        Ok(Self {
            bind,
            database_url,
            checkout,
            store,
            auth_url,
            service_token,
            r2,
            deploy_hook_url,
            coalesce: Duration::from_millis(coalesce_ms),
            reference_browser,
        })
    }
}

impl R2Config {
    /// Resolve the R2 configuration from the environment, returning `None` when
    /// any of the four required variables is absent (the snapshot upload is then
    /// disabled — a dev-only mode). When all four are present an endpoint is
    /// derived from the account id unless `TCAB_R2_ENDPOINT` overrides it.
    pub fn from_env() -> Option<Self> {
        let account_id = nonempty("TCAB_R2_ACCOUNT_ID")?;
        let bucket = nonempty("TCAB_R2_BUCKET")?;
        let access_key_id = nonempty("TCAB_R2_ACCESS_KEY_ID")?;
        let secret_access_key = nonempty("TCAB_R2_SECRET_ACCESS_KEY")?;

        let endpoint = std::env::var("TCAB_R2_ENDPOINT")
            .ok()
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| format!("https://{account_id}.r2.cloudflarestorage.com"));
        let endpoint = endpoint.trim_end_matches('/').to_string();

        Some(Self {
            account_id,
            bucket,
            access_key_id,
            secret_access_key,
            endpoint,
            region: "auto".to_string(),
        })
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
