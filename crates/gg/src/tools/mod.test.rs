use std::sync::Arc;

use super::*;
use serde_json::json;
use tempfile::TempDir;
use test_cabinet_core::gg::{
    CAPABILITY_EDIT_FILE, CAPABILITY_LIST_DIR, CAPABILITY_READ_FILE, CAPABILITY_SEARCH,
    CAPABILITY_SHELL, CAPABILITY_SKILLS, CAPABILITY_WRITE_FILE, GgAgentConfig, GgCapabilityConfig,
    GgRosterEntry, ROOT_PROFILE_ID, SHELL_OUTPUT_OFFLOAD,
};

use crate::archive::ArchiveRuntime;
use crate::board::BoardRuntime;
use crate::memories::{MemoriesRuntime, MemoryCaps, MemoryStrategy};
use crate::model::ToolCall;
use crate::modules::ModuleHandle;
use crate::skills::{SkillLibrary, SkillsRuntime};
use crate::tasks::TasksRuntime;

/// The four per-tool filesystem capabilities — one per filesystem primitive.
const FILESYSTEM_CAPABILITIES: [&str; 5] = [
    CAPABILITY_READ_FILE,
    CAPABILITY_WRITE_FILE,
    CAPABILITY_EDIT_FILE,
    CAPABILITY_LIST_DIR,
    CAPABILITY_SEARCH,
];

/// The [capability modules](CapabilityModules) a registry is assembled against when only the skill
/// `library` is bound. An empty library still binds a module — an *enabled* skills module with
/// nothing in it, which is exactly the "there is nothing to read" case `read_skill` is gated on.
fn skills_modules(library: &Arc<SkillLibrary>) -> CapabilityModules {
    CapabilityModules::inert().with(ModuleHandle::Skills(SkillsRuntime::new(Arc::clone(
        library,
    ))))
}

/// A resolved delegation [roster](GgRosterEntry) over `ids` — the shape a caller holding the whole
/// capability set hands the registry.
///
/// Each entry's display name is deliberately unlike its id, so a surface that offers a name where
/// the model can only pass an id fails here rather than passing on a coincidence.
fn roster(ids: &[&str]) -> Vec<GgRosterEntry> {
    ids.iter()
        .map(|id| GgRosterEntry {
            agent_id: (*id).to_string(),
            name: format!("The {id} agent"),
            description: String::new(),
        })
        .collect()
}

/// An agent profile with the given capability configs and no model binding, granted **every tool
/// those capabilities offer**.
///
/// The allowlist is seeded rather than left empty because these tests are about the *capability*
/// gate: a fixture that named no tools would be withheld everything for a second reason, and every
/// assertion below would pass for the wrong one. Seeding it from [`capability_tools`] rather than by
/// hand keeps the fixture correct as tools are added — the tests that are about the allowlist itself
/// narrow this list explicitly.
fn set_with(capabilities: Vec<GgCapabilityConfig>) -> GgAgentConfig {
    granting(GgAgentConfig {
        capabilities,
        ..GgAgentConfig::root()
    })
}

/// The default Root profile, granted every tool its default capabilities offer — the shape the
/// console's editor writes when an operator switches those capabilities on.
fn root() -> GgAgentConfig {
    granting(GgAgentConfig::root())
}

/// `profile` with its [tool allowlist](GgAgentConfig::tools) set to everything its enabled
/// capabilities offer.
fn granting(profile: GgAgentConfig) -> GgAgentConfig {
    let enabled: Vec<&str> = profile
        .capabilities
        .iter()
        .filter(|capability| capability.enabled)
        .map(|capability| capability.id.as_str())
        .collect();
    let tools = capability_tools(enabled)
        .into_iter()
        .map(str::to_string)
        .collect();
    GgAgentConfig { tools, ..profile }
}

/// The four per-tool filesystem capabilities, all enabled — every filesystem primitive on.
fn filesystem_enabled() -> Vec<GgCapabilityConfig> {
    FILESYSTEM_CAPABILITIES
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
    let registry = ToolRegistry::from_capabilities(&root());

    // shell + read_file + write_file + edit_file + list_dir + search
    assert_eq!(registry.len(), 6);
    for name in [
        "shell",
        "read_file",
        "write_file",
        "edit_file",
        "list_dir",
        "search",
    ] {
        assert!(offers(&registry, name), "expected `{name}` to be offered");
    }

    let names: Vec<String> = registry
        .definitions()
        .into_iter()
        .map(|def| def.name)
        .collect();
    assert_eq!(names.len(), 6);
}

/// Disabling the shell capability withholds *only* the shell tool — the filesystem tools remain.
/// A capability is switched off one at a time, and takes only its own tools with it.
#[test]
fn registry_excludes_shell_tool_when_shell_capability_disabled() {
    let mut capabilities = vec![GgCapabilityConfig::disabled(CAPABILITY_SHELL)];
    capabilities.extend(filesystem_enabled());
    let registry = ToolRegistry::from_capabilities(&set_with(capabilities));

    assert!(!offers(&registry, "shell"));
    assert!(offers(&registry, "read_file"));
    assert!(offers(&registry, "write_file"));
    assert_eq!(registry.len(), 5);
}

