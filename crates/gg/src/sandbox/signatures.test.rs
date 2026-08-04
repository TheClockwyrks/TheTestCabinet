//! Tests for the committed signature catalogue the [docs carve-out](crate::docs) reads.
//!
//! What these guard is subtle but expensive to get wrong: the catalogue is the *only* description of
//! this API a model ever sees, served on demand through `fn.docs()`. A catalogue that has drifted
//! from the guest does not fail loudly — it hands a model a signature that does not exist, and every
//! program it writes against it is wrong in a way it cannot diagnose.

use test_cabinet_core::gg::GgProgramLanguage;

use super::*;
use crate::sandbox::FINISH_FUNCTION;
use crate::sandbox::language;
use crate::tools::ALL_TOOL_NAMES;

/// The language whose committed catalogue these cases read: **TypeScript's**, named explicitly.
///
/// Every expectation below is a spelling — `readFile`, `requestChanges`, `interface DirEntry` — and
/// a spelling is exactly what the [seam](crate::sandbox::ProgramLanguage) declares free to differ
/// between languages. So these are assertions about TypeScript's SDK, and they say so, rather than
/// about whichever language happens to be gg's default.
///
/// What is *not* here is anything that must hold for **every** registered language, or that compares
/// two languages: the tool bijection, the type closure, the ending vocabulary, the gates and the
/// spelling-uniqueness rules all live in the [agreement gate](crate::sandbox::language) now, stated
/// once and applied to every language there is.
fn typescript() -> &'static dyn ProgramLanguage {
    language(GgProgramLanguage::TypeScript)
}

/// TypeScript's committed catalogue.
fn catalogue() -> &'static SignatureCatalogue {
    typescript().catalogue()
}

/// The committed catalogue parses, is not empty, and says whose it is.
#[test]
fn the_committed_catalogue_parses() {
    let catalogue = catalogue();
    assert!(!catalogue.tools.is_empty());
    assert!(!catalogue.types.is_empty());
    assert!(
        !catalogue.generated_from.is_empty(),
        "the catalogue records where it was generated from"
    );
    assert_eq!(
        catalogue.language,
        typescript().id(),
        "a catalogue records the language it was generated for, and the language that embedded it \
         checks it got its own"
    );
}

/// **Every function that is not a gg tool carries a `key`.**
///
/// A tool's identity is its gg tool name; the carve-outs have none, so the key is the only thing
/// that says a second language's `request_changes` and this one's `requestChanges` are one function.
/// Without it the surfaces of two languages could only be compared by spelling, which is precisely
/// the thing a cross-language study leaves free to differ.
#[test]
fn every_carve_out_entry_carries_an_identity() {
    let catalogue = catalogue();
    let keys = catalogue
        .session
        .iter()
        .map(|entry| (entry.key.as_str(), entry.name.as_str()))
        .chain(
            catalogue
                .views
                .iter()
                .map(|entry| (entry.key.as_str(), entry.name.as_str())),
        )
        .chain(
            catalogue
                .programs
                .iter()
                .map(|entry| (entry.key.as_str(), entry.name.as_str())),
        )
        .chain(
            catalogue
                .helpers
                .iter()
                .map(|entry| (entry.key.as_str(), entry.name.as_str())),
        );

    let mut seen: Vec<&str> = Vec::new();
    for (key, name) in keys {
        assert!(!key.is_empty(), "`{name}` has no identity of its own");
        assert!(
            !seen.contains(&key),
            "two functions claim the identity `{key}`"
        );
        seen.push(key);
    }

    // The projection the docs runtime reads carries a tool's identity too — its own gg tool name,
    // which is why a tool needs no separate key.
    let functions = catalogue_functions(typescript());
    let read = functions
        .iter()
        .find(|function| function.name == "readFile")
        .expect("readFile is documented");
    assert_eq!(read.key, "read_file");
    let request_changes = functions
        .iter()
        .find(|function| function.name == "requestChanges")
        .expect("requestChanges is documented");
    assert_eq!(request_changes.key, "request_changes");
}

/// `readTextFile` is a **helper**, not a gg tool: it wraps `read_file` for the common case, and
/// listing it among the tools would put a name in the model's head that no capability controls.
#[test]
fn read_text_file_is_a_helper_not_a_tool() {
    assert!(
        catalogue()
            .tools
            .iter()
            .all(|entry| entry.name != "readTextFile"),
        "the helper is listed as a tool"
    );
    let helper = catalogue()
        .helpers
        .iter()
        .find(|helper| helper.name == "readTextFile")
        .expect("the helper is catalogued");
    assert_eq!(
        helper.requires, "read_file",
        "the helper is bound only when the tool it wraps is"
    );
}

