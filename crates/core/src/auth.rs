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
    pub(crate) fn host_path(&self) -> PathBuf {
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

impl SubscriptionSpec {
    /// The credential files this subscription declares, in order. Used by the
    /// driver to enumerate a harness's subscription files (their
    /// [`container_path`](CredFile::container_path) and mode) without duplicating
    /// the per-harness list — it maps a mounted Secret's keys back to these paths.
    pub fn files(&self) -> &'static [CredFile] {
        self.files
    }
}

/// A source of subscription credential bytes, keyed by the
/// [`CredFile`](CredFile) being read.
///
/// This is the seam that lets a subscription be authenticated from somewhere
/// other than the host filesystem. The CLI/desktop path reads the credential
/// files the user signed in with on a trusted host ([`HostCreds`]); the driver,
/// which runs in an ephemeral pod with no such files, reads bytes from an
/// operator-provided Secret mounted into the pod ([`MapCreds`]).
///
/// A required file the source cannot supply fails the run with the same
/// [`Error::HarnessUnavailable`] the host path returns; an optional file the
/// source cannot supply is simply not copied.
pub trait CredBytesSource {
    /// Read the bytes for one credential file, or `Ok(None)` when the source has
    /// no such file (the equivalent of a host file that does not exist). An I/O
    /// error is surfaced; for a required file it fails the run.
    fn read(&self, file: &CredFile) -> std::io::Result<Option<Vec<u8>>>;

    /// Whether the source can supply this file, without reading its contents.
    /// Used by the cost-free readiness check; the default reads the bytes (cheap
    /// for the small credential files), and [`HostCreds`] overrides it with a
    /// filesystem-existence check so readiness never opens the file.
    fn present(&self, file: &CredFile) -> bool {
        matches!(self.read(file), Ok(Some(_)))
    }
}

/// A [`CredBytesSource`] backed by the host filesystem — the CLI/desktop path.
///
/// It resolves each [`CredFile`]'s [`CredSource`] against the current host
/// environment and reads it with `std::fs`, mapping `NotFound` to `Ok(None)` so
/// an absent optional file is skipped (the exact behavior the in-process run path
/// has always had).
#[derive(Debug, Clone, Copy, Default)]
pub struct HostCreds;

impl CredBytesSource for HostCreds {
    fn read(&self, file: &CredFile) -> std::io::Result<Option<Vec<u8>>> {
        match std::fs::read(file.source.host_path()) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(err) => Err(err),
        }
    }

    /// Cost-free existence check: the readiness listing only needs to know whether
    /// the file is there, never its contents.
    fn present(&self, file: &CredFile) -> bool {
        file.source.host_path().exists()
    }
}

/// A [`CredBytesSource`] backed by an in-memory map keyed by each file's
/// [`container_path`](CredFile::container_path) — the driver/cluster path.
///
/// The driver builds this from an operator-provided Secret mounted into its pod
/// (the Secret's keys are credential basenames, which the driver maps back to the
/// full container paths). A missing key returns `Ok(None)`, so an optional file
/// the operator did not include is skipped and core enforces required-ness.
#[derive(Debug, Clone, Default)]
pub struct MapCreds {
    /// Credential bytes keyed by [`CredFile::container_path`].
    by_container_path: std::collections::HashMap<String, Vec<u8>>,
}

impl MapCreds {
    /// Build a `MapCreds` from credential bytes keyed by container path.
    pub fn new(by_container_path: std::collections::HashMap<String, Vec<u8>>) -> Self {
        Self { by_container_path }
    }
}

