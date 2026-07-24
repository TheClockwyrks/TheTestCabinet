use super::*;
use serde_json::json;
use tempfile::TempDir;
use test_cabinet_core::gg::{
    CAPABILITY_FILESYSTEM, CAPABILITY_SHELL, GgCapabilityConfig, GgCapabilitySet,
};

use crate::model::ToolCall;

/// A capability set with the given capability configs and no slot binding.
fn set_with(capabilities: Vec<GgCapabilityConfig>) -> GgCapabilitySet {
    GgCapabilitySet {
        preset: None,
        capabilities,
        slots: Vec::new(),
    }
}

/// Whether the registry offers a tool with the given name (via its definitions).
fn offers(registry: &ToolRegistry, name: &str) -> bool {
    registry.definitions().iter().any(|def| def.name == name)
}

/// The default Phase 0 set (shell + filesystem enabled) offers the full toolset.
#[test]
fn registry_offers_all_phase0_tools_when_both_capabilities_enabled() {
    let registry = ToolRegistry::from_capabilities(&GgCapabilitySet::default());

    // shell + read_file + write_file + edit_file + list_dir
    assert_eq!(registry.len(), 5);
    assert!(!registry.is_empty());
    for name in ["shell", "read_file", "write_file", "edit_file", "list_dir"] {
        assert!(offers(&registry, name), "expected `{name}` to be offered");
    }

    let names: Vec<String> = registry
        .definitions()
        .into_iter()
        .map(|def| def.name)
        .collect();
    assert_eq!(names.len(), 5);
}

/// Disabling the shell capability withholds *only* the shell tool — the filesystem
/// tools remain. This is the concrete toolset-ablation behavior.
#[test]
fn registry_excludes_shell_tool_when_shell_capability_disabled() {
    let registry = ToolRegistry::from_capabilities(&set_with(vec![
        GgCapabilityConfig::disabled(CAPABILITY_SHELL),
        GgCapabilityConfig::enabled(CAPABILITY_FILESYSTEM),
    ]));

    assert!(!offers(&registry, "shell"));
    assert!(offers(&registry, "read_file"));
    assert!(offers(&registry, "write_file"));
    assert_eq!(registry.len(), 4);
}

/// Disabling the filesystem capability withholds all four filesystem tools while the
/// shell tool remains.
#[test]
fn registry_excludes_filesystem_tools_when_filesystem_capability_disabled() {
    let registry = ToolRegistry::from_capabilities(&set_with(vec![
        GgCapabilityConfig::enabled(CAPABILITY_SHELL),
        GgCapabilityConfig::disabled(CAPABILITY_FILESYSTEM),
    ]));

    assert!(offers(&registry, "shell"));
    for name in ["read_file", "write_file", "edit_file", "list_dir"] {
        assert!(!offers(&registry, name), "expected `{name}` to be withheld");
    }
    assert_eq!(registry.len(), 1);
}

/// A capability that is *absent* from the set (not merely disabled) also contributes
/// no tools; an empty set offers nothing.
#[test]
fn registry_is_empty_when_no_capabilities_present() {
    let registry = ToolRegistry::from_capabilities(&set_with(Vec::new()));
    assert!(registry.is_empty());
    assert_eq!(registry.len(), 0);
    assert!(registry.definitions().is_empty());
}

/// Dispatching an unknown tool name yields a well-formed error outcome, never a panic.
#[tokio::test]
async fn dispatch_unknown_tool_returns_error_outcome() {
    let dir = TempDir::new().unwrap();
    let registry = ToolRegistry::from_capabilities(&GgCapabilitySet::default());
    let ctx = ToolContext::new(dir.path());

    let call = ToolCall {
        id: "call_1".to_string(),
        name: "does_not_exist".to_string(),
        arguments: json!({}),
    };
    let outcome = registry.dispatch(&call, &ctx).await;

    assert!(!outcome.ok);
    assert!(outcome.output.contains("unknown tool"));
    assert!(outcome.output.contains("does_not_exist"));
}

/// A capability that is disabled means its tool is not merely un-listed but genuinely
/// undispatchable — the model calling it gets the unknown-tool error.
#[tokio::test]
async fn dispatch_withheld_tool_returns_error_outcome() {
    let dir = TempDir::new().unwrap();
    let registry = ToolRegistry::from_capabilities(&set_with(vec![
        GgCapabilityConfig::disabled(CAPABILITY_SHELL),
        GgCapabilityConfig::enabled(CAPABILITY_FILESYSTEM),
    ]));
    let ctx = ToolContext::new(dir.path());

    let call = ToolCall {
        id: "call_1".to_string(),
        name: "shell".to_string(),
        arguments: json!({ "command": "echo hi" }),
    };
    let outcome = registry.dispatch(&call, &ctx).await;

    assert!(!outcome.ok);
    assert!(outcome.output.contains("unknown tool"));
}

/// Dispatch routes to the named tool and returns its real outcome.
#[tokio::test]
async fn dispatch_routes_to_the_named_tool() {
    let dir = TempDir::new().unwrap();
    let registry = ToolRegistry::from_capabilities(&GgCapabilitySet::default());
    let ctx = ToolContext::new(dir.path());

    let call = ToolCall {
        id: "call_1".to_string(),
        name: "write_file".to_string(),
        arguments: json!({ "path": "hello.txt", "contents": "hi" }),
    };
    let outcome = registry.dispatch(&call, &ctx).await;

    assert!(outcome.ok);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("hello.txt")).unwrap(),
        "hi"
    );
}

/// `ToolOutcome` constructors set `ok` and populate the summary as documented.
#[test]
fn tool_outcome_constructors() {
    let ok = ToolOutcome::ok("body", "did it");
    assert!(ok.ok);
    assert_eq!(ok.output, "body");
    assert_eq!(ok.summary.as_deref(), Some("did it"));

    let err = ToolOutcome::error("boom");
    assert!(!err.ok);
    assert_eq!(err.output, "boom");
    assert_eq!(err.summary.as_deref(), Some("boom"));
}
