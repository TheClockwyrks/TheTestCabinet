//! Per-harness authentication settings for the self-contained desktop cluster.
//!
//! The desktop app runs test cases on a local cluster it stands up itself (see
//! [`crate::cluster`]). Each run's driver pod authenticates its harness exactly
//! the way every other deployment does — the shared run engine in
//! [`test_cabinet_core::auth`] resolves an API key or a subscription from the
//! pod's environment and a mounted credential volume. This module is the desktop
//! UI's control surface over what those resolve to:
//!
//! - **Auth method** per harness — `auto` (the default), `subscription`, or
//!   `api-key` — written into the driver Secret as `TCAB_AUTH_MODE_<SLUG>`, which
//!   the engine honors per harness.
//! - **API key** per harness — written as `TCAB_API_KEY_<SLUG>`, the per-harness
//!   override the engine reads before the shared provider variable, so harnesses
//!   that share a provider key (the OpenRouter harnesses all read
//!   `OPENROUTER_API_KEY`) can still be given independent keys.
//! - **Subscription refresh** — rebuild the `tcab-driver-subscription` Secret from
//!   the host's currently signed-in CLI credential files, so a fresh sign-in on
//!   the host is pushed into the cluster.
//!
//! Settings persist to `<app-data>/harness-auth.json` and are applied to the
//! running cluster on every change and on every launch (the bootstrap calls
//! [`apply_harness_secrets`]). The persisted values are layered *over* the host
//! environment: a discovered provider key (exported in the shell or a `.env`
//! file) is the default, and a saved override wins over it.
//!
//! Plaintext storage of API keys mirrors the app's existing posture — it already
//! lifts plaintext provider keys from the environment into a loopback-only cluster
//! Secret — and is appropriate for the single-user local-machine threat model the
//! desktop app targets.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use test_cabinet_core::run_record::HarnessSlug;
use test_cabinet_core::{
    AgentHarness, DefaultHarnessRegistry, HarnessRegistry, RequestedAuthMode, api_key_override_var,
    select_mode, subscription_files,
};

use crate::cluster;

/// The stored auth-mode values, matching the engine's `TCAB_AUTH_MODE` spelling
/// (see [`test_cabinet_core::auth`]) and the UI's segmented control.
const MODE_AUTO: &str = "auto";
const MODE_SUBSCRIPTION: &str = "subscription";
const MODE_API_KEY: &str = "api-key";

// --- Persisted configuration --------------------------------------------------

/// The persisted per-harness authentication settings, at
/// `<app-data>/harness-auth.json`. A harness with no entry uses the defaults
/// (`auto` mode, no key override — keys then come from the host environment).
#[derive(Debug, Default, Serialize, Deserialize)]
struct AuthConfig {
    #[serde(default)]
    harnesses: BTreeMap<String, HarnessEntry>,
}

/// One harness's saved settings. Both fields are optional: an absent `auth_mode`
/// means `auto`, and an absent `api_key` means "use whatever the host environment
/// provides".
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct HarnessEntry {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    auth_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    api_key: Option<String>,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(cluster::app_data(app)?.join("harness-auth.json"))
}

