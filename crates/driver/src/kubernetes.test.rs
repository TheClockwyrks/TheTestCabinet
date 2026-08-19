//! Unit tests for the pure logic of the Kubernetes runtime. The cluster-driving
//! paths (`exec`, pod lifecycle) need a live API server and are exercised by the
//! deployment, not here; everything below is the manifest construction, tar
//! framing, and status/identifier parsing, which are deterministic and pure.

use super::*;

use std::collections::BTreeMap;

use k8s_openapi::api::core::v1::{
    ContainerState, ContainerStateWaiting, ContainerStatus, PodCondition, PodSpec, PodStatus,
};
use k8s_openapi::apimachinery::pkg::apis::meta::v1::{StatusCause, StatusDetails};
use test_cabinet_core::execution::{ContainerFile, ContainerSpec};

fn spec(image: &str) -> ContainerSpec {
    ContainerSpec {
        image: image.to_string(),
        repo_path: std::path::PathBuf::from("/tmp/seed"),
        secrets: BTreeMap::new(),
        env: BTreeMap::new(),
        files: Vec::new(),
        network_enabled: true,
        add_hosts: Vec::new(),
    }
}

// ── exit_code_from_status ────────────────────────────────────────────────────

#[test]
fn success_status_is_zero() {
    let status = Status {
        status: Some("Success".to_string()),
        ..Default::default()
    };
    assert_eq!(exit_code_from_status(Some(status)), 0);
}

#[test]
fn failure_status_reads_exit_code_cause() {
    let status = Status {
        status: Some("Failure".to_string()),
        details: Some(StatusDetails {
            causes: Some(vec![StatusCause {
                reason: Some("ExitCode".to_string()),
                message: Some("17".to_string()),
                ..Default::default()
            }]),
            ..Default::default()
        }),
        ..Default::default()
    };
    assert_eq!(exit_code_from_status(Some(status)), 17);
}

#[test]
fn failure_without_exit_code_is_generic_nonzero() {
    let status = Status {
        status: Some("Failure".to_string()),
        ..Default::default()
    };
    assert_eq!(exit_code_from_status(Some(status)), 1);
}

#[test]
fn missing_status_is_minus_one() {
    assert_eq!(exit_code_from_status(None), -1);
}

// ── normalize_image_id ───────────────────────────────────────────────────────

#[test]
fn image_id_with_digest_is_kept() {
    assert_eq!(
        normalize_image_id("ghcr.io/x/base@sha256:abc"),
        Some("ghcr.io/x/base@sha256:abc".to_string())
    );
}

#[test]
fn image_id_strips_docker_pullable_prefix() {
    assert_eq!(
        normalize_image_id("docker-pullable://ghcr.io/x/base@sha256:abc"),
        Some("ghcr.io/x/base@sha256:abc".to_string())
    );
}

#[test]
fn image_id_without_digest_is_none() {
    assert_eq!(normalize_image_id("ghcr.io/x/base:latest"), None);
    assert_eq!(normalize_image_id(""), None);
}

// ── run_pod_host_aliases ─────────────────────────────────────────────────────

#[test]
fn host_gateway_rewrites_to_pod_ip() {
    let aliases = run_pod_host_aliases(
        &["host.docker.internal:host-gateway".to_string()],
        Some("10.1.2.3"),
    )
    .expect("alias");
    assert_eq!(aliases.len(), 1);
    assert_eq!(aliases[0].ip, "10.1.2.3");
    assert_eq!(
        aliases[0].hostnames.as_deref(),
        Some(["host.docker.internal".to_string()].as_slice())
    );
}

#[test]
fn host_gateway_without_pod_ip_is_dropped() {
    assert_eq!(
        run_pod_host_aliases(&["host.docker.internal:host-gateway".to_string()], None),
        None
    );
}

#[test]
fn explicit_ip_mapping_passes_through() {
    let aliases =
        run_pod_host_aliases(&["example.test:192.0.2.9".to_string()], None).expect("alias");
    assert_eq!(aliases[0].ip, "192.0.2.9");
}

#[test]
fn no_add_hosts_is_none() {
    assert_eq!(run_pod_host_aliases(&[], Some("10.0.0.1")), None);
}

// ── quantity_map ─────────────────────────────────────────────────────────────

