//! Unit tests for the pure driver-`Job` builder. No cluster: the manifest shape is
//! deterministic given a [`ClaimedJob`] and the [`Config`], so every assertion here
//! reads the built `Job` struct directly.

use super::*;

use std::collections::BTreeMap;
use std::time::Duration;

use k8s_openapi::api::core::v1::EnvVar;

use test_cabinet_core::run_record::HarnessSlug;
use test_cabinet_core::{ClaimedJob, LaunchBody};

/// A representative claimed job.
fn claim() -> ClaimedJob {
    ClaimedJob {
        job_id: "job-123".to_string(),
        job_token: "token-abc".to_string(),
        request: LaunchBody {
            test_case: "pong".to_string(),
            version: "v1.0.0".to_string(),
            variant: "base".to_string(),
            harness: HarnessSlug::Claude,
            model: "anthropic/claude".to_string(),
            orchestrator: Some("one-shot".to_string()),
            max_runtime_seconds: Some(600),
            auth_mode: None,
        },
    }
}

/// A config carrying the sandbox-pod passthroughs the driver Job must forward.
fn config() -> Config {
    Config {
        backend_url: "http://backend:8787".to_string(),
        service_token: "service-tok".to_string(),
        driver_image: "ghcr.io/example/tcab-driver:latest".to_string(),
        namespace: "tcab".to_string(),
        driver_service_account: Some("tcab-driver".to_string()),
        max_inflight: 8,
        poll_interval: Duration::from_secs(2),
        job_ttl_seconds: 300,
        driver_secrets: vec!["tcab-driver-secrets".to_string()],
        driver_subscription_secret: None,
        subscription_dir: "/var/run/tcab/subscription".to_string(),
        driver_auth_mode: None,
        passthrough_k8s_env: vec![
            ("TCAB_K8S_RUN_CPU_REQUEST".to_string(), "500m".to_string()),
            ("TCAB_K8S_RUN_CPU_LIMIT".to_string(), "2".to_string()),
            ("TCAB_K8S_RUN_MEMORY_REQUEST".to_string(), "1Gi".to_string()),
            ("TCAB_K8S_RUN_MEMORY_LIMIT".to_string(), "4Gi".to_string()),
            (
                "TCAB_K8S_IMAGE_PULL_SECRETS".to_string(),
                "ghcr-pull".to_string(),
            ),
        ],
    }
}

/// Index the built pod's env by name for assertions. Each name is unique.
fn env_map(env: &[EnvVar]) -> BTreeMap<&str, &EnvVar> {
    env.iter().map(|var| (var.name.as_str(), var)).collect()
}

/// Pull the single container out of a built Job's pod template.
fn container(job: &Job) -> &k8s_openapi::api::core::v1::Container {
    &job.spec
        .as_ref()
        .unwrap()
        .template
        .spec
        .as_ref()
        .unwrap()
        .containers[0]
}

#[test]
fn sets_the_driver_image() {
    let job = build_driver_job(&claim(), &config()).unwrap();
    assert_eq!(
        container(&job).image.as_deref(),
        Some("ghcr.io/example/tcab-driver:latest"),
    );
}

#[test]
fn sets_the_required_literal_env() {
    let job = build_driver_job(&claim(), &config()).unwrap();
    let env = container(&job).env.as_ref().unwrap();
    let map = env_map(env);

    assert_eq!(
        map["TCAB_BACKEND_URL"].value.as_deref(),
        Some("http://backend:8787")
    );
    assert_eq!(map["TCAB_JOB_ID"].value.as_deref(), Some("job-123"));
    assert_eq!(map["TCAB_JOB_TOKEN"].value.as_deref(), Some("token-abc"));
    assert_eq!(
        map["TCAB_DRIVER_RUNTIME"].value.as_deref(),
        Some("kubernetes")
    );
}

