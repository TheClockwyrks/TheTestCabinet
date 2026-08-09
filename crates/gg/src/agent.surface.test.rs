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
use test_cabinet_core::gg::{
    GgAgentApi, GgCapabilitySet, GgProgramLanguage, GgTelemetryEvent, ROOT_AGENT,
};

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
                program_language: _,
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

/// The functions bound on `object` in `apis`, as `(spelling, catalogue key)`.
fn functions_on(apis: &[GgAgentApi], object: &str) -> Vec<(String, String)> {
    apis.iter()
        .find(|api| api.object == object)
        .unwrap_or_else(|| panic!("the surface binds a `{object}` object"))
        .functions
        .iter()
        .map(|function| (function.name.clone(), function.key.clone()))
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
    let apis = api_surface(
        &registry,
        EndingRole::Standard,
        false,
        GgProgramLanguage::TypeScript,
    );
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

/// **An object's description is the catalogue's, in the catalogue's order.**
///
/// The sentence a model is introduced to `fs` by is written on the declaration that names `fs`, in
/// the guest SDK, and reflected into the catalogue by the same build that produced the component —
/// exactly as every function's description is. A table here would be a second copy of prose the
/// model also reads through the reference and through a doc lookup, and nothing would keep the
/// copies equal.
///
/// The **order** travels with it, and is checked here rather than left implicit: it is what the
/// system prompt's API list renders in, so a surface that sorted the objects would silently rewrite
/// what a model reads first.
#[test]
fn each_objects_description_and_its_place_come_from_the_catalogue() {
    let set = GgCapabilitySet::minimal("mock/echo");
    let registry = ToolRegistry::from_capabilities(set.root());
    let apis = api_surface(
        &registry,
        EndingRole::Standard,
        false,
        GgProgramLanguage::TypeScript,
    );

    let catalogue =
        crate::sandbox::catalogue_objects(crate::sandbox::language(GgProgramLanguage::TypeScript));
    for api in &apis {
        let described = catalogue
            .iter()
            .find(|entry| entry.object == api.object)
            .unwrap_or_else(|| panic!("`{}` is described by the catalogue", api.object));
        assert_eq!(
            api.description, described.doc,
            "`{}`'s description is the catalogue's, verbatim",
            api.object
        );
    }

    // Presentation order, not alphabetical and not the order the functions happen to be catalogued
    // in. `fs` leads because nearly every run has it.
    let order: Vec<&str> = apis.iter().map(|api| api.object.as_str()).collect();
    let expected: Vec<&str> = catalogue
        .iter()
        .map(|entry| entry.object.as_str())
        .filter(|object| order.contains(object))
        .collect();
    assert_eq!(order, expected, "the surface keeps the catalogue's order");
    assert_eq!(order.first(), Some(&"fs"));
}

/// The code-mode surface: one object per family the agent binds, each carrying the functions
/// actually bound and each function's own language-independent key — the join a console counts a
/// program's calls by, because a call is recorded under the function the model wrote and no gg tool
/// name reaches this surface at all.
#[test]
fn the_api_surface_carries_each_objects_functions_and_their_own_keys() {
    let set = GgCapabilitySet::minimal("mock/echo");
    let registry = ToolRegistry::from_capabilities(set.root());
    let apis = api_surface(
        &registry,
        EndingRole::Standard,
        false,
        GgProgramLanguage::TypeScript,
    );

    assert_eq!(
        functions_on(&apis, "fs"),
        vec![
            ("readFile".to_string(), "read_file".to_string()),
            ("writeFile".to_string(), "write_file".to_string()),
            ("editFile".to_string(), "edit_file".to_string()),
            ("listDir".to_string(), "list_dir".to_string()),
            // The helper's key is its own, not the `read_file` it shares a core with: two API
            // functions over one core are two functions, and each is counted as itself.
            ("readTextFile".to_string(), "read_text_file".to_string()),
            ("list".to_string(), "list".to_string()),
        ],
        "every bound `fs` call carries its own identity"
    );
    // The view channel is the case the old tool-keyed join could not express: `openFile` runs a
    // `read_file` and the other four run nothing at all, and all five are counted as themselves.
    assert_eq!(
        functions_on(&apis, "view"),
        vec![
            ("openFile".to_string(), "open_file".to_string()),
            ("openText".to_string(), "open_text".to_string()),
            ("openDocsView".to_string(), "open_docs_view".to_string()),
            ("close".to_string(), "close".to_string()),
            ("current".to_string(), "current".to_string()),
            ("list".to_string(), "list".to_string()),
        ],
        "the view channel is counted per function, tool or no tool"
    );
    assert_eq!(
        functions_on(&apis, "harness"),
        vec![
            ("finish".to_string(), "finish".to_string()),
            ("list".to_string(), "list".to_string()),
        ],
        "the ending call is counted as itself"
    );
    assert!(
        apis.iter().all(|api| api
            .functions
            .iter()
            .all(|function| !function.key.is_empty())),
        "no bound function reaches a console with nothing to join on"
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
    let reviewer = api_surface(
        &registry,
        EndingRole::Review,
        false,
        GgProgramLanguage::TypeScript,
    );
    assert_eq!(
        functions_on(&reviewer, "review"),
        vec![
            ("approve".to_string(), "approve".to_string()),
            ("requestChanges".to_string(), "request_changes".to_string()),
            ("list".to_string(), "list".to_string()),
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

    let surface = api_surface(
        &registry,
        EndingRole::Standard,
        true,
        GgProgramLanguage::TypeScript,
    );
    let views = api_views(
        &registry,
        EndingRole::Standard,
        true,
        GgProgramLanguage::TypeScript,
    );
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
        api_surface(
            &registry,
            EndingRole::Standard,
            false,
            GgProgramLanguage::TypeScript
        )
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
/// It is catalogued in the section for the functions that hang off no object, so a surface built by
/// walking the *object-bearing* sections alone is one function short on every object, and a reader
/// asking *"was this agent offered `list`?"* gets silence about a call it always has.
///
/// Two things are asserted about how it is named, and they are different claims. Its **key** is gg's
/// own [`LIST_FUNCTION`](crate::docs::LIST_FUNCTION), because that is what a call is recorded under;
/// its **name** is whatever this language's SDK spells it, taken from the catalogue rather than from
/// the key, because those two coincide in TypeScript and will not in every language. And the whole
/// readout is checked against [`DocsRuntime::list`] rather than against a hand-written list, because
/// the thing that must hold is that the console's readout and the directory the model itself gets
/// from `object.list()` name the same functions in the same order.
#[test]
fn every_object_reports_the_list_meta_function_last_and_ungated() {
    let mut set = GgCapabilitySet::minimal("mock/echo");
    set.agents[0]
        .capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_PROGRAM_LIBRARY));
    let registry = ToolRegistry::from_capabilities(set.root());
    // The reviewer's role, so the object a dispatched role binds is covered alongside the tool-gated
    // and capability-gated ones.
    let apis = api_surface(
        &registry,
        EndingRole::Review,
        true,
        GgProgramLanguage::TypeScript,
    );
    let docs = crate::docs::DocsRuntime::new(
        scope_tools(&registry),
        EndingRole::Review,
        &[CAPABILITY_PROGRAM_LIBRARY],
        GgProgramLanguage::TypeScript,
    );

    // The name the SDK gives it, read from the catalogue — never gg's key for it.
    let spelling = crate::sandbox::meta_function(
        crate::sandbox::language(GgProgramLanguage::TypeScript),
        crate::docs::LIST_FUNCTION,
    )
    .expect("`list` is catalogued")
    .name
    .clone();
    assert_eq!(
        spelling, "list",
        "TypeScript's SDK spells the directory `list`"
    );

    assert!(!apis.is_empty(), "the fixture binds objects to check");
    for api in &apis {
        assert_eq!(
            api.functions.last(),
            Some(&GgAgentApiFunction {
                name: spelling.clone(),
                key: crate::docs::LIST_FUNCTION.to_string(),
            }),
            "`{}` ends with the SDK's own spelling of the directory, keyed by gg's name for it: \
             {:?}",
            api.object,
            api.functions
        );
        assert_eq!(
            api.functions
                .iter()
                .filter(|function| function.name == spelling)
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
