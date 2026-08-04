//! **What each agent instance is offered**, driven offline through the real loop — the
//! [surface](GgTelemetryKind::AgentSurface) half of the pair whose other half
//! `agent.modules.test.rs` covers.
//!
//! The question these exist to keep answerable is the one a console reader asks of a run that went
//! wrong: *was the model never given that call, or was it given it and never made it?* Nothing else
//! in the record separates those — a `ToolCall` reports only what was called — so what has to be
//! true is that every instance reports its **resolved** offered set, after capability gating and
//! after the per-tool ablation, and reports it whether or not it ever used any of it.
//!
//! The gating itself is proven by the toolset tests; what only these can reach is that the resolved
//! set is really emitted, really emitted per instance rather than once for the root, and really
//! carries the ending calls the loop appends outside the registry.

use std::sync::Arc;

use tempfile::TempDir;

use super::*;
use crate::client::MockClient;
use crate::telemetry::{CollectingSink, Emitter};
use test_cabinet_core::gg::{GgAgentApi, GgCapabilitySet, GgTelemetryEvent, ROOT_AGENT};

use super::{ScriptedFactory, invocation, subagent_set};

/// One instance's reported surface, keyed by the agent that emitted it.
type Surface = (String, String, Vec<String>, Vec<GgAgentApi>, Vec<String>);

/// Every `AgentSurface` in the stream, as
/// `(emitting agent, execution mode, tools, apis, withheld)`.
fn surfaces(events: &[GgTelemetryEvent]) -> Vec<Surface> {
    events
        .iter()
        .filter_map(|event| match &event.kind {
            GgTelemetryKind::AgentSurface {
                execution_mode,
                tools,
                apis,
                withheld,
            } => Some((
                event.agent_id.clone().unwrap_or_default(),
                execution_mode.clone(),
                tools.clone(),
                apis.clone(),
                withheld.clone(),
            )),
            _ => None,
        })
        .collect()
}

/// The functions bound on `object` in `apis`, as `(name, gating tool)`.
fn functions_on(apis: &[GgAgentApi], object: &str) -> Vec<(String, Option<String>)> {
    apis.iter()
        .find(|api| api.object == object)
        .unwrap_or_else(|| panic!("the surface binds a `{object}` object"))
        .functions
        .iter()
        .map(|function| (function.name.clone(), function.tool.clone()))
        .collect()
}

/// A tool-calling run reports the toolset it was actually offered — the enabled capabilities'
/// tools **and** the `finish` the loop appends outside the registry — and reports no API objects,
/// because it has no such surface rather than an unknown one.
#[tokio::test]
async fn a_tool_calling_instance_reports_its_offered_tools_and_no_apis() {
    let dir = TempDir::new().unwrap();
    seed_default_skill(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-surface".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), GgCapabilitySet::minimal("mock/echo"));

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);

    let surfaces = surfaces(&sink.events());
    let (_, mode, tools, apis, _) = surfaces
        .first()
        .expect("the root instance reports its surface");
    assert_eq!(mode, "tool_calling");
    assert!(apis.is_empty(), "a tool-calling agent binds no API objects");

    // The default capability set's tools, each named by the capability that contributes it...
    for offered in ["shell", "read_file", "write_file", "edit_file", "list_dir"] {
        assert!(
            tools.contains(&offered.to_string()),
            "`{offered}` is offered by the default capability set: {tools:?}"
        );
    }
    // ...including `read_skill`, which exists only once gg's own built-in skills have joined the
    // library. It is the proof the surface is read off the **completed** registry rather than the
    // one built before the skills were resolved, whose toolset is a tool short.
    assert!(
        tools.contains(&"read_skill".to_string()),
        "the surface is the registry as it finally stands: {tools:?}"
    );
    // ...and the ending call, which is offered on every request but is not the registry's, so a
    // surface built from the registry alone would answer "was `finish` offered?" with silence.
    assert_eq!(
        tools.last().map(String::as_str),
        Some("finish"),
        "the role's ending call is appended to the offered set: {tools:?}"
    );
    // A capability this run does not enable contributes nothing, which is what makes the set a
    // statement about this agent rather than about gg.
    assert!(
        !tools.contains(&"spawn_subagent".to_string()),
        "a disabled capability's tools are not offered: {tools:?}"
    );
}

