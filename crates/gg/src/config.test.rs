use super::*;
use test_cabinet_core::gg::PRIMARY_SLOT;

/// A fully-specified invocation file deserializes into the expected fields and its
/// capability set round-trips.
#[test]
fn deserializes_a_full_invocation_file() {
    let json = r#"{
        "sessionId": "run-abc123",
        "workspaceDir": "/workspace",
        "prompt": "Build the game described in specs/README.md.",
        "capabilitySet": {
            "preset": "minimal",
            "capabilities": [
                { "id": "shell", "enabled": true },
                { "id": "filesystem", "enabled": true }
            ],
            "slots": [
                { "slot": "primary", "modelId": "anthropic/claude-opus-4-8" }
            ]
        }
    }"#;

    let invocation: GgInvocation = serde_json::from_str(json).expect("valid invocation");

    assert_eq!(invocation.session_id, "run-abc123");
    assert_eq!(invocation.workspace_dir, PathBuf::from("/workspace"));
    assert!(invocation.prompt.contains("Build the game"));
    assert_eq!(invocation.capability_set.preset.as_deref(), Some("minimal"));
    assert_eq!(
        invocation.capability_set.model_for_slot(PRIMARY_SLOT),
        Some("anthropic/claude-opus-4-8")
    );
    assert!(invocation.capability_set.is_enabled("shell"));
    assert!(invocation.capability_set.is_enabled("filesystem"));
}

/// The capability set is optional in the file; when omitted it defaults to the
/// Phase 0 set (present but with no slot bound, so it parses yet cannot launch).
#[test]
fn defaults_the_capability_set_when_omitted() {
    let json = r#"{
        "sessionId": "run-xyz",
        "workspaceDir": "/workspace",
        "prompt": "hi"
    }"#;

    let invocation: GgInvocation = serde_json::from_str(json).expect("valid invocation");

    assert_eq!(invocation.capability_set, GgCapabilitySet::default());
    assert_eq!(invocation.capability_set.model_for_slot(PRIMARY_SLOT), None);
}

/// `load` reads and parses a file from disk, attaching a diagnosable error for a
/// missing path.
#[test]
fn load_reads_and_parses_from_disk() {
    let dir = std::env::temp_dir().join(format!("gg-config-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("create temp dir");
    let path = dir.join("invocation.json");
    std::fs::write(
        &path,
        r#"{ "sessionId": "s", "workspaceDir": "/w", "prompt": "p" }"#,
    )
    .expect("write config");

    let invocation = GgInvocation::load(&path).expect("load succeeds");
    assert_eq!(invocation.session_id, "s");

    let missing = dir.join("does-not-exist.json");
    let err = GgInvocation::load(&missing).expect_err("missing file errors");
    assert!(err.to_string().contains("reading gg invocation file"));

    let _ = std::fs::remove_dir_all(&dir);
}
