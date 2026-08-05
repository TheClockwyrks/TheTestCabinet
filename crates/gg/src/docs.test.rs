//! Tests for the [documentation carve-out runtime](super::DocsRuntime).

use test_cabinet_core::gg::GgProgramLanguage;

use super::*;
use crate::ending::EndingRole;

/// The scope-bound tool names a full run offers, as gg expresses its enabled set — enough to bind
/// `fs`, `system`, and `project`.
fn enabled() -> Vec<String> {
    ["read_file", "write_file", "shell", "create_issue"]
        .into_iter()
        .map(str::to_string)
        .collect()
}

/// An object's directory lists its bound functions with summaries, plus the `list` meta function
/// every object carries — and only the functions the run enabled.
#[test]
fn list_enumerates_bound_functions_and_the_list_meta() {
    let docs = DocsRuntime::new(
        enabled(),
        EndingRole::Standard,
        false,
        GgProgramLanguage::TypeScript,
    );
    let fs = docs.list("fs");
    let names: Vec<&str> = fs.iter().map(|f| f.name.as_str()).collect();
    assert!(names.contains(&"readFile"), "{names:?}");
    assert!(names.contains(&"writeFile"), "{names:?}");
    assert!(
        names.contains(&"list"),
        "every object carries `list`: {names:?}"
    );
    // `edit_file` was not enabled, so `editFile` is not listed.
    assert!(!names.contains(&"editFile"), "{names:?}");
    // Every entry carries a non-empty one-line summary.
    assert!(fs.iter().all(|f| !f.summary.is_empty()));
}

/// The `harness` object always carries `finish` and `list`, whatever a run enables.
///
/// It no longer carries `readDocs`: reading a function's documentation is
/// `view.openDocsView`, on the object that owns every other channel into the model's window.
#[test]
fn harness_always_carries_finish_and_list() {
    let docs = DocsRuntime::new(
        Vec::new(),
        EndingRole::Standard,
        false,
        GgProgramLanguage::TypeScript,
    );
    let harness = docs.list("harness");
    let names: Vec<&str> = harness.iter().map(|f| f.name.as_str()).collect();
    assert!(names.contains(&"finish"), "{names:?}");
    assert!(names.contains(&"list"), "{names:?}");
    assert!(!names.contains(&"readDocs"), "{names:?}");
}

/// The `view` object carries `openDocsView`, ungated — a run that enables no tools at all must still
/// be able to read what the functions it *does* have do.
#[test]
fn view_always_carries_open_docs_view() {
    let docs = DocsRuntime::new(
        Vec::new(),
        EndingRole::Standard,
        false,
        GgProgramLanguage::TypeScript,
    );
    let names: Vec<String> = docs.list("view").into_iter().map(|f| f.name).collect();
    assert!(names.iter().any(|n| n == "openDocsView"), "{names:?}");
}

/// A doc lookup returns the signature, the description, and every referenced type's declaration —
/// **every time**, with no dedup against what an earlier lookup showed.
///
/// That is a property of documentation being a [view](crate::context::ViewKind::Docs) rather than a
/// pinned block: a view can be closed and it can be replaced, so a block that omitted a declaration
/// because some *other* block already carried it would stop making sense the moment the model tidied
/// up. Each one has to read correctly on its own.
#[test]
fn every_lookup_is_self_contained() {
    let docs = DocsRuntime::new(
        enabled(),
        EndingRole::Standard,
        false,
        GgProgramLanguage::TypeScript,
    );

    let first = docs.read("readFile").expect("readFile is bound");
    assert!(
        first.contains("readFile("),
        "the signature is included: {first}"
    );
    assert!(
        first.contains("FileRead"),
        "the referenced type's declaration is included: {first}"
    );

    // A second lookup says exactly the same thing. A repeat that quietly said less would be a view
    // the model could not trust to be complete.
    let second = docs.read("readFile").expect("readFile is bound");
    assert_eq!(first, second);
}

