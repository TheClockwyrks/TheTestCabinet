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

/// Build a resolved credential pointing at a host path.
fn cred(host_path: std::path::PathBuf, required: bool) -> ResolvedCred {
    ResolvedCred {
        host_path,
        container_path: "/home/node/cred",
        mode: 0o600,
        required,
    }
}

#[test]
fn subscription_absent_without_any_required_file() {
    // An optional-only set is never "present": there is nothing that must exist.
    let dir = tempfile::tempdir().unwrap();
    let creds = [cred(dir.path().join("optional"), false)];
    assert!(!subscription_present(&creds));
}

#[test]
fn subscription_present_only_when_every_required_file_exists() {
    let dir = tempfile::tempdir().unwrap();
    let present = dir.path().join("present");
    let missing = dir.path().join("missing");
    std::fs::write(&present, b"token").unwrap();

    assert!(subscription_present(&[cred(present.clone(), true)]));
    assert!(!subscription_present(&[
        cred(present.clone(), true),
        cred(missing, true),
    ]));
}

#[test]
fn subscription_plan_reads_required_and_present_optional_files() {
    let dir = tempfile::tempdir().unwrap();
    let required = dir.path().join("required");
    let optional = dir.path().join("optional");
    std::fs::write(&required, b"required-bytes").unwrap();
    std::fs::write(&optional, b"optional-bytes").unwrap();

    let creds = vec![
        ResolvedCred {
            host_path: required,
            container_path: "/home/node/.codex/auth.json",
            mode: 0o600,
            required: true,
        },
        ResolvedCred {
            host_path: optional,
            container_path: "/home/node/.claude.json",
            mode: 0o640,
            required: false,
        },
    ];

    let plan = subscription_plan(HarnessSlug::Codex, creds).unwrap();
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
    let dir = tempfile::tempdir().unwrap();
    let required = dir.path().join("required");
    std::fs::write(&required, b"token").unwrap();

    let creds = vec![
        ResolvedCred {
            host_path: required,
            container_path: "/home/node/.codex/auth.json",
            mode: 0o600,
            required: true,
        },
        // Optional, never created — must be silently skipped, not an error.
        cred(dir.path().join("never-created"), false),
    ];

    let AuthPlan::Subscription { files } = subscription_plan(HarnessSlug::Codex, creds).unwrap()
    else {
        panic!("expected a subscription plan");
    };
    assert_eq!(files.len(), 1);
}

#[test]
fn subscription_plan_errors_when_a_required_file_is_missing() {
    let dir = tempfile::tempdir().unwrap();
    let creds = vec![cred(dir.path().join("missing"), true)];
    let err = subscription_plan(HarnessSlug::Codex, creds).unwrap_err();
    // The error names the credential that could not be read.
    assert!(err.to_string().contains("missing"), "got: {err}");
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