fn load_config(app: &AppHandle) -> Result<AuthConfig, String> {
    let path = config_path(app)?;
    match std::fs::read(&path) {
        Ok(bytes) => {
            serde_json::from_slice(&bytes).map_err(|e| format!("parsing {}: {e}", path.display()))
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(AuthConfig::default()),
        Err(err) => Err(format!("reading {}: {err}", path.display())),
    }
}

fn save_config(app: &AppHandle, config: &AuthConfig) -> Result<(), String> {
    let path = config_path(app)?;
    let json =
        serde_json::to_vec_pretty(config).map_err(|e| format!("serializing auth config: {e}"))?;
    std::fs::write(&path, json).map_err(|e| format!("writing {}: {e}", path.display()))
}

/// Drop entries that carry no settings, so a cleared override does not leave an
/// empty object behind.
fn prune(config: &mut AuthConfig) {
    config
        .harnesses
        .retain(|_, entry| entry.auth_mode.is_some() || entry.api_key.is_some());
}

// --- Resolution helpers -------------------------------------------------------

/// Where a harness's effective API key comes from.
#[derive(Clone, Copy, PartialEq, Eq)]
enum KeyOrigin {
    /// A saved per-harness override.
    Override,
    /// The host environment (a `TCAB_API_KEY_<SLUG>` or the shared provider key).
    Environment,
}

fn nonempty_env(var: &str) -> Option<String> {
    std::env::var(var).ok().filter(|v| !v.trim().is_empty())
}

/// The effective API key for a harness from the settings layered over the host
/// environment: the saved override wins, then a `TCAB_API_KEY_<SLUG>` in the
/// environment, then the shared provider variable. `None` when the harness has no
/// API-key mode or no key is available anywhere.
fn resolve_api_key(
    harness: &dyn AgentHarness,
    entry: Option<&HarnessEntry>,
) -> Option<(String, KeyOrigin)> {
    let provider_var = harness.api_key_env()?;
    if let Some(key) = entry
        .and_then(|e| e.api_key.as_ref())
        .filter(|k| !k.trim().is_empty())
    {
        return Some((key.clone(), KeyOrigin::Override));
    }
    if let Some(value) = nonempty_env(&api_key_override_var(harness.slug())) {
        return Some((value, KeyOrigin::Environment));
    }
    nonempty_env(provider_var).map(|value| (value, KeyOrigin::Environment))
}

/// Which dotenv file (if any) defines `var`, searching the same files the app
/// loads at launch (`.env.runner` then `.env`). Used only to attribute a
/// discovered key's source in the UI.
fn dotenv_source(var: &str) -> Option<&'static str> {
    for file in [".env.runner", ".env"] {
        if let Ok(iter) = dotenvy::from_filename_iter(file) {
            for (key, _) in iter.flatten() {
                if key == var {
                    return Some(file);
                }
            }
        }
    }
    None
}

/// A human-facing tag for where a harness's API key comes from, never the value:
/// `override`, `dotenv:<file>`, `env`, or `none`.
fn api_key_source(harness: &dyn AgentHarness, origin: Option<KeyOrigin>) -> String {
    match origin {
        None => "none".to_string(),
        Some(KeyOrigin::Override) => "override".to_string(),
        Some(KeyOrigin::Environment) => dotenv_source(&api_key_override_var(harness.slug()))
            .or_else(|| harness.api_key_env().and_then(dotenv_source))
            .map(|file| format!("dotenv:{file}"))
            .unwrap_or_else(|| "env".to_string()),
    }
}

/// The requested mode for a stored value (`None`/`auto` ⇒ auto).
fn requested_mode(stored: Option<&str>) -> RequestedAuthMode {
    match stored {
        Some(MODE_SUBSCRIPTION) => RequestedAuthMode::Subscription,
        Some(MODE_API_KEY) => RequestedAuthMode::ApiKey,
        _ => RequestedAuthMode::Auto,
    }
}

/// The readiness verdict for a harness: `ready` when the selected mode's
/// credentials are present, else the most useful next step.
fn readiness(
    mode: RequestedAuthMode,
    supports_api_key: bool,
    supports_subscription: bool,
    api_available: bool,
    subscription_available: bool,
) -> &'static str {
    if select_mode(mode, api_available, subscription_available).is_some() {
        return "ready";
    }
    match mode {
        RequestedAuthMode::ApiKey => "needs-key",
        RequestedAuthMode::Subscription => "needs-sign-in",
        RequestedAuthMode::Auto => match (supports_api_key, supports_subscription) {
            (true, true) => "needs-credentials",
            (true, false) => "needs-key",
            (false, true) => "needs-sign-in",
            (false, false) => "unsupported",
        },
    }
}

// --- DTOs ---------------------------------------------------------------------

/// One subscription credential file's host status, for the settings UI.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionFileDto {
    host_path: String,
    secret_key: String,
    present: bool,
    required: bool,
}

