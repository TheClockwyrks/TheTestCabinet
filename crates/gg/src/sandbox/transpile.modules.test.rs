//! Tests for [`transpile_module`] — the pass that turns a code skill or memory into a function body
//! returning its namespace.

use super::*;

/// The generated epilogue, as a haystack the assertions look for their names in.
fn epilogue(js: &str) -> String {
    js.lines()
        .rev()
        .find(|line| line.trim_start().starts_with("return {"))
        .unwrap_or_default()
        .to_string()
}

#[test]
fn exported_declarations_become_the_namespace() {
    let module = transpile_module(
        "export function parse(text: string): string[] { return text.split(\",\"); }\n\
         export const VERSION = 2;\n\
         function helper() { return 1; }\n",
    )
    .expect("a plain module transpiles");

    // Only what it exported — `helper` is internal, and a file that says what it exports means it.
    assert_eq!(
        module.exports,
        vec!["parse".to_string(), "VERSION".to_string()]
    );
    assert!(epilogue(&module.js).contains("parse"));
    assert!(!epilogue(&module.js).contains("helper"));
    // The `export` keyword is gone, so the body is legal inside a `new Function`.
    assert!(!module.js.contains("export "));
}

#[test]
fn a_module_with_no_exports_at_all_exports_everything_it_declares() {
    let module = transpile_module("function a() {}\nconst b = 1;\nclass C {}\n")
        .expect("an export-free module transpiles");
    assert_eq!(
        module.exports,
        vec!["a".to_string(), "b".to_string(), "C".to_string()]
    );
}

#[test]
fn a_specifier_export_names_the_exported_half() {
    let module = transpile_module("function rows() {}\nexport { rows as toRows };\n")
        .expect("a specifier export transpiles");
    // The namespace offers `toRows`; the object literal maps it onto the local `rows`.
    assert_eq!(module.exports, vec!["toRows".to_string()]);
    assert!(epilogue(&module.js).contains("toRows: rows"));
}

#[test]
fn destructured_bindings_are_all_exported() {
    let module = transpile_module("export const { a, b } = { a: 1, b: 2 };\n")
        .expect("a destructuring export transpiles");
    assert_eq!(module.exports, vec!["a".to_string(), "b".to_string()]);
}

#[test]
fn type_only_declarations_are_not_exported() {
    let module = transpile_module(
        "export interface Row { a: string }\nexport type Rows = Row[];\nexport const n = 1;\n",
    )
    .expect("type exports transpile");
    // Types do not exist at run time, so a namespace entry for one would be `undefined`.
    assert_eq!(module.exports, vec!["n".to_string()]);
}

#[test]
fn types_are_stripped_from_a_module_as_they_are_from_a_program() {
    let module = transpile_module("export const n: number = 1;\n").expect("types strip");
    assert!(!module.js.contains(": number"));
}

#[test]
fn blanking_preserves_the_line_a_later_error_is_reported_on() {
    // The syntax error is on line 4; the `export` keywords above it are blanked in place, so the
    // diagnostic must still say 4 rather than a line in a re-printed file.
    let error = transpile_module(
        "export function a() {}\n\
         export const b = 1;\n\
         export class C {}\n\
         const d = ;\n",
    )
    .expect_err("a syntax error is refused");
    assert!(
        format!("{error}").contains("line 4"),
        "the diagnostic must locate itself in the author's own file: {error}"
    );
}

#[test]
fn cross_file_module_syntax_is_refused_by_name() {
    for (source, keyword) in [
        ("import { x } from \"y\";\n", "import"),
        ("export * from \"y\";\n", "export *"),
        ("export { x } from \"y\";\n", "export … from"),
    ] {
        let error = transpile_module(source).expect_err("cross-file syntax is refused");
        let message = format!("{error}");
        assert!(
            message.contains(keyword),
            "the refusal must name what was written ({keyword}): {message}"
        );
        assert!(message.contains("no module loader"), "{message}");
    }
}

#[test]
fn a_default_export_is_refused_because_a_namespace_is_made_of_names() {
    let error =
        transpile_module("export default function () {}\n").expect_err("a default is refused");
    assert!(format!("{error}").contains("export default"));
}

#[test]
fn a_top_level_await_is_refused_with_the_synchronous_explanation() {
    let error = transpile_module("export const x = await something();\n")
        .expect_err("top-level await is refused");
    assert!(format!("{error}").contains("synchronous"), "{error}");
}

#[test]
fn a_dynamic_import_is_refused() {
    let error = transpile_module("export const x = import(\"y\");\n")
        .expect_err("a dynamic import is refused");
    assert!(format!("{error}").contains("no loader"), "{error}");
}

/// A module is not refused for its length either: a big authored library transpiles like a small
/// one, on a stack sized for it.
#[test]
fn a_very_large_module_transpiles() {
    let source = format!("export const x = \"{}\";\n", "a".repeat(256 * 1024));
    let module = transpile_module(&source).expect("a very large module transpiles");
    assert_eq!(module.exports, vec!["x".to_string()]);
}

#[test]
fn an_empty_module_still_returns_an_object() {
    let module = transpile_module("// nothing here\n").expect("an empty module transpiles");
    assert!(module.exports.is_empty());
    // An empty namespace is a truthful answer; `undefined` would look like a module that failed.
    assert!(module.js.contains("return {  };"));
}
