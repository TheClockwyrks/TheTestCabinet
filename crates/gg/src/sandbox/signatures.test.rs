//! Tests for the committed signature catalogue the [docs carve-out](crate::docs) reads.
//!
//! What these guard is subtle but expensive to get wrong: the catalogue is the *only* description of
//! this API a model ever sees, served on demand through `fn.docs()`. A catalogue that has drifted
//! from the guest does not fail loudly — it hands a model a signature that does not exist, and every
//! program it writes against it is wrong in a way it cannot diagnose.

use super::*;
use crate::sandbox::FINISH_FUNCTION;
use crate::tools::ALL_TOOL_NAMES;

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

/// **G4: the catalogue covers exactly the tools the sandbox binds** — every gg tool, and nothing
/// else.
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
        ALL_TOOL_NAMES.len(),
        "the sandbox binds every gg tool"
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

/// The catalogue carries every model-facing function that is not a gg tool, each tagged with the
/// [role](crate::ending::EndingRole) whose programs bind it and with the signature a doc lookup
/// renders.
///
/// The tags are what make one catalogue serve three scopes: the host filters by them to decide what a
/// given agent's `object.list()` enumerates, so an untagged entry would be documented to every agent
/// including the ones that cannot call it.
#[test]
fn the_catalogue_carries_every_ending_function() {
    let by_name = |js: &str| {
        catalogue()
            .session
            .iter()
            .find(|entry| entry.js == js)
            .unwrap_or_else(|| panic!("`{js}` is catalogued"))
    };

    let finish = by_name(FINISH_FUNCTION);
    assert_eq!(finish.object, "harness");
    assert_eq!(finish.ending, "standard");
    assert_eq!(finish.signature, "finish(summary: string): void");

    let approve = by_name("approve");
    assert_eq!(approve.object, "review");
    assert_eq!(approve.ending, "review");
    assert_eq!(approve.signature, "approve(): void");

    let request_changes = by_name("requestChanges");
    assert_eq!(request_changes.object, "review");
    assert_eq!(request_changes.ending, "review");
    assert_eq!(
        request_changes.signature,
        "requestChanges(items: string[]): void"
    );

    let select_winner = by_name("selectWinner");
    assert_eq!(select_winner.object, "judge");
    assert_eq!(select_winner.ending, "judge");
    assert_eq!(
        select_winner.signature,
        "selectWinner(attempt: number, rationale: string): void"
    );

    // Every entry documents itself: the doc is what a `.docs()` lookup renders verbatim.
    for entry in &catalogue().session {
        assert!(
            entry.doc.contains("ends your session") || entry.doc.contains("End your session"),
            "`{}` does not say that it ends the session: {}",
            entry.js,
            entry.doc
        );
    }
}

/// The catalogue carries the four `view` functions, each with the gate that decides whether a
/// program binds it — and none of them as a gg tool.
///
/// The gate is the whole content of this entry type: `openFile` is a read and must close when
/// `read_file` is withheld, while the other three are bound whatever a run enables, because a run
/// that offers no tools at all must still be able to show its model something. A `requires` that
/// slipped onto the wrong one would silently withhold the only channel into the context window, or
/// silently open a side door into the workspace, and neither shows up as a compile error.
#[test]
fn the_catalogue_carries_every_view_function() {
    let by_name = |js: &str| {
        catalogue()
            .views
            .iter()
            .find(|entry| entry.js == js)
            .unwrap_or_else(|| panic!("`{js}` is catalogued"))
    };

    let open_file = by_name("openFile");
    assert_eq!(open_file.object, "view");
    assert_eq!(
        open_file.requires.as_deref(),
        Some("read_file"),
        "opening a file view is a read, and closes with reading"
    );

    for js in ["openText", "close", "current"] {
        let entry = by_name(js);
        assert_eq!(entry.object, "view");
        assert!(
            entry.requires.is_none(),
            "`{js}` is bound whatever a run enables"
        );
    }

    assert_eq!(
        catalogue().views.len(),
        4,
        "the view surface is the four functions and nothing else"
    );

    // None of them is a gg tool, and none collides with one: two vocabularies share a program's
    // scope, and a collision would be resolved by bind order rather than by anyone's decision.
    for entry in &catalogue().views {
        assert!(
            !ALL_TOOL_NAMES.contains(&entry.js.as_str()),
            "`{}` is not a gg tool name",
            entry.js
        );
        assert!(
            catalogue().tools.iter().all(|tool| tool.js != entry.js),
            "the gg tool vocabulary binds the name `{}` the view surface needs",
            entry.js
        );
        assert!(!entry.doc.trim().is_empty(), "`{}` has no doc", entry.js);
        assert!(
            entry.signature.starts_with(&entry.js),
            "`{}`'s signature does not start with the name a program calls: {}",
            entry.js,
            entry.signature
        );
    }

    // The projection the docs runtime reads carries the same gates, which is what makes a withheld
    // `read_file` withhold `view.openFile`'s *documentation* as well as the function.
    let functions = catalogue_functions();
    let projected = |name: &str| {
        functions
            .iter()
            .find(|function| function.name == name)
            .unwrap_or_else(|| panic!("`{name}` is documented"))
    };
    assert_eq!(projected("openFile").gate, Some("read_file"));
    assert_eq!(projected("openFile").object, "view");
    assert!(projected("openText").gate.is_none());
    assert!(projected("openText").ending.is_none());
    assert!(!projected("current").summary.is_empty());
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
/// The documentation directory the [docs carve-out](crate::docs) reads carries, for each function,
/// the object it lives on and the gg tool that gates it — `None` for a carve-out always bound.
#[test]
fn catalogue_functions_carry_object_and_gate() {
    let functions = catalogue_functions();

    // `finish` is always bound (no gate) and lives on `harness`.
    let finish = functions
        .iter()
        .find(|function| function.name == "finish")
        .expect("finish is documented");
    assert_eq!(finish.object, "harness");
    assert!(
        finish.gate.is_none(),
        "finish is not gated by any capability"
    );

    // A tool is gated by its own gg tool name and grouped under its object.
    let read = functions
        .iter()
        .find(|function| function.name == "readFile")
        .expect("readFile is documented");
    assert_eq!(read.object, "fs");
    assert_eq!(read.gate, Some("read_file"));
    assert!(!read.summary.is_empty(), "every function carries a summary");

    // The helper is gated by the tool it wraps, and lives on that tool's object.
    let helper = functions
        .iter()
        .find(|function| function.name == "readTextFile")
        .expect("readTextFile is documented");
    assert_eq!(helper.object, "fs");
    assert_eq!(helper.gate, Some("read_file"));
}

/// A type's declaration is returned verbatim, so what a doc lookup shows is what the SDK wrote — and
/// a type the catalogue does not carry is `None` rather than a fabricated declaration.
#[test]
fn type_declaration_returns_the_sdks_own_declaration() {
    assert!(
        type_declaration("DirEntry")
            .expect("DirEntry is declared")
            .contains("interface DirEntry"),
    );
    assert!(type_declaration("NoSuchType").is_none());
}