/// One harness's authentication state, for the settings UI. Never carries the key
/// value itself — only whether one is set and where it came from.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessAuthDto {
    slug: String,
    name: String,
    api_key_env: Option<String>,
    supports_api_key: bool,
    supports_subscription: bool,
    selected_mode: String,
    api_key_set: bool,
    api_key_source: String,
    subscription_files: Vec<SubscriptionFileDto>,
    subscription_present: bool,
    readiness: String,
}

fn describe(harness: &dyn AgentHarness, entry: Option<&HarnessEntry>) -> HarnessAuthDto {
    let slug = harness.slug();
    let supports_api_key = harness.api_key_env().is_some();
    let supports_subscription = harness.subscription_spec().is_some();
    let resolved = resolve_api_key(harness, entry);
    let api_key_set = resolved.is_some();
    let api_key_source = api_key_source(harness, resolved.map(|(_, origin)| origin));

    let files = subscription_files(harness);
    let subscription_present =
        !files.is_empty() && files.iter().filter(|f| f.required).all(|f| f.present);

    let mode = requested_mode(entry.and_then(|e| e.auth_mode.as_deref()));
    HarnessAuthDto {
        slug: slug.as_str().to_string(),
        name: harness.name().to_string(),
        api_key_env: harness.api_key_env().map(str::to_string),
        supports_api_key,
        supports_subscription,
        selected_mode: entry
            .and_then(|e| e.auth_mode.clone())
            .unwrap_or_else(|| MODE_AUTO.to_string()),
        api_key_set,
        api_key_source,
        subscription_files: files
            .into_iter()
            .map(|f| SubscriptionFileDto {
                host_path: f.host_path,
                secret_key: f.secret_key,
                present: f.present,
                required: f.required,
            })
            .collect(),
        subscription_present,
        readiness: readiness(
            mode,
            supports_api_key,
            supports_subscription,
            api_key_set,
            subscription_present,
        )
        .to_string(),
    }
}

fn build_list(app: &AppHandle) -> Result<Vec<HarnessAuthDto>, String> {
    let config = load_config(app)?;
    let registry = DefaultHarnessRegistry::new();
    let mut out = Vec::with_capacity(HarnessSlug::ALL.len());
    for slug in HarnessSlug::ALL {
        if let Some(harness) = registry.get(slug) {
            out.push(describe(harness, config.harnesses.get(slug.as_str())));
        }
    }
    Ok(out)
}

// --- Applying to the cluster --------------------------------------------------

/// The `TCAB_AUTH_MODE_<SLUG>` lock variable for a harness.
fn auth_mode_var(slug: HarnessSlug) -> String {
    format!("TCAB_AUTH_MODE_{}", slug.as_str().to_ascii_uppercase())
}

/// Build and apply the per-harness authentication Secrets to the cluster from the
/// persisted settings layered over the host environment:
///
/// - **`tcab-driver-secrets`** (mounted into each driver Job's env via `envFrom`):
///   `TCAB_API_KEY_<SLUG>` for every harness with a resolved key, plus
///   `TCAB_AUTH_MODE_<SLUG>` for every harness whose mode is locked off `auto`.
/// - **`tcab-driver-subscription`** (mounted as the read-only subscription volume):
///   every present subscription credential file, keyed by basename and read by
///   `kubectl` straight from the host — the key the driver maps back to the full
///   container path.
///
/// Called by the bootstrap and after every settings change. Idempotent: each
/// Secret is created-or-updated in place, so an emptied set simply clears it.
pub(crate) fn apply_harness_secrets(app: &AppHandle, kubeconfig: &Path) -> Result<(), String> {
    let config = load_config(app)?;
    let registry = DefaultHarnessRegistry::new();

    // Own the strings/paths up front so the borrowed slices below outlive the call.
    let mut driver: Vec<(String, String)> = Vec::new();
    let mut subscription: Vec<(String, PathBuf)> = Vec::new();
    for slug in HarnessSlug::ALL {
        let Some(harness) = registry.get(slug) else {
            continue;
        };
        let entry = config.harnesses.get(slug.as_str());
        if let Some((key, _)) = resolve_api_key(harness, entry) {
            driver.push((api_key_override_var(slug), key));
        }
        if let Some(mode) = entry
            .and_then(|e| e.auth_mode.as_deref())
            .filter(|mode| *mode != MODE_AUTO)
        {
            driver.push((auth_mode_var(slug), mode.to_string()));
        }
        for file in subscription_files(harness) {
            if file.present {
                subscription.push((file.secret_key, PathBuf::from(file.host_path)));
            }
        }
    }

    let driver_refs: Vec<(&str, &str)> = driver
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();
    cluster::apply_secret(kubeconfig, "tcab-driver-secrets", &driver_refs)?;

    let subscription_refs: Vec<(&str, &Path)> = subscription
        .iter()
        .map(|(k, p)| (k.as_str(), p.as_path()))
        .collect();
    cluster::apply_secret_from_files(kubeconfig, "tcab-driver-subscription", &subscription_refs)?;
    Ok(())
}