#[test]
fn quantity_map_omits_unset_and_keeps_set() {
    let map = quantity_map([("cpu", Some("500m")), ("memory", None)]).expect("map");
    assert_eq!(map.get("cpu").map(|q| q.0.as_str()), Some("500m"));
    assert!(!map.contains_key("memory"));
}

#[test]
fn quantity_map_all_unset_is_none() {
    assert_eq!(quantity_map([("cpu", None), ("memory", None)]), None);
}

// ── build_run_pod ────────────────────────────────────────────────────────────

#[test]
fn pod_carries_both_env_channels_with_secrets_last() {
    // The harness runs inside this pod, so its telemetry configuration has to be
    // on the pod spec: the Kubernetes exec API carries no environment of its own.
    let mut s = spec("ghcr.io/x/base:latest");
    s.env.insert(
        "OTEL_EXPORTER_OTLP_ENDPOINT".to_string(),
        "http://tcab-lgtm:4318".to_string(),
    );
    s.secrets
        .insert("ANTHROPIC_API_KEY".to_string(), "sk-real".to_string());
    // A telemetry variable must never shadow the key the harness authenticates
    // with, which is why secrets are applied last.
    s.env
        .insert("ANTHROPIC_API_KEY".to_string(), "bogus".to_string());

    let pod = build_run_pod("tcab-run-abc", &s, &KubernetesConfig::default());
    let container = &pod.spec.expect("spec").containers[0];
    let env = container.env.as_ref().expect("env");

    let names = env.iter().map(|var| var.name.as_str()).collect::<Vec<_>>();
    assert_eq!(
        names,
        vec![
            "ANTHROPIC_API_KEY",
            "OTEL_EXPORTER_OTLP_ENDPOINT",
            "ANTHROPIC_API_KEY",
        ],
    );
    // Kubernetes takes the last value for a repeated name.
    assert_eq!(env[2].value.as_deref(), Some("sk-real"));
    assert_eq!(env[1].value.as_deref(), Some("http://tcab-lgtm:4318"));
}

#[test]
fn pod_carries_image_secrets_labels_and_no_command() {
    let mut s = spec("ghcr.io/x/base:latest");
    s.secrets
        .insert("ANTHROPIC_API_KEY".to_string(), "sk-test".to_string());
    let mut config = KubernetesConfig {
        cpu_request: Some("500m".to_string()),
        memory_limit: Some("4Gi".to_string()),
        image_pull_secrets: vec!["tcab-registry".to_string()],
        run_service_account: Some("tcab-run".to_string()),
        ..KubernetesConfig::default()
    };
    config.namespace = "tcab-prod".to_string();

    let pod = build_run_pod("tcab-run-abc", &s, &config);
    let pod_spec = pod.spec.expect("spec");
    let container = &pod_spec.containers[0];

    assert_eq!(container.name, RUN_CONTAINER);
    assert_eq!(container.image.as_deref(), Some("ghcr.io/x/base:latest"));
    // The image's keep-alive CMD must run — no command override.
    assert!(container.command.is_none());
    let env = container.env.as_ref().expect("env");
    assert_eq!(env[0].name, "ANTHROPIC_API_KEY");
    assert_eq!(env[0].value.as_deref(), Some("sk-test"));

    assert_eq!(pod_spec.restart_policy.as_deref(), Some("Never"));
    assert_eq!(pod_spec.service_account_name.as_deref(), Some("tcab-run"));
    assert_eq!(pod_spec.automount_service_account_token, Some(false));
    assert_eq!(
        pod_spec.image_pull_secrets.as_ref().expect("pull secrets")[0].name,
        "tcab-registry"
    );

    let labels = pod.metadata.labels.expect("labels");
    assert_eq!(
        labels
            .get("app.kubernetes.io/managed-by")
            .map(String::as_str),
        Some("tcab-driver")
    );
    assert_eq!(
        labels.get("tcab.dev/network").map(String::as_str),
        Some("enabled")
    );

    let resources = container.resources.as_ref().expect("resources");
    assert_eq!(
        resources
            .requests
            .as_ref()
            .and_then(|r| r.get("cpu"))
            .map(|q| q.0.as_str()),
        Some("500m")
    );
    assert_eq!(
        resources
            .limits
            .as_ref()
            .and_then(|r| r.get("memory"))
            .map(|q| q.0.as_str()),
        Some("4Gi")
    );
}