/// Disabling every filesystem capability withholds all five filesystem tools while the
/// shell tool remains.
#[test]
fn registry_excludes_filesystem_tools_when_their_capabilities_are_disabled() {
    let mut capabilities = vec![GgCapabilityConfig::enabled(CAPABILITY_SHELL)];
    capabilities.extend(
        FILESYSTEM_CAPABILITIES
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
        (CAPABILITY_SEARCH, "search"),
    ] {
        let capabilities = FILESYSTEM_CAPABILITIES
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
            4,
            "`{capability}` off should leave the other four filesystem tools"
        );
    }
}

/// The read-file capability's implementation and `lineCap` param decide the
/// [`ReadPolicy`] the offered `read_file` enforces — the configuration seam behind the
/// two read modes.
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
        read_policy(&with_mode("default-cap", json!({ "lineCap": 500 }))),
        Some(ReadPolicy::DefaultCap(500))
    );
    assert_eq!(
        read_policy(&with_mode("unlimited", json!({ "lineCap": 500 }))),
        Some(ReadPolicy::Unlimited)
    );

    // A capability that is absent, or present and switched off, has no policy at all: there is no
    // `read_file` for one to govern, and gg picks no mode for a capability nobody configured.
    assert_eq!(read_policy(&set_with(Vec::new())), None);
    let mut disabled = with_mode("default-cap", json!({ "lineCap": 500 }));
    disabled.capabilities[0].enabled = false;
    assert_eq!(read_policy(&disabled), None);

    // The policy actually reaches the offered tool: a capped mode declares paging args.
    let registry =
        ToolRegistry::from_capabilities(&with_mode("default-cap", json!({ "lineCap": 250 })));
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

/// The shell capability's implementation and `maxLines`/`maxChars` params decide the
/// [`OffloadPolicy`] the offered `shell` runs under — the configuration seam behind output
/// offloading.
#[test]
fn shell_offload_comes_from_the_shell_capability() {
    let with_mode = |implementation: &str, params| {
        set_with(vec![GgCapabilityConfig {
            id: CAPABILITY_SHELL.to_string(),
            enabled: true,
            implementation: Some(implementation.to_string()),
            params,
        }])
    };

    // Every resolution here is of a capability the launch pass would accept, so the sink is one
    // that asserts nothing arrives.
    let offloaded = shell_offload(
        &with_mode(
            SHELL_OUTPUT_OFFLOAD,
            json!({ "maxLines": 120, "maxChars": 9_000 }),
        ),
        &mut crate::validate::LaunchReport::Discarding,
    );
    let limits = offloaded.limits().expect("offloading is armed");
    assert_eq!((limits.max_lines, limits.max_chars), (120, 9_000));

    // A capability that is *absent* has no bargain to keep either.
    assert_eq!(
        shell_offload(
            &set_with(Vec::new()),
            &mut crate::validate::LaunchReport::Discarding
        ),
        OffloadPolicy::Inline
    );

    // A *disabled* shell capability resolves to inline whatever it declares: offloading is a
    // bargain (you see less, and grep back the rest) that an agent without the tool cannot keep its
    // side of — and the policy also governs the commands this agent's hooks run.
    let mut disabled = with_mode(
        SHELL_OUTPUT_OFFLOAD,
        json!({ "maxLines": 120, "maxChars": 9_000 }),
    );
    disabled.capabilities[0].enabled = false;
    assert_eq!(
        shell_offload(&disabled, &mut crate::validate::LaunchReport::Discarding),
        OffloadPolicy::Inline
    );

    // The policy actually reaches the offered tool: its description offers the file pair.
    let registry = ToolRegistry::from_capabilities(&with_mode(
        SHELL_OUTPUT_OFFLOAD,
        json!({ "maxLines": 120, "maxChars": 9_000 }),
    ));
    let definition = registry
        .definitions()
        .into_iter()
        .find(|def| def.name == SHELL_TOOL)
        .expect("shell is offered");
    assert!(
        definition.description.contains("files named in the result"),
        "{}",
        definition.description
    );
}

/// A capability that is *absent* from the set (not merely disabled) also contributes
/// no tools; an empty set offers nothing.
#[test]
fn registry_is_empty_when_no_capabilities_present() {
    let registry = ToolRegistry::from_capabilities(&set_with(Vec::new()));
    assert_eq!(registry.len(), 0);
    assert!(registry.definitions().is_empty());
}

