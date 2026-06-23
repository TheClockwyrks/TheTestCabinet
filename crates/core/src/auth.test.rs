//! Tests for authentication-mode resolution.
//!
//! The selection policy, mode parsing, and credential presence/reading are
//! tested through their pure helpers so the suite never touches the process
//! environment (which is global and would race under the parallel test runner).

use super::*;

// --- Mode parsing -------------------------------------------------------------

#[test]
fn parse_mode_accepts_each_spelling() {
    assert_eq!(parse_mode("auto"), Some(RequestedAuthMode::Auto));
    assert_eq!(
        parse_mode("subscription"),
        Some(RequestedAuthMode::Subscription)
    );
    assert_eq!(parse_mode("sub"), Some(RequestedAuthMode::Subscription));
    assert_eq!(parse_mode("api-key"), Some(RequestedAuthMode::ApiKey));
    assert_eq!(parse_mode("api_key"), Some(RequestedAuthMode::ApiKey));
    assert_eq!(parse_mode("apikey"), Some(RequestedAuthMode::ApiKey));
    assert_eq!(parse_mode("key"), Some(RequestedAuthMode::ApiKey));
}

#[test]
fn parse_mode_is_tolerant_of_case_and_whitespace() {
    assert_eq!(
        parse_mode("  SUBSCRIPTION  "),
        Some(RequestedAuthMode::Subscription)
    );
    assert_eq!(parse_mode("Api-Key"), Some(RequestedAuthMode::ApiKey));
}

#[test]
fn parse_mode_rejects_empty_and_unknown() {
    assert_eq!(parse_mode(""), None);
    assert_eq!(parse_mode("   "), None);
    assert_eq!(parse_mode("nonsense"), None);
}

// --- Mode precedence ----------------------------------------------------------

#[test]
fn per_harness_value_wins_over_global() {
    let mode = requested_mode_from(Some("api-key"), Some("subscription"));
    assert_eq!(mode, RequestedAuthMode::ApiKey);
}

#[test]
fn global_is_used_when_no_per_harness_override() {
    let mode = requested_mode_from(None, Some("subscription"));
    assert_eq!(mode, RequestedAuthMode::Subscription);
}

#[test]
fn unrecognized_per_harness_value_falls_through_to_global() {
    let mode = requested_mode_from(Some("garbage"), Some("api-key"));
    assert_eq!(mode, RequestedAuthMode::ApiKey);
}

#[test]
fn defaults_to_auto_when_nothing_is_set() {
    assert_eq!(requested_mode_from(None, None), RequestedAuthMode::Auto);
    assert_eq!(
        requested_mode_from(Some("bad"), Some("worse")),
        RequestedAuthMode::Auto
    );
}

// --- Selection policy ---------------------------------------------------------

#[test]
fn auto_prefers_subscription_when_both_are_available() {
    assert_eq!(
        select(RequestedAuthMode::Auto, true, true),
        Selection::Subscription
    );
}

#[test]
fn auto_falls_back_to_api_key_when_no_subscription() {
    assert_eq!(
        select(RequestedAuthMode::Auto, true, false),
        Selection::ApiKey
    );
}

#[test]
fn auto_is_unavailable_when_neither_is_present() {
    assert_eq!(
        select(RequestedAuthMode::Auto, false, false),
        Selection::None
    );
}

#[test]
fn locking_api_key_ignores_an_available_subscription() {
    assert_eq!(
        select(RequestedAuthMode::ApiKey, true, true),
        Selection::ApiKey
    );
}

#[test]
fn locking_api_key_fails_without_a_key_even_if_subscription_present() {
    assert_eq!(
        select(RequestedAuthMode::ApiKey, false, true),
        Selection::None
    );
}

#[test]
fn locking_subscription_ignores_an_available_api_key() {
    assert_eq!(
        select(RequestedAuthMode::Subscription, true, true),
        Selection::Subscription
    );
}

#[test]
fn locking_subscription_fails_without_credentials_even_if_key_present() {
    assert_eq!(
        select(RequestedAuthMode::Subscription, true, false),
        Selection::None
    );
}

// --- Subscription credential presence and reading -----------------------------

use std::collections::HashMap;

