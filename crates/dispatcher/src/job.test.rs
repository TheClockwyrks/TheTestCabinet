//! Unit tests for the pure driver-`Job` builder. No cluster: the manifest shape is
//! deterministic given a [`ClaimedJob`] and the [`Config`], so every assertion here
//! reads the built `Job` struct directly.

use super::*;

use std::collections::BTreeMap;
use std::time::Duration;

use k8s_openapi::api::core::v1::EnvVar;

use crate::config::{
    DEFAULT_DRIVER_CPU_REQUEST, DEFAULT_DRIVER_MEMORY_LIMIT, DEFAULT_DRIVER_MEMORY_REQUEST,
    DriverResources,
};
use test_cabinet_core::run_record::HarnessSlug;
use test_cabinet_core::{ClaimedJob, LaunchBody, PublishClaim};

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
            retry_count: None,
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
        sandbox_namespace: "tcab".to_string(),
        driver_service_account: Some("tcab-driver".to_string()),
        max_inflight: 8,
        poll_interval: Duration::from_secs(2),
        job_ttl_seconds: 300,
        // Mirrors what `DriverResources::from_env` resolves by default: the memory
        // request and limit are ONE value (see `DEFAULT_DRIVER_MEMORY_REQUEST`), and
        // CPU is left unbounded.
        driver_resources: DriverResources {
            cpu_request: Some(DEFAULT_DRIVER_CPU_REQUEST.to_string()),
            memory_request: Some(DEFAULT_DRIVER_MEMORY_REQUEST.to_string()),
            cpu_limit: None,
            memory_limit: Some(DEFAULT_DRIVER_MEMORY_LIMIT.to_string()),
        },
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
        publisher_image: Some("ghcr.io/example/tcab-publisher:latest".to_string()),
        publisher_secrets: vec!["tcab-publisher-secrets".to_string()],
        passthrough_publisher_env: vec![
            (
                "TCAB_ARTIFACTS_URL".to_string(),
                "http://tcab-artifacts:8790".to_string(),
            ),
            ("TCAB_GITHUB_ORG".to_string(), "TheClockwyrks".to_string()),
            ("TCAB_PAGES_PROJECT".to_string(), "tcab-runs".to_string()),
        ],
    }
}

