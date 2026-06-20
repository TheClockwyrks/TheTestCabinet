//! Authentication mode resolution for a harness run.
//!
//! The Test Cabinet authenticates a harness in one of two modes:
//!
//! - **API key** — a provider key the user exports on the host is injected into
//!   the run container as an environment variable (see
//!   [`AgentHarness::api_key_env`](crate::harness::AgentHarness::api_key_env)).
//! - **Subscription** — the credential files a harness's CLI writes when the user
//!   signs in (for example `~/.codex/auth.json`) are copied into the run
//!   container at the paths the CLI reads under the run user's home, so the
//!   harness authenticates with the account subscription. The user signs in with
//!   the harness CLI itself in a trusted environment; The Test Cabinet never
//!   performs the login or mints tokens.
//!
//! Which mode a run uses is resolved here, once, from the harness's declared
//! capabilities and the host environment, so the orchestrator and the
//! `tcab harnesses` readiness listing select identically.
//!
//! ## Selecting a mode
//!
//! The default is to **prefer a subscription** when its credentials are present,
//! falling back to an API key otherwise. A user can lock the mode with an
//! environment variable: `TCAB_AUTH_MODE` for every harness, or
//! `TCAB_AUTH_MODE_<SLUG>` (for example `TCAB_AUTH_MODE_CODEX`) for one harness,
//! which takes precedence. Accepted values are `auto` (the default),
//! `subscription`, and `api-key`.
//!
//! ## Credential refresh
//!
//! A subscription CLI may refresh its tokens mid-session, rewriting the
//! credential file inside the container. The container is ephemeral and torn
//! down after the run, so that refreshed copy is discarded — credentials are
//! copied **in** only, never written back to the host. Claude Code's and Codex's
//! refresh tokens are long-lived, so the host credentials stay valid for the
//! next run; this is a deliberate limitation, not an oversight.

use std::path::PathBuf;

use crate::error::{Error, Result};
use crate::execution::ContainerFile;
use crate::harness::{AgentHarness, Availability};
use crate::run_record::{AuthMode, HarnessSlug};

/// A subscription-authentication descriptor: the credential files a harness's
/// CLI needs visible inside the run container. Declared per harness in its
/// adapter, alongside [`AgentHarness::api_key_env`](crate::harness::AgentHarness::api_key_env).
#[derive(Debug, Clone, Copy)]
pub struct SubscriptionSpec {
    /// The credential files copied from the host into the container. At least one
    /// must be [`required`](CredFile::required) for a subscription to be
    /// considered present.
    pub files: &'static [CredFile],
}

/// One credential file a subscription harness reads.
#[derive(Debug, Clone, Copy)]
pub struct CredFile {
    /// Where the file lives on the host.
    pub source: CredSource,
    /// The absolute path it is copied to inside the container — under the run
    /// user's home, where the CLI reads it (for example
    /// `/home/node/.codex/auth.json`).
    pub container_path: &'static str,
    /// The Unix mode the copied file is given (for example `0o600`).
    pub mode: u32,
    /// Whether the subscription requires this file. A subscription is "present"
    /// when every required file exists on the host; a non-required file is copied
    /// when present and skipped when absent.
    pub required: bool,
}

/// How a [`CredFile`]'s host location is resolved.
#[derive(Debug, Clone, Copy)]
pub enum CredSource {
    /// A path relative to the user's home directory (`$HOME`) — for example
    /// `.claude/.credentials.json`.
    HomeRelative(&'static str),
    /// A file inside a CLI home directory that an environment variable can
    /// relocate. The directory is `$<env>` when set, else `$HOME/<default_rel>`;
    /// the file is `<dir>/<file>`. This honors, for example, `CODEX_HOME`.
    HomeDir {
        /// The environment variable that relocates the CLI home directory.
        env: &'static str,
        /// The home-relative default directory when `env` is unset.
        default_rel: &'static str,
        /// The credential file name within that directory.
        file: &'static str,
    },
}

impl CredSource {
    /// Resolve the host path this source points at, from the current environment.
    fn host_path(&self) -> PathBuf {
        match self {
            CredSource::HomeRelative(rel) => home_dir().join(rel),
            CredSource::HomeDir {
                env,
                default_rel,
                file,
            } => {
                let dir = std::env::var_os(env)
                    .map(PathBuf::from)
                    .unwrap_or_else(|| home_dir().join(default_rel));
                dir.join(file)
            }
        }
    }
}

/// The mode a user can request through the environment.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequestedAuthMode {
    /// Prefer a subscription when its credentials are present, else an API key.
    /// The default when nothing is set.
    Auto,
    /// Use the subscription; fail if its credentials are not present.
    Subscription,
    /// Use the API key; fail if it is not set.
    ApiKey,
}

/// The resolved plan for authenticating a run, ready to apply to a
/// [`ContainerSpec`](crate::execution::ContainerSpec).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthPlan {
    /// Inject the API key into the container under `container_env`.
    ApiKey {
        /// The variable the key is injected as inside the container.
        container_env: String,
        /// The key value, read from the host.
        key: String,
    },
    /// Copy the subscription credential files into the container.
    Subscription {
        /// The credential files to materialize, with their container paths.
        files: Vec<ContainerFile>,
    },
}