/// A tool withheld by the per-tool [ablation](GgAgentConfig::disabled_tools) is **absent** from the
/// surface, even though the capability contributing it is on — and its code-mode function goes with
/// it, so the two execution modes agree about what was withheld.
///
/// This is the finest-grained thing the surface has to get right: the capability set alone cannot
/// tell a reader that `write_file` was withheld from a run whose write-file capability is enabled.
#[tokio::test]
async fn a_withheld_tool_is_absent_from_the_surface_and_from_its_api_object() {
    let dir = TempDir::new().unwrap();
    seed_default_skill(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-ablation".to_string()), Box::new(sink.clone()));
    let mut set = GgCapabilitySet::minimal("mock/echo");
    // The ablation names a **tool**, not the capability that contributes it: `write-file` is on,
    // and exactly one of its tools is withheld.
    set.agents[0].disabled_tools = vec!["write_file".to_string()];
    let inv = invocation(dir.path(), set.clone());

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);

    let surfaces = surfaces(&sink.events());
    let (_, _, tools, _, _) = surfaces.first().expect("a surface");
    assert!(
        !tools.contains(&"write_file".to_string()),
        "the withheld tool is not offered: {tools:?}"
    );
    assert!(
        tools.contains(&"read_file".to_string()),
        "the rest of the toolset is untouched: {tools:?}"
    );

    // The same registry drives a program's scope, so the withheld tool's function is unbound too —
    // `fs` survives on its other three calls rather than disappearing.
    let registry = ToolRegistry::from_capabilities(set.root());
    let apis = api_surface(&registry, EndingRole::Standard, false);
    let names: Vec<String> = functions_on(&apis, "fs")
        .into_iter()
        .map(|(name, _)| name)
        .collect();
    assert!(
        !names.contains(&"writeFile".to_string()),
        "the withheld tool's function is unbound: {names:?}"
    );
    assert!(
        names.contains(&"readFile".to_string()),
        "its object survives on the calls that are still bound: {names:?}"
    );
}

/// Every instance reports its own surface, not just the root's. A subagent may run under a
/// different profile with a different toolset, so a run that reported one surface would describe
/// the wrong agent for every agent but the first.
#[tokio::test]
async fn a_subagent_reports_its_own_surface() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-child".to_string()), Box::new(sink.clone()));
    // The child's profile withholds `shell`, so the two surfaces are distinguishable by what they
    // offer rather than only by who emitted them.
    let mut set = subagent_set(2, 3, &["subagent"]);
    set.agents[1].disabled_tools = vec!["shell".to_string()];
    let inv = invocation(dir.path(), set);
    let factory = ScriptedFactory::new().slot(ROOT_AGENT, |binding| {
        Box::new(MockClient::with_subagent_parent_script(&binding.model_id))
    });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    let surfaces = surfaces(&sink.events());
    assert_eq!(
        surfaces.len(),
        2,
        "the root and its child each report one surface"
    );
    let (root_id, _, root_tools, _, _) = &surfaces[0];
    let (child_id, _, child_tools, _, _) = &surfaces[1];
    assert_ne!(root_id, child_id, "each surface names its own instance");
    assert!(
        root_tools.contains(&"shell".to_string()),
        "the root keeps its shell: {root_tools:?}"
    );
    assert!(
        !child_tools.contains(&"shell".to_string()),
        "the child's profile withholds it: {child_tools:?}"
    );
    assert!(
        child_tools.contains(&"finish".to_string()),
        "a subagent still ends with `finish`: {child_tools:?}"
    );
}

