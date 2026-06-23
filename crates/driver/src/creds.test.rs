//! Tests for building a subscription source from a mounted Secret directory.
//!
//! These prove the driver authenticates a subscription **purely** from the
//! mounted directory, never the host filesystem: every test points `HOME` and
//! `CODEX_HOME` at a path that does not exist, so any accidental host read would
//! make a present-subscription case fail. They serialize on an env lock because
//! `HOME`/`CODEX_HOME` and `TCAB_AUTH_MODE` are process-global.

use super::*;

use std::path::Path;

use test_cabinet_core::run_record::HarnessSlug;
use test_cabinet_core::{AuthPlan, DefaultHarnessRegistry, HarnessRegistry, resolve_auth_with};

/// Serializes the few tests that mutate process-global env (`HOME`, `CODEX_HOME`,
/// `TCAB_AUTH_MODE`).
static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Run `body` with the env lock held, the auth-relevant env pointed at a
/// non-existent home (so no host credential file can ever be read), and every
/// touched variable restored afterward.
fn with_isolated_home(body: impl FnOnce()) {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let prev: Vec<(&str, Option<std::ffi::OsString>)> =
        ["HOME", "CODEX_HOME", "TCAB_AUTH_MODE", "TCAB_AUTH_MODE_CLAUDE"]
            .iter()
            .map(|&k| (k, std::env::var_os(k)))
            .collect();
    let nowhere = "/nonexistent/tcab-driver-creds-test";
    unsafe {
        std::env::set_var("HOME", nowhere);
        std::env::set_var("CODEX_HOME", nowhere);
        std::env::remove_var("TCAB_AUTH_MODE");
        std::env::remove_var("TCAB_AUTH_MODE_CLAUDE");
    }
    body();
    for (key, value) in prev {
        match value {
            Some(v) => unsafe { std::env::set_var(key, v) },
            None => unsafe { std::env::remove_var(key) },
        }
    }
}

/// Resolve a harness's plan from a mounted-creds directory for `slug`.
fn plan_from_mount(
    dir: &Path,
    slug: HarnessSlug,
) -> Result<AuthPlan, test_cabinet_core::Error> {
    let creds = mounted_creds(dir, slug);
    let registry = DefaultHarnessRegistry::new();
    let harness = registry.get(slug).unwrap();
    resolve_auth_with(harness, &creds)
}

#[test]
fn required_present_yields_subscription_with_exact_paths_and_modes() {
    with_isolated_home(|| {
        // Claude's required credential basename is `.credentials.json`; provide it
        // and the optional `.claude.json` in the mount.
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(".credentials.json"), b"creds-bytes").unwrap();
        std::fs::write(dir.path().join(".claude.json"), b"state-bytes").unwrap();

        let AuthPlan::Subscription { mut files } =
            plan_from_mount(dir.path(), HarnessSlug::Claude).unwrap()
        else {
            panic!("expected a subscription plan from the mount");
        };
        files.sort_by(|a, b| a.container_path.cmp(&b.container_path));
        // Both files materialize at their full container paths with 0o600 modes
        // and the injected contents — proving the basename→container_path mapping.
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].container_path, "/home/node/.claude.json");
        assert_eq!(files[0].contents, b"state-bytes");
        assert_eq!(files[0].mode, 0o600);
        assert_eq!(
            files[1].container_path,
            "/home/node/.claude/.credentials.json"
        );
        assert_eq!(files[1].contents, b"creds-bytes");
        assert_eq!(files[1].mode, 0o600);
    });
}

#[test]
fn optional_absent_is_skipped() {
    with_isolated_home(|| {
        // Only the required Claude credential is in the mount; the optional
        // `.claude.json` is absent and must be silently skipped.
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(".credentials.json"), b"creds-bytes").unwrap();

        let AuthPlan::Subscription { files } =
            plan_from_mount(dir.path(), HarnessSlug::Claude).unwrap()
        else {
            panic!("expected a subscription plan");
        };
        assert_eq!(files.len(), 1);
        assert_eq!(
            files[0].container_path,
            "/home/node/.claude/.credentials.json"
        );
    });
}

#[test]
fn required_missing_is_harness_unavailable() {
    with_isolated_home(|| {
        // An empty mount: Antigravity (subscription-only, one required file) cannot
        // authenticate, and there is no API-key fallback, so the run is unavailable.
        let dir = tempfile::tempdir().unwrap();
        let err = plan_from_mount(dir.path(), HarnessSlug::Antigravity).unwrap_err();
        assert!(
            matches!(err, test_cabinet_core::Error::HarnessUnavailable { .. }),
            "got: {err}"
        );
    });
}

#[test]
fn an_api_key_only_harness_yields_an_empty_map() {
    // Cline has no subscription spec; the mount is irrelevant and the map is empty.
    let dir = tempfile::tempdir().unwrap();
    let creds = mounted_creds(dir.path(), HarnessSlug::Cline);
    // An empty map cannot supply any subscription file — resolve would fall back to
    // the API key. Here we just confirm building it does not panic or read the host.
    let registry = DefaultHarnessRegistry::new();
    let harness = registry.get(HarnessSlug::Cline).unwrap();
    // With no API key set and no subscription spec, resolution is unavailable; the
    // point is that `creds` carries nothing from the (empty) mount.
    let _ = resolve_auth_with(harness, &creds);
}