/// Dispatching an unknown tool name yields a well-formed error outcome, never a panic.
#[tokio::test]
async fn dispatch_unknown_tool_returns_error_outcome() {
    let dir = TempDir::new().unwrap();
    let registry = ToolRegistry::from_capabilities(&root());
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
    let mut capabilities = vec![GgCapabilityConfig::disabled(CAPABILITY_SHELL)];
    capabilities.extend(filesystem_enabled());
    let registry = ToolRegistry::from_capabilities(&set_with(capabilities));
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
    let registry = ToolRegistry::from_capabilities(&root());
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
    let library = Arc::new(SkillLibrary::loaded(dir.path()));
    let empty = Arc::new(SkillLibrary::empty());

    // Enabled capability + a non-empty library => read_skill is offered.
    let on = set_with(vec![GgCapabilityConfig::enabled(CAPABILITY_SKILLS)]);
    assert!(offers(
        &ToolRegistry::from_run(&on, &skills_modules(&library), &AgentFacts::default()),
        "read_skill"
    ));

    // Enabled capability but an empty library => nothing to read, so no tool.
    assert!(!offers(
        &ToolRegistry::from_run(&on, &skills_modules(&empty), &AgentFacts::default()),
        "read_skill"
    ));

    // Disabled capability => no tool even with a populated library (the capability-off arm).
    let off = set_with(vec![GgCapabilityConfig::disabled(CAPABILITY_SKILLS)]);
    assert!(!offers(
        &ToolRegistry::from_run(&off, &skills_modules(&library), &AgentFacts::default()),
        "read_skill"
    ));
}

/// The memory tools are offered only when the memories capability is enabled **and** a
/// memory store is bound — capability off, or no store bound, offers none.
#[test]
fn registry_gates_memory_tools_on_capability_and_a_bound_store() {
    use test_cabinet_core::gg::CAPABILITY_MEMORIES;

    let modules = || {
        CapabilityModules::inert().with(ModuleHandle::Memories(MemoriesRuntime::new(
            MemoryStrategy::Scratchpad,
            MemoryCaps::UNBOUNDED,
        )))
    };
    let names = ["write_memory", "update_memory", "delete_memory"];

    // Enabled capability + an enabled memories module => all three memory tools are offered.
    let on = set_with(vec![GgCapabilityConfig::enabled(CAPABILITY_MEMORIES)]);
    let registry = ToolRegistry::from_run(&on, &modules(), &AgentFacts::default());
    for name in names {
        assert!(offers(&registry, name), "expected `{name}` offered");
    }

    // Enabled capability but a disabled module => no memory tools (the bare convenience path).
    let none = ToolRegistry::from_run(&on, &CapabilityModules::inert(), &AgentFacts::default());
    for name in names {
        assert!(
            !offers(&none, name),
            "expected `{name}` withheld with no store"
        );
    }

    // Disabled capability => no memory tools even with a bound store (the capability-off arm).
    let off = set_with(vec![GgCapabilityConfig::disabled(CAPABILITY_MEMORIES)]);
    let registry = ToolRegistry::from_run(&off, &modules(), &AgentFacts::default());
    for name in names {
        assert!(
            !offers(&registry, name),
            "expected `{name}` withheld when off"
        );
    }
}

/// A **read-only** memory holder is offered the read calls and nothing else.
///
/// The gate is at the registry, on the module's access rather than on a list of tool names, which
/// is what makes the restriction total in one move: the responses-as-code scope is derived from the
/// registry, and so is the prompt's API section, so a read-only agent is never *shown* a write call
/// it would then have to be refused for using.
#[test]
fn registry_offers_a_read_only_holder_the_read_calls_alone() {
    use test_cabinet_core::gg::{CAPABILITY_MEMORIES, GgMemoryScope};

    use crate::memories::MemoryAccess;

    let read_only = |strategy| {
        CapabilityModules::inert().with(ModuleHandle::Memories(
            MemoriesRuntime::new(strategy, MemoryCaps::UNBOUNDED)
                .with_binding(GgMemoryScope::ReadOnly, MemoryAccess::ReadOnly),
        ))
    };
    let on = set_with(vec![GgCapabilityConfig::enabled(CAPABILITY_MEMORIES)]);

    // Markdown: `read_memory` survives; nothing that writes does.
    let registry = ToolRegistry::from_run(
        &on,
        &read_only(MemoryStrategy::Markdown),
        &AgentFacts::default(),
    );
    assert!(offers(&registry, "read_memory"));
    for name in ["create_memory", "edit_memory", "delete_memory"] {
        assert!(!offers(&registry, name), "expected `{name}` withheld");
    }

    // Keyword search additionally keeps its retrieval call, which is how it finds anything at all.
    let registry = ToolRegistry::from_run(
        &on,
        &read_only(MemoryStrategy::KeywordSearch),
        &AgentFacts::default(),
    );
    assert!(offers(&registry, "search_memories"));
    assert!(offers(&registry, "read_memory"));
    assert!(!offers(&registry, "delete_memory"));

    // The scratchpad has no read call — its memories *are* the pinned block — so a read-only holder
    // of one gets no memory tools at all, and reads them by having them in its window.
    let registry = ToolRegistry::from_run(
        &on,
        &read_only(MemoryStrategy::Scratchpad),
        &AgentFacts::default(),
    );
    for name in [
        "write_memory",
        "update_memory",
        "delete_memory",
        "read_memory",
    ] {
        assert!(!offers(&registry, name), "expected `{name}` withheld");
    }
}

