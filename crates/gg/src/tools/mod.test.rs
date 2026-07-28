use std::sync::Arc;

use super::*;
use serde_json::json;
use tempfile::TempDir;
use test_cabinet_core::gg::{
    CAPABILITY_EDIT_FILE, CAPABILITY_FILESYSTEM, CAPABILITY_LIST_DIR, CAPABILITY_READ_FILE,
    CAPABILITY_SHELL, CAPABILITY_SKILLS, CAPABILITY_WRITE_FILE, FILESYSTEM_TOOL_CAPABILITIES,
    GgAgentConfig, GgCapabilityConfig,
};

use crate::model::ToolCall;
use crate::skills::SkillLibrary;

/// An agent profile with the given capability configs and no model binding.
fn set_with(capabilities: Vec<GgCapabilityConfig>) -> GgAgentConfig {
    GgAgentConfig {
        capabilities,
        ..GgAgentConfig::root()
    }
}

/// The four per-tool filesystem capabilities, all enabled — the modern spelling of what
/// used to be one `filesystem` capability.
fn filesystem_enabled() -> Vec<GgCapabilityConfig> {
    FILESYSTEM_TOOL_CAPABILITIES
        .iter()
        .map(|id| GgCapabilityConfig::enabled(*id))
        .collect()
}

/// Whether the registry offers a tool with the given name (via its definitions).
fn offers(registry: &ToolRegistry, name: &str) -> bool {
    registry.definitions().iter().any(|def| def.name == name)
}

/// The default Phase 0 set (shell + filesystem enabled) offers the full toolset.
#[test]
fn registry_offers_all_phase0_tools_when_both_capabilities_enabled() {
    let registry = ToolRegistry::from_capabilities(&GgAgentConfig::root());

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
    let mut capabilities = vec![GgCapabilityConfig::disabled(CAPABILITY_SHELL)];
    capabilities.extend(filesystem_enabled());
    let registry = ToolRegistry::from_capabilities(&set_with(capabilities));

    assert!(!offers(&registry, "shell"));
    assert!(offers(&registry, "read_file"));
    assert!(offers(&registry, "write_file"));
    assert_eq!(registry.len(), 4);
}

/// Disabling every filesystem capability withholds all four filesystem tools while the
/// shell tool remains.
#[test]
fn registry_excludes_filesystem_tools_when_their_capabilities_are_disabled() {
    let mut capabilities = vec![GgCapabilityConfig::enabled(CAPABILITY_SHELL)];
    capabilities.extend(
        FILESYSTEM_TOOL_CAPABILITIES
            .iter()
            .map(|id| GgCapabilityConfig::disabled(*id)),
    );
    let registry = ToolRegistry::from_capabilities(&set_with(capabilities));

    assert!(offers(&registry, "shell"));
    for name in ["read_file", "write_file", "edit_file", "list_dir"] {
        assert!(!offers(&registry, name), "expected `{name}` to be withheld");
    }
    assert_eq!(registry.len(), 1);
}

/// Each filesystem primitive is its own capability, so turning one off leaves the other
/// three offered — the coarse lever now cuts per tool, not per bundle.
#[test]
fn registry_gates_each_filesystem_tool_on_its_own_capability() {
    for (capability, withheld) in [
        (CAPABILITY_READ_FILE, "read_file"),
        (CAPABILITY_WRITE_FILE, "write_file"),
        (CAPABILITY_EDIT_FILE, "edit_file"),
        (CAPABILITY_LIST_DIR, "list_dir"),
    ] {
        let capabilities = FILESYSTEM_TOOL_CAPABILITIES
            .iter()
            .map(|id| {
                if *id == capability {
                    GgCapabilityConfig::disabled(*id)
                } else {
                    GgCapabilityConfig::enabled(*id)
                }
            })
            .collect();
        let registry = ToolRegistry::from_capabilities(&set_with(capabilities));

        assert!(
            !offers(&registry, withheld),
            "`{capability}` off should withhold `{withheld}`"
        );
        assert_eq!(
            registry.len(),
            3,
            "`{capability}` off should leave the other three filesystem tools"
        );
    }
}

