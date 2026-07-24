use std::sync::Arc;

use super::*;
use serde_json::json;
use tempfile::TempDir;
use test_cabinet_core::gg::{
    CAPABILITY_FILESYSTEM, CAPABILITY_SHELL, CAPABILITY_SKILLS, GgCapabilityConfig, GgCapabilitySet,
};

use crate::model::ToolCall;
use crate::skills::SkillLibrary;

/// A capability set with the given capability configs and no slot binding.
fn set_with(capabilities: Vec<GgCapabilityConfig>) -> GgCapabilitySet {
    GgCapabilitySet {
        preset: None,
        capabilities,
        slots: Vec::new(),
        disabled_tools: Vec::new(),
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

/// The `read_skill` tool is offered only when the skills capability is enabled **and**
/// the bound library actually holds skills — capability off, or an empty library, offers
/// nothing.
#[test]
fn registry_gates_read_skill_on_capability_and_a_non_empty_library() {
    let dir = TempDir::new().unwrap();
    std::fs::write(
        dir.path().join("intro.md"),
        "---\nname: intro\ndescription: d.\n---\nbody",
    )
    .unwrap();
    let library = Arc::new(SkillLibrary::load(dir.path()));
    let empty = Arc::new(SkillLibrary::empty());

    // Enabled capability + a non-empty library => read_skill is offered.
    let on = set_with(vec![GgCapabilityConfig::enabled(CAPABILITY_SKILLS)]);
    assert!(offers(
        &ToolRegistry::from_run(&on, &RuntimeSet::new(&library)),
        "read_skill"
    ));

    // Enabled capability but an empty library => nothing to read, so no tool.
    assert!(!offers(
        &ToolRegistry::from_run(&on, &RuntimeSet::new(&empty)),
        "read_skill"
    ));

    // Disabled capability => no tool even with a populated library (the ablation off arm).
    let off = set_with(vec![GgCapabilityConfig::disabled(CAPABILITY_SKILLS)]);
    assert!(!offers(
        &ToolRegistry::from_run(&off, &RuntimeSet::new(&library)),
        "read_skill"
    ));
}

/// The memory tools are offered only when the memories capability is enabled **and** a
/// memory store is bound — capability off, or no store bound, offers none.
#[test]
fn registry_gates_memory_tools_on_capability_and_a_bound_store() {
    use std::sync::Mutex;

    use crate::memories::{MemoryCaps, MemoryStore};
    use test_cabinet_core::gg::CAPABILITY_MEMORIES;

    let empty = Arc::new(SkillLibrary::empty());
    let store = Arc::new(Mutex::new(MemoryStore::new(MemoryCaps::default())));
    let names = ["write_memory", "update_memory", "delete_memory"];

    // Enabled capability + a bound store => all three memory tools are offered.
    let on = set_with(vec![GgCapabilityConfig::enabled(CAPABILITY_MEMORIES)]);
    let registry = ToolRegistry::from_run(&on, &RuntimeSet::new(&empty).with_memories(&store));
    for name in names {
        assert!(offers(&registry, name), "expected `{name}` offered");
    }

    // Enabled capability but no store bound => no memory tools (the bare convenience path).
    let none = ToolRegistry::from_run(&on, &RuntimeSet::new(&empty));
    for name in names {
        assert!(
            !offers(&none, name),
            "expected `{name}` withheld with no store"
        );
    }

    // Disabled capability => no memory tools even with a bound store (the ablation off arm).
    let off = set_with(vec![GgCapabilityConfig::disabled(CAPABILITY_MEMORIES)]);
    let registry = ToolRegistry::from_run(&off, &RuntimeSet::new(&empty).with_memories(&store));
    for name in names {
        assert!(
            !offers(&registry, name),
            "expected `{name}` withheld when off"
        );
    }
}

/// The task tools are offered only when the tasks capability is enabled **and** a task
/// store is bound — capability off, or no store bound, offers none.
#[test]
fn registry_gates_task_tools_on_capability_and_a_bound_store() {
    use std::sync::Mutex;

    use crate::tasks::TaskStore;
    use test_cabinet_core::gg::CAPABILITY_TASKS;

    let empty = Arc::new(SkillLibrary::empty());
    let store = Arc::new(Mutex::new(TaskStore::new(100)));
    let names = [
        "add_task",
        "update_task",
        "set_blocked_by",
        "complete_task",
        "remove_task",
    ];

    // Enabled capability + a bound store => all five task tools are offered.
    let on = set_with(vec![GgCapabilityConfig::enabled(CAPABILITY_TASKS)]);
    let registry = ToolRegistry::from_run(&on, &RuntimeSet::new(&empty).with_tasks(&store));
    for name in names {
        assert!(offers(&registry, name), "expected `{name}` offered");
    }

    // Enabled capability but no store bound => no task tools (the bare convenience path).
    let none = ToolRegistry::from_run(&on, &RuntimeSet::new(&empty));
    for name in names {
        assert!(
            !offers(&none, name),
            "expected `{name}` withheld with no store"
        );
    }

    // Disabled capability => no task tools even with a bound store (the ablation off arm).
    let off = set_with(vec![GgCapabilityConfig::disabled(CAPABILITY_TASKS)]);
    let registry = ToolRegistry::from_run(&off, &RuntimeSet::new(&empty).with_tasks(&store));
    for name in names {
        assert!(
            !offers(&registry, name),
            "expected `{name}` withheld when off"
        );
    }
}

/// The board tools are offered only when the epics-and-issues capability is enabled **and** a
/// board store is bound — capability off, or no store bound, offers none.
#[test]
fn registry_gates_board_tools_on_capability_and_a_bound_store() {
    use std::sync::Mutex;

    use crate::board::{BoardCaps, BoardStore};
    use test_cabinet_core::gg::CAPABILITY_EPICS_ISSUES;

    let empty = Arc::new(SkillLibrary::empty());
    let store = Arc::new(Mutex::new(BoardStore::new(BoardCaps::default())));
    let names = [
        "create_epic",
        "create_issue",
        "update_issue",
        "set_issue_blocked_by",
        "complete_issue",
        "remove_epic",
        "remove_issue",
    ];

    // Enabled capability + a bound store => all seven board tools are offered.
    let on = set_with(vec![GgCapabilityConfig::enabled(CAPABILITY_EPICS_ISSUES)]);
    let registry = ToolRegistry::from_run(&on, &RuntimeSet::new(&empty).with_board(&store));
    for name in names {
        assert!(offers(&registry, name), "expected `{name}` offered");
    }

    // Enabled capability but no store bound => no board tools.
    let none = ToolRegistry::from_run(&on, &RuntimeSet::new(&empty));
    for name in names {
        assert!(
            !offers(&none, name),
            "expected `{name}` withheld with no store"
        );
    }

    // Disabled capability => no board tools even with a bound store (the ablation off arm).
    let off = set_with(vec![GgCapabilityConfig::disabled(CAPABILITY_EPICS_ISSUES)]);
    let registry = ToolRegistry::from_run(&off, &RuntimeSet::new(&empty).with_board(&store));
    for name in names {
        assert!(
            !offers(&registry, name),
            "expected `{name}` withheld when off"
        );
    }
}

/// The planning tools are gated purely on the capability (they are stateless, like
/// shell/filesystem — they need no bound store).
#[test]
fn registry_gates_planning_tools_on_capability() {
    use test_cabinet_core::gg::CAPABILITY_PLANNING;

    let empty = Arc::new(SkillLibrary::empty());
    let names = ["enter_plan_mode", "submit_plan"];

    // Enabled => both planning tools offered (no store needed).
    let on = set_with(vec![GgCapabilityConfig::enabled(CAPABILITY_PLANNING)]);
    let registry = ToolRegistry::from_run(&on, &RuntimeSet::new(&empty));
    for name in names {
        assert!(offers(&registry, name), "expected `{name}` offered");
    }

    // Disabled => neither offered (the ablation off arm).
    let off = set_with(vec![GgCapabilityConfig::disabled(CAPABILITY_PLANNING)]);
    let registry = ToolRegistry::from_run(&off, &RuntimeSet::new(&empty));
    for name in names {
        assert!(
            !offers(&registry, name),
            "expected `{name}` withheld when off"
        );
    }

    // Absent => neither offered.
    let none = ToolRegistry::from_run(&set_with(Vec::new()), &RuntimeSet::new(&empty));
    for name in names {
        assert!(
            !offers(&none, name),
            "expected `{name}` withheld when the capability is absent"
        );
    }
}

/// `is_read_only_tool` admits exactly the four non-mutating tools, and `plan_mode_offers`
/// restricts the offered set to those (plus `submit_plan`) in plan mode while withholding only
/// `submit_plan` outside it.
#[test]
fn plan_mode_offers_restricts_to_read_only_tools() {
    // The read-only allowlist.
    for name in ["read_file", "list_dir", "read_skill", "search_archive"] {
        assert!(is_read_only_tool(name), "`{name}` is read-only");
    }
    for name in [
        "write_file",
        "edit_file",
        "shell",
        "add_task",
        "create_issue",
    ] {
        assert!(!is_read_only_tool(name), "`{name}` mutates");
    }

    // In plan mode: read-only tools + submit_plan are offered; everything mutating (and a second
    // enter_plan_mode) is withheld.
    assert!(plan_mode_offers("read_file", true));
    assert!(plan_mode_offers(SUBMIT_PLAN_TOOL, true));
    assert!(!plan_mode_offers("write_file", true));
    assert!(!plan_mode_offers("shell", true));
    assert!(!plan_mode_offers(ENTER_PLAN_MODE_TOOL, true));

    // Outside plan mode: everything is offered except submit_plan (no plan pass in progress).
    assert!(plan_mode_offers("write_file", false));
    assert!(plan_mode_offers(ENTER_PLAN_MODE_TOOL, false));
    assert!(!plan_mode_offers(SUBMIT_PLAN_TOOL, false));
}

/// A per-tool override withholds exactly the named tool while its capability stays on: the rest of
/// the capability's tools remain offered. This is the finest-grained toolset-ablation lever — one
/// notch below toggling a whole capability (the `apply-patch` vs `write-file` study).
#[test]
fn per_tool_override_withholds_only_the_named_tool() {
    // Filesystem on, but `edit_file` individually disabled.
    let mut set = set_with(vec![
        GgCapabilityConfig::enabled(CAPABILITY_SHELL),
        GgCapabilityConfig::enabled(CAPABILITY_FILESYSTEM),
    ]);
    set.disabled_tools = vec!["edit_file".to_string()];
    let registry = ToolRegistry::from_capabilities(&set);

    assert!(
        !offers(&registry, "edit_file"),
        "the individually disabled tool is withheld"
    );
    // Its capability stays on, so the rest of the filesystem tools (and shell) remain.
    for name in ["shell", "read_file", "write_file", "list_dir"] {
        assert!(
            offers(&registry, name),
            "expected `{name}` to remain offered"
        );
    }
    // It is absent from the recorded effective toolset too.
    assert!(!registry.tool_names().contains(&"edit_file".to_string()));
    assert_eq!(registry.len(), 4);
}

/// A per-tool-disabled tool is genuinely undispatchable — a model that calls it anyway gets the
/// unknown-tool error, exactly as if its capability were off (no schema, not dispatchable).
#[tokio::test]
async fn dispatch_per_tool_disabled_tool_returns_error_outcome() {
    let dir = TempDir::new().unwrap();
    let set = GgCapabilitySet {
        disabled_tools: vec!["edit_file".to_string()],
        ..GgCapabilitySet::default()
    };
    let registry = ToolRegistry::from_capabilities(&set);
    let ctx = ToolContext::new(dir.path());

    let call = ToolCall {
        id: "call_1".to_string(),
        name: "edit_file".to_string(),
        arguments: json!({ "path": "a.txt", "old": "x", "new": "y" }),
    };
    let outcome = registry.dispatch(&call, &ctx).await;
    assert!(!outcome.ok);
    assert!(outcome.output.contains("unknown tool"));
}

/// `tool_names` reports the effective toolset in registration order, after **both** capability
/// gating and per-tool overrides — the exact list recorded on the session summary.
#[test]
fn tool_names_reports_the_effective_toolset() {
    // The default set is shell + filesystem.
    let set = GgCapabilitySet {
        disabled_tools: vec!["write_file".to_string()],
        ..GgCapabilitySet::default()
    };
    let registry = ToolRegistry::from_capabilities(&set);
    assert_eq!(
        registry.tool_names(),
        vec![
            "shell".to_string(),
            "read_file".to_string(),
            "edit_file".to_string(),
            "list_dir".to_string(),
        ]
    );
}

/// `unknown_disabled_tools` flags only names no gg tool bears (a typo or removed tool), not a real
/// tool that this run's capabilities simply do not offer — that withholds nothing but is not a
/// mistake (a sweep may name a tool only some arms offer).
#[test]
fn unknown_disabled_tools_flags_only_typos() {
    let mut set = set_with(Vec::new());
    set.disabled_tools = vec![
        "edit_file".to_string(), // a real tool (not offered here, but valid) — not flagged
        "speculate".to_string(), // a real tool — not flagged
        "edti_file".to_string(), // a typo — flagged
        "frobnicate".to_string(), // not a tool at all — flagged
    ];
    assert_eq!(
        unknown_disabled_tools(&set),
        vec!["edti_file".to_string(), "frobnicate".to_string()]
    );
}

/// The canonical [`ALL_TOOL_NAMES`] vocabulary stays in lockstep with what the registry can offer:
/// a maximal capability set (every capability enabled, every store bound, a non-empty skill
/// library) offers exactly the names in `ALL_TOOL_NAMES`. This guards the per-tool-override
/// vocabulary against drift when a tool is added or renamed.
#[test]
fn all_tool_names_matches_a_maximal_registry() {
    use std::collections::BTreeSet;
    use std::sync::Mutex;

    use crate::archive::ArchiveStore;
    use crate::board::{BoardCaps, BoardStore};
    use crate::memories::{MemoryCaps, MemoryStore};
    use crate::tasks::TaskStore;
    use test_cabinet_core::gg::{
        CAPABILITY_AGENT_MANAGED_CONTEXT, CAPABILITY_EPICS_ISSUES, CAPABILITY_FSM,
        CAPABILITY_MEMORIES, CAPABILITY_PLANNING, CAPABILITY_SPECULATIVE, CAPABILITY_SUBAGENTS,
        CAPABILITY_TASKS, CAPABILITY_WORKFLOWS,
    };

    let dir = TempDir::new().unwrap();
    std::fs::write(
        dir.path().join("s.md"),
        "---\nname: s\ndescription: d.\n---\nbody",
    )
    .unwrap();
    let library = Arc::new(SkillLibrary::load(dir.path()));
    let memories = Arc::new(Mutex::new(MemoryStore::new(MemoryCaps::default())));
    let tasks = Arc::new(Mutex::new(TaskStore::new(100)));
    let board = Arc::new(Mutex::new(BoardStore::new(BoardCaps::default())));
    let archive = Arc::new(Mutex::new(ArchiveStore::new()));

    let set = set_with(vec![
        GgCapabilityConfig::enabled(CAPABILITY_SHELL),
        GgCapabilityConfig::enabled(CAPABILITY_FILESYSTEM),
        GgCapabilityConfig::enabled(CAPABILITY_SKILLS),
        GgCapabilityConfig::enabled(CAPABILITY_MEMORIES),
        GgCapabilityConfig::enabled(CAPABILITY_TASKS),
        GgCapabilityConfig::enabled(CAPABILITY_EPICS_ISSUES),
        GgCapabilityConfig::enabled(CAPABILITY_AGENT_MANAGED_CONTEXT),
        GgCapabilityConfig::enabled(CAPABILITY_PLANNING),
        GgCapabilityConfig::enabled(CAPABILITY_FSM),
        GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS),
        GgCapabilityConfig::enabled(CAPABILITY_WORKFLOWS),
        GgCapabilityConfig::enabled(CAPABILITY_SPECULATIVE),
    ]);
    let registry = ToolRegistry::from_run(
        &set,
        &RuntimeSet::new(&library)
            .with_memories(&memories)
            .with_tasks(&tasks)
            .with_board(&board)
            .with_archive(&archive),
    );

    let offered: BTreeSet<String> = registry.tool_names().into_iter().collect();
    let canonical: BTreeSet<String> = ALL_TOOL_NAMES.iter().map(|s| s.to_string()).collect();
    assert_eq!(
        offered, canonical,
        "ALL_TOOL_NAMES must list exactly the tools a maximal registry offers"
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