/// The task tools are offered only when the tasks capability is enabled **and** a task
/// store is bound — capability off, or no store bound, offers none.
#[test]
fn registry_gates_task_tools_on_capability_and_a_bound_store() {
    use test_cabinet_core::gg::CAPABILITY_TASKS;

    let modules = || CapabilityModules::inert().with(ModuleHandle::Tasks(TasksRuntime::new(100)));
    let names = [
        "add_task",
        "update_task",
        "set_blocked_by",
        "complete_task",
        "remove_task",
    ];

    // Enabled capability + a bound store => all five task tools are offered.
    let on = set_with(vec![GgCapabilityConfig::enabled(CAPABILITY_TASKS)]);
    let registry = ToolRegistry::from_run(&on, &modules(), &AgentFacts::default());
    for name in names {
        assert!(offers(&registry, name), "expected `{name}` offered");
    }

    // Enabled capability but a disabled module => no task tools (the bare convenience path).
    let none = ToolRegistry::from_run(&on, &CapabilityModules::inert(), &AgentFacts::default());
    for name in names {
        assert!(
            !offers(&none, name),
            "expected `{name}` withheld with no store"
        );
    }

    // Disabled capability => no task tools even with a bound store (the capability-off arm).
    let off = set_with(vec![GgCapabilityConfig::disabled(CAPABILITY_TASKS)]);
    let registry = ToolRegistry::from_run(&off, &modules(), &AgentFacts::default());
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
    use crate::board::BoardCaps;
    use test_cabinet_core::gg::CAPABILITY_PROJECT_MANAGEMENT;

    let modules = || {
        CapabilityModules::inert().with(ModuleHandle::Board(BoardRuntime::new(
            BoardCaps::detached(),
        )))
    };
    let names = [
        "create_epic",
        "create_issue",
        "update_issue",
        "set_issue_blocked_by",
        "remove_epic",
        "remove_issue",
    ];

    // Enabled capability + a bound store => all six board tools are offered.
    let on = set_with(vec![GgCapabilityConfig::enabled(
        CAPABILITY_PROJECT_MANAGEMENT,
    )]);
    let registry = ToolRegistry::from_run(&on, &modules(), &AgentFacts::default());
    for name in names {
        assert!(offers(&registry, name), "expected `{name}` offered");
    }

    // Enabled capability but a disabled module => no board tools.
    let none = ToolRegistry::from_run(&on, &CapabilityModules::inert(), &AgentFacts::default());
    for name in names {
        assert!(
            !offers(&none, name),
            "expected `{name}` withheld with no store"
        );
    }

    // Disabled capability => no board tools even with a bound store (the capability-off arm).
    let off = set_with(vec![GgCapabilityConfig::disabled(
        CAPABILITY_PROJECT_MANAGEMENT,
    )]);
    let registry = ToolRegistry::from_run(&off, &modules(), &AgentFacts::default());
    for name in names {
        assert!(
            !offers(&registry, name),
            "expected `{name}` withheld when off"
        );
    }
}

/// **An agent dispatched to implement an issue earns no board tool from the assignment.**
///
/// It hands its work back by *finishing* — the issue is completed when its implementer completes,
/// under that agent's own completion rule — so there is nothing for the assignment to unlock.
/// Authoring the board and working an issue on it are different jobs, and an implementer profile is
/// normally configured without `project-management`; a run that gave it board tools anyway would be
/// handing an implementer the vocabulary to file work instead of doing it.
#[test]
fn an_assigned_issue_earns_no_board_tools_without_the_board_capability() {
    use crate::board::BoardCaps;

    // A profile with no board capability at all — the ordinary shape of an implementer.
    let implementer = set_with(Vec::new());

    let dispatched = ToolRegistry::from_run(
        &implementer,
        &CapabilityModules::inert().with(ModuleHandle::Board(BoardRuntime::new(
            BoardCaps::detached(),
        ))),
        &AgentFacts::default(),
    );
    for name in [
        "create_epic",
        "create_issue",
        "update_issue",
        "set_issue_blocked_by",
        "remove_epic",
        "remove_issue",
        "wait_for_issue",
    ] {
        assert!(
            !offers(&dispatched, name),
            "an implementer without the board capability is offered no `{name}`"
        );
    }
    assert!(
        !ALL_TOOL_NAMES.contains(&"complete_issue"),
        "there is no completion tool to offer at all"
    );
}

/// An allowlist that omits one of a capability's tools offers the rest of that capability — the
/// finest-grained lever there is, one notch below switching the whole capability off.
#[test]
fn an_allowlist_that_omits_one_tool_offers_the_rest() {
    // Every filesystem capability on, and every tool granted except `edit_file`.
    let mut capabilities = vec![GgCapabilityConfig::enabled(CAPABILITY_SHELL)];
    capabilities.extend(filesystem_enabled());
    let mut set = set_with(capabilities);
    set.tools.retain(|name| name != "edit_file");
    let registry = ToolRegistry::from_capabilities(&set);

    assert!(
        !offers(&registry, "edit_file"),
        "the tool the allowlist does not name is withheld"
    );
    // Its capability stays on, so the rest of the filesystem tools (and shell) remain.
    for name in ["shell", "read_file", "write_file", "list_dir", "search"] {
        assert!(
            offers(&registry, name),
            "expected `{name}` to remain offered"
        );
    }
    // It is absent from the recorded effective toolset too.
    assert!(!registry.tool_names().contains(&"edit_file".to_string()));
    assert_eq!(registry.len(), 5);
}

