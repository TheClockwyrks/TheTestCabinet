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
    "TCAB_DISPATCHER_DRIVER_CPU_REQUEST",
    "TCAB_DISPATCHER_DRIVER_MEMORY_REQUEST",
    "TCAB_DISPATCHER_DRIVER_CPU_LIMIT",
    "TCAB_DISPATCHER_DRIVER_MEMORY_LIMIT",
    "TCAB_K8S_NAMESPACE",
    "TCAB_PUBLISHER_IMAGE",
    "TCAB_DISPATCHER_PUBLISHER_SECRETS",
    "TCAB_GITHUB_ORG",
    "TCAB_PAGES_PROJECT",
    "TCAB_K8S_RUN_CPU_REQUEST",
    "TCAB_K8S_RUN_MEMORY_LIMIT",
    "TCAB_ARTIFACTS_URL",
    // Run-container image passthroughs — cleared for the same reason as the
    // observability vars below: a developer or CI machine may have these set (they
    // are the runner's own image-resolution env), and they must not leak into the
    // passthrough-collection assertions (notably the exact-count one). The registry
    // and tag are listed here; every per-image `TCAB_CONTAINER_IMAGE_*` override is
    // cleared from `RUN_IMAGE_OVERRIDE_ENVS` in `clear_all` (the same canonical list
    // the dispatcher forwards), so the two stay in lockstep as asset kinds are added.
    "TCAB_CONTAINER_REGISTRY",
    "TCAB_CONTAINER_TAG",
    // Observability passthroughs — cleared so the ambient process env (which may set
    // TCAB_ENV / OTEL_* on a developer or CI machine) cannot leak into the
    // passthrough-collection assertions below.
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "OTEL_EXPORTER_OTLP_HEADERS",
    "OTEL_EXPORTER_OTLP_PROTOCOL",
    "TCAB_ENV",
];

fn clear_all() {
    for var in ALL_VARS
        .iter()
        .chain(test_cabinet_core::harness::RUN_IMAGE_OVERRIDE_ENVS.iter())
    {
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
        // Publishing is off by default: no image means the publish path is disabled,
        // no publisher secrets, and nothing forwarded into a publish Job.
        assert!(config.publisher_image.is_none());
        assert!(!config.publishing_enabled());
        assert!(config.publisher_secrets.is_empty());
        assert!(config.passthrough_publisher_env.is_empty());
    });
}

#[test]
fn publisher_config_parses_when_set() {
    with_env(|| {
        set_required();
        set("TCAB_PUBLISHER_IMAGE", "ghcr.io/example/tcab-publisher:1.0");
        set(
            "TCAB_DISPATCHER_PUBLISHER_SECRETS",
            "tcab-publisher-secrets, tcab-cf ",
        );
        set("TCAB_GITHUB_ORG", "TheClockwyrks");
        set("TCAB_PAGES_PROJECT", "tcab-runs");
        let config = Config::from_env().expect("config should resolve");

        assert_eq!(
            config.publisher_image.as_deref(),
            Some("ghcr.io/example/tcab-publisher:1.0")
        );
        // A configured image enables the publish path.
        assert!(config.publishing_enabled());
        // Comma-split, trimmed, blanks dropped — exactly like driver secrets.
        assert_eq!(
            config.publisher_secrets,
            vec!["tcab-publisher-secrets", "tcab-cf"]
        );
        // The GitHub org and Pages project are forwarded into the publish Job for
        // the publisher's `PublishConfig::from_env` to resolve.
        assert!(
            config
                .passthrough_publisher_env
                .contains(&("TCAB_GITHUB_ORG".to_string(), "TheClockwyrks".to_string()))
        );
        assert!(
            config
                .passthrough_publisher_env
                .contains(&("TCAB_PAGES_PROJECT".to_string(), "tcab-runs".to_string()))
        );
    });
}

