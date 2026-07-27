//! Tests for the committed signature catalogue and the prompt views projected from it.
//!
//! What these guard is subtle but expensive to get wrong: the prompt is the *only* description of
//! this API a model ever sees. A catalogue that has drifted from the guest does not fail loudly —
//! it teaches a model a signature that does not exist, and every program it writes is wrong in a
//! way it cannot diagnose.

use super::*;
use crate::sandbox::FINISH_FUNCTION;
use crate::tools::{ALL_TOOL_NAMES, TURN_LEVEL_TOOLS};

/// The committed catalogue parses, and is not empty.
#[test]
fn the_committed_catalogue_parses() {
    let catalogue = catalogue();
    assert!(!catalogue.tools.is_empty());
    assert!(!catalogue.types.is_empty());
    assert!(
        !catalogue.generated_from.is_empty(),
        "the catalogue records where it was generated from"
    );
}

/// **G4: the catalogue covers exactly the tools the sandbox binds** — every gg tool except the
/// three turn-level transitions, and nothing else.
#[test]
fn the_signature_catalogue_covers_every_tool() {
    let mut catalogued: Vec<&str> = catalogue()
        .tools
        .iter()
        .map(|entry| entry.tool.as_str())
        .collect();
    catalogued.sort_unstable();

    let mut expected = sandbox_tool_names();
    expected.sort_unstable();

    assert_eq!(
        catalogued, expected,
        "the committed catalogue and gg's tool vocabulary have drifted apart"
    );
    assert_eq!(
        expected.len(),
        ALL_TOOL_NAMES.len() - TURN_LEVEL_TOOLS.len() - NON_SANDBOX_TOOLS.len(),
        "the sandbox binds every gg tool but the turn-level transitions and the non-sandbox tools"
    );
}

/// Every entry carries what the prompt renders. An entry with an empty signature or an empty doc
/// would render as a bullet the model cannot use.
#[test]
fn every_catalogue_entry_carries_a_signature_and_documentation() {
    for entry in &catalogue().tools {
        assert!(
            !entry.signature.trim().is_empty(),
            "`{}` has no signature",
            entry.tool
        );
        assert!(!entry.doc.trim().is_empty(), "`{}` has no doc", entry.tool);
        assert!(
            entry.signature.starts_with(&entry.js),
            "`{}`'s signature does not start with the name a program calls (`{}`): {}",
            entry.tool,
            entry.js,
            entry.signature
        );
    }
    for helper in &catalogue().helpers {
        assert!(!helper.signature.trim().is_empty());
        assert!(!helper.doc.trim().is_empty());
    }
}

/// Every type a signature mentions is declared, so the prompt never shows a name it does not then
/// define.
#[test]
fn every_referenced_type_is_declared() {
    let declared: Vec<&str> = catalogue()
        .types
        .iter()
        .map(|declaration| declaration.name.as_str())
        .collect();
    let referenced = catalogue()
        .tools
        .iter()
        .flat_map(|entry| entry.types.iter())
        .chain(
            catalogue()
                .helpers
                .iter()
                .flat_map(|entry| entry.types.iter()),
        );

    for name in referenced {
        assert!(
            declared.contains(&name.as_str()),
            "`{name}` is referenced by a signature but never declared"
        );
    }
}

/// `readTextFile` is a **helper**, not a gg tool: it wraps `read_file` for the common case, and
/// listing it among the tools would put a name in the model's head that no capability controls.
#[test]
fn read_text_file_is_a_helper_not_a_tool() {
    assert!(
        catalogue()
            .tools
            .iter()
            .all(|entry| entry.js != "readTextFile"),
        "the helper is listed as a tool"
    );
    let helper = catalogue()
        .helpers
        .iter()
        .find(|helper| helper.js == "readTextFile")
        .expect("the helper is catalogued");
    assert_eq!(
        helper.requires, "read_file",
        "the helper is bound only when the tool it wraps is"
    );
}

