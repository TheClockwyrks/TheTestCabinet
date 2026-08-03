//! Tests for the [documentation carve-out runtime](super::DocsRuntime).

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
    let docs = DocsRuntime::new(enabled(), EndingRole::Standard);
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
    let docs = DocsRuntime::new(Vec::new(), EndingRole::Standard);
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
    let docs = DocsRuntime::new(Vec::new(), EndingRole::Standard);
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
    let docs = DocsRuntime::new(enabled(), EndingRole::Standard);

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

/// A lookup for a function the run did not enable is `None` — the model is told the name is not
/// available rather than shown docs for a method its scope does not carry.
#[test]
fn read_of_a_withheld_function_is_none() {
    let docs = DocsRuntime::new(vec!["read_file".to_string()], EndingRole::Standard);
    assert!(docs.read("writeFile").is_none());
}

/// The one meta function documents itself, so `view.openDocsView("list")` is answerable even though
/// `list` has no catalogue entry of its own.
#[test]
fn read_documents_the_list_meta_function() {
    let docs = DocsRuntime::new(Vec::new(), EndingRole::Standard);
    let list = docs.read("list").expect("list is a meta function");
    assert!(list.contains("FunctionSummary"), "{list}");
    // And it now points at the call that replaced `fn.docs()`.
    assert!(list.contains("view.openDocsView"), "{list}");
    assert!(docs.read("readDocs").is_none(), "`readDocs` is retired");
}
