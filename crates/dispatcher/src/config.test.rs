//! Tests for the env-resolved dispatcher config. Environment mutation is process
//! global, so these serialize through a mutex and restore every variable they
//! touch — a panic mid-test still leaves the next test a clean slate.

use super::*;

use std::sync::Mutex;

static ENV_LOCK: Mutex<()> = Mutex::new(());

/// All variables a test in this file may set, cleared before and after each.
const ALL_VARS: &[&str] = &[
    "TCAB_BACKEND_URL",
    "TCAB_BACKEND_SERVICE_TOKEN",
    "TCAB_DRIVER_IMAGE",
    "TCAB_DISPATCHER_NAMESPACE",
    "TCAB_DISPATCHER_DRIVER_SA",
    "TCAB_DISPATCHER_MAX_INFLIGHT",
    "TCAB_DISPATCHER_POLL_INTERVAL_SECONDS",
    "TCAB_DISPATCHER_JOB_TTL_SECONDS",
    "TCAB_DISPATCHER_DRIVER_SECRETS",
    "TCAB_DISPATCHER_DRIVER_SUBSCRIPTION_SECRET",
    "TCAB_DISPATCHER_DRIVER_SUBSCRIPTION_DIR",
    "TCAB_DISPATCHER_DRIVER_AUTH_MODE",
    "TCAB_K8S_RUN_CPU_REQUEST",
    "TCAB_K8S_RUN_MEMORY_LIMIT",
    "TCAB_ARTIFACTS_URL",
];

fn clear_all() {
    for var in ALL_VARS {
        unsafe { std::env::remove_var(var) };
    }
}

/// Run `body` with the env lock held and every touched variable cleared first and
/// after, so config resolution sees only what the test set.
fn with_env(body: impl FnOnce()) {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    clear_all();
    body();
    clear_all();
}

fn set(key: &str, value: &str) {
    unsafe { std::env::set_var(key, value) };
}

/// The three required variables, set so a config resolves.
fn set_required() {
    set("TCAB_BACKEND_URL", "http://backend:8787/");
    set("TCAB_BACKEND_SERVICE_TOKEN", "svc-tok");
    set("TCAB_DRIVER_IMAGE", "ghcr.io/example/tcab-driver:1.0");
}

#[test]
fn resolves_with_required_and_defaults() {
    with_env(|| {
        set_required();
        let config = Config::from_env().expect("config should resolve");

        // Trailing slash trimmed.
        assert_eq!(config.backend_url, "http://backend:8787");
        assert_eq!(config.service_token, "svc-tok");
        assert_eq!(config.driver_image, "ghcr.io/example/tcab-driver:1.0");
        // Defaults.
        assert_eq!(config.max_inflight, 8);
        assert_eq!(config.poll_interval.as_secs(), 2);
        assert_eq!(config.job_ttl_seconds, 300);
        assert!(config.driver_service_account.is_none());
        assert!(config.driver_secrets.is_empty());
        // Subscription unset by default; the mount dir falls back to its default.
        assert!(config.driver_subscription_secret.is_none());
        assert_eq!(config.subscription_dir, "/var/run/tcab/subscription");
        assert!(config.driver_auth_mode.is_none());
        assert!(config.passthrough_k8s_env.is_empty());
    });
}

#[test]
fn subscription_vars_parse_when_set() {
    with_env(|| {
        set_required();
        set(
            "TCAB_DISPATCHER_DRIVER_SUBSCRIPTION_SECRET",
            "tcab-driver-subscription",
        );
        set(
            "TCAB_DISPATCHER_DRIVER_SUBSCRIPTION_DIR",
            "/etc/tcab/subscription",
        );
        set("TCAB_DISPATCHER_DRIVER_AUTH_MODE", "subscription");
        let config = Config::from_env().expect("config should resolve");
        assert_eq!(
            config.driver_subscription_secret.as_deref(),
            Some("tcab-driver-subscription")
        );
        assert_eq!(config.subscription_dir, "/etc/tcab/subscription");
        assert_eq!(config.driver_auth_mode.as_deref(), Some("subscription"));
    });
}

#[test]
fn blank_subscription_vars_are_treated_as_unset() {
    with_env(|| {
        set_required();
        set("TCAB_DISPATCHER_DRIVER_SUBSCRIPTION_SECRET", "   ");
        set("TCAB_DISPATCHER_DRIVER_SUBSCRIPTION_DIR", "");
        set("TCAB_DISPATCHER_DRIVER_AUTH_MODE", " ");
        let config = Config::from_env().expect("config should resolve");
        assert!(config.driver_subscription_secret.is_none());
        // Blank dir falls back to the default, not the empty string.
        assert_eq!(config.subscription_dir, "/var/run/tcab/subscription");
        assert!(config.driver_auth_mode.is_none());
    });
}

