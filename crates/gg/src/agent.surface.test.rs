//! **What each agent instance is offered**, driven offline through the real loop — the
//! [surface](GgTelemetryKind::AgentSurface) half of the pair whose other half
//! `agent.modules.test.rs` covers.
//!
//! The question these exist to keep answerable is the one a console reader asks of a run that went
//! wrong: *was the model never given that call, or was it given it and never made it?* Nothing else
//! in the record separates those — a `ToolCall` reports only what was called — so what has to be
//! true is that every instance reports its **resolved** offered set, after capability gating and
//! after its own allowlist, and reports it whether or not it ever used any of it.
//!
//! The gating itself is proven by the toolset tests; what only these can reach is that the resolved
//! set is really emitted, really emitted per instance rather than once for the root, and really
//! carries the ending calls the loop appends outside the registry.
//!
//! **An instance has exactly one surface**, so exactly one of the two lists is populated: a
//! tool-calling instance reports tools and no apis, a responses-as-code one reports apis and no
//! tools. Nothing here compares the two — the vocabularies are scoped, so there is nothing to
//! compare.

use std::sync::Arc;

use tempfile::TempDir;

use super::*;
use crate::client::MockClient;
use crate::telemetry::{CollectingSink, Emitter};
use test_cabinet_core::gg::{
    CAPABILITY_PROGRAM_LIBRARY, GgAgentApi, GgCapabilitySet, GgProgramLanguage, GgTelemetryEvent,
    ROOT_PROFILE_ID,
};

use super::{ScriptedFactory, invocation, subagent_set};

/// One instance's reported surface, keyed by the agent that emitted it.
type Surface = (String, String, Option<String>, Vec<String>, Vec<GgAgentApi>);

/// Every `AgentSurface` in the stream, as
/// `(emitting agent, execution mode, documentation mode, tools, apis)`.
fn surfaces(events: &[GgTelemetryEvent]) -> Vec<Surface> {
    events
        .iter()
        .filter_map(|event| match &event.kind {
            GgTelemetryKind::AgentSurface {
                execution_mode,
                program_language: _,
                doc_view_types,
                tools,
                apis,
            } => Some((
                event.agent_id.clone().unwrap_or_default(),
                execution_mode.clone(),
                doc_view_types.clone(),
                tools.clone(),
                apis.clone(),
            )),
            _ => None,
        })
        .collect()
}

/// The two halves of what `profile` was granted, resolved exactly as the loop resolves them: the
/// capabilities it has switched on, and the operations its own allowlist names.
///
/// Both readers of a grant — the surface readout and the documentation runtime — take these, so a
/// fixture that built either half a second way would be asserting against something the loop never
/// computes.
fn grant(profile: &GgAgentConfig) -> (Vec<String>, Vec<crate::sandbox::OperationId>) {
    let (operations, _) =
        crate::sandbox::resolve_operations(profile.operations.iter().map(String::as_str));
    (enabled_capabilities(profile), operations)
}

