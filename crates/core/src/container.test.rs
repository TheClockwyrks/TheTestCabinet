//! Tests for container runtime helpers.

use super::*;

#[test]
fn parent_dir_returns_the_directory_of_a_nested_path() {
    assert_eq!(
        parent_dir("/home/node/.codex/auth.json"),
        Some("/home/node/.codex"),
    );
    assert_eq!(parent_dir("/home/node/.claude.json"), Some("/home/node"));
}

#[test]
fn parent_dir_is_none_for_a_root_level_file() {
    // A file directly under the filesystem root has no directory to create.
    assert_eq!(parent_dir("/auth.json"), None);
    assert_eq!(parent_dir("auth.json"), None);
}

// ── run_args ────────────────────────────────────────────────────────────────

fn spec() -> ContainerSpec {
    ContainerSpec {
        image: "tcab-run:latest".to_string(),
        repo_path: std::path::PathBuf::from("/tmp/seed"),
        secrets: std::collections::BTreeMap::new(),
        env: std::collections::BTreeMap::new(),
        files: Vec::new(),
        network_enabled: true,
        add_hosts: Vec::new(),
    }
}

/// The `--env` values in an argument vector, in order.
fn env_args(args: &[String]) -> Vec<String> {
    args.iter()
        .zip(args.iter().skip(1))
        .filter(|(flag, _)| flag.as_str() == "--env")
        .map(|(_, value)| value.clone())
        .collect()
}

#[test]
fn both_env_channels_reach_the_container() {
    // The harness process runs *inside* the container, so anything it must read
    // — its API key and its telemetry configuration alike — has to be passed as
    // a `--env` flag at start. Nothing on the host side reaches it.
    let mut spec = spec();
    spec.env.insert(
        "OTEL_EXPORTER_OTLP_ENDPOINT".to_string(),
        "http://tcab-lgtm:4318".to_string(),
    );
    spec.env.insert(
        "TRACEPARENT".to_string(),
        "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01".to_string(),
    );
    spec.secrets
        .insert("ANTHROPIC_API_KEY".to_string(), "sk-test".to_string());

    let args = run_args(&spec, None);
    assert_eq!(
        env_args(&args),
        vec![
            "OTEL_EXPORTER_OTLP_ENDPOINT=http://tcab-lgtm:4318".to_string(),
            "TRACEPARENT=00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01".to_string(),
            "ANTHROPIC_API_KEY=sk-test".to_string(),
        ],
    );
    // The image is always the final argument, after every flag.
    assert_eq!(args.last().unwrap(), "tcab-run:latest");
}

#[test]
fn a_telemetry_variable_cannot_shadow_the_api_key() {
    // Secrets are applied last precisely so this collision resolves in favour of
    // the key the harness authenticates with.
    let mut spec = spec();
    spec.env
        .insert("ANTHROPIC_API_KEY".to_string(), "bogus".to_string());
    spec.secrets
        .insert("ANTHROPIC_API_KEY".to_string(), "sk-real".to_string());

    assert_eq!(
        env_args(&run_args(&spec, None)).last().unwrap(),
        "ANTHROPIC_API_KEY=sk-real",
    );
}

#[test]
fn a_run_without_env_or_host_mappings_passes_neither() {
    let args = run_args(&spec(), None);
    assert!(env_args(&args).is_empty());
    assert!(!args.iter().any(|arg| arg == "--add-host"));
    // Network is enabled, so no isolation flag is added.
    assert!(!args.iter().any(|arg| arg == "--network"));
}

#[test]
fn a_job_driven_run_labels_its_container_with_the_job_id() {
    // The label is the only handle the driver has left on the container once it drops a
    // canceled run's future: the container is detached and not `--rm`, so the harness
    // inside it keeps running until something removes it by this label.
    let args = run_args(&spec(), Some("vud0d2ok4is2c870pqcls2h0"));
    let index = args.iter().position(|arg| arg == "--label").unwrap();
    assert_eq!(args[index + 1], "dev.tcab.job-id=vud0d2ok4is2c870pqcls2h0");
    // Flags precede the image, which stays last.
    assert_eq!(args.last().unwrap(), "tcab-run:latest");
}