/// A capability set saved before the filesystem split names only the umbrella id. It stays
/// launchable: all four tools are offered, and `read_file` reads whole files, exactly as it
/// did when that set was written.
#[test]
fn registry_honors_the_legacy_filesystem_capability() {
    let set = set_with(vec![GgCapabilityConfig::enabled(CAPABILITY_FILESYSTEM)]);
    let registry = ToolRegistry::from_capabilities(&set);

    for name in ["read_file", "write_file", "edit_file", "list_dir"] {
        assert!(offers(&registry, name), "expected `{name}` to be offered");
    }
    assert_eq!(read_policy(&set), ReadPolicy::Unlimited);

    // And a legacy set that turned the umbrella *off* still offers nothing.
    let off = set_with(vec![GgCapabilityConfig::disabled(CAPABILITY_FILESYSTEM)]);
    assert!(ToolRegistry::from_capabilities(&off).is_empty());
}

/// An explicit per-tool capability wins over the legacy umbrella beside it, so an ablation
/// arm that deliberately withholds one tool is not overridden by a stale `filesystem` row.
#[test]
fn an_explicit_filesystem_tool_capability_overrides_the_legacy_umbrella() {
    let registry = ToolRegistry::from_capabilities(&set_with(vec![
        GgCapabilityConfig::enabled(CAPABILITY_FILESYSTEM),
        GgCapabilityConfig::disabled(CAPABILITY_EDIT_FILE),
    ]));

    assert!(!offers(&registry, "edit_file"));
    assert!(offers(&registry, "read_file"));
    assert_eq!(registry.len(), 3);
}

/// The read-file capability's implementation and `lineCap` param decide the
/// [`ReadPolicy`] the offered `read_file` enforces — the configuration seam behind the
/// three read modes.
#[test]
fn read_policy_comes_from_the_read_file_capability() {
    let with_mode = |implementation: &str, params| {
        set_with(vec![GgCapabilityConfig {
            id: CAPABILITY_READ_FILE.to_string(),
            enabled: true,
            implementation: Some(implementation.to_string()),
            params,
        }])
    };

    assert_eq!(
        read_policy(&with_mode("hard-cap", json!({ "lineCap": 250 }))),
        ReadPolicy::HardCap(250)
    );
    assert_eq!(
        read_policy(&with_mode("default-cap", json!({ "lineCap": 500 }))),
        ReadPolicy::DefaultCap(500)
    );
    assert_eq!(
        read_policy(&with_mode("unlimited", json!({}))),
        ReadPolicy::Unlimited
    );
    // An unconfigured capability keeps the historical whole-file read.
    assert_eq!(
        read_policy(&set_with(vec![GgCapabilityConfig::enabled(
            CAPABILITY_READ_FILE
        )])),
        ReadPolicy::Unlimited
    );

    // The policy actually reaches the offered tool: a capped mode declares paging args.
    let registry =
        ToolRegistry::from_capabilities(&with_mode("hard-cap", json!({ "lineCap": 250 })));
    let definition = registry
        .definitions()
        .into_iter()
        .find(|def| def.name == "read_file")
        .expect("read_file is offered");
    assert!(
        definition.parameters["properties"]
            .as_object()
            .unwrap()
            .contains_key("offset")
    );
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
    let registry = ToolRegistry::from_capabilities(&GgAgentConfig::root());
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
    // Classified as the tool being unavailable rather than the call being malformed: the arguments
    // were never the problem, and a caller told this can stop asking for the tool.
    assert_eq!(outcome.failure, Some(ToolFailure::Unavailable));
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
    assert_eq!(outcome.failure, Some(ToolFailure::Unavailable));
}