/// A static `CredFile` for a container path, with the required flag under test.
fn cred(container_path: &'static str, required: bool) -> CredFile {
    CredFile {
        source: CredSource::HomeRelative("unused"),
        container_path,
        mode: 0o600,
        required,
    }
}

/// A spec over a leaked slice of files (the trait carries `&'static [CredFile]`).
fn spec(files: Vec<CredFile>) -> SubscriptionSpec {
    SubscriptionSpec {
        files: Box::leak(files.into_boxed_slice()),
    }
}

/// A [`MapCreds`] keyed by container path from `(path, bytes)` pairs.
fn map_creds(entries: &[(&str, &[u8])]) -> MapCreds {
    MapCreds::new(
        entries
            .iter()
            .map(|(path, bytes)| (path.to_string(), bytes.to_vec()))
            .collect::<HashMap<_, _>>(),
    )
}

#[test]
fn subscription_absent_without_any_required_file() {
    // An optional-only set is never "present": there is nothing that must exist.
    let spec = spec(vec![cred("/home/node/optional", false)]);
    let creds = map_creds(&[("/home/node/optional", b"x")]);
    assert!(!subscription_present(&spec, &creds));
}

#[test]
fn subscription_present_only_when_every_required_file_is_supplied() {
    let spec = spec(vec![
        cred("/home/node/a", true),
        cred("/home/node/b", true),
    ]);
    assert!(subscription_present(
        &spec,
        &map_creds(&[("/home/node/a", b"x"), ("/home/node/b", b"y")]),
    ));
    // One required file missing from the source ⇒ not present.
    assert!(!subscription_present(
        &spec,
        &map_creds(&[("/home/node/a", b"x")]),
    ));
}

#[test]
fn subscription_plan_reads_required_and_present_optional_files() {
    let spec = SubscriptionSpec {
        files: &[
            CredFile {
                source: CredSource::HomeRelative("unused"),
                container_path: "/home/node/.codex/auth.json",
                mode: 0o600,
                required: true,
            },
            CredFile {
                source: CredSource::HomeRelative("unused"),
                container_path: "/home/node/.claude.json",
                mode: 0o640,
                required: false,
            },
        ],
    };
    let creds = map_creds(&[
        ("/home/node/.codex/auth.json", b"required-bytes"),
        ("/home/node/.claude.json", b"optional-bytes"),
    ]);

    let plan = subscription_plan(HarnessSlug::Codex, spec, &creds).unwrap();
    let AuthPlan::Subscription { files } = plan else {
        panic!("expected a subscription plan");
    };
    assert_eq!(files.len(), 2);
    assert_eq!(files[0].container_path, "/home/node/.codex/auth.json");
    assert_eq!(files[0].contents, b"required-bytes");
    assert_eq!(files[0].mode, 0o600);
    assert_eq!(files[1].contents, b"optional-bytes");
}

#[test]
fn subscription_plan_skips_an_absent_optional_file() {
    let spec = spec(vec![
        cred("/home/node/.codex/auth.json", true),
        // Optional, not in the source — must be silently skipped, not an error.
        cred("/home/node/never-supplied", false),
    ]);
    let creds = map_creds(&[("/home/node/.codex/auth.json", b"token")]);

    let AuthPlan::Subscription { files } =
        subscription_plan(HarnessSlug::Codex, spec, &creds).unwrap()
    else {
        panic!("expected a subscription plan");
    };
    assert_eq!(files.len(), 1);
}

#[test]
fn subscription_plan_errors_when_a_required_file_is_missing() {
    let spec = spec(vec![cred("/home/node/required", true)]);
    let creds = map_creds(&[]);
    let err = subscription_plan(HarnessSlug::Codex, spec, &creds).unwrap_err();
    // The error names the credential that could not be read.
    assert!(err.to_string().contains("/home/node/required"), "got: {err}");
}