/// The functions bound in the module this arm spells `path`, as `(spelling, operation)`.
fn functions_on(apis: &[GgAgentApi], path: &str) -> Vec<(String, String)> {
    apis.iter()
        .find(|api| api.path == path)
        .unwrap_or_else(|| panic!("the surface binds a `{path}` module"))
        .functions
        .iter()
        .map(|function| (function.name.clone(), function.operation.clone()))
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
    let (_, mode, _, tools, apis) = surfaces
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

/// A tool the agent's [allowlist](GgAgentConfig::tools) does not name is **absent** from the
/// surface, even though the capability contributing it is on.
///
/// This is the finest-grained thing the surface has to get right: the capability set alone cannot
/// tell a reader that `write_file` never reached a run whose write-file capability is enabled.
#[tokio::test]
async fn a_tool_the_allowlist_omits_is_absent_from_the_surface() {
    let dir = TempDir::new().unwrap();
    seed_default_skill(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-allowlist".to_string()), Box::new(sink.clone()));
    let mut set = GgCapabilitySet::minimal("mock/echo");
    // The allowlist names **tools**, not the capability that contributes them: `write-file` is on,
    // and exactly one of its tools goes ungranted.
    set.agents[0].tools.retain(|name| name != "write_file");
    let inv = invocation(dir.path(), set.clone());

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);

    let surfaces = surfaces(&sink.events());
    let (_, _, _, tools, _) = surfaces.first().expect("a surface");
    assert!(
        !tools.contains(&"write_file".to_string()),
        "the ungranted tool is not offered: {tools:?}"
    );
    assert!(
        tools.contains(&"read_file".to_string()),
        "the rest of the toolset is untouched: {tools:?}"
    );
}

/// The **other** surface's half of the same rule, and the reason the two are separate tests: an
/// operation the [allowlist](GgAgentConfig::operations) does not name is absent from the API
/// surface, and narrowing the *tool* allowlist does nothing to it.
///
/// The two vocabularies are independent, and this is where that is visible. `write_file` and
/// `files.write_file` reach the same core, and an agent holds exactly one of the two surfaces — so
/// a configuration that withdrew the tool and left the operation has withdrawn nothing from an
/// agent that writes programs, and saying otherwise would report a narrower surface than the model
/// was actually offered.
///
/// The function is still **bound** in a program's scope whatever the grant, because every SDK is
/// static; what this readout answers is what the agent was *offered*, which is the question a
/// console reader asks.
#[test]
fn an_operation_the_allowlist_omits_is_absent_from_the_api_surface() {
    let mut profile = GgCapabilitySet::minimal("mock/echo").root().clone();
    // Only the tool goes: the API surface must not notice.
    profile.tools.retain(|name| name != "write_file");
    let (capabilities, operations) = grant(&profile);
    let names = |apis: &[GgAgentApi]| -> Vec<String> {
        functions_on(apis, "gg.files")
            .into_iter()
            .map(|(name, _)| name)
            .collect()
    };
    let untouched = api_surface(
        &capabilities,
        &operations,
        EndingRole::Standard,
        GgProgramLanguage::TypeScript,
    );
    assert!(
        names(&untouched).contains(&"writeFile".to_string()),
        "a narrowed tool allowlist says nothing about the API surface: {:?}",
        names(&untouched)
    );

    // And the operation allowlist is what does say something about it.
    profile.operations.retain(|id| id != "files.write_file");
    let (capabilities, operations) = grant(&profile);
    let narrowed = api_surface(
        &capabilities,
        &operations,
        EndingRole::Standard,
        GgProgramLanguage::TypeScript,
    );
    assert!(
        !names(&narrowed).contains(&"writeFile".to_string()),
        "the ungranted operation's function is unbound: {:?}",
        names(&narrowed)
    );
    assert!(
        names(&narrowed).contains(&"readFile".to_string()),
        "its module survives on the calls that are still granted: {:?}",
        names(&narrowed)
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
    set.agents[1].tools.retain(|name| name != "shell");
    let inv = invocation(dir.path(), set);
    let factory = ScriptedFactory::new().slot(ROOT_PROFILE_ID, |binding| {
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
    let (root_id, _, _, root_tools, _) = &surfaces[0];
    let (child_id, _, _, child_tools, _) = &surfaces[1];
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
    let (capabilities, operations) = grant(set.root());
    let apis = api_surface(
        &capabilities,
        &operations,
        EndingRole::Standard,
        GgProgramLanguage::TypeScript,
    );

    // Read through the module projection `api_surface` itself reads: this arm groups its surface
    // into capability modules, so the grouping the surface names is the module path and the sentence
    // introducing it is the module's authored brief and detail.
    let catalogue =
        crate::sandbox::catalogue_modules(crate::sandbox::language(GgProgramLanguage::TypeScript));
    for api in &apis {
        let described = catalogue
            .iter()
            .find(|entry| entry.id == api.module)
            .unwrap_or_else(|| panic!("`{}` is described by the catalogue", api.path));
        assert_eq!(
            api.description,
            described.prose.rendered(),
            "`{}`'s description is the catalogue's, verbatim",
            api.path
        );
        assert_eq!(
            api.path, described.path,
            "`{}` is reported under this arm's own spelling of it",
            api.module
        );
    }

    // Presentation order, not alphabetical and not the order the functions happen to be catalogued
    // in. `gg.files` leads because nearly every run has it.
    let order: Vec<&str> = apis.iter().map(|api| api.path.as_str()).collect();
    let expected: Vec<&str> = catalogue
        .iter()
        .map(|entry| entry.path)
        .filter(|object| order.contains(object))
        .collect();
    assert_eq!(order, expected, "the surface keeps the catalogue's order");
    assert_eq!(order.first(), Some(&"gg.files"));
}

/// The code-mode surface: one module per family the agent binds, each carrying the functions
/// actually bound and each function's own **operation** — gg's identity for what the call does,
/// which is the join a console counts a program's calls by, because a call is recorded under that
/// and no gg tool name reaches this surface at all.
///
/// The operation is what makes the count survive the arm: this run's model wrote `readFile` and a
/// Rust arm's would have written `read_file`, and both are `files.read_file`.
#[test]
fn the_api_surface_carries_each_modules_functions_and_their_own_operations() {
    let set = GgCapabilitySet::minimal("mock/echo");
    let (capabilities, operations) = grant(set.root());
    let apis = api_surface(
        &capabilities,
        &operations,
        EndingRole::Standard,
        GgProgramLanguage::TypeScript,
    );

    assert_eq!(
        functions_on(&apis, "gg.files"),
        vec![
            ("readFile".to_string(), "files.read_file".to_string()),
            // The helper's operation is its own, not the `read_file` it shares a core with: two
            // API functions over one core are two operations, and each is counted as itself.
            (
                "readTextFile".to_string(),
                "files.read_text_file".to_string()
            ),
            ("writeFile".to_string(), "files.write_file".to_string()),
            ("editFile".to_string(), "files.edit_file".to_string()),
            ("listDir".to_string(), "files.list_dir".to_string()),
        ],
        "every bound `gg.files` call carries its own identity, in the order its SDK declares them"
    );
    // The view channel is the case the old tool-keyed join could not express: `openFile` runs a
    // `read_file` and the other four run nothing at all, and all five are counted as themselves.
    //
    // The sixth entry is the second `views.close`, and it is here because the surface reports what
    // the instance was **offered** rather than what gg can do: `OpenView.close` is the method on the
    // value `current` lists, an alias that supplies its own selector, and a model holding one really
    // can call it. Counting it once because its operation was already counted would report a
    // narrower surface than the agent has.
    assert_eq!(
        functions_on(&apis, "gg.views"),
        vec![
            ("openFile".to_string(), "views.open_file".to_string()),
            ("openText".to_string(), "views.open_text".to_string()),
            (
                "openDocsView".to_string(),
                "views.open_docs_view".to_string()
            ),
            ("close".to_string(), "views.close".to_string()),
            ("current".to_string(), "views.current".to_string()),
            ("close".to_string(), "views.close".to_string()),
        ],
        "the view channel is counted per function, tool or no tool"
    );
    assert_eq!(
        functions_on(&apis, "gg.session"),
        vec![("finish".to_string(), "session.finish".to_string())],
        "the ending call is counted as itself"
    );
    assert!(
        apis.iter().all(|api| api
            .functions
            .iter()
            .all(|function| !function.operation.is_empty())),
        "no bound function reaches a console with nothing to join on"
    );

    // A grouping appears exactly when something in it is bound: this profile keeps no program
    // library, so its module is absent rather than empty. This arm groups all three ending calls in
    // one module, so *which* ending a role holds is asserted on that module's contents — above for
    // the worker, below for the reviewer — rather than on which grouping exists.
    let modules: Vec<&str> = apis.iter().map(|api| api.path.as_str()).collect();
    assert!(
        !modules.contains(&"gg.programs"),
        "a module with nothing bound is absent rather than empty: {modules:?}"
    );
    // Nothing is appended to a module the catalogue does not carry, so a module reported at all is
    // a module with a bound call on it.
    assert!(
        apis.iter().all(|api| !api.functions.is_empty()),
        "no module is reported holding nothing"
    );

    // The reviewer's arm of the same rule: a dispatched role decides which verdict object exists.
    let reviewer = api_surface(
        &capabilities,
        &operations,
        EndingRole::Review,
        GgProgramLanguage::TypeScript,
    );
    let verdicts = functions_on(&reviewer, "gg.session");
    assert_eq!(
        verdicts,
        vec![
            ("approve".to_string(), "session.approve".to_string()),
            (
                "requestChanges".to_string(),
                "session.request_changes".to_string()
            ),
        ]
    );
    assert!(
        !verdicts.iter().any(|(name, _)| name == "finish"),
        "a reviewer is not offered `finish`"
    );
}

/// The prompt's projection is the surface with the functions dropped — same modules, in the same
/// order — so the model's list and the console's readout cannot describe different runs.
///
/// It adds exactly one field the surface event has no use for, the arm's own import line, and takes
/// it from the same catalogue the description came from rather than authoring one.
///
/// # The prose is where the two deliberately part company
///
/// The surface carries a module's **whole** documentation and the prompt carries only its
/// [brief](crate::sandbox::signatures::Prose::brief). They must not be the same string: a module's
/// detail is written for a reader who has already chosen the family, so it
/// says what the family is for — and on most arms it does that by naming calls, sometimes in a
/// fenced worked example. Rendering it into the prompt would put those names into the one document
/// that tells the model in as many words that it names none, and would hand it for free the one
/// round trip the discovery design still requires: from a brief to the whole signature, by opening a
/// documentation view of it. (A function's brief is not itself earned any more: the
/// [bootstrap](crate::bootstrap) lists every granted module, a line per function, before the first
/// real turn. What is left to go and get is the signature.)
///
/// So this asserts the paths and the order agree, and that the brief is a **prefix** of the
/// description rather than equal to it: both are projections of one authored entry, which is the
/// property that stops the two readouts describing different modules, and only the amount differs.
/// That a rendered prompt names no function at all is
/// [`a_rendered_prompt_names_no_function_but_the_one_that_ends_the_session`](crate::prompts)'s.
#[test]
fn the_prompt_projection_is_the_surface_without_its_functions() {
    let mut set = GgCapabilitySet::minimal("mock/echo");
    crate::tools::grant(&mut set.agents[0], CAPABILITY_PROGRAM_LIBRARY);
    set.agents[0].operations.extend(
        crate::sandbox::capability_operations([CAPABILITY_PROGRAM_LIBRARY])
            .into_iter()
            .map(|id| id.to_string()),
    );
    let (capabilities, operations) = grant(set.root());

    let surface = api_surface(
        &capabilities,
        &operations,
        EndingRole::Standard,
        GgProgramLanguage::TypeScript,
    );
    let views = module_views(
        &capabilities,
        &operations,
        EndingRole::Standard,
        GgProgramLanguage::TypeScript,
    );
    assert_eq!(
        views
            .iter()
            .map(|view| view.path.as_str())
            .collect::<Vec<_>>(),
        surface
            .iter()
            .map(|api| api.path.as_str())
            .collect::<Vec<_>>()
    );
    for (view, api) in views.iter().zip(&surface) {
        assert!(
            api.description.starts_with(&view.brief),
            "{}: the prompt's line is the opening of the surface's prose, not a second wording of \
             it — brief {:?} against description {:?}",
            api.path,
            view.brief,
            api.description
        );
        assert!(
            !view.brief.contains('\n'),
            "{}: the prompt's line is one line: {:?}",
            api.path,
            view.brief
        );
    }
    // At least one module in this surface has more to say than its brief, so the assertion above is
    // exercised as a *prefix* check rather than as an equality that happens to be spelled oddly.
    assert!(
        surface
            .iter()
            .zip(&views)
            .any(|(api, view)| api.description.len() > view.brief.len()),
        "a module with a detail is in this surface, or the prefix rule above proves nothing"
    );
    // The TypeScript arm reaches its whole surface through one line, so every module here states
    // that line. It is asserted rather than left unsaid because a projection that dropped it would
    // leave a model hunting for the import its compiler requires.
    assert!(
        views
            .iter()
            .all(|view| view.import.as_deref() == Some("import * as gg from \"gg\";")),
        "an arm whose catalogue declares an import line states it on every module"
    );
    // The library is the one family a capability gates rather than a role, so it is the one whose
    // presence proves the grant is threaded through both consumers.
    assert!(
        surface.iter().any(|api| api.path == "gg.programs"),
        "an enabled program library binds its module"
    );
    let (without, without_operations) = grant(GgCapabilitySet::minimal("mock/echo").root());
    assert!(
        api_surface(
            &without,
            &without_operations,
            EndingRole::Standard,
            GgProgramLanguage::TypeScript
        )
        .iter()
        .all(|api| api.path != "gg.programs"),
        "and a run without one does not"
    );
}

/// A capability the profile switches **off** contributes nothing to the surface — one level up from
/// the allowlist above, and the coarser of the two levers.
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
    let (_, _, _, tools, _) = surfaces.first().expect("a surface");
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

/// **The surface reports exactly the catalogue's own bound entries, and nothing beside them.**
///
/// No object ends with a directory function no catalogue entry names, so this readout can say
/// nothing the catalogue does not: what the console shows and what a program's scope binds are one
/// projection of one array.
///
/// So the assertion is an equality against [`DocsRuntime`](crate::docs::DocsRuntime)'s own predicate
/// — object by object, name for name, in catalogue order — rather than a hand-written list. A
/// function reported and not bound is a call the console claims the agent had; a function bound and
/// not reported is a call whose count joins to nothing.
#[test]
fn the_surface_reports_the_bound_catalogue_and_nothing_else() {
    let mut set = GgCapabilitySet::minimal("mock/echo");
    crate::tools::grant(&mut set.agents[0], CAPABILITY_PROGRAM_LIBRARY);
    set.agents[0].operations.extend(
        crate::sandbox::capability_operations([CAPABILITY_PROGRAM_LIBRARY])
            .into_iter()
            .map(|id| id.to_string()),
    );
    let (capabilities, operations) = grant(set.root());
    // The reviewer's role, so the module a dispatched role binds is covered alongside the
    // capability-gated ones.
    let apis = api_surface(
        &capabilities,
        &operations,
        EndingRole::Review,
        GgProgramLanguage::TypeScript,
    );
    let docs = crate::docs::DocsRuntime::new(
        capabilities.clone(),
        EndingRole::Review,
        &operations,
        GgProgramLanguage::TypeScript,
    );

    assert!(!apis.is_empty(), "the fixture binds objects to check");
    let language = crate::sandbox::language(GgProgramLanguage::TypeScript);
    for api in &apis {
        let expected: Vec<GgAgentApiFunction> = crate::sandbox::catalogue_functions(language)
            .into_iter()
            .filter(|function| function.module == api.module && docs.bound(function))
            .map(|function| GgAgentApiFunction {
                name: function.name.to_string(),
                operation: function.operation.to_string(),
            })
            .collect();
        assert_eq!(
            api.functions, expected,
            "`{}` reports exactly what this agent binds of the catalogue",
            api.path
        );
        assert!(
            !api.functions.iter().any(|function| function.name == "list"),
            "`{}` reports no directory: there is none",
            api.path
        );
    }
}
