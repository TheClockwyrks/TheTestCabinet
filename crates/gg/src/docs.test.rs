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

/// The `harness` object always carries `finish` and the two meta functions, whatever a run enables.
#[test]
fn harness_always_carries_finish_readdocs_and_list() {
    let docs = DocsRuntime::new(Vec::new(), EndingRole::Standard);
    let harness = docs.list("harness");
    let names: Vec<&str> = harness.iter().map(|f| f.name.as_str()).collect();
    assert!(names.contains(&"finish"), "{names:?}");
    assert!(names.contains(&"readDocs"), "{names:?}");
    assert!(names.contains(&"list"), "{names:?}");
}

/// A doc lookup returns the signature and description, and includes a referenced type's declaration
/// the first time it is shown but not the second — the session-level dedup only gg can do.
#[test]
fn read_includes_a_referenced_type_only_once() {
    let mut docs = DocsRuntime::new(enabled(), EndingRole::Standard);

    let first = docs.read("readFile").expect("readFile is bound");
    assert!(first.fresh, "the first read of a function is fresh");
    assert!(
        first.text.contains("readFile("),
        "the signature is included: {}",
        first.text
    );
    assert!(
        first.text.contains("FileRead"),
        "the referenced type's declaration is shown the first time: {}",
        first.text
    );

    // A second read of the same function is not fresh, and does not re-show the type.
    let second = docs.read("readFile").expect("readFile is bound");
    assert!(!second.fresh, "a repeat read is not fresh");
    assert!(
        !second.text.contains("interface FileRead"),
        "the type declaration is not repeated: {}",
        second.text
    );
}

/// A lookup for a function the run did not enable is `None` — the model is told the name is not
/// available rather than shown docs for a method its scope does not carry.
#[test]
fn read_of_a_withheld_function_is_none() {
    let mut docs = DocsRuntime::new(vec!["read_file".to_string()], EndingRole::Standard);
    assert!(docs.read("writeFile").is_none());
}

/// The meta functions document themselves.
#[test]
fn read_documents_the_meta_functions() {
    let mut docs = DocsRuntime::new(Vec::new(), EndingRole::Standard);
    assert!(
        docs.read("list")
            .expect("list is a meta function")
            .text
            .contains("FunctionSummary")
    );
    assert!(
        docs.read("readDocs")
            .expect("readDocs is a meta function")
            .text
            .contains("readDocs(")
    );
}
