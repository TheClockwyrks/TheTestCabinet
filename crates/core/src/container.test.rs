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

    let args = run_args(&spec);
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
        env_args(&run_args(&spec)).last().unwrap(),
        "ANTHROPIC_API_KEY=sk-real",
    );
}

#[test]
fn a_run_without_env_or_host_mappings_passes_neither() {
    let args = run_args(&spec());
    assert!(env_args(&args).is_empty());
    assert!(!args.iter().any(|arg| arg == "--add-host"));
    // Network is enabled, so no isolation flag is added.
    assert!(!args.iter().any(|arg| arg == "--network"));
}

#[test]
fn host_mappings_become_add_host_flags() {
    let mut spec = spec();
    spec.add_hosts
        .push(crate::preview::HOST_GATEWAY_ADD_HOST.to_string());
    let args = run_args(&spec);
    let index = args.iter().position(|arg| arg == "--add-host").unwrap();
    assert_eq!(args[index + 1], "host.docker.internal:host-gateway");
}