/// The prompt shows only what the run offers — the property toolset ablation depends on. A run
/// without `tasks` is not told the task functions exist, and is not shown their types either.
#[test]
fn prompt_views_are_filtered_by_the_enabled_set() {
    let enabled = ["shell".to_string(), "list_dir".to_string()];
    let views = prompt_views(&enabled);

    let names: Vec<&str> = views.tools.iter().map(|view| view.name.as_str()).collect();
    assert_eq!(names, ["shell", "list_dir"]);
    assert!(
        views.helpers.is_empty(),
        "the helper's required tool is withheld, so the helper is too"
    );

    let type_names: Vec<&str> = views.types.iter().map(|view| view.name.as_str()).collect();
    assert!(type_names.contains(&"ShellOutput"));
    assert!(type_names.contains(&"DirEntry"));
    assert!(
        !type_names.contains(&"TaskUsage"),
        "a type only a withheld tool uses must not reach the prompt: {type_names:?}"
    );
}

/// The helper appears exactly when the tool it wraps does.
#[test]
fn the_helper_follows_its_required_tool() {
    let helpers = prompt_views(&["read_file".to_string()]).helpers;
    let names: Vec<&str> = helpers.iter().map(|view| view.name.as_str()).collect();
    assert_eq!(names, ["readTextFile"]);
}

/// The error contract always reaches the model, even for a run whose signatures never mention it:
/// nothing *returns* a `ToolError` — it is thrown — so nothing else would pull it in, and a model
/// that has never seen it cannot write the `catch` the prompt tells it to write.
#[test]
fn the_error_contract_is_always_shown() {
    for enabled in [Vec::new(), vec!["shell".to_string()]] {
        let types = prompt_views(&enabled).types;
        let names: Vec<&str> = types.iter().map(|view| view.name.as_str()).collect();
        assert!(names.contains(&"ToolError"), "{names:?}");
        assert!(
            names.contains(&"ToolErrorCode"),
            "the code vocabulary comes with it, or `e.code` is a field to guess at: {names:?}"
        );
    }
}

/// A view carries the declaration verbatim, so what the prompt shows is what the SDK wrote.
#[test]
fn a_type_view_carries_the_sdks_own_declaration() {
    let types = prompt_views(&["list_dir".to_string()]).types;
    let entry = types
        .iter()
        .find(|view| view.name == "DirEntry")
        .expect("the type is shown");
    assert!(
        entry.declaration.contains("interface DirEntry"),
        "{}",
        entry.declaration
    );
}

/// A tool view carries the real signature and the SDK's own words about it.
#[test]
fn a_tool_view_carries_the_real_signature() {
    let tools = prompt_views(&["list_dir".to_string()]).tools;
    assert_eq!(tools.len(), 1);
    assert_eq!(tools[0].name, "list_dir");
    assert_eq!(tools[0].signature, "listDir(path?: string): DirEntry[]");
    assert!(tools[0].doc.contains("sorted by name"), "{}", tools[0].doc);
}

/// The four tool names the code section's **prose** is gated on are real names in gg's vocabulary.
///
/// They are written as literals here rather than derived, because what they gate is prose, and prose
/// cannot be derived. That makes a rename in [`ALL_TOOL_NAMES`] able to turn a gate silently and
/// permanently off — the prompt would simply stop teaching a tool the run does offer — so the
/// literals are pinned to the vocabulary here instead.
#[test]
fn every_tool_the_prompt_prose_names_is_a_real_tool() {
    for name in [LIST_DIR_TOOL, WRITE_FILE_TOOL, EDIT_FILE_TOOL, SHELL_TOOL] {
        assert!(
            ALL_TOOL_NAMES.contains(&name),
            "`{name}` gates a piece of the code-mode prompt but is not a gg tool"
        );
    }
}