#[test]
fn a_run_outside_a_job_is_labelled_with_nothing() {
    // The CLI and desktop paths hold the container handle for the whole run and stop it
    // themselves, so they have nothing to look a container up by later.
    assert!(!run_args(&spec(), None).iter().any(|arg| arg == "--label"));
}

#[test]
fn host_mappings_become_add_host_flags() {
    let mut spec = spec();
    spec.add_hosts
        .push(crate::preview::HOST_GATEWAY_ADD_HOST.to_string());
    let args = run_args(&spec, None);
    let index = args.iter().position(|arg| arg == "--add-host").unwrap();
    assert_eq!(args[index + 1], "host.docker.internal:host-gateway");
}

// ── artifact salvage ────────────────────────────────────────────────────────

#[test]
fn salvaging_copies_one_container_file_to_a_verbatim_host_path() {
    // `cp` is handled by the runtime CLI on the *host*, so the destination goes through
    // untranslated — the same rule the whole-tree collection follows. Only the source is
    // container-qualified.
    assert_eq!(
        copy_out_args(
            &ContainerHandle {
                id: "c1".to_string(),
            },
            "/work/.gg/replay.ndjson",
            "/runs/abc/replay.ndjson",
        ),
        vec![
            "cp".to_string(),
            "c1:/work/.gg/replay.ndjson".to_string(),
            "/runs/abc/replay.ndjson".to_string(),
        ],
    );
}

#[tokio::test]
async fn salvaging_reports_nothing_recovered_when_the_runtime_cannot_be_invoked() {
    // `collect_file` is the seam a `hung`/`timed_out` run's capture journal is rescued
    // through, and it runs on a path that is *already* failing a run. A runtime binary
    // that cannot even be spawned must therefore report "nothing salvaged" rather than
    // an error: a salvage attempt is never allowed to turn a diagnosable timeout into an
    // unexplained collection failure.
    let dest_dir = tempfile::tempdir().expect("scratch");
    let dest = dest_dir.path().join(".gg/replay.ndjson");
    let collector = CliArtifactCollector::new(
        CliContainerRuntime::with_binary("no-such-runtime"),
        dest_dir.path().to_path_buf(),
    );
    let salvaged = collector
        .collect_file(
            &ContainerHandle {
                id: "c1".to_string(),
            },
            "/work/.gg/replay.ndjson",
            &dest,
        )
        .await
        .expect("an unreachable runtime is not an error");
    assert!(!salvaged);
    assert!(
        !dest.exists(),
        "a failed salvage must leave no file behind for assembly to read",
    );
}

#[tokio::test]
async fn salvaging_reports_nothing_recovered_when_the_copy_produces_no_file() {
    // The runtime *runs* and exits zero, but writes nothing — the shape a `cp` of a
    // directory, or of a path the runtime silently no-ops on, would take. The collector
    // claims a salvage only when a plain file actually landed, because the caller's next
    // move is to hand that path to the assembler.
    let dest_dir = tempfile::tempdir().expect("scratch");
    let dest = dest_dir.path().join("nested/replay.ndjson");
    let collector = CliArtifactCollector::new(
        // `true` ignores its arguments and exits zero.
        CliContainerRuntime::with_binary("true"),
        dest_dir.path().to_path_buf(),
    );
    let salvaged = collector
        .collect_file(
            &ContainerHandle {
                id: "c1".to_string(),
            },
            "/work/.gg/replay.ndjson",
            &dest,
        )
        .await
        .expect("a successful-but-empty copy is not an error");
    assert!(!salvaged);
    assert!(
        dest.parent().expect("parent").is_dir(),
        "the destination's directory is prepared before the copy is attempted",
    );
}