/// **A lookup says what each argument is for, and what each field of the result means.**
///
/// A signature and a paragraph leave a model to infer the rest from names alone, and the two things
/// it has to infer are exactly the two it cannot: what to put in an argument it has never passed,
/// and what a field of a returned record means. Both are the SDK's own words — reflected out of the
/// `@param` written on the argument and the comment written above the member — so this is also the
/// assertion that the reflection reaches the model rather than stopping at the committed JSON.
#[test]
fn a_lookup_explains_every_argument_and_every_field() {
    let docs = DocsRuntime::new(
        enabled(),
        EndingRole::Standard,
        false,
        GgProgramLanguage::TypeScript,
    );
    let read_file = docs.read("readFile").expect("readFile is bound");

    // The argument, and the fields of the structured argument nested under it.
    assert!(read_file.contains("\n  path: string — "), "{read_file}");
    assert!(read_file.contains("\n  options?: "), "{read_file}");
    assert!(
        read_file.contains("\n    offset?: number — "),
        "{read_file}"
    );

    // And the referenced type: its own paragraph, then a line per member.
    assert!(
        read_file.contains("What `readFile` returned"),
        "the type is explained, not just declared: {read_file}"
    );
    assert!(
        read_file.contains("\n  totalLines: number — "),
        "{read_file}"
    );
}

/// **An argument passed by name says so, and a positional one is silent.**
///
/// The one property of an argument that changes what the model has to *type*: under a language that
/// passes by name, the call site writes the argument's name as well as its value, and a model that
/// read only the name and the type would write it positionally and be refused.
///
/// Built from a parameter rather than read out of a catalogue because no registered language passes
/// by name yet — TypeScript is positional throughout, so a catalogue-driven test could only assert
/// the silent half. The point of the test is that the renderer is ready for the first language that
/// is not, rather than carrying the distinction as far as the JSON and dropping it.
#[test]
fn an_argument_passed_by_name_is_marked_and_a_positional_one_is_not() {
    let parameter = |kind: &str| -> Parameter {
        serde_json::from_value(serde_json::json!({
            "name": "limit",
            "type": "number",
            "optional": true,
            "kind": kind,
            "default": null,
            "doc": "How many lines to read.",
            "fields": [],
        }))
        .expect("a parameter")
    };

    let mut positional = String::new();
    describe(&mut positional, &parameter("positional"), 1);
    assert_eq!(
        positional, "  limit?: number — How many lines to read.\n",
        "a positional argument carries no marker: it is every argument in every language that \
         passes by position"
    );

    let mut keyword = String::new();
    describe(&mut keyword, &parameter("keyword"), 1);
    assert_eq!(
        keyword,
        "  limit?: number (passed by name) — How many lines to read.\n"
    );
}

/// A union's arms are members too — named by the literal, with no type beside them, because the arm
/// *is* the value. A model choosing between `pending` and `in_progress` is choosing between two
/// values whose difference is prose, and nothing but the prose can tell it which to write.
#[test]
fn a_lookup_explains_the_arms_of_a_union() {
    let docs = DocsRuntime::new(
        vec!["update_issue".to_string()],
        EndingRole::Standard,
        false,
        GgProgramLanguage::TypeScript,
    );
    let update_issue = docs.read("updateIssue").expect("updateIssue is bound");
    assert!(
        update_issue.contains("\n  \"in_progress\" — "),
        "{update_issue}"
    );
}

/// A lookup for a function the run did not enable is `None` — the model is told the name is not
/// available rather than shown docs for a method its scope does not carry.
#[test]
fn read_of_a_withheld_function_is_none() {
    let docs = DocsRuntime::new(
        vec!["read_file".to_string()],
        EndingRole::Standard,
        false,
        GgProgramLanguage::TypeScript,
    );
    assert!(docs.read("writeFile").is_none());
}

/// The one meta function documents itself, so `view.openDocsView("list")` is answerable even though
/// `list` has no catalogue entry of its own.
#[test]
fn read_documents_the_list_meta_function() {
    let docs = DocsRuntime::new(
        Vec::new(),
        EndingRole::Standard,
        false,
        GgProgramLanguage::TypeScript,
    );
    let list = docs.read("list").expect("list is a meta function");
    // Its signature, its paragraph and its return type all come from the SDK declaration the guest
    // binds it from — including `FunctionSummary`'s own declaration, which a lookup that named a
    // return type it could not then define would have left the model to guess at.
    assert!(list.contains("list(): FunctionSummary[]"), "{list}");
    assert!(list.contains("interface FunctionSummary"), "{list}");
    assert!(list.contains("summary"), "{list}");
    // And it points at the call that opens a function's full documentation.
    assert!(list.contains("view.openDocsView"), "{list}");
    assert!(docs.read("readDocs").is_none(), "`readDocs` is retired");
}