#[test]
fn pod_carries_the_job_id_label_so_a_cancel_can_target_it() {
    let config = KubernetesConfig {
        job_id: Some("job-42".to_string()),
        ..KubernetesConfig::default()
    };
    let pod = build_run_pod("tcab-run-abc", &spec("img"), &config);
    let labels = pod.metadata.labels.expect("labels");
    assert_eq!(
        labels.get("tcab.dev/job-id").map(String::as_str),
        Some("job-42"),
        "the run pod is tagged with its job id for cancellation teardown"
    );

    // Without a job id (e.g. a non-dispatcher run) the label is simply omitted.
    let anon = build_run_pod("tcab-run-x", &spec("img"), &KubernetesConfig::default());
    assert!(
        !anon
            .metadata
            .labels
            .expect("labels")
            .contains_key("tcab.dev/job-id")
    );
}

#[test]
fn pod_without_secrets_or_resources_omits_them() {
    let pod = build_run_pod("tcab-run-x", &spec("img"), &KubernetesConfig::default());
    let pod_spec = pod.spec.expect("spec");
    let container = &pod_spec.containers[0];
    assert!(container.env.is_none());
    // Resources object is present but its maps are omitted when nothing is set.
    let resources = container.resources.as_ref().expect("resources");
    assert!(resources.requests.is_none());
    assert!(resources.limits.is_none());
    assert!(pod_spec.image_pull_secrets.is_none());
    assert!(pod_spec.service_account_name.is_none());
    assert!(pod_spec.host_aliases.is_none());
}

#[test]
fn unwatched_network_label_is_none_when_disabled() {
    let mut s = spec("img");
    s.network_enabled = false;
    let pod = build_run_pod("p", &s, &KubernetesConfig::default());
    let labels = pod.metadata.labels.expect("labels");
    assert_eq!(
        labels.get("tcab.dev/network").map(String::as_str),
        Some("none")
    );
}

// ── workdir_command / shell_quote ────────────────────────────────────────────

#[test]
fn workdir_command_cds_then_execs() {
    let wrapped = workdir_command(&["node".to_string(), "--version".to_string()]);
    assert_eq!(wrapped[0], "sh");
    assert_eq!(wrapped[1], "-c");
    assert_eq!(wrapped[2], "cd /work && exec 'node' '--version'");
}

#[test]
fn shell_quote_escapes_single_quotes() {
    assert_eq!(shell_quote("a'b"), r"'a'\''b'");
}

// ── tar framing ──────────────────────────────────────────────────────────────

#[test]
fn tar_files_roundtrips_with_path_and_mode() {
    let files = vec![ContainerFile {
        container_path: "/home/node/.codex/auth.json".to_string(),
        contents: b"{\"token\":\"x\"}".to_vec(),
        mode: 0o600,
    }];
    let archive = tar_files(&files).expect("archive");

    let mut found = false;
    let mut tar = tar::Archive::new(std::io::Cursor::new(archive));
    for entry in tar.entries().expect("entries") {
        let entry = entry.expect("entry");
        let path = entry.path().expect("path");
        // The leading slash is stripped so extraction with `-C /` is correct.
        assert_eq!(path.to_str(), Some("home/node/.codex/auth.json"));
        assert_eq!(entry.header().mode().expect("mode") & 0o777, 0o600);
        found = true;
    }
    assert!(found, "expected one entry");
}