/// The worked example is chosen from the tools the run actually binds, and exactly one is chosen.
///
/// This is the property that stops the prompt's single most-copied artifact — its example program —
/// from being a `ReferenceError` under a reduced toolset, which is precisely what toolset ablation
/// sweeps.
#[test]
fn exactly_one_worked_example_is_chosen_and_it_only_names_bound_tools() {
    /// Which flag a toolset must set, as a predicate over the projected teaching.
    type Chosen = fn(&CodeTeachingView) -> bool;

    let cases: [(&[&str], Chosen); 5] = [
        (&["list_dir", "read_file", "shell"], |t| t.example_compose),
        (&["shell", "write_file"], |t| t.example_shell),
        (&["write_file", "read_file"], |t| t.example_write),
        (&["add_task"], |t| t.example_pure),
        (&[], |t| t.example_pure),
    ];
    for (enabled, chosen) in cases {
        let enabled: Vec<String> = enabled.iter().map(|name| (*name).to_string()).collect();
        let teaching = prompt_views(&enabled).teaching;
        assert!(
            chosen(&teaching),
            "the wrong example was chosen for {enabled:?}: {teaching:?}"
        );
        let examples = [
            teaching.example_compose,
            teaching.example_shell,
            teaching.example_write,
            teaching.example_pure,
        ];
        assert_eq!(
            examples.iter().filter(|shown| **shown).count(),
            1,
            "exactly one example is shown for {enabled:?}: {teaching:?}"
        );
    }
}

/// The catalogue carries the one model-facing function that is not a gg tool, with the signature the
/// prompt renders.
///
/// The `never` return type is asserted rather than assumed: it is not decoration but the accurate
/// type of a function that always throws, and it is what tells a model at a glance that nothing after
/// the call runs. A `void` here would teach the opposite.
#[test]
fn the_catalogue_carries_the_session_function() {
    let session = &catalogue().session;
    assert_eq!(session.js, FINISH_FUNCTION);
    assert_eq!(session.signature, "finish(summary: string): void");
    assert!(
        session.doc.contains("ONLY thing that ends a run"),
        "the prompt renders this verbatim, and it is the whole protocol: {}",
        session.doc
    );
}

/// **`finish` is not a gg tool, and no gg tool is called `finish`.**
///
/// Two vocabularies share one namespace — a program's scope — and the sandbox binds them from
/// different places: the tools from the run's enabled set, `finish` unconditionally. If they ever
/// collided, one would silently shadow the other in every program, and which one won would depend on
/// bind order rather than on anything anyone decided.
#[test]
fn no_gg_tool_binds_the_name_finish() {
    assert!(
        !ALL_TOOL_NAMES.contains(&FINISH_FUNCTION),
        "`{FINISH_FUNCTION}` is not a gg tool: no capability offers it and nothing dispatches it"
    );
    for entry in &catalogue().tools {
        assert_ne!(
            entry.js, FINISH_FUNCTION,
            "the gg tool `{}` binds the name the session function needs",
            entry.tool
        );
    }
    for helper in &catalogue().helpers {
        assert_ne!(
            helper.js, FINISH_FUNCTION,
            "a helper binds the name the session function needs"
        );
    }
}

/// The session function is offered whatever the run enables — including a run that enables **no**
/// tools at all.
///
/// This is the one view that is not a projection of the enabled set, and it has to be: under
/// responses-as-code a session ends only when a program calls `finish`, so a toolset that made the
/// prompt omit it would leave a model in a protocol with no exit.
#[test]
fn the_session_function_is_offered_whatever_the_run_enables() {
    for enabled in [Vec::new(), vec!["shell".to_string()], all_tool_names()] {
        let views = prompt_views(&enabled);
        assert_eq!(views.session.name, FINISH_FUNCTION, "for {enabled:?}");
        assert!(!views.session.signature.trim().is_empty());
        assert!(!views.session.doc.trim().is_empty());
    }
}

/// Every gg tool name, as a run with the full capability set offers them.
fn all_tool_names() -> Vec<String> {
    sandbox_tool_names()
        .into_iter()
        .map(str::to_string)
        .collect()
}

/// The three prose gates follow their tools, so a bullet never illustrates itself with a function
/// the run withheld.
#[test]
fn the_prose_gates_follow_their_tools() {
    let none = prompt_views(&[]).teaching;
    assert!(
        !none.read_file && !none.edit_file && !none.shell,
        "{none:?}"
    );

    let all = prompt_views(&[
        "read_file".to_string(),
        "edit_file".to_string(),
        "shell".to_string(),
    ])
    .teaching;
    assert!(all.read_file && all.edit_file && all.shell, "{all:?}");
}