/// The code-mode surface: one object per family the agent binds, each carrying the functions
/// actually bound and the gg tool that gates each — the join a console counts a program's calls by,
/// because a program's calls are recorded under the tool name, never the JavaScript one.
#[test]
fn the_api_surface_carries_each_objects_functions_and_the_tool_that_gates_them() {
    let set = GgCapabilitySet::minimal("mock/echo");
    let registry = ToolRegistry::from_capabilities(set.root());
    let apis = api_surface(&registry, EndingRole::Standard, false);

    assert_eq!(
        functions_on(&apis, "fs"),
        vec![
            ("readFile".to_string(), Some("read_file".to_string())),
            ("writeFile".to_string(), Some("write_file".to_string())),
            ("editFile".to_string(), Some("edit_file".to_string())),
            ("listDir".to_string(), Some("list_dir".to_string())),
            ("readTextFile".to_string(), Some("read_file".to_string())),
            ("list".to_string(), None),
        ],
        "every bound `fs` call names the tool its calls are counted under"
    );
    // The calls no tool backs report none, so a consumer shows them as bound rather than as bound
    // and never called — a zero there would be a claim about the model that is not true.
    assert_eq!(
        functions_on(&apis, "view")
            .into_iter()
            .filter(|(_, tool)| tool.is_none())
            .map(|(name, _)| name)
            .collect::<Vec<_>>(),
        vec!["openText", "openDocsView", "close", "current", "list"],
        "the ungated view channel carries no gate"
    );
    assert_eq!(
        functions_on(&apis, "harness"),
        vec![("finish".to_string(), None), ("list".to_string(), None)],
        "the ending call is the role's, not a tool's"
    );

    // An object appears exactly when something on it is bound: this role has no verdict to return,
    // and this profile keeps no program library.
    let objects: Vec<&str> = apis.iter().map(|api| api.object.as_str()).collect();
    assert!(
        !objects.contains(&"review") && !objects.contains(&"programs"),
        "an object with nothing bound is absent rather than empty: {objects:?}"
    );
    // Stated against the *catalogued* functions rather than the whole list, because every object
    // carries `list`: an object with nothing else bound would be reported as a one-function object
    // rather than an empty one, which is the same lie in a different shape.
    assert!(
        apis.iter()
            .all(|api| api.functions.iter().any(|function| function.name != "list")),
        "no object is reported holding nothing but its `list`"
    );

    // The reviewer's arm of the same rule: a dispatched role decides which verdict object exists.
    let reviewer = api_surface(&registry, EndingRole::Review, false);
    assert_eq!(
        functions_on(&reviewer, "review"),
        vec![
            ("approve".to_string(), None),
            ("requestChanges".to_string(), None),
            ("list".to_string(), None),
        ]
    );
    assert!(
        !reviewer.iter().any(|api| api.object == "harness"),
        "a reviewer is not offered `finish`"
    );
}

/// The prompt's projection is the surface with the functions dropped — same objects, same order,
/// same prose — so the model's list and the console's readout cannot describe different runs.
#[test]
fn the_prompt_projection_is_the_surface_without_its_functions() {
    let mut set = GgCapabilitySet::minimal("mock/echo");
    set.agents[0]
        .capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_PROGRAM_LIBRARY));
    let registry = ToolRegistry::from_capabilities(set.root());

    let surface = api_surface(&registry, EndingRole::Standard, true);
    let views = api_views(&registry, EndingRole::Standard, true);
    assert_eq!(
        views
            .iter()
            .map(|view| (view.object.as_str(), view.description.as_str()))
            .collect::<Vec<_>>(),
        surface
            .iter()
            .map(|api| (api.object.as_str(), api.description.as_str()))
            .collect::<Vec<_>>()
    );
    // The library is the one family a capability gates rather than a tool or a role, so it is the
    // one whose presence proves the flag is threaded through both consumers.
    assert!(
        surface.iter().any(|api| api.object == "programs"),
        "an enabled program library binds its object"
    );
    assert!(
        api_surface(&registry, EndingRole::Standard, false)
            .iter()
            .all(|api| api.object != "programs"),
        "and a run without one does not"
    );
}

/// A capability the profile switches **off** contributes nothing to the surface — the ablation's
/// off arm, one level up from the per-tool one above.
#[tokio::test]
async fn a_disabled_capability_contributes_nothing_to_the_surface() {
    let dir = TempDir::new().unwrap();
    seed_default_skill(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-off-arm".to_string()), Box::new(sink.clone()));
    let mut set = GgCapabilitySet::minimal("mock/echo");
    for capability in &mut set.agents[0].capabilities {
        capability.enabled &= capability.id != CAPABILITY_SHELL;
    }
    let inv = invocation(dir.path(), set);

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);

    let surfaces = surfaces(&sink.events());
    let (_, _, tools, _, _) = surfaces.first().expect("a surface");
    assert!(
        !tools.contains(&"shell".to_string()),
        "a capability switched off offers no tools: {tools:?}"
    );
    let mut sorted = tools.clone();
    sorted.sort();
    sorted.dedup();
    assert_eq!(
        sorted.len(),
        tools.len(),
        "the offered set names each tool once: {tools:?}"
    );
}