/// Apply the Secrets to the cluster when one is running. Settings are always
/// persisted; they reach the cluster live here, and otherwise at the next launch's
/// bootstrap (there is no local cluster on the external-backend developer path).
fn apply_if_running(app: &AppHandle) -> Result<(), String> {
    if cluster::cluster_present() {
        let kubeconfig = cluster::kubeconfig_path(app)?;
        apply_harness_secrets(app, &kubeconfig)?;
    }
    Ok(())
}

fn known_slug(slug: &str) -> Result<(), String> {
    HarnessSlug::ALL
        .iter()
        .any(|s| s.as_str() == slug)
        .then_some(())
        .ok_or_else(|| format!("unknown harness `{slug}`"))
}

// --- Tauri commands -----------------------------------------------------------

/// Every harness's authentication state for the settings UI.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn list_harness_auth(app: AppHandle) -> Result<Vec<HarnessAuthDto>, String> {
    build_list(&app)
}

/// Lock (or reset to `auto`) a harness's authentication method, persist it, and
/// apply it to the running cluster. Returns the refreshed list.
#[tauri::command]
#[tracing::instrument(skip_all, fields(%slug, %mode))]
pub fn set_harness_auth_mode(
    app: AppHandle,
    slug: String,
    mode: String,
) -> Result<Vec<HarnessAuthDto>, String> {
    known_slug(&slug)?;
    if !matches!(mode.as_str(), MODE_AUTO | MODE_SUBSCRIPTION | MODE_API_KEY) {
        return Err(format!("unknown auth mode `{mode}`"));
    }
    let mut config = load_config(&app)?;
    let entry = config.harnesses.entry(slug).or_default();
    entry.auth_mode = (mode != MODE_AUTO).then_some(mode);
    prune(&mut config);
    save_config(&app, &config)?;
    apply_if_running(&app)?;
    build_list(&app)
}

/// Set (or clear, with `null`) a harness's per-harness API key override, persist
/// it, and apply it to the running cluster. The key value is never logged. Returns
/// the refreshed list.
#[tauri::command]
#[tracing::instrument(skip_all, fields(%slug))]
pub fn set_harness_api_key(
    app: AppHandle,
    slug: String,
    key: Option<String>,
) -> Result<Vec<HarnessAuthDto>, String> {
    known_slug(&slug)?;
    let mut config = load_config(&app)?;
    let entry = config.harnesses.entry(slug).or_default();
    entry.api_key = key.map(|k| k.trim().to_string()).filter(|k| !k.is_empty());
    prune(&mut config);
    save_config(&app, &config)?;
    apply_if_running(&app)?;
    build_list(&app)
}

/// Re-read the host's signed-in subscription credential files and push them into
/// the cluster's subscription Secret. The Secret is one object keyed by credential
/// basename across all harnesses, so the rebuild is global; `slug` identifies the
/// harness the user acted on (for the UI affordance) but does not scope the
/// rebuild. Returns the refreshed list.
#[tauri::command]
#[tracing::instrument(skip_all, fields(%slug))]
pub fn refresh_subscription(app: AppHandle, slug: String) -> Result<Vec<HarnessAuthDto>, String> {
    known_slug(&slug)?;
    apply_if_running(&app)?;
    build_list(&app)
}