#[test]
fn tar_dir_contents_packs_relative_entries() {
    let dir = tempfile::tempdir().expect("tempdir");
    std::fs::write(dir.path().join("spec.md"), b"hello").expect("write");
    std::fs::create_dir(dir.path().join("sub")).expect("subdir");
    std::fs::write(dir.path().join("sub/file.txt"), b"x").expect("write");

    let archive = tar_dir_contents(dir.path()).expect("archive");
    let mut names: Vec<String> = tar::Archive::new(std::io::Cursor::new(archive))
        .entries()
        .expect("entries")
        .map(|e| {
            e.expect("entry")
                .path()
                .expect("path")
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    names.sort();
    // Entries are relative to the directory root, so extraction with `-C /work`
    // lands them directly under /work (e.g. /work/spec.md, /work/sub/file.txt).
    assert!(names.iter().any(|n| n == "spec.md"), "{names:?}");
    assert!(names.iter().any(|n| n == "sub/file.txt"), "{names:?}");
}

#[test]
fn collect_tar_command_excludes_regenerable_dependency_dirs() {
    let cmd = collect_tar_command();
    // Streams the working tree to stdout (`-f -`) from `/work`, packing `.`.
    assert_eq!(cmd.first().map(String::as_str), Some("tar"));
    assert!(cmd.contains(&"-c".to_string()), "{cmd:?}");
    assert_eq!(
        cmd[cmd.len() - 5..],
        ["-f", "-", "-C", WORK_DIR, "."].map(String::from)
    );
    // Every never-kept directory is excluded at pack time, before the `.` operand
    // (GNU tar's `--exclude` is unanchored, so the bare name matches at any depth),
    // so a `node_modules` full of native binaries and `.bin/*` symlinks never
    // enters the archive the host must unpack.
    for dir in SKIPPED_DIRS {
        let flag = format!("--exclude={dir}");
        let pos = cmd.iter().position(|a| a == &flag);
        assert!(pos.is_some(), "expected {flag} in {cmd:?}");
        let dot = cmd.iter().position(|a| a == ".").expect("`.` operand");
        assert!(pos.unwrap() < dot, "{flag} must precede the `.` operand");
    }
    assert!(
        SKIPPED_DIRS.contains(&"node_modules"),
        "node_modules must be excluded from collection",
    );
}

#[test]
fn extract_tar_command_bounds_the_read_by_byte_count() {
    // `head -c {len}` is what lets the remote pipeline terminate without relying
    // on stdin-EOF, so the exit Status survives on a v4 exec WebSocket.
    let cmd = extract_tar_command("/work", 4096, false);
    assert_eq!(cmd[..2], ["sh".to_string(), "-c".to_string()]);
    assert_eq!(cmd[2], "head -c 4096 | tar -x -f - -C '/work'");
}

#[test]
fn extract_tar_command_preserves_modes_for_credential_files() {
    let cmd = extract_tar_command("/", 128, true);
    assert_eq!(cmd[2], "head -c 128 | tar -x -p -f - -C '/'");
}

// ── pod_waiting_reason / resolved_image_digest ───────────────────────────────

fn pod_with_container_status(status: ContainerStatus) -> Pod {
    Pod {
        status: Some(PodStatus {
            container_statuses: Some(vec![status]),
            ..Default::default()
        }),
        ..Default::default()
    }
}

#[test]
fn waiting_reason_surfaces_image_pull_backoff() {
    let pod = pod_with_container_status(ContainerStatus {
        name: RUN_CONTAINER.to_string(),
        state: Some(ContainerState {
            waiting: Some(ContainerStateWaiting {
                reason: Some("ImagePullBackOff".to_string()),
                ..Default::default()
            }),
            ..Default::default()
        }),
        ..Default::default()
    });
    assert_eq!(
        pod_waiting_reason(&pod).as_deref(),
        Some("ImagePullBackOff")
    );
}

// ── pod_scheduled / pod_scheduling_message ───────────────────────────────────

fn pod_with_condition(reason: Option<&str>, status: &str, message: Option<&str>) -> Pod {
    Pod {
        status: Some(PodStatus {
            conditions: Some(vec![PodCondition {
                type_: "PodScheduled".to_string(),
                status: status.to_string(),
                reason: reason.map(str::to_string),
                message: message.map(str::to_string),
                ..Default::default()
            }]),
            ..Default::default()
        }),
        ..Default::default()
    }
}

#[test]
fn scheduled_condition_true_marks_pod_scheduled() {
    assert!(pod_scheduled(&pod_with_condition(None, "True", None)));
}

#[test]
fn assigned_node_marks_pod_scheduled() {
    let pod = Pod {
        spec: Some(PodSpec {
            node_name: Some("node-1".to_string()),
            ..Default::default()
        }),
        ..Default::default()
    };
    assert!(pod_scheduled(&pod));
}

#[test]
fn unscheduled_pod_is_not_scheduled() {
    // A pod the scheduler cannot yet place: PodScheduled=False, no node bound.
    let pod = pod_with_condition(
        Some("Unschedulable"),
        "False",
        Some("0/3 nodes are available"),
    );
    assert!(!pod_scheduled(&pod));
    // A brand-new pod with no status at all is likewise not scheduled.
    assert!(!pod_scheduled(&Pod::default()));
    // An empty node name does not count as bound.
    let blank_node = Pod {
        spec: Some(PodSpec {
            node_name: Some(String::new()),
            ..Default::default()
        }),
        ..Default::default()
    };
    assert!(!pod_scheduled(&blank_node));
}

#[test]
fn scheduling_message_joins_reason_and_message() {
    let pod = pod_with_condition(
        Some("Unschedulable"),
        "False",
        Some("0/3 nodes are available: insufficient memory"),
    );
    assert_eq!(
        pod_scheduling_message(&pod).as_deref(),
        Some("Unschedulable: 0/3 nodes are available: insufficient memory")
    );
}

#[test]
fn scheduling_message_falls_back_to_reason_or_message_alone() {
    assert_eq!(
        pod_scheduling_message(&pod_with_condition(Some("Unschedulable"), "False", None))
            .as_deref(),
        Some("Unschedulable")
    );
    assert_eq!(
        pod_scheduling_message(&pod_with_condition(None, "False", Some("waiting"))).as_deref(),
        Some("waiting")
    );
    // No PodScheduled condition at all: nothing to report.
    assert_eq!(pod_scheduling_message(&Pod::default()), None);
}

#[test]
fn resolved_digest_reads_running_container_image_id() {
    let pod = pod_with_container_status(ContainerStatus {
        name: RUN_CONTAINER.to_string(),
        image_id: "ghcr.io/x/base@sha256:deadbeef".to_string(),
        ..Default::default()
    });
    assert_eq!(
        resolved_image_digest(&pod),
        Some("ghcr.io/x/base@sha256:deadbeef".to_string())
    );
}

#[test]
fn sandbox_pod_carries_the_active_deadline_backstop() {
    // The sandbox's keep-alive is `sleep infinity`, so without a deadline a pod
    // whose driver died by SIGKILL — and that the dispatcher's reaper never got to
    // either — runs until an operator notices, holding its requests the whole time.
    let pod = build_run_pod("tcab-run-abc", &spec("img"), &KubernetesConfig::default());
    let spec = pod.spec.expect("spec");

    assert_eq!(
        spec.active_deadline_seconds,
        Some(24 * 60 * 60),
        "the default backstop must outlast any real run, but still be finite",
    );
}

#[test]
fn sandbox_pod_active_deadline_is_configurable_and_disablable() {
    let config = KubernetesConfig {
        pod_active_deadline: Some(std::time::Duration::from_secs(3_600)),
        ..KubernetesConfig::default()
    };
    let pod = build_run_pod("tcab-run-abc", &spec("img"), &config);
    assert_eq!(pod.spec.expect("spec").active_deadline_seconds, Some(3_600));

    let disabled = KubernetesConfig {
        pod_active_deadline: None,
        ..KubernetesConfig::default()
    };
    let pod = build_run_pod("tcab-run-abc", &spec("img"), &disabled);
    assert_eq!(pod.spec.expect("spec").active_deadline_seconds, None);
}

#[test]
fn sandbox_pod_is_pinned_against_autoscaler_eviction() {
    // A sandbox holds the only copy of the run's working tree; evicting it destroys
    // the run. The autoscaler spares it today only because it is a bare pod, which is
    // a fact about cluster policy rather than about this manifest — so state it here.
    let pod = build_run_pod("tcab-run-abc", &spec("img"), &KubernetesConfig::default());
    let annotations = pod.metadata.annotations.expect("annotations");

    assert_eq!(
        annotations
            .get("cluster-autoscaler.kubernetes.io/safe-to-evict")
            .map(String::as_str),
        Some("false"),
    );
}

#[test]
fn sandbox_pod_managed_by_matches_what_the_dispatcher_reaps_on() {
    // The dispatcher's sandbox reaper selects on this literal
    // (`dispatcher::job::SANDBOX_MANAGED_BY`). The two crates do not depend on each
    // other, so each pins the shared value from its own side; changing one without
    // the other silently stops orphaned sandboxes from being cleaned up.
    let pod = build_run_pod("tcab-run-abc", &spec("img"), &KubernetesConfig::default());
    let labels = pod.metadata.labels.expect("labels");

    assert_eq!(
        labels
            .get("app.kubernetes.io/managed-by")
            .map(String::as_str),
        Some("tcab-driver"),
    );
}