impl AuthPlan {
    /// The mode this plan records on the run.
    pub fn mode(&self) -> AuthMode {
        match self {
            AuthPlan::ApiKey { .. } => AuthMode::ApiKey,
            AuthPlan::Subscription { .. } => AuthMode::Subscription,
        }
    }
}

/// A credential file resolved against the current host environment.
struct ResolvedCred {
    host_path: PathBuf,
    container_path: &'static str,
    mode: u32,
    required: bool,
}

/// Which mode a [`select`] decision landed on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Selection {
    /// Authenticate with the API key.
    ApiKey,
    /// Authenticate with the subscription.
    Subscription,
    /// Neither mode's credentials are available.
    None,
}

/// Decide a mode from the requested mode and what is available. `auto` prefers a
/// subscription when present, else an API key; a locked mode requires that
/// method's credentials. This is the whole selection policy, kept pure so it is
/// exercised without touching the process environment.
fn select(mode: RequestedAuthMode, api_available: bool, subscription_available: bool) -> Selection {
    match mode {
        RequestedAuthMode::ApiKey if api_available => Selection::ApiKey,
        RequestedAuthMode::Subscription if subscription_available => Selection::Subscription,
        RequestedAuthMode::Auto if subscription_available => Selection::Subscription,
        RequestedAuthMode::Auto if api_available => Selection::ApiKey,
        _ => Selection::None,
    }
}

/// Resolve the authentication plan for a harness from the host environment.
///
/// Honors the requested mode (`TCAB_AUTH_MODE[_<SLUG>]`); in `auto` it prefers a
/// subscription when present, else an API key. Returns a clear
/// [`Error::HarnessUnavailable`] naming what to set or sign in to when the
/// requested mode's credentials are not available.
pub fn resolve_auth(harness: &dyn AgentHarness) -> Result<AuthPlan> {
    let slug = harness.slug();
    let mode = requested_mode(slug);
    let api_key = api_key_value(harness);
    let creds = harness.subscription_spec().map(resolved_creds);
    let subscription_available = creds.as_deref().is_some_and(subscription_present);

    match select(mode, api_key.is_some(), subscription_available) {
        Selection::Subscription => subscription_plan(slug, creds.unwrap_or_default()),
        Selection::ApiKey => {
            let (container_env, key) = api_key.expect("api key present for an ApiKey selection");
            Ok(AuthPlan::ApiKey { container_env, key })
        }
        Selection::None => Err(unavailable(slug, mode_detail(harness, mode))),
    }
}

/// Report a harness's readiness from configuration alone, for the
/// `tcab harnesses` listing. Cost-free: it only checks whether the credentials
/// the resolved mode needs are present (environment variables and file
/// existence), never reading file contents or starting a container.
pub fn auth_readiness(harness: &dyn AgentHarness) -> Availability {
    let mode = requested_mode(harness.slug());
    let api_available = api_key_value(harness).is_some();
    let subscription_available = harness
        .subscription_spec()
        .map(resolved_creds)
        .as_deref()
        .is_some_and(subscription_present);

    match select(mode, api_available, subscription_available) {
        Selection::None => Availability {
            available: false,
            version: None,
            detail: Some(mode_detail(harness, mode)),
        },
        Selection::ApiKey | Selection::Subscription => Availability {
            available: true,
            version: None,
            detail: None,
        },
    }
}

/// The API key value and the container variable it is injected as, when the
/// harness supports API-key auth and its host key variable is set and non-empty.
fn api_key_value(harness: &dyn AgentHarness) -> Option<(String, String)> {
    let host_env = harness.api_key_env()?;
    let key = std::env::var(host_env)
        .ok()
        .filter(|v| !v.trim().is_empty())?;
    let container_env = harness.container_key_env().unwrap_or(host_env).to_string();
    Some((container_env, key))
}

/// Resolve a subscription spec's files against the current host environment.
fn resolved_creds(spec: SubscriptionSpec) -> Vec<ResolvedCred> {
    spec.files
        .iter()
        .map(|file| ResolvedCred {
            host_path: file.source.host_path(),
            container_path: file.container_path,
            mode: file.mode,
            required: file.required,
        })
        .collect()
}

/// Whether a subscription is present: there is at least one required file and
/// every required file exists on the host.
fn subscription_present(creds: &[ResolvedCred]) -> bool {
    let mut any_required = false;
    for cred in creds.iter().filter(|c| c.required) {
        any_required = true;
        if !cred.host_path.exists() {
            return false;
        }
    }
    any_required
}