#[test]
fn host_creds_skip_absent_optional_and_read_present_files() {
    // HostCreds reads from the filesystem; point a file at a real temp path and an
    // absent one at a path that does not exist, confirming the host path is
    // preserved exactly.
    let dir = tempfile::tempdir().unwrap();
    let present = dir.path().join("present");
    std::fs::write(&present, b"host-bytes").unwrap();

    let present_file = CredFile {
        source: CredSource::HomeRelative("present"),
        container_path: "/home/node/present",
        mode: 0o600,
        required: true,
    };
    // Override $HOME so the HomeRelative path resolves under the temp dir. Env is
    // process-global, so serialize and restore.
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let prev_home = std::env::var_os("HOME");
    unsafe { std::env::set_var("HOME", dir.path()) };
    assert_eq!(
        HostCreds.read(&present_file).unwrap(),
        Some(b"host-bytes".to_vec())
    );
    let absent_file = CredFile {
        source: CredSource::HomeRelative("never-created"),
        container_path: "/home/node/x",
        mode: 0o600,
        required: false,
    };
    assert_eq!(HostCreds.read(&absent_file).unwrap(), None);
    match prev_home {
        Some(home) => unsafe { std::env::set_var("HOME", home) },
        None => unsafe { std::env::remove_var("HOME") },
    }
}

// --- resolve_auth_with over an injected source --------------------------------
//
// These exercise the real subscription-only Antigravity adapter (no API-key
// mode), so the selection policy is tested end-to-end with the injected source
// standing in for the host filesystem — exactly what the driver does. They never
// read the host filesystem: the credential bytes come from a `MapCreds`.

use crate::harness::HarnessRegistry;
use crate::harness_registry::DefaultHarnessRegistry;

/// Antigravity's single required credential, by container path.
const ANTIGRAVITY_CRED: &str = "/home/node/.gemini/antigravity-cli/antigravity-oauth-token";

/// The env lock and cleaner for the tests that must touch `TCAB_AUTH_MODE`
/// (process-global, so serialized).
static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn clear_auth_env() {
    for var in ["TCAB_AUTH_MODE", "TCAB_AUTH_MODE_ANTIGRAVITY"] {
        unsafe { std::env::remove_var(var) };
    }
}

#[test]
fn resolve_auth_with_selects_subscription_from_the_map() {
    // No env set ⇒ auto; Antigravity has no API key, so an available subscription
    // is chosen, and the plan carries exactly the injected bytes + mode.
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    clear_auth_env();
    let registry = DefaultHarnessRegistry::new();
    let harness = registry.get(HarnessSlug::Antigravity).unwrap();
    let creds = map_creds(&[(ANTIGRAVITY_CRED, b"oauth")]);
    let plan = resolve_auth_with(harness, &creds).unwrap();
    let AuthPlan::Subscription { files } = plan else {
        panic!("expected subscription");
    };
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].container_path, ANTIGRAVITY_CRED);
    assert_eq!(files[0].contents, b"oauth");
    assert_eq!(files[0].mode, 0o600);
}

#[test]
fn resolve_auth_with_unavailable_when_map_empty_and_no_api_key() {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    clear_auth_env();
    let registry = DefaultHarnessRegistry::new();
    let harness = registry.get(HarnessSlug::Antigravity).unwrap();
    let err = resolve_auth_with(harness, &MapCreds::default()).unwrap_err();
    assert!(matches!(err, Error::HarnessUnavailable { .. }), "got: {err}");
}

#[test]
fn resolve_auth_with_honors_locked_subscription_mode() {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    clear_auth_env();
    unsafe { std::env::set_var("TCAB_AUTH_MODE", "subscription") };
    let registry = DefaultHarnessRegistry::new();
    let harness = registry.get(HarnessSlug::Antigravity).unwrap();
    let creds = map_creds(&[(ANTIGRAVITY_CRED, b"oauth")]);
    let plan = resolve_auth_with(harness, &creds);
    clear_auth_env();
    assert!(matches!(plan, Ok(AuthPlan::Subscription { .. })));
}

#[test]
fn auth_plan_records_its_mode() {
    let api = AuthPlan::ApiKey {
        container_env: "CODEX_API_KEY".to_string(),
        key: "sk-x".to_string(),
    };
    assert_eq!(api.mode(), AuthMode::ApiKey);
    let sub = AuthPlan::Subscription { files: Vec::new() };
    assert_eq!(sub.mode(), AuthMode::Subscription);
}