/// **TypeScript spells its four ending calls the way its SDK declares them**, on the objects gg
/// groups them under.
///
/// That every language carries these four, tagged with the [role](crate::ending::EndingRole) whose
/// programs bind it, is the [agreement gate](crate::sandbox::language)'s to assert — it is identity,
/// and it holds for a language nobody has written yet. What is left here is the half that is
/// TypeScript's alone: the exact signature a doc lookup renders, which is prompt text a model reads
/// and acts on, and the object each call hangs off, which the console groups by.
///
/// The `void` in each signature is load-bearing: it tells a model at a glance that the call returns
/// like any other, so what follows it still runs.
#[test]
fn typescript_spells_its_ending_calls_as_its_sdk_declares_them() {
    let by_name = |name: &str| {
        catalogue()
            .session
            .iter()
            .find(|entry| entry.name == name)
            .unwrap_or_else(|| panic!("`{name}` is catalogued"))
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
            entry.name,
            entry.doc
        );
    }
}

/// **TypeScript's `view` object is the five functions its SDK declares, spelled as it declares
/// them.**
///
/// Which functions the object carries and what gates them is identity — a file view is a read
/// whatever language asks for it — and the [agreement gate](crate::sandbox::language) asserts that
/// for every language, including the ones with no committed component yet. What stays here is
/// TypeScript's own spelling of them, and the count, which is this SDK's surface rather than a rule
/// about surfaces.
#[test]
fn typescript_spells_its_view_calls_as_its_sdk_declares_them() {
    let by_name = |name: &str| {
        catalogue()
            .views
            .iter()
            .find(|entry| entry.name == name)
            .unwrap_or_else(|| panic!("`{name}` is catalogued"))
    };

    let open_file = by_name("openFile");
    assert_eq!(open_file.object, "view");
    assert_eq!(
        open_file.requires.as_deref(),
        Some("read_file"),
        "opening a file view is a read, and closes with reading"
    );

    for name in ["openText", "openDocsView", "close", "current"] {
        let entry = by_name(name);
        assert_eq!(entry.object, "view");
        assert!(
            entry.requires.is_none(),
            "`{name}` is bound whatever a run enables"
        );
    }

    assert_eq!(
        catalogue().views.len(),
        5,
        "the view surface is the five functions and nothing else"
    );

    // The projection the docs runtime reads carries the same gates, which is what makes a withheld
    // `read_file` withhold `view.openFile`'s *documentation* as well as the function.
    let functions = catalogue_functions(typescript());
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
            entry.name, FINISH_FUNCTION,
            "the gg tool `{}` binds the name the session function needs",
            entry.tool
        );
    }
    for helper in &catalogue().helpers {
        assert_ne!(
            helper.name, FINISH_FUNCTION,
            "a helper binds the name the session function needs"
        );
    }
}
/// The documentation directory the [docs carve-out](crate::docs) reads carries, for each function,
/// the object it lives on and the gg tool that gates it — `None` for a carve-out always bound.
#[test]
fn catalogue_functions_carry_object_and_gate() {
    let functions = catalogue_functions(typescript());

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
        type_declaration(typescript(), "DirEntry")
            .expect("DirEntry is declared")
            .contains("interface DirEntry"),
    );
    assert!(type_declaration(typescript(), "NoSuchType").is_none());
}

/// **The picture channel the catalogue describes is the one gg implements.**
///
/// These two docs are the only place a code-mode model can learn how looking at an image works
/// before it tries, and they used to contradict both gg and each other: `fs.readFile` promised that
/// "an image's pixels are shown to you" one sentence before saying `view.openFile` is the call that
/// shows a file. A model that reads the first half calls `readFile` on a reference mockup and then
/// reasons about a picture it was never shown — the exact misconception the one-channel rule exists
/// to prevent, delivered by gg's own documentation.
///
/// A doc string cannot be type-checked against behaviour, so this pins the two claims that matter:
/// a bare read does not show, and a view can be refused.
#[test]
fn the_catalogue_tells_the_truth_about_pictures() {
    let read = catalogue()
        .tools
        .iter()
        .find(|entry| entry.name == "readFile")
        .expect("readFile is catalogued");
    assert!(
        !read.doc.contains("pixels are shown to you"),
        "`fs.readFile` must not promise a picture it does not show: {}",
        read.doc
    );
    assert!(
        read.doc.contains("does not show it to YOU"),
        "`fs.readFile` must say plainly that reading an image does not show it: {}",
        read.doc
    );
    assert!(
        read.doc.contains("view.openFile"),
        "`fs.readFile` must name the call that does show it: {}",
        read.doc
    );

    let open_file = catalogue()
        .views
        .iter()
        .find(|entry| entry.name == "openFile")
        .expect("openFile is catalogued");
    assert!(
        open_file.doc.contains("imageViewCap"),
        "`view.openFile` must name the cap an operator configures: {}",
        open_file.doc
    );
    assert!(
        open_file.doc.contains("limit-exceeded") && open_file.doc.contains("view.close"),
        "`view.openFile` must say how the cap fails and how to recover from it: {}",
        open_file.doc
    );
}