/// A tool the allowlist does not name is genuinely undispatchable — a model that calls it anyway
/// gets the unknown-tool error, exactly as if its capability were off (no schema, not dispatchable).
#[tokio::test]
async fn dispatch_of_an_ungranted_tool_returns_error_outcome() {
    let dir = TempDir::new().unwrap();
    let mut set = root();
    set.tools.retain(|name| name != "edit_file");
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

/// An empty allowlist grants nothing, however many capabilities are on: the list *is* the grant,
/// and there is no configuration that means "everything".
#[test]
fn an_empty_allowlist_grants_nothing() {
    let registry = ToolRegistry::from_capabilities(&GgAgentConfig {
        tools: Vec::new(),
        ..GgAgentConfig::root()
    });
    assert_eq!(
        registry.len(),
        0,
        "the default capabilities are on, and no tool is named"
    );
}

/// **The default profile grants exactly what its default capabilities offer**, on both surfaces.
///
/// [`GgAgentConfig::root`] authors its two allowlists as literals, because the vocabularies belong
/// to this crate and the contract belongs to `core`. That is the right split and it is the kind of
/// split that rots: a tool added to an existing capability, or an operation renamed, leaves the
/// default profile a call short and nothing about it reads as wrong — a narrower allowlist is a
/// legitimate configuration, so there is no shape to notice. This is the only thing that notices.
///
/// Held to **equality** rather than containment in both directions at once. A default profile
/// missing a call is an agent quietly weaker than the capabilities it declares; one naming a call
/// its capabilities do not offer is an entry that grants nothing and that the launch reports as an
/// error on every run that starts from the default.
#[test]
fn the_default_profile_grants_what_its_capabilities_offer() {
    let profile = GgAgentConfig::root();
    let enabled: Vec<&str> = profile
        .capabilities
        .iter()
        .filter(|capability| capability.enabled)
        .map(|capability| capability.id.as_str())
        .collect();

    assert_eq!(
        profile.tools,
        capability_tools(enabled.iter().copied())
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>(),
        "the default profile's tool allowlist is not what its capabilities offer"
    );
    assert_eq!(
        profile.operations,
        crate::sandbox::capability_operations(enabled)
            .into_iter()
            .map(|id| id.to_string())
            .collect::<Vec<_>>(),
        "the default profile's operation allowlist is not what its capabilities offer"
    );
}

/// `tool_names` reports the effective toolset in registration order, after **both** capability
/// gating and the allowlist — the exact list recorded on the session summary.
#[test]
fn tool_names_reports_the_effective_toolset() {
    // The default set is shell + filesystem.
    let mut set = root();
    set.tools.retain(|name| name != "write_file");
    let registry = ToolRegistry::from_capabilities(&set);
    assert_eq!(
        registry.tool_names(),
        vec![
            "shell".to_string(),
            "read_file".to_string(),
            "edit_file".to_string(),
            "list_dir".to_string(),
            "search".to_string(),
        ]
    );
}

/// `ungranted_tools` flags only names no gg tool bears (a typo, a removed tool, or an operation id
/// from the other surface's vocabulary), not a real tool that this run's capabilities simply do not
/// offer — that grants nothing but is not a mistake, since one configuration document describes
/// agents whose capabilities differ.
#[test]
fn ungranted_tools_flags_only_names_no_tool_bears() {
    let mut set = set_with(Vec::new());
    set.tools = vec![
        "edit_file".to_string(), // a real tool (not offered here, but valid) — not flagged
        "fork".to_string(),      // a real tool — not flagged
        "edti_file".to_string(), // a typo — flagged
        "frobnicate".to_string(), // not a tool at all — flagged
        "files.edit_file".to_string(), // the other surface's spelling — flagged
    ];
    assert_eq!(
        ungranted_tools(&set),
        vec![
            "edti_file".to_string(),
            "frobnicate".to_string(),
            "files.edit_file".to_string()
        ]
    );
}

/// A [position](crate::fsm::FsmPosition) in a two-state machine whose entry state has somewhere to
/// go — the one fact that makes the transition call offerable, and therefore what a *maximal*
/// toolset needs beyond a maximal capability set.
fn fsm_position() -> crate::fsm::FsmPosition {
    use test_cabinet_core::gg::{CAPABILITY_FSM, FSM_PARAM_STATES};
    let shell = GgAgentConfig {
        capabilities: vec![GgCapabilityConfig {
            params: serde_json::json!({ FSM_PARAM_STATES: [
                { "name": "build", "agentId": "builder", "transitions": [{ "to": "verify" }] },
                { "name": "verify", "agentId": "verifier" },
            ] }),
            ..GgCapabilityConfig::enabled(CAPABILITY_FSM)
        }],
        ..GgAgentConfig::root()
    };
    let spec = Arc::new(
        crate::fsm::FsmSpec::resolve(&shell)
            .expect("the shell declares a machine")
            .expect("it parses"),
    );
    spec.entry_position()
}

/// The transition call is offered from where an instance **stands in a machine**, not from any
/// capability on its own profile: an agent with no position is never offered it, and one in a state
/// with somewhere to go is — with that state's targets, and no others, named in its description.
#[test]
fn the_transition_tool_is_offered_from_the_machine_position() {
    let profile = set_with(vec![GgCapabilityConfig::enabled(CAPABILITY_SHELL)]);
    assert!(
        !ToolRegistry::from_capabilities(&profile).offers(TRANSITION_STATE_TOOL),
        "an agent outside a machine is never offered a transition"
    );

    let position = fsm_position();
    let registry = ToolRegistry::from_run(
        &profile,
        &CapabilityModules::inert(),
        &AgentFacts {
            fsm: Some(&position),
            ..AgentFacts::default()
        },
    );
    let definition = registry
        .definitions()
        .into_iter()
        .find(|definition| definition.name == TRANSITION_STATE_TOOL)
        .expect("a state with an outgoing edge is offered the transition");
    assert!(
        definition.description.contains("`verify`"),
        "the description names the states it may move to: {}",
        definition.description
    );
    assert!(
        definition.description.contains("build"),
        "and the state it is standing in: {}",
        definition.description
    );
}

/// A **terminal** state is offered no transition at all. A tool whose every call would be refused
/// costs a schema in every request the state makes and teaches the model a move it does not have.
#[test]
fn a_terminal_state_is_offered_no_transition_tool() {
    let profile = set_with(vec![GgCapabilityConfig::enabled(CAPABILITY_SHELL)]);
    let entry = fsm_position();
    let terminal = entry.moved_to(
        entry
            .transition_to("verify")
            .expect("the entry state may reach `verify`"),
    );
    assert!(
        terminal.outgoing().is_empty(),
        "`verify` is the machine's terminal state"
    );
    assert!(
        !ToolRegistry::from_run(
            &profile,
            &CapabilityModules::inert(),
            &AgentFacts {
                fsm: Some(&terminal),
                ..AgentFacts::default()
            },
        )
        .offers(TRANSITION_STATE_TOOL),
        "a terminal state is offered nothing to transition with"
    );
}

/// The [`exec`](test_cabinet_core::gg::CAPABILITY_EXEC) and
/// [`fork`](test_cabinet_core::gg::CAPABILITY_FORK) calls are offered on **different**
/// conditions, and each is withheld when the thing that would make it usable is missing.
///
/// `exec` needs a roster (there has to be something to become) and is withheld inside a machine,
/// where the next move is `transition_state`'s. `fork` needs the `subagents` capability, which is
/// what offers the two calls that collect a copy — a copy nobody can wait on or message is a leak
/// rather than a second worker. Neither is offered without the capability at all.
///
/// The roster arrives on the [facts](AgentFacts::spawnable) already resolved to profile ids, so
/// each case says outright what this agent may become rather than leaving it to be read off a
/// profile.
#[test]
fn the_agent_transition_tools_are_offered_on_their_own_terms() {
    use test_cabinet_core::gg::{CAPABILITY_EXEC, CAPABILITY_FORK, CAPABILITY_SUBAGENTS};

    let offered = |set: &GgAgentConfig,
                   spawnable: &[GgRosterEntry],
                   position: Option<&crate::fsm::FsmPosition>| {
        let registry = ToolRegistry::from_run(
            set,
            &CapabilityModules::inert(),
            &AgentFacts {
                fsm: position,
                spawnable,
                ..AgentFacts::default()
            },
        );
        (registry.offers(EXEC_TOOL), registry.offers(FORK_TOOL))
    };
    let somebody = roster(&[ROOT_PROFILE_ID]);
    let nobody: &[GgRosterEntry] = &[];

    // Both capabilities off: neither call, whatever else is on.
    let off = set_with(vec![GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS)]);
    assert_eq!(offered(&off, &somebody, None), (false, false));

    // Both on, but nothing to become and nothing to collect a copy with.
    let bare = set_with(vec![
        GgCapabilityConfig::enabled(CAPABILITY_EXEC),
        GgCapabilityConfig::enabled(CAPABILITY_FORK),
    ]);
    assert_eq!(offered(&bare, nobody, None), (false, false));

    // A roster alone buys `exec`; the delegation capability alone buys `fork`.
    assert_eq!(offered(&bare, &somebody, None), (true, false));

    let mut with_delegation = bare.clone();
    crate::tools::grant(&mut with_delegation, CAPABILITY_SUBAGENTS);
    assert_eq!(offered(&with_delegation, nobody, None), (false, true));

    // **The two are independent capabilities, not one capability with two halves.** Enabling either
    // alone, with everything each needs beside it, offers that call and not the other — which is
    // the arm the split exists to make expressible.
    let exec_only = set_with(vec![
        GgCapabilityConfig::enabled(CAPABILITY_EXEC),
        GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS),
    ]);
    assert_eq!(offered(&exec_only, &somebody, None), (true, false));

    let fork_only = set_with(vec![
        GgCapabilityConfig::enabled(CAPABILITY_FORK),
        GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS),
    ]);
    assert_eq!(offered(&fork_only, &somebody, None), (false, true));

    // **And an agent whose only child can be a copy of itself is given the calls that collect
    // one.** The roster is what `spawn_subagent` needs, not what `fork` needs, so gating waiting
    // and messaging on it left the one profile that can fork and cannot spawn — every
    // "everything on" single-agent preset — holding a `fork` whose result it could never reach.
    let registry = ToolRegistry::from_run(
        &with_delegation,
        &CapabilityModules::inert(),
        &AgentFacts::default(),
    );
    assert!(
        !registry.offers(SPAWN_SUBAGENT_TOOL),
        "there is still nobody on the roster to spawn"
    );
    assert!(
        registry.offers(WAIT_FOR_SUBAGENTS_TOOL) && registry.offers(SEND_MESSAGE_TOOL),
        "but the copy it can make is waitable and messageable"
    );

    // Both, and then the same profile standing in a machine: the copy is still a copy, but where
    // the run goes next has stopped being this agent's decision.
    assert_eq!(offered(&with_delegation, &somebody, None), (true, true));
    let position = fsm_position();
    assert_eq!(
        offered(&with_delegation, &somebody, Some(&position)),
        (false, true)
    );
}

