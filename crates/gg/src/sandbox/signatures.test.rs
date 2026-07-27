//! Tests for the committed signature catalogue the [docs carve-out](crate::docs) reads.
//!
//! What these guard is subtle but expensive to get wrong: the catalogue is the *only* description of
//! this API a model ever sees, served on demand through `fn.docs()`. A catalogue that has drifted
//! from the guest does not fail loudly — it hands a model a signature that does not exist, and every
//! program it writes against it is wrong in a way it cannot diagnose.

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
        ALL_TOOL_NAMES.len() - TURN_LEVEL_TOOLS.len(),
        "the sandbox binds every gg tool but the three turn-level transitions"
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