/// A missed lookup is answered with the bound names nearest it — the tool name the model wrote
/// instead of the spelling, and the stem it completed by guess.
#[test]
fn a_miss_suggests_the_bound_names_nearest_it() {
    let docs = DocsRuntime::new(
        enabled(),
        EndingRole::Standard,
        false,
        GgProgramLanguage::TypeScript,
    );
    assert_eq!(docs.suggest("write_file"), vec!["writeFile"]);
    assert_eq!(docs.suggest("write"), vec!["writeFile"]);
    // The meta function is a candidate like any other: it is bound on every object, and `read`
    // answers it.
    assert_eq!(docs.suggest("lists"), vec!["list"]);
}

/// **A suggestion is drawn from this agent's scope, never from the catalogue.**
///
/// The failure a whole-catalogue hint would cause is the worst kind: the model reads a plausible
/// name gg itself offered, writes the call, and is answered with a `ReferenceError`. So a run that
/// withheld `write_file` does not hear `writeFile` back — from the lookup or from the hint.
#[test]
fn a_suggestion_never_names_a_function_this_agent_lacks() {
    let docs = DocsRuntime::new(
        vec!["read_file".to_string()],
        EndingRole::Standard,
        false,
        GgProgramLanguage::TypeScript,
    );
    assert!(docs.read("writeFile").is_none());
    assert!(
        docs.suggest("write_file").is_empty(),
        "`writeFile` is not bound, so it is not offered: {:?}",
        docs.suggest("write_file")
    );
    // What *is* bound is still offered, on the same query shape.
    assert_eq!(docs.suggest("read_file"), vec!["readFile"]);

    // The ending gate is a scope like any other: a reviewer's verdicts are not suggested to an
    // agent doing work, and `finish` is not suggested to a reviewer.
    let worker = DocsRuntime::new(
        enabled(),
        EndingRole::Standard,
        false,
        GgProgramLanguage::TypeScript,
    );
    assert!(worker.suggest("request_changes").is_empty());
    let reviewer = DocsRuntime::new(
        enabled(),
        EndingRole::Review,
        false,
        GgProgramLanguage::TypeScript,
    );
    assert_eq!(reviewer.suggest("request_changes"), vec!["requestChanges"]);
    assert!(reviewer.suggest("finsih").is_empty());
}

/// The **third gate**: the program library, which neither the enabled set nor the ending role can
/// express.
///
/// It is documented exactly when the capability is on, because a directory that lists a function the
/// scope did not bind is the one thing a directory must never do — and the failure it would produce
/// is the worst kind: the model reads a plausible signature, writes the call, and is answered with a
/// `ReferenceError` about a name gg itself named.
#[test]
fn the_program_library_is_documented_only_when_the_agent_keeps_one() {
    let without = DocsRuntime::new(
        enabled(),
        EndingRole::Standard,
        false,
        GgProgramLanguage::TypeScript,
    );
    assert!(without.read("rerun").is_none());
    assert_eq!(
        without
            .list("programs")
            .iter()
            .map(|f| f.name.as_str())
            .collect::<Vec<_>>(),
        vec!["list"],
        "an unknown object lists the meta function alone"
    );

    let with = DocsRuntime::new(
        enabled(),
        EndingRole::Standard,
        true,
        GgProgramLanguage::TypeScript,
    );
    let listed = with.list("programs");
    let names: Vec<&str> = listed.iter().map(|f| f.name.as_str()).collect();
    assert!(names.contains(&"history"), "{names:?}");
    assert!(names.contains(&"get"), "{names:?}");
    assert!(names.contains(&"rerun"), "{names:?}");
    let doc = with
        .read("rerun")
        .expect("the library's calls are documented");
    assert!(doc.contains("rerun(source: string)"), "{doc}");

    // The gate is the library's alone: it does not withdraw anything else, and it is not withdrawn
    // by an ending role.
    assert!(with.read("readFile").is_some());
    let reviewer = DocsRuntime::new(
        enabled(),
        EndingRole::Review,
        true,
        GgProgramLanguage::TypeScript,
    );
    assert!(reviewer.read("get").is_some());
}