/// The `list()` meta function is bound on **every** object the guest creates, so the surface reports
/// it on every object — last, and gated by nothing.
///
/// It has no signature-catalogue entry (it is the documentation carve-out's own, not the SDK's), so
/// a surface built from the catalogue alone is one function short on every object, and a reader
/// asking *"was this agent offered `list`?"* gets silence about a call it always has. Checked
/// against [`DocsRuntime::list`] rather than against a hand-written list, because the thing that
/// must hold is that the console's readout and the directory the model itself gets from
/// `object.list()` name the same functions in the same order.
#[test]
fn every_object_reports_the_list_meta_function_last_and_ungated() {
    let mut set = GgCapabilitySet::minimal("mock/echo");
    set.agents[0]
        .capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_PROGRAM_LIBRARY));
    let registry = ToolRegistry::from_capabilities(set.root());
    // The reviewer's role, so the object a dispatched role binds is covered alongside the tool-gated
    // and capability-gated ones.
    let apis = api_surface(&registry, EndingRole::Review, true);
    let docs = crate::docs::DocsRuntime::new(scope_tools(&registry), EndingRole::Review, true);

    assert!(!apis.is_empty(), "the fixture binds objects to check");
    for api in &apis {
        assert_eq!(
            api.functions.last(),
            Some(&GgAgentApiFunction {
                name: "list".to_string(),
                tool: None,
            }),
            "`{}` ends with an ungated `list`: {:?}",
            api.object,
            api.functions
        );
        assert_eq!(
            api.functions
                .iter()
                .filter(|function| function.name == "list")
                .count(),
            1,
            "`{}` binds it once, not once per family it came from",
            api.object
        );
        assert_eq!(
            api.functions
                .iter()
                .map(|function| function.name.as_str())
                .collect::<Vec<_>>(),
            docs.list(&api.object)
                .iter()
                .map(|summary| summary.name.as_str())
                .collect::<Vec<_>>(),
            "the surface's `{}` and the directory the model reads agree",
            api.object
        );
    }
}

/// What the surface calls **withheld** is the ablation gg could actually apply: a `disabledTools`
/// entry that names a real gg tool. A name gg does not know withholds nothing — it is inert, and gg
/// says so in the run log — so it is absent rather than reported as an applied ablation.
///
/// This is the whole point of emitting the field instead of letting a consumer read the capability
/// set: a typo rendered as *"withheld"* on the one screen that separates "never offered" from "never
/// called" asserts an experiment that did not happen.
#[tokio::test]
async fn withheld_names_the_ablations_gg_could_apply_and_omits_the_ones_it_could_not() {
    let dir = TempDir::new().unwrap();
    seed_default_skill(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-withheld".to_string()), Box::new(sink.clone()));
    let mut set = GgCapabilitySet::minimal("mock/echo");
    // One real tool, and one plausible-looking name gg has never offered.
    set.agents[0].disabled_tools = vec!["write_file".to_string(), "read_files".to_string()];
    let inv = invocation(dir.path(), set);

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);

    let surfaces = surfaces(&sink.events());
    let (_, _, tools, _, withheld) = surfaces.first().expect("a surface");
    assert_eq!(
        withheld,
        &vec!["write_file".to_string()],
        "only the name that is a gg tool is reported as withheld: {withheld:?}"
    );
    assert!(
        !tools.contains(&"write_file".to_string()),
        "and it is genuinely gone from the offered set: {tools:?}"
    );
}

/// An agent that ablates nothing reports nothing withheld — the empty case is a statement, not a
/// gap: the surface is emitted for every instance whatever its configuration, so a consumer reading
/// an empty list knows the ablation was empty rather than unreported.
#[tokio::test]
async fn an_agent_with_no_ablation_reports_nothing_withheld() {
    let dir = TempDir::new().unwrap();
    seed_default_skill(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-unablated".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), GgCapabilitySet::minimal("mock/echo"));

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);

    let surfaces = surfaces(&sink.events());
    let (_, _, _, _, withheld) = surfaces.first().expect("a surface");
    assert!(
        withheld.is_empty(),
        "an unablated agent withholds nothing: {withheld:?}"
    );
}