/// **Every registry a maximal run can produce**: every capability enabled, every store bound, a
/// non-empty skill library — one per memory strategy, and one on each side of the machine-position
/// split.
///
/// Both partitions are why this is a set of registries rather than one. A run picks a single memory
/// strategy and each offers a different family; and `transition_state` and `exec` are deliberately
/// **mutually exclusive**, because a state's next move belongs to its machine. So no single registry
/// can offer every tool gg has, and "every tool gg has" is the union over these.
///
/// The [`TempDir`] is handed back with them: the skill library reads from it, so dropping it here
/// would leave every registry holding a library over a directory that no longer exists.
fn maximal_registries() -> (TempDir, Vec<ToolRegistry>) {
    use crate::board::BoardCaps;
    use crate::memories::{MemoryCaps, MemoryStrategy};
    use test_cabinet_core::gg::{
        CAPABILITY_AGENT_MANAGED_CONTEXT, CAPABILITY_COMPACTION, CAPABILITY_MEMORIES,
        CAPABILITY_PROJECT_MANAGEMENT, CAPABILITY_SUBAGENTS, CAPABILITY_TASKS,
        COMPACTION_STRATEGY_SELF_COMPACTION,
    };

    let dir = TempDir::new().unwrap();
    std::fs::write(
        dir.path().join("s.md"),
        "---\nname: s\ndescription: d.\n---\nbody",
    )
    .unwrap();
    let library = Arc::new(SkillLibrary::loaded(dir.path()));

    let mut capabilities = vec![GgCapabilityConfig::enabled(CAPABILITY_SHELL)];
    capabilities.extend(filesystem_enabled());
    capabilities.extend([
        GgCapabilityConfig::enabled(CAPABILITY_SKILLS),
        GgCapabilityConfig::enabled(CAPABILITY_MEMORIES),
        GgCapabilityConfig::enabled(CAPABILITY_TASKS),
        GgCapabilityConfig::enabled(CAPABILITY_PROJECT_MANAGEMENT),
        GgCapabilityConfig::enabled(CAPABILITY_AGENT_MANAGED_CONTEXT),
        GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS),
        GgCapabilityConfig::enabled(CAPABILITY_EXEC),
        GgCapabilityConfig::enabled(CAPABILITY_FORK),
    ]);
    // `compact` is the one tool a *strategy* rather than a capability alone contributes: compaction
    // offers it only when the working model is the one that performs the compaction.
    capabilities.push(GgCapabilityConfig {
        id: CAPABILITY_COMPACTION.to_string(),
        enabled: true,
        implementation: Some(COMPACTION_STRATEGY_SELF_COMPACTION.to_string()),
        params: serde_json::json!({}),
    });
    let set = set_with(capabilities);
    // A maximal registry offers the delegation tools too, which requires at least one agent this
    // profile may spawn — and `create_issue` names the profiles it may put to work by id, so the
    // implementer and reviewer halves of the roster are resolved here as well.
    let roster = roster(&[ROOT_PROFILE_ID]);
    let position = fsm_position();
    let registries = [
        MemoryStrategy::Scratchpad,
        MemoryStrategy::Markdown,
        MemoryStrategy::KeywordSearch,
    ]
    .into_iter()
    .flat_map(|strategy| {
        let set = &set;
        let library = &library;
        let roster = &roster;
        [Some(&position), None].into_iter().map(move |fsm| {
            ToolRegistry::from_run(
                set,
                &skills_modules(library)
                    .with(ModuleHandle::Memories(MemoriesRuntime::new(
                        strategy,
                        MemoryCaps::UNBOUNDED,
                    )))
                    .with(ModuleHandle::Tasks(TasksRuntime::new(100)))
                    .with(ModuleHandle::Board(
                        BoardRuntime::new(BoardCaps::detached()),
                    ))
                    .with(ModuleHandle::Archive(ArchiveRuntime::new())),
                &AgentFacts {
                    fsm,
                    spawnable: roster,
                    implementers: roster,
                    reviewers: roster,
                },
            )
        })
    })
    .collect();
    (dir, registries)
}