#[test]
fn driver_secrets_are_split_on_commas() {
    with_env(|| {
        set_required();
        set(
            "TCAB_DISPATCHER_DRIVER_SECRETS",
            "tcab-driver-secrets, tcab-extra ",
        );
        let config = Config::from_env().expect("config should resolve");
        // Trimmed, blanks dropped.
        assert_eq!(
            config.driver_secrets,
            vec!["tcab-driver-secrets", "tcab-extra"]
        );
    });
}

#[test]
fn missing_required_is_an_error() {
    with_env(|| {
        // Only two of three set.
        set("TCAB_BACKEND_URL", "http://b");
        set("TCAB_BACKEND_SERVICE_TOKEN", "t");
        let err = Config::from_env().expect_err("missing driver image should error");
        assert!(matches!(err, ConfigError::Missing("TCAB_DRIVER_IMAGE")));
    });
}

#[test]
fn blank_value_is_treated_as_unset() {
    with_env(|| {
        set("TCAB_BACKEND_URL", "   ");
        set("TCAB_BACKEND_SERVICE_TOKEN", "t");
        set("TCAB_DRIVER_IMAGE", "img");
        let err = Config::from_env().expect_err("blank required var should error");
        assert!(matches!(err, ConfigError::Missing("TCAB_BACKEND_URL")));
    });
}

#[test]
fn overrides_and_passthrough_are_collected() {
    with_env(|| {
        set_required();
        set("TCAB_DISPATCHER_NAMESPACE", "runs");
        set("TCAB_DISPATCHER_DRIVER_SA", "tcab-driver");
        set("TCAB_DISPATCHER_MAX_INFLIGHT", "16");
        set("TCAB_DISPATCHER_POLL_INTERVAL_SECONDS", "5");
        set("TCAB_DISPATCHER_JOB_TTL_SECONDS", "120");
        set("TCAB_K8S_RUN_CPU_REQUEST", "500m");
        set("TCAB_K8S_RUN_MEMORY_LIMIT", "4Gi");

        let config = Config::from_env().expect("config should resolve");
        assert_eq!(config.namespace, "runs");
        assert_eq!(
            config.driver_service_account.as_deref(),
            Some("tcab-driver")
        );
        assert_eq!(config.max_inflight, 16);
        assert_eq!(config.poll_interval.as_secs(), 5);
        assert_eq!(config.job_ttl_seconds, 120);

        // Only the set passthroughs are captured, as (key, value) pairs.
        assert!(
            config
                .passthrough_k8s_env
                .contains(&("TCAB_K8S_RUN_CPU_REQUEST".to_string(), "500m".to_string()))
        );
        assert!(
            config
                .passthrough_k8s_env
                .contains(&("TCAB_K8S_RUN_MEMORY_LIMIT".to_string(), "4Gi".to_string()))
        );
        assert_eq!(config.passthrough_k8s_env.len(), 2);
    });
}

#[test]
fn artifacts_url_is_passed_through() {
    with_env(|| {
        set_required();
        set("TCAB_ARTIFACTS_URL", "http://tcab-artifacts:8790");

        let config = Config::from_env().expect("config should resolve");
        // The artifact-service URL is forwarded into each driver Job's env exactly
        // like the sandbox-pod settings; the dispatcher never interprets it.
        assert!(config.passthrough_k8s_env.contains(&(
            "TCAB_ARTIFACTS_URL".to_string(),
            "http://tcab-artifacts:8790".to_string()
        )));
    });
}

#[test]
fn max_inflight_is_floored_at_one() {
    with_env(|| {
        set_required();
        set("TCAB_DISPATCHER_MAX_INFLIGHT", "0");
        let config = Config::from_env().expect("config should resolve");
        assert_eq!(config.max_inflight, 1);
    });
}

#[test]
fn unparseable_numeric_is_an_error() {
    with_env(|| {
        set_required();
        set("TCAB_DISPATCHER_MAX_INFLIGHT", "lots");
        let err = Config::from_env().expect_err("non-numeric cap should error");
        assert!(matches!(
            err,
            ConfigError::Invalid {
                name: "TCAB_DISPATCHER_MAX_INFLIGHT",
                ..
            }
        ));
    });
}