#[test]
fn run_request_env_is_the_launch_body_json() {
    let claim = claim();
    let job = build_driver_job(&claim, &config()).unwrap();
    let env = container(&job).env.as_ref().unwrap();
    let raw = env_map(env)["TCAB_RUN_REQUEST"].value.clone().unwrap();

    // It must round-trip back to the exact launch request the driver will parse.
    let decoded: LaunchBody = serde_json::from_str(&raw).unwrap();
    assert_eq!(decoded.test_case, claim.request.test_case);
    assert_eq!(decoded.version, claim.request.version);
    assert_eq!(decoded.variant, claim.request.variant);
    assert_eq!(decoded.harness, claim.request.harness);
    assert_eq!(decoded.model, claim.request.model);
    assert_eq!(decoded.orchestrator, claim.request.orchestrator);
    assert_eq!(
        decoded.max_runtime_seconds,
        claim.request.max_runtime_seconds
    );
}

#[test]
fn passes_the_k8s_resource_requests_through() {
    let job = build_driver_job(&claim(), &config()).unwrap();
    let env = container(&job).env.as_ref().unwrap();
    let map = env_map(env);

    assert_eq!(
        map["TCAB_K8S_RUN_CPU_REQUEST"].value.as_deref(),
        Some("500m")
    );
    assert_eq!(map["TCAB_K8S_RUN_CPU_LIMIT"].value.as_deref(), Some("2"));
    assert_eq!(
        map["TCAB_K8S_RUN_MEMORY_REQUEST"].value.as_deref(),
        Some("1Gi")
    );
    assert_eq!(
        map["TCAB_K8S_RUN_MEMORY_LIMIT"].value.as_deref(),
        Some("4Gi")
    );
    assert_eq!(
        map["TCAB_K8S_IMAGE_PULL_SECRETS"].value.as_deref(),
        Some("ghcr-pull"),
    );
}

#[test]
fn pod_ip_comes_from_the_downward_api() {
    let job = build_driver_job(&claim(), &config()).unwrap();
    let env = container(&job).env.as_ref().unwrap();
    let pod_ip = env_map(env)["TCAB_K8S_POD_IP"];

    // No literal value; sourced from `fieldRef: status.podIP`.
    assert!(pod_ip.value.is_none());
    let field_ref = pod_ip
        .value_from
        .as_ref()
        .and_then(|src| src.field_ref.as_ref())
        .expect("TCAB_K8S_POD_IP must use a fieldRef");
    assert_eq!(field_ref.field_path, "status.podIP");
}

#[test]
fn mounts_driver_secrets_via_env_from() {
    let job = build_driver_job(&claim(), &config()).unwrap();
    let env_from = container(&job)
        .env_from
        .as_ref()
        .expect("configured driver secrets must produce an envFrom");
    let names: Vec<&str> = env_from
        .iter()
        .filter_map(|src| src.secret_ref.as_ref())
        .map(|secret| secret.name.as_str())
        .collect();
    assert_eq!(names, vec!["tcab-driver-secrets"]);
}

#[test]
fn no_driver_secrets_omits_env_from() {
    let mut config = config();
    config.driver_secrets.clear();
    let job = build_driver_job(&claim(), &config).unwrap();
    assert!(container(&job).env_from.is_none());
}

#[test]
fn no_subscription_secret_omits_the_volume_and_env() {
    // The default config configures no subscription Secret: no volume, no mount,
    // and no TCAB_DRIVER_SUBSCRIPTION_DIR env.
    let job = build_driver_job(&claim(), &config()).unwrap();
    let pod = job.spec.as_ref().unwrap().template.spec.as_ref().unwrap();
    assert!(pod.volumes.is_none(), "expected no volumes");
    assert!(container(&job).volume_mounts.is_none(), "expected no mounts");
    assert!(!env_map(container(&job).env.as_ref().unwrap()).contains_key("TCAB_DRIVER_SUBSCRIPTION_DIR"));
}