/// A representative claimed publish job.
fn publish_claim() -> PublishClaim {
    PublishClaim {
        job_id: "pub-456".to_string(),
        job_token: "pub-token-xyz".to_string(),
        run_id: "run-789".to_string(),
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
    assert!(
        container(&job).volume_mounts.is_none(),
        "expected no mounts"
    );
    // No subscription mount means no fsGroup either — an API-key-only pod needs no
    // pod-level security context.
    assert!(
        pod.security_context.is_none(),
        "expected no security context"
    );
    assert!(
        !env_map(container(&job).env.as_ref().unwrap())
            .contains_key("TCAB_DRIVER_SUBSCRIPTION_DIR")
    );
}

#[test]
fn subscription_secret_mounts_a_readonly_group_readable_volume() {
    let mut config = config();
    config.driver_subscription_secret = Some("tcab-driver-subscription".to_string());
    config.subscription_dir = "/var/run/tcab/subscription".to_string();
    let job = build_driver_job(&claim(), &config).unwrap();

    let pod = job.spec.as_ref().unwrap().template.spec.as_ref().unwrap();
    let volume = &pod.volumes.as_ref().expect("expected a volume")[0];
    assert_eq!(volume.name, "subscription-creds");
    let secret = volume
        .secret
        .as_ref()
        .expect("expected a secret volume source");
    assert_eq!(
        secret.secret_name.as_deref(),
        Some("tcab-driver-subscription")
    );
    // Group-readable (never world-readable), and optional so a missing Secret never
    // wedges the pod. The group bit lets the non-root `node` user read the
    // root-owned projected files via the pod's fsGroup (asserted below).
    assert_eq!(secret.default_mode, Some(0o640));
    assert_eq!(secret.optional, Some(true));

    // The pod carries an fsGroup so the driver's `node` user can read those
    // root-owned credential files; without it the read fails with EACCES.
    assert_eq!(
        pod.security_context
            .as_ref()
            .expect("expected a pod security context")
            .fs_group,
        Some(1000)
    );

    let mount = &container(&job)
        .volume_mounts
        .as_ref()
        .expect("expected a mount")[0];
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

/// A driver `Job` has `backoffLimit: 0`, so an evicted driver pod is not replaced —
/// it is a destroyed run. The autoscaler cannot know that (a `Job` pod normally
/// *is* replaceable), and the driver's small CPU request makes its node an
/// attractive consolidation target for as long as the run lasts, so the pod must
/// say so itself.
#[test]
fn driver_pod_is_pinned_against_autoscaler_eviction() {
    let job = build_driver_job(&claim(), &config()).unwrap();
    let annotations = job
        .spec
        .as_ref()
        .unwrap()
        .template
        .metadata
        .as_ref()
        .unwrap()
        .annotations
        .as_ref()
        .unwrap();
    assert_eq!(
        annotations
            .get("cluster-autoscaler.kubernetes.io/safe-to-evict")
            .map(String::as_str),
        Some("false"),
    );
}

/// The publisher is single-attempt for the same reason and holds an in-flight
/// release; evicting it mid-deploy is no more recoverable than evicting a driver.
#[test]
fn publish_pod_is_pinned_against_autoscaler_eviction() {
    let job = build_publish_job(&publish_claim(), &config());
    let annotations = job
        .spec
        .as_ref()
        .unwrap()
        .template
        .metadata
        .as_ref()
        .unwrap()
        .annotations
        .as_ref()
        .unwrap();
    assert_eq!(
        annotations
            .get("cluster-autoscaler.kubernetes.io/safe-to-evict")
            .map(String::as_str),
        Some("false"),
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

// --- publish Job builder ---------------------------------------------------

#[test]
fn publish_job_sets_the_publisher_image_and_container_name() {
    let job = build_publish_job(&publish_claim(), &config());
    let c = container(&job);
    assert_eq!(c.name, "publisher");
    assert_eq!(
        c.image.as_deref(),
        Some("ghcr.io/example/tcab-publisher:latest"),
    );
}

#[test]
fn publish_job_sets_the_claim_env() {
    let job = build_publish_job(&publish_claim(), &config());
    let map = env_map(container(&job).env.as_ref().unwrap());

    assert_eq!(
        map["TCAB_BACKEND_URL"].value.as_deref(),
        Some("http://backend:8787")
    );
    assert_eq!(map["TCAB_PUBLISH_JOB_ID"].value.as_deref(), Some("pub-456"));
    assert_eq!(
        map["TCAB_PUBLISH_JOB_TOKEN"].value.as_deref(),
        Some("pub-token-xyz")
    );
    assert_eq!(map["TCAB_PUBLISH_RUN_ID"].value.as_deref(), Some("run-789"));
}

#[test]
fn publish_job_forwards_artifacts_org_and_pages_project() {
    let job = build_publish_job(&publish_claim(), &config());
    let map = env_map(container(&job).env.as_ref().unwrap());

    assert_eq!(
        map["TCAB_ARTIFACTS_URL"].value.as_deref(),
        Some("http://tcab-artifacts:8790")
    );
    assert_eq!(
        map["TCAB_GITHUB_ORG"].value.as_deref(),
        Some("TheClockwyrks")
    );
    assert_eq!(
        map["TCAB_PAGES_PROJECT"].value.as_deref(),
        Some("tcab-runs")
    );
}

#[test]
fn publish_job_mounts_publisher_secrets_via_env_from() {
    let job = build_publish_job(&publish_claim(), &config());
    let env_from = container(&job)
        .env_from
        .as_ref()
        .expect("configured publisher secrets must produce an envFrom");
    let names: Vec<&str> = env_from
        .iter()
        .filter_map(|src| src.secret_ref.as_ref())
        .map(|secret| secret.name.as_str())
        .collect();
    assert_eq!(names, vec!["tcab-publisher-secrets"]);
}

#[test]
fn publish_job_with_no_secrets_omits_env_from() {
    let mut config = config();
    config.publisher_secrets.clear();
    let job = build_publish_job(&publish_claim(), &config);
    assert!(container(&job).env_from.is_none());
}

#[test]
fn publish_job_has_no_driver_k8s_extras() {
    // The inverse of the driver Job: the publisher only talks HTTP, so it carries
    // none of the sandbox/pod-IP/subscription/driver-SA machinery.
    let job = build_publish_job(&publish_claim(), &config());
    let pod = job.spec.as_ref().unwrap().template.spec.as_ref().unwrap();
    let map = env_map(container(&job).env.as_ref().unwrap());

    // No downward-API pod IP and no sandbox-pod passthroughs.
    assert!(!map.contains_key("TCAB_K8S_POD_IP"));
    assert!(!map.contains_key("TCAB_K8S_RUN_CPU_REQUEST"));
    assert!(!map.contains_key("TCAB_K8S_IMAGE_PULL_SECRETS"));
    // No driver-runtime selector or run-request — those are run-path only.
    assert!(!map.contains_key("TCAB_DRIVER_RUNTIME"));
    assert!(!map.contains_key("TCAB_RUN_REQUEST"));

    // No subscription volume/mount/security-context, and no ServiceAccount: the
    // publisher must NOT get the driver's pod-create RBAC — it runs as the namespace
    // default.
    assert!(pod.volumes.is_none(), "publisher needs no volumes");
    assert!(
        container(&job).volume_mounts.is_none(),
        "publisher needs no mounts"
    );
    assert!(
        pod.security_context.is_none(),
        "publisher needs no fsGroup/security context"
    );
    assert!(
        pod.service_account_name.is_none(),
        "publisher must use the namespace default SA, not the driver SA"
    );
}

#[test]
fn publish_job_restart_policy_never_and_no_retries() {
    let job = build_publish_job(&publish_claim(), &config());
    let job_spec = job.spec.as_ref().unwrap();
    assert_eq!(job_spec.backoff_limit, Some(0));
    let pod_spec = job_spec.template.spec.as_ref().unwrap();
    assert_eq!(pod_spec.restart_policy.as_deref(), Some("Never"));
}

#[test]
fn publish_job_sets_ttl_after_finished() {
    let job = build_publish_job(&publish_claim(), &config());
    assert_eq!(
        job.spec.as_ref().unwrap().ttl_seconds_after_finished,
        Some(300),
    );
}

#[test]
fn publish_job_carries_ownership_and_job_id_labels() {
    let job = build_publish_job(&publish_claim(), &config());
    // Same ownership label as driver Jobs so the dispatcher's reconcile/cleanup
    // covers publish Jobs too, plus the job-id label.
    let meta_labels = job.metadata.labels.as_ref().unwrap();
    assert_eq!(
        meta_labels
            .get("app.kubernetes.io/managed-by")
            .map(String::as_str),
        Some(MANAGED_BY),
    );
    assert_eq!(
        meta_labels.get(JOB_ID_LABEL).map(String::as_str),
        Some("pub-456")
    );
}

#[test]
fn publish_job_is_named_and_namespaced() {
    let job = build_publish_job(&publish_claim(), &config());
    assert_eq!(job.metadata.name.as_deref(), Some("tcab-publisher-pub-456"));
    assert_eq!(job.metadata.namespace.as_deref(), Some("tcab"));
}

#[test]
fn driver_container_carries_resource_requests() {
    // The driver pod must never land in the `BestEffort` QoS class: it is the only
    // process that can tear down a run's sandbox, and `BestEffort` makes it the
    // first thing the kubelet evicts and the kernel OOM-kills. A driver killed by
    // SIGKILL runs no teardown and orphans the sandbox forever.
    let job = build_driver_job(&claim(), &config()).unwrap();
    let resources = container(&job)
        .resources
        .as_ref()
        .expect("the driver container carries resources");
    let requests = resources
        .requests
        .as_ref()
        .expect("requests are what set the QoS class");

    assert_eq!(requests["cpu"].0, DEFAULT_DRIVER_CPU_REQUEST);
    assert_eq!(requests["memory"].0, DEFAULT_DRIVER_MEMORY_REQUEST);

    // The memory LIMIT is rendered too, and equals the request: a node then reserves
    // exactly what the driver may use, so the driver can neither be killed to satisfy
    // another pod's growth nor cause another pod to be. The CPU limit stays absent —
    // over-limit CPU is throttled, not killed.
    let limits = resources
        .limits
        .as_ref()
        .expect("the memory limit is rendered by default");
    assert_eq!(limits["memory"].0, DEFAULT_DRIVER_MEMORY_LIMIT);
    assert_eq!(
        limits["memory"].0, requests["memory"].0,
        "a gap between the driver's memory request and limit is memory the scheduler \
         has promised twice"
    );
    assert!(!limits.contains_key("cpu"));
}

#[test]
fn driver_container_limits_are_applied_when_configured() {
    let mut config = config();
    config.driver_resources.cpu_limit = Some("1".to_string());
    config.driver_resources.memory_limit = Some("2Gi".to_string());

    let job = build_driver_job(&claim(), &config).unwrap();
    let limits = container(&job)
        .resources
        .as_ref()
        .unwrap()
        .limits
        .as_ref()
        .expect("configured limits are applied");

    assert_eq!(limits["cpu"].0, "1");
    assert_eq!(limits["memory"].0, "2Gi");
}

#[test]
fn driver_container_omits_resources_when_all_are_blank() {
    // The deliberate opt-out (every quantity blanked — both requests AND the memory
    // limit, which now defaults) must omit the field rather than serialize an empty
    // `resources: {}`.
    let mut config = config();
    config.driver_resources = DriverResources::default();

    let job = build_driver_job(&claim(), &config).unwrap();
    assert!(container(&job).resources.is_none());
}

#[test]
fn sandbox_managed_by_matches_the_value_the_driver_stamps() {
    // The driver crate stamps this literal on every sandbox pod it creates
    // (`driver::kubernetes::build_run_pod`), and the dispatcher's sandbox reaper
    // selects on it. The two crates do not depend on each other, so this pins the
    // shared value from the dispatcher's side; the driver has the mirror assertion.
    assert_eq!(SANDBOX_MANAGED_BY, "tcab-driver");
    // It must differ from the dispatcher's own value, or the reaper's selector
    // would match driver Job pods as well as sandboxes.
    assert_ne!(SANDBOX_MANAGED_BY, MANAGED_BY);
}