/// Read the subscription credential files into a plan, skipping optional files
/// that are absent. A required file that cannot be read fails the run.
fn subscription_plan(slug: HarnessSlug, creds: Vec<ResolvedCred>) -> Result<AuthPlan> {
    let mut files = Vec::with_capacity(creds.len());
    for cred in creds {
        match std::fs::read(&cred.host_path) {
            Ok(contents) => files.push(ContainerFile {
                container_path: cred.container_path.to_string(),
                contents,
                mode: cred.mode,
            }),
            // An optional file the user has not created is simply not copied.
            Err(err) if err.kind() == std::io::ErrorKind::NotFound && !cred.required => {}
            Err(err) => {
                return Err(unavailable(
                    slug,
                    format!(
                        "could not read subscription credential `{}`: {err}",
                        cred.host_path.display()
                    ),
                ));
            }
        }
    }
    Ok(AuthPlan::Subscription { files })
}

/// The requested mode for a harness, read from the environment: a per-harness
/// override (`TCAB_AUTH_MODE_<SLUG>`) wins over the global `TCAB_AUTH_MODE`.
fn requested_mode(slug: HarnessSlug) -> RequestedAuthMode {
    let per_harness = std::env::var(format!(
        "TCAB_AUTH_MODE_{}",
        slug.as_str().to_ascii_uppercase()
    ))
    .ok();
    let global = std::env::var("TCAB_AUTH_MODE").ok();
    requested_mode_from(per_harness.as_deref(), global.as_deref())
}

/// Resolve the requested mode from the per-harness and global values: the
/// per-harness override wins, then the global, then [`Auto`] by default. A value
/// that is set but unrecognized is ignored (it falls through to the next).
///
/// [`Auto`]: RequestedAuthMode::Auto
fn requested_mode_from(per_harness: Option<&str>, global: Option<&str>) -> RequestedAuthMode {
    per_harness
        .and_then(parse_mode)
        .or_else(|| global.and_then(parse_mode))
        .unwrap_or(RequestedAuthMode::Auto)
}

/// The readiness/error detail for a mode whose credentials are not available.
fn mode_detail(harness: &dyn AgentHarness, mode: RequestedAuthMode) -> String {
    match mode {
        RequestedAuthMode::ApiKey => api_key_detail(harness),
        RequestedAuthMode::Subscription => subscription_detail(harness),
        RequestedAuthMode::Auto => auto_detail(harness),
    }
}

/// Parse an auth-mode value, tolerant of case, surrounding whitespace, and the
/// `-`/`_` separator. Returns `None` for an empty or unrecognized value.
fn parse_mode(value: &str) -> Option<RequestedAuthMode> {
    match value.trim().to_ascii_lowercase().replace('_', "-").as_str() {
        "auto" => Some(RequestedAuthMode::Auto),
        "subscription" | "sub" => Some(RequestedAuthMode::Subscription),
        "api-key" | "apikey" | "key" => Some(RequestedAuthMode::ApiKey),
        _ => None,
    }
}

/// The user's home directory, from `$HOME`; an empty path when it is unset (so a
/// resolved credential path simply will not exist).
fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default()
}

/// Build a `HarnessUnavailable` error.
fn unavailable(slug: HarnessSlug, detail: String) -> Error {
    Error::HarnessUnavailable {
        slug: slug.as_str().to_string(),
        detail,
    }
}

/// Detail explaining how to provide an API key (or that the harness has no
/// API-key mode).
fn api_key_detail(harness: &dyn AgentHarness) -> String {
    match harness.api_key_env() {
        Some(var) => format!("set {var} to use API-key authentication"),
        None => "this harness does not support API-key authentication".to_string(),
    }
}

/// Detail explaining how to provide a subscription (or that the harness has no
/// subscription mode), naming the expected credential file(s).
fn subscription_detail(harness: &dyn AgentHarness) -> String {
    match harness.subscription_spec() {
        Some(spec) => {
            let paths = required_host_paths(spec);
            format!(
                "sign in with the harness CLI for subscription authentication (expected {paths})"
            )
        }
        None => "this harness does not support subscription authentication".to_string(),
    }
}

/// Detail for `auto` mode: name whichever credentials the harness can accept.
fn auto_detail(harness: &dyn AgentHarness) -> String {
    match (harness.api_key_env(), harness.subscription_spec()) {
        (Some(var), Some(spec)) => format!(
            "set {var} for API-key authentication, or sign in with the harness CLI for \
             subscription authentication (expected {})",
            required_host_paths(spec)
        ),
        (Some(var), None) => format!("set {var} to run this harness"),
        (None, Some(spec)) => format!(
            "sign in with the harness CLI for subscription authentication (expected {})",
            required_host_paths(spec)
        ),
        (None, None) => "this harness has no supported authentication mode".to_string(),
    }
}

/// A comma-separated list of a subscription's required host credential paths,
/// for a readiness/error detail.
fn required_host_paths(spec: SubscriptionSpec) -> String {
    resolved_creds(spec)
        .into_iter()
        .filter(|cred| cred.required)
        .map(|cred| cred.host_path.display().to_string())
        .collect::<Vec<_>>()
        .join(", ")
}

#[cfg(test)]
#[path = "auth.test.rs"]
mod tests;