/// Dispatch routes to the named tool and returns its real outcome.
#[tokio::test]
async fn dispatch_routes_to_the_named_tool() {
    let dir = TempDir::new().unwrap();
    let registry = ToolRegistry::from_capabilities(&GgAgentConfig::root());
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

/// The board tools are offered only when the project-management capability is enabled **and** a
/// board store is bound — capability off, or no store bound, offers none.
#[test]
fn registry_gates_board_tools_on_capability_and_a_bound_store() {
    use std::sync::Mutex;

    use crate::board::{BoardCaps, BoardStore};
    use test_cabinet_core::gg::CAPABILITY_PROJECT_MANAGEMENT;

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
    let on = set_with(vec![GgCapabilityConfig::enabled(
        CAPABILITY_PROJECT_MANAGEMENT,
    )]);
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
    let off = set_with(vec![GgCapabilityConfig::disabled(
        CAPABILITY_PROJECT_MANAGEMENT,
    )]);
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
    // Every filesystem capability on, but `edit_file` individually disabled.
    let mut capabilities = vec![GgCapabilityConfig::enabled(CAPABILITY_SHELL)];
    capabilities.extend(filesystem_enabled());
    let mut set = set_with(capabilities);
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
    let set = GgAgentConfig {
        disabled_tools: vec!["edit_file".to_string()],
        ..GgAgentConfig::root()
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
    let set = GgAgentConfig {
        disabled_tools: vec!["write_file".to_string()],
        ..GgAgentConfig::root()
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
        CAPABILITY_AGENT_MANAGED_CONTEXT, CAPABILITY_COMPACTION, CAPABILITY_FSM,
        CAPABILITY_MEMORIES, CAPABILITY_PLANNING, CAPABILITY_PROJECT_MANAGEMENT,
        CAPABILITY_SPECULATIVE, CAPABILITY_SUBAGENTS, CAPABILITY_TASKS, CAPABILITY_WORKFLOWS,
        COMPACTION_STRATEGY_SELF_COMPACTION, GgSubagentRef, ROOT_AGENT,
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

    let mut capabilities = vec![GgCapabilityConfig::enabled(CAPABILITY_SHELL)];
    capabilities.extend(filesystem_enabled());
    capabilities.extend([
        GgCapabilityConfig::enabled(CAPABILITY_SKILLS),
        GgCapabilityConfig::enabled(CAPABILITY_MEMORIES),
        GgCapabilityConfig::enabled(CAPABILITY_TASKS),
        GgCapabilityConfig::enabled(CAPABILITY_PROJECT_MANAGEMENT),
        GgCapabilityConfig::enabled(CAPABILITY_AGENT_MANAGED_CONTEXT),
        GgCapabilityConfig::enabled(CAPABILITY_PLANNING),
        GgCapabilityConfig::enabled(CAPABILITY_FSM),
        GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS),
        GgCapabilityConfig::enabled(CAPABILITY_WORKFLOWS),
        GgCapabilityConfig::enabled(CAPABILITY_SPECULATIVE),
    ]);
    // `compact` is the one tool a *strategy* rather than a capability alone contributes: compaction
    // offers it only when the working model is the one that performs the compaction.
    capabilities.push(GgCapabilityConfig {
        id: CAPABILITY_COMPACTION.to_string(),
        enabled: true,
        implementation: Some(COMPACTION_STRATEGY_SELF_COMPACTION.to_string()),
        params: serde_json::json!({}),
    });
    let mut set = set_with(capabilities);
    // A maximal registry offers the delegation tools too, which requires at least one agent this
    // profile may spawn.
    set.subagents.push(GgSubagentRef {
        agent: ROOT_AGENT.to_string(),
        description: String::new(),
    });
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
    assert_eq!(ok.data, None);
    assert_eq!(ok.failure, None);

    let err = ToolOutcome::error("boom");
    assert!(!err.ok);
    assert_eq!(err.output, "boom");
    assert_eq!(err.summary.as_deref(), Some("boom"));
    assert_eq!(err.failure, None, "`error` is the unclassified spelling");
}

/// A classified failure says the same thing to the model as an unclassified one — the class is
/// additional information for a caller that branches on it, never a substitute for the guidance.
#[test]
fn a_classified_failure_reads_exactly_like_an_unclassified_one() {
    let classified = ToolOutcome::failed(ToolFailure::Conflict, "boom");
    let plain = ToolOutcome::error("boom");

    assert_eq!(classified.ok, plain.ok);
    assert_eq!(classified.output, plain.output);
    assert_eq!(classified.summary, plain.summary);
    assert_eq!(classified.failure, Some(ToolFailure::Conflict));
}

/// The sidecar rides along without disturbing anything else on the outcome.
#[test]
fn attaching_data_leaves_the_model_facing_text_alone() {
    let bare = ToolOutcome::ok("wrote 5 bytes", "wrote 5 bytes");
    let with_data =
        ToolOutcome::ok("wrote 5 bytes", "wrote 5 bytes").with_data(ToolData::BytesWritten(5));

    assert_eq!(with_data.output, bare.output);
    assert_eq!(with_data.summary, bare.summary);
    assert_eq!(with_data.data, Some(ToolData::BytesWritten(5)));
}

/// The turn-level partition names exactly the three transitions, and every one of them is a real
/// gg tool — so a consumer that subtracts this list from [`ALL_TOOL_NAMES`] is left with tools
/// that all exist.
#[test]
fn turn_level_tools_are_the_three_transitions() {
    assert_eq!(
        TURN_LEVEL_TOOLS,
        ["enter_plan_mode", "submit_plan", "advance_state"]
    );
    for name in TURN_LEVEL_TOOLS {
        assert!(
            ALL_TOOL_NAMES.contains(name),
            "`{name}` must be a real tool"
        );
    }
    // The partition is exactly the planning and FSM tools — the two capabilities whose tools
    // change the loop's mode rather than producing a value.
    for name in ALL_TOOL_NAMES {
        assert_eq!(
            TURN_LEVEL_TOOLS.contains(name),
            is_planning_tool(name) || is_fsm_tool(name),
            "`{name}` is misclassified"
        );
    }
}

// ---------------------------------------------------------------------------
// The serde contract the replay recorder depends on
// ---------------------------------------------------------------------------

/// An outcome recorded **before** the sidecar existed still deserializes.
///
/// The replay recorder captures a dispatch's outcome verbatim and a replay driver feeds it back,
/// so a record written by an older gg has to keep loading. Both new fields are `#[serde(default)]`
/// for exactly this reason, and this is the test that would fail if one stopped being.
#[test]
fn an_outcome_recorded_before_the_sidecar_still_deserializes() {
    let recorded = json!({
        "ok": true,
        "output": "a\nb/\nc",
        "summary": "3 entries"
    });

    let outcome: ToolOutcome = serde_json::from_value(recorded).expect("an older record loads");

    assert!(outcome.ok);
    assert_eq!(outcome.output, "a\nb/\nc");
    assert_eq!(outcome.summary.as_deref(), Some("3 entries"));
    assert!(outcome.images.is_empty());
    assert_eq!(outcome.data, None, "an older record simply has no sidecar");
    assert_eq!(outcome.failure, None);
}

/// An outcome with nothing structured to say serializes to exactly what it always did, so a
/// recorded session does not grow a field per call for tools that gained nothing.
#[test]
fn an_outcome_without_a_sidecar_serializes_unchanged() {
    let value = serde_json::to_value(ToolOutcome::ok("body", "did it")).unwrap();
    assert_eq!(
        value,
        json!({ "ok": true, "output": "body", "summary": "did it" })
    );
}

/// A full outcome round trips, sidecar and classification included — the other half of the replay
/// contract, since a driver has to hand back exactly what dispatch produced.
#[test]
fn an_outcome_with_a_sidecar_round_trips() {
    let outcome = ToolOutcome::ok("a\nb/", "2 entries").with_data(ToolData::DirEntries(vec![
        DirEntryData {
            name: "a".to_string(),
            kind: DirEntryKind::File,
        },
        DirEntryData {
            name: "b".to_string(),
            kind: DirEntryKind::Directory,
        },
    ]));
    let json = serde_json::to_string(&outcome).unwrap();
    assert_eq!(
        serde_json::from_str::<ToolOutcome>(&json).unwrap(),
        outcome,
        "a recorded outcome replays as itself"
    );

    let failed = ToolOutcome::failed(ToolFailure::LimitExceeded, "out of budget");
    let json = serde_json::to_string(&failed).unwrap();
    assert_eq!(serde_json::from_str::<ToolOutcome>(&json).unwrap(), failed);
    assert!(
        json.contains("\"failure\":\"limit-exceeded\""),
        "the class is recorded in its wire spelling: {json}"
    );
}