impl CredBytesSource for MapCreds {
    fn read(&self, file: &CredFile) -> std::io::Result<Option<Vec<u8>>> {
        Ok(self.by_container_path.get(file.container_path).cloned())
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

/// The mode a harness would authenticate with given the requested mode and which
/// credentials are available, or `None` when none of the requested mode's
/// credentials are present. This exposes the selection policy of [`select`] for a
/// host that already knows availability out of band — the desktop authentication
/// settings layer persisted overrides over the environment, so they cannot use the
/// environment-reading [`auth_readiness`] but still want the verdict the run path
/// would reach.
pub fn select_mode(
    mode: RequestedAuthMode,
    api_available: bool,
    subscription_available: bool,
) -> Option<AuthMode> {
    match select(mode, api_available, subscription_available) {
        Selection::ApiKey => Some(AuthMode::ApiKey),
        Selection::Subscription => Some(AuthMode::Subscription),
        Selection::None => None,
    }
}

/// Resolve the authentication plan for a harness from the host environment.
///
/// Honors the requested mode (`TCAB_AUTH_MODE[_<SLUG>]`); in `auto` it prefers a
/// subscription when present, else an API key. Returns a clear
/// [`Error::HarnessUnavailable`] naming what to set or sign in to when the
/// requested mode's credentials are not available.
///
/// This is the CLI/desktop path: the subscription credentials are read from the
/// host filesystem ([`HostCreds`]). The driver, which has no such files, uses
/// [`resolve_auth_with`] with a [`MapCreds`] built from a mounted Secret.
pub fn resolve_auth(harness: &dyn AgentHarness) -> Result<AuthPlan> {
    resolve_auth_with(harness, &HostCreds)
}

/// Resolve the authentication plan for a harness, drawing any subscription
/// credentials from `creds` rather than assuming the host filesystem.
///
/// The mode selection is identical to [`resolve_auth`] — the requested mode
/// (`TCAB_AUTH_MODE[_<SLUG>]`) is still honored from the environment and `auto`
/// still prefers a subscription when present — only *where the credential bytes
/// come from* differs. The driver passes a [`MapCreds`] over its mounted Secret;
/// the CLI/desktop pass [`HostCreds`] (the [`resolve_auth`] default).
//
// The per-account credential vault (the deferred multi-tenant follow-up) would
// slot in here as another `CredBytesSource` — one keyed to the enqueuing account
// rather than a single operator Secret — with no change to the selection policy.
pub fn resolve_auth_with(
    harness: &dyn AgentHarness,
    creds: &dyn CredBytesSource,
) -> Result<AuthPlan> {
    let slug = harness.slug();
    let mode = requested_mode(slug);
    let api_key = api_key_value(harness);
    let subscription_available = harness
        .subscription_spec()
        .is_some_and(|spec| subscription_present(&spec, creds));

    match select(mode, api_key.is_some(), subscription_available) {
        Selection::Subscription => subscription_plan(
            slug,
            harness
                .subscription_spec()
                .unwrap_or(SubscriptionSpec { files: &[] }),
            creds,
        ),
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
        .is_some_and(|spec| subscription_present(&spec, &HostCreds));

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
/// harness supports API-key auth and a key is available. A per-harness override
/// (`TCAB_API_KEY_<SLUG>`) wins over the shared provider variable
/// ([`api_key_env`](AgentHarness::api_key_env)) so harnesses that share a
/// provider key — the OpenRouter harnesses all read `OPENROUTER_API_KEY` — can
/// still be given independent keys.
fn api_key_value(harness: &dyn AgentHarness) -> Option<(String, String)> {
    let host_env = harness.api_key_env()?;
    let key =
        nonempty_env(&api_key_override_var(harness.slug())).or_else(|| nonempty_env(host_env))?;
    let container_env = harness.container_key_env().unwrap_or(host_env).to_string();
    Some((container_env, key))
}

/// The value of an environment variable when it is set and not blank.
fn nonempty_env(var: &str) -> Option<String> {
    std::env::var(var).ok().filter(|v| !v.trim().is_empty())
}

/// The per-harness API-key override variable, `TCAB_API_KEY_<SLUG>` (for example
/// `TCAB_API_KEY_KILO`). When set, it supplies that one harness's key, taking
/// precedence over the shared provider variable
/// ([`api_key_env`](AgentHarness::api_key_env)) so harnesses that share a provider
/// can be given independent keys. This is the single source of truth for the name:
/// the desktop app builds the driver Secret with it, and the run engine reads it
/// here in both the host (CLI/desktop) and driver-pod paths.
pub fn api_key_override_var(slug: HarnessSlug) -> String {
    format!("TCAB_API_KEY_{}", slug.as_str().to_ascii_uppercase())
}

/// The host-side status of one of a harness's subscription credential files, for
/// a UI that inspects which files a user is signed in with. See
/// [`subscription_files`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubscriptionFileStatus {
    /// The path the file is expected at on the host, resolved from the current
    /// environment (honoring relocators like `CODEX_HOME`).
    pub host_path: String,
    /// The data key this file occupies in the cluster subscription Secret: the
    /// basename of its [`container_path`](CredFile::container_path) (for example
    /// `auth.json`). A host that builds that Secret keys this file by this value,
    /// which the driver maps back to the full container path (see the driver's
    /// `mounted_creds`).
    pub secret_key: String,
    /// Whether the file exists on the host right now.
    pub present: bool,
    /// Whether the subscription requires this file (versus an optional one).
    pub required: bool,
}

/// The host status of each subscription credential file a harness declares, or an
/// empty vec for a harness with no subscription mode. Resolves each file's host
/// path from the current environment and checks its presence with [`HostCreds`]'s
/// cost-free existence check (never reading contents). For inspecting what a user
/// is signed in to — the desktop authentication settings — leaving the run path on
/// [`resolve_auth`].
pub fn subscription_files(harness: &dyn AgentHarness) -> Vec<SubscriptionFileStatus> {
    let Some(spec) = harness.subscription_spec() else {
        return Vec::new();
    };
    spec.files
        .iter()
        .map(|file| SubscriptionFileStatus {
            host_path: file.source.host_path().display().to_string(),
            secret_key: file
                .container_path
                .rsplit('/')
                .next()
                .unwrap_or(file.container_path)
                .to_string(),
            present: HostCreds.present(file),
            required: file.required,
        })
        .collect()
}

/// Whether a subscription is present: there is at least one required file and the
/// `creds` source can supply every required file. Drawn from `creds` so the same
/// policy works for the host filesystem ([`HostCreds`]) and a mounted Secret
/// ([`MapCreds`]).
fn subscription_present(spec: &SubscriptionSpec, creds: &dyn CredBytesSource) -> bool {
    let mut any_required = false;
    for file in spec.files.iter().filter(|f| f.required) {
        any_required = true;
        if !creds.present(file) {
            return false;
        }
    }
    any_required
}

/// Read the subscription credential files into a plan from `creds`, skipping
/// optional files the source cannot supply. A required file that cannot be read
/// fails the run with the same [`Error::HarnessUnavailable`] the host path
/// returns.
fn subscription_plan(
    slug: HarnessSlug,
    spec: SubscriptionSpec,
    creds: &dyn CredBytesSource,
) -> Result<AuthPlan> {
    let mut files = Vec::with_capacity(spec.files.len());
    for cred in spec.files {
        match creds.read(cred) {
            Ok(Some(contents)) => files.push(ContainerFile {
                container_path: cred.container_path.to_string(),
                contents,
                mode: cred.mode,
            }),
            // An optional file the source does not supply is simply not copied.
            Ok(None) if !cred.required => {}
            Ok(None) => {
                return Err(unavailable(
                    slug,
                    format!(
                        "subscription credential `{}` is not available",
                        cred.container_path
                    ),
                ));
            }
            Err(err) => {
                return Err(unavailable(
                    slug,
                    format!(
                        "could not read subscription credential `{}`: {err}",
                        cred.container_path
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
/// for a readiness/error detail. These name where the CLI/desktop expects the
/// files signed in on the host; the driver/cluster path supplies the same files
/// from a mounted Secret instead.
fn required_host_paths(spec: SubscriptionSpec) -> String {
    spec.files
        .iter()
        .filter(|cred| cred.required)
        .map(|cred| cred.source.host_path().display().to_string())
        .collect::<Vec<_>>()
        .join(", ")
}

#[cfg(test)]
#[path = "auth.test.rs"]
mod tests;