/// The canonical [`ALL_TOOL_NAMES`] vocabulary stays in lockstep with what the registry can offer:
/// a [maximal capability set](maximal_registries) offers exactly the names in `ALL_TOOL_NAMES`.
/// This guards the per-tool-override vocabulary against drift when a tool is added or renamed.
#[test]
fn all_tool_names_matches_a_maximal_registry() {
    use std::collections::BTreeSet;

    let (_dir, registries) = maximal_registries();
    let offered: BTreeSet<String> = registries
        .iter()
        .flat_map(|registry| registry.tool_names())
        .collect();

    let canonical: BTreeSet<String> = ALL_TOOL_NAMES.iter().map(|s| s.to_string()).collect();
    assert_eq!(
        offered, canonical,
        "ALL_TOOL_NAMES must list exactly the tools a maximal registry offers"
    );
}

/// **Every tool a run offers declares itself well enough to be called**, in the one document a
/// tool-calling model reads it through.
///
/// gg's system prompt deliberately [names no tools](crate::prompts): on that arm the toolset *is*
/// the declaration, so everything a model knows about `write_file` before calling it — that it
/// exists, what it is for, what each argument means, which are required — is in this
/// [`ToolDefinition`] and nowhere else. A tool whose description is empty, or whose arguments are
/// declared without saying what they are, is a tool the model can see and cannot use, and the
/// failure shows up as the model reaching for it and getting an argument error it cannot diagnose.
///
/// Asserted on the declaration's **shape** rather than its wording: that each part is present and
/// internally consistent, never that it says any particular thing. Rewriting a description is an
/// editing pass and must stay one.
#[test]
fn every_offered_tool_declares_itself_to_the_model() {
    let (_dir, registries) = maximal_registries();
    for registry in &registries {
        for definition in registry.definitions() {
            let name = &definition.name;
            assert!(
                !definition.description.trim().is_empty(),
                "`{name}` is offered with no description, so nothing tells the model what it is"
            );
            let parameters = definition
                .parameters
                .as_object()
                .unwrap_or_else(|| panic!("`{name}` must declare a JSON-Schema object"));
            assert_eq!(
                parameters.get("type").and_then(|value| value.as_str()),
                Some("object"),
                "`{name}`'s parameters must be an object schema: a model builds its call as one"
            );
            let properties = parameters
                .get("properties")
                .and_then(|value| value.as_object())
                .unwrap_or_else(|| panic!("`{name}` must declare its properties"));
            for (argument, schema) in properties {
                let description = schema
                    .get("description")
                    .and_then(|value| value.as_str())
                    .unwrap_or_default();
                assert!(
                    !description.trim().is_empty(),
                    "`{name}`'s `{argument}` is declared with nothing that says what it is"
                );
            }
            // A required argument the schema never declares is one the model is told to send and
            // given no way to write: it has neither a type nor a description to build a value from.
            for required in parameters
                .get("required")
                .and_then(|value| value.as_array())
                .map(Vec::as_slice)
                .unwrap_or_default()
            {
                let required = required.as_str().expect("a required name is a string");
                assert!(
                    properties.contains_key(required),
                    "`{name}` requires `{required}` and never declares it"
                );
            }
        }
    }
}