#[test]
fn subscription_secret_mounts_a_readonly_volume_with_default_mode_0600() {
    let mut config = config();
    config.driver_subscription_secret = Some("tcab-driver-subscription".to_string());
    config.subscription_dir = "/var/run/tcab/subscription".to_string();
    let job = build_driver_job(&claim(), &config).unwrap();

    let pod = job.spec.as_ref().unwrap().template.spec.as_ref().unwrap();
    let volume = &pod.volumes.as_ref().expect("expected a volume")[0];
    assert_eq!(volume.name, "subscription-creds");
    let secret = volume.secret.as_ref().expect("expected a secret volume source");
    assert_eq!(secret.secret_name.as_deref(), Some("tcab-driver-subscription"));
    // Owner-only credential files, and optional so a missing Secret never wedges
    // the pod.
    assert_eq!(secret.default_mode, Some(0o600));
    assert_eq!(secret.optional, Some(true));

    let mount = &container(&job).volume_mounts.as_ref().expect("expected a mount")[0];
    assert_eq!(mount.name, "subscription-creds");
    assert_eq!(mount.mount_path, "/var/run/tcab/subscription");
    assert_eq!(mount.read_only, Some(true));

    // The driver is told where the Secret is mounted.
    let env = env_map(container(&job).env.as_ref().unwrap());
    assert_eq!(
        env["TCAB_DRIVER_SUBSCRIPTION_DIR"].value.as_deref(),
        Some("/var/run/tcab/subscription")
    );
    // The API-key envFrom path is untouched (still present).
    assert!(container(&job).env_from.is_some());
}

#[test]
fn driver_auth_mode_is_forwarded_as_tcab_auth_mode() {
    let mut config = config();
    config.driver_auth_mode = Some("subscription".to_string());
    let job = build_driver_job(&claim(), &config).unwrap();
    let env = env_map(container(&job).env.as_ref().unwrap());
    assert_eq!(env["TCAB_AUTH_MODE"].value.as_deref(), Some("subscription"));
}

#[test]
fn no_driver_auth_mode_omits_tcab_auth_mode() {
    let job = build_driver_job(&claim(), &config()).unwrap();
    let env = env_map(container(&job).env.as_ref().unwrap());
    assert!(!env.contains_key("TCAB_AUTH_MODE"));
}

#[test]
fn uses_the_driver_service_account() {
    let job = build_driver_job(&claim(), &config()).unwrap();
    let spec = job.spec.as_ref().unwrap().template.spec.as_ref().unwrap();
    assert_eq!(spec.service_account_name.as_deref(), Some("tcab-driver"));
}

#[test]
fn restart_policy_never_and_no_retries() {
    let job = build_driver_job(&claim(), &config()).unwrap();
    let job_spec = job.spec.as_ref().unwrap();
    assert_eq!(job_spec.backoff_limit, Some(0));

    let pod_spec = job_spec.template.spec.as_ref().unwrap();
    assert_eq!(pod_spec.restart_policy.as_deref(), Some("Never"));
}

#[test]
fn sets_ttl_after_finished() {
    let job = build_driver_job(&claim(), &config()).unwrap();
    assert_eq!(
        job.spec.as_ref().unwrap().ttl_seconds_after_finished,
        Some(300),
    );
}

#[test]
fn carries_ownership_and_job_id_labels() {
    let claim = claim();
    let job = build_driver_job(&claim, &config()).unwrap();

    let meta_labels = job.metadata.labels.as_ref().unwrap();
    assert_eq!(
        meta_labels
            .get("app.kubernetes.io/managed-by")
            .map(String::as_str),
        Some(MANAGED_BY),
    );
    assert_eq!(
        meta_labels.get(JOB_ID_LABEL).map(String::as_str),
        Some("job-123")
    );

    // The pod template carries the same labels so a death-detection pod lookup and
    // a managed list both resolve.
    let template_labels = job
        .spec
        .as_ref()
        .unwrap()
        .template
        .metadata
        .as_ref()
        .unwrap()
        .labels
        .as_ref()
        .unwrap();
    assert_eq!(
        template_labels
            .get("app.kubernetes.io/managed-by")
            .map(String::as_str),
        Some(MANAGED_BY),
    );
}

#[test]
fn names_the_job_and_namespaces_it() {
    let job = build_driver_job(&claim(), &config()).unwrap();
    assert_eq!(job.metadata.name.as_deref(), Some("tcab-driver-job-123"));
    assert_eq!(job.metadata.namespace.as_deref(), Some("tcab"));
}

#[test]
fn managed_selector_matches_the_label() {
    assert_eq!(
        managed_selector(),
        format!("app.kubernetes.io/managed-by={MANAGED_BY}"),
    );
}