#[test]
fn artifacts_url_is_forwarded_into_publish_jobs() {
    with_env(|| {
        set_required();
        set("TCAB_PUBLISHER_IMAGE", "ghcr.io/example/tcab-publisher:1.0");
        set("TCAB_ARTIFACTS_URL", "http://tcab-artifacts:8790");
        let config = Config::from_env().expect("config should resolve");
        // The artifact-service URL is forwarded into both driver and publish Jobs:
        // the publisher downloads the run's tree.tar from it.
        assert!(config.passthrough_publisher_env.contains(&(
            "TCAB_ARTIFACTS_URL".to_string(),
            "http://tcab-artifacts:8790".to_string()
        )));
    });
}

#[test]
fn blank_publisher_vars_are_treated_as_unset() {
    with_env(|| {
        set_required();
        set("TCAB_PUBLISHER_IMAGE", "   ");
        set("TCAB_DISPATCHER_PUBLISHER_SECRETS", "");
        let config = Config::from_env().expect("config should resolve");
        assert!(config.publisher_image.is_none());
        assert!(!config.publishing_enabled());
        assert!(config.publisher_secrets.is_empty());
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
fn container_image_vars_are_passed_through() {
    with_env(|| {
        set_required();
        set("TCAB_CONTAINER_REGISTRY", "ghcr.io/theclockwyrks");
        set("TCAB_CONTAINER_TAG", "deadbeef");
        set(
            "TCAB_CONTAINER_IMAGE_ADVERSARIAL",
            "ghcr.io/example/custom-adversarial:1.0",
        );

        let config = Config::from_env().expect("config should resolve");
        // The run-image selection is forwarded into each driver Job so the driver's
        // `resolve_run_image` pins the run-container image to the same `:<git-sha>`
        // the deployment chose, instead of the compiled `:latest` default.
        assert!(config.passthrough_k8s_env.contains(&(
            "TCAB_CONTAINER_REGISTRY".to_string(),
            "ghcr.io/theclockwyrks".to_string()
        )));
        assert!(
            config
                .passthrough_k8s_env
                .contains(&("TCAB_CONTAINER_TAG".to_string(), "deadbeef".to_string()))
        );
        // Per-image full-ref overrides ride the same passthrough.
        assert!(config.passthrough_k8s_env.contains(&(
            "TCAB_CONTAINER_IMAGE_ADVERSARIAL".to_string(),
            "ghcr.io/example/custom-adversarial:1.0".to_string()
        )));
        // The unset per-image overrides are not forwarded ("forward only if set").
        assert_eq!(config.passthrough_k8s_env.len(), 3);
    });
}

#[test]
fn observability_vars_are_passed_through() {
    with_env(|| {
        set_required();
        set("OTEL_EXPORTER_OTLP_ENDPOINT", "http://tcab-lgtm:4318");
        set("TCAB_ENV", "prod");

        let config = Config::from_env().expect("config should resolve");
        // The OTLP endpoint and the environment tag are forwarded into each driver
        // Job's env so run/driver spans export to the same collector as the services.
        assert!(config.passthrough_k8s_env.contains(&(
            "OTEL_EXPORTER_OTLP_ENDPOINT".to_string(),
            "http://tcab-lgtm:4318".to_string()
        )));
        assert!(
            config
                .passthrough_k8s_env
                .contains(&("TCAB_ENV".to_string(), "prod".to_string()))
        );
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

#[test]
fn driver_resource_requests_default_so_the_pod_is_never_best_effort() {
    with_env(|| {
        set_required();
        let config = Config::from_env().expect("config should resolve");

        assert_eq!(
            config.driver_resources.cpu_request.as_deref(),
            Some(DEFAULT_DRIVER_CPU_REQUEST)
        );
        assert_eq!(
            config.driver_resources.memory_request.as_deref(),
            Some(DEFAULT_DRIVER_MEMORY_REQUEST)
        );
        // The memory limit defaults too, and to the SAME value as the request: that
        // equality is what makes a node reserve exactly what a driver may use, so
        // nothing on the node can be killed to satisfy the driver's growth. The CPU
        // limit stays absent — over-limit CPU is throttled, not killed.
        assert_eq!(
            config.driver_resources.memory_limit.as_deref(),
            Some(DEFAULT_DRIVER_MEMORY_LIMIT)
        );
        assert_eq!(
            config.driver_resources.memory_request, config.driver_resources.memory_limit,
            "the driver's memory request and limit must default to one value; a gap \
             between them is memory the scheduler has promised twice"
        );
        assert!(config.driver_resources.cpu_limit.is_none());
        assert!(!config.driver_resources.is_empty());
    });
}

#[test]
fn driver_resources_are_overridable() {
    with_env(|| {
        set_required();
        set("TCAB_DISPATCHER_DRIVER_CPU_REQUEST", "250m");
        set("TCAB_DISPATCHER_DRIVER_MEMORY_REQUEST", "1Gi");
        set("TCAB_DISPATCHER_DRIVER_CPU_LIMIT", "2");
        set("TCAB_DISPATCHER_DRIVER_MEMORY_LIMIT", "4Gi");
        let config = Config::from_env().expect("config should resolve");

        assert_eq!(config.driver_resources.cpu_request.as_deref(), Some("250m"));
        assert_eq!(
            config.driver_resources.memory_request.as_deref(),
            Some("1Gi")
        );
        assert_eq!(config.driver_resources.cpu_limit.as_deref(), Some("2"));
        assert_eq!(config.driver_resources.memory_limit.as_deref(), Some("4Gi"));
    });
}

#[test]
fn blanking_a_driver_request_omits_it_rather_than_defaulting() {
    // Unset means "use the default"; explicitly blank means "omit". Collapsing the
    // two would make the documented opt-out silently impossible.
    with_env(|| {
        set_required();
        set("TCAB_DISPATCHER_DRIVER_CPU_REQUEST", "");
        set("TCAB_DISPATCHER_DRIVER_MEMORY_REQUEST", "   ");
        // The memory LIMIT now defaults as well, so it has to be blanked too for the
        // container to carry no `resources` at all — the state `is_empty` names.
        set("TCAB_DISPATCHER_DRIVER_MEMORY_LIMIT", "");
        let config = Config::from_env().expect("config should resolve");

        assert!(config.driver_resources.cpu_request.is_none());
        assert!(config.driver_resources.memory_request.is_none());
        assert!(config.driver_resources.memory_limit.is_none());
        assert!(config.driver_resources.is_empty());
    });
}

#[test]
fn blanking_the_driver_memory_limit_leaves_the_container_unbounded() {
    // The documented escape hatch for an operator managing driver QoS elsewhere (a
    // `LimitRange`). It must stay reachable, but it is the one opt-out that gives up
    // the "sum of a node's limits is knowable" property, so it is asserted explicitly
    // rather than left to follow from the blanking rule.
    with_env(|| {
        set_required();
        set("TCAB_DISPATCHER_DRIVER_MEMORY_LIMIT", "");
        let config = Config::from_env().expect("config should resolve");

        assert!(config.driver_resources.memory_limit.is_none());
        // The request survives, so the pod is still not `BestEffort`.
        assert_eq!(
            config.driver_resources.memory_request.as_deref(),
            Some(DEFAULT_DRIVER_MEMORY_REQUEST)
        );
        assert!(!config.driver_resources.is_empty());
    });
}

#[test]
fn sandbox_namespace_defaults_to_the_dispatcher_namespace() {
    with_env(|| {
        set_required();
        set("TCAB_DISPATCHER_NAMESPACE", "tcab-staging");
        let config = Config::from_env().expect("config should resolve");

        // The reaper must look where sandboxes actually land. With TCAB_K8S_NAMESPACE
        // unset the driver defaults to its own pod namespace, which is this one.
        assert_eq!(config.sandbox_namespace, "tcab-staging");
    });
}

#[test]
fn sandbox_namespace_follows_the_driver_override() {
    with_env(|| {
        set_required();
        set("TCAB_DISPATCHER_NAMESPACE", "tcab-staging");
        set("TCAB_K8S_NAMESPACE", "tcab-sandboxes");
        let config = Config::from_env().expect("config should resolve");

        assert_eq!(config.namespace, "tcab-staging");
        assert_eq!(config.sandbox_namespace, "tcab-sandboxes");
    });
}