/// Each strategy offers its own memory tools and **only** its own: a model is never shown two ways
/// to write the same memory, and never a tool for a shape its store is not in.
#[test]
fn each_memory_strategy_offers_its_own_tools() {
    use std::collections::BTreeSet;

    use crate::memories::{MemoryCaps, MemoryStrategy};
    use test_cabinet_core::gg::CAPABILITY_MEMORIES;

    let on = set_with(vec![GgCapabilityConfig::enabled(CAPABILITY_MEMORIES)]);

    for (strategy, expected) in [
        (
            MemoryStrategy::Scratchpad,
            vec!["write_memory", "update_memory", "delete_memory"],
        ),
        (
            MemoryStrategy::Markdown,
            vec![
                "create_memory",
                "read_memory",
                "edit_memory",
                "delete_memory",
            ],
        ),
        (
            MemoryStrategy::KeywordSearch,
            vec![
                "create_memory",
                "read_memory",
                "edit_memory",
                "delete_memory",
                "search_memories",
            ],
        ),
    ] {
        let registry = ToolRegistry::from_run(
            &on,
            &CapabilityModules::inert().with(ModuleHandle::Memories(MemoriesRuntime::new(
                strategy,
                MemoryCaps::UNBOUNDED,
            ))),
            &AgentFacts::default(),
        );
        let offered: BTreeSet<String> = registry
            .tool_names()
            .into_iter()
            .filter(|name| name.contains("memor"))
            .collect();
        assert_eq!(
            offered,
            expected
                .into_iter()
                .map(str::to_string)
                .collect::<BTreeSet<String>>(),
            "{strategy:?} offers exactly its own memory tools"
        );
    }
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
        ToolOutcome::ok("wrote 5 bytes", "wrote 5 bytes").with_data(ApiData::BytesWritten(5));

    assert_eq!(with_data.output, bare.output);
    assert_eq!(with_data.summary, bare.summary);
    assert_eq!(with_data.data, Some(ApiData::BytesWritten(5)));
}

// ---------------------------------------------------------------------------
// The serde contract the session recorder depends on
// ---------------------------------------------------------------------------

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
    let outcome = ToolOutcome::ok("a\nb/", "2 entries").with_data(ApiData::DirEntries(vec![
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
