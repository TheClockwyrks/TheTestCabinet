//! Tests for the TypeScript front end.

use super::*;
use crate::caps::{derived_stack_bytes, on_stack};

/// Parse a TypeScript source, failing loudly rather than returning `None` into an assertion.
fn facts(source: &str) -> FileFacts {
    analyze("src/game.ts", source).expect("the fixture parses")
}

#[test]
fn a_file_that_does_not_parse_reports_nothing_rather_than_a_partial_count() {
    assert!(
        analyze("src/broken.ts", "export function f( {").is_none(),
        "a file with a syntax error has no honest function count"
    );
}

/// Every function form is scored, and each is named by whatever the source gives it.
#[test]
fn every_function_form_is_named_and_scored() {
    let facts = facts(
        "export function declared(a: number) { return a; }\n\
         const arrow = (a: number) => a;\n\
         class Sprite { draw(a: number) { return a; } }\n",
    );
    let names: Vec<&str> = facts
        .functions
        .iter()
        .map(|function| function.name.as_str())
        .collect();
    assert!(names.contains(&"declared"), "{names:?}");
    assert!(
        names.contains(&"arrow"),
        "an arrow takes its binding's name: {names:?}"
    );
    assert!(names.contains(&"draw"), "a method takes its key: {names:?}");
}

/// A function declared inside another nests the outer one, because burying a branch is
/// exactly what makes it harder to read.
#[test]
fn an_inner_function_nests_the_outer_one() {
    let facts = facts(
        "export function outer(a: boolean) {\n\
           return () => { if (a) { return 1; } return 0; };\n\
         }\n",
    );
    let outer = facts
        .functions
        .iter()
        .find(|function| function.name == "outer")
        .expect("the outer function is scored");
    assert_eq!(
        outer.max_nesting, 1,
        "the inner function is a nesting level"
    );
    assert_eq!(
        outer.cyclomatic, 1,
        "the inner function's branch belongs to the inner function"
    );
}

/// Exports come from all four spellings, and a barrel is recorded as a re-export so the
/// reference counter can credit it.
#[test]
fn exports_and_barrels_are_recorded() {
    let facts = facts(
        "export const speed = 1;\n\
         export function tick() {}\n\
         export interface Entity { id: string }\n\
         export { helper } from './helpers';\n\
         export * from './entities';\n\
         export default function main() {}\n",
    );
    let mut exports = facts.exports.clone();
    exports.sort();
    assert_eq!(
        exports,
        vec!["Entity", "default", "helper", "speed", "tick"]
    );
    let barrels: Vec<&str> = facts
        .imports
        .iter()
        .filter(|import| import.reexport)
        .map(|import| import.specifier.as_str())
        .collect();
    assert_eq!(barrels, vec!["./helpers", "./entities"]);
}

/// The type-discipline counters, all syntactic. `as const` is deliberately not a cast: it
/// narrows a literal rather than overriding the checker, and counting it would punish the
/// one assertion that is always safe.
#[test]
fn the_type_discipline_counters_are_syntactic() {
    let facts = facts(
        "// @ts-expect-error deliberate\n\
         export function f(a: any, b: unknown) {\n\
           const c = a!;\n\
           const d = b as string;\n\
           const e = { kind: 'ship' } as const;\n\
           return [c, d, e];\n\
         }\n",
    );
    assert_eq!(facts.typescript.any_occurrences, 1);
    assert_eq!(facts.typescript.unknown_occurrences, 1);
    assert_eq!(facts.typescript.suppression_comments, 1);
    assert_eq!(facts.typescript.non_null_assertions, 1);
    assert_eq!(
        facts.typescript.assertion_casts, 1,
        "`as const` is not an assertion cast"
    );
}

/// The annotation ratios split the exported surface out, because the API boundary is the
/// one that actually matters.
#[test]
fn annotation_counts_separate_the_exported_surface() {
    let facts = facts(
        "export function api(a: number): number { return a; }\n\
         function internal(a) { return a; }\n",
    );
    assert_eq!(facts.typescript.functions, 2);
    assert_eq!(facts.typescript.annotated_returns, 1);
    assert_eq!(facts.typescript.parameters, 2);
    assert_eq!(facts.typescript.annotated_parameters, 1);
    assert_eq!(facts.typescript.exported_functions, 1);
    assert_eq!(facts.typescript.exported_annotated_returns, 1);
}

/// A namespace import's member access is folded into the identifier map — which is the only
/// reason `import * as ns` then `ns.render` can be seen at all.
#[test]
fn namespace_member_access_is_visible_to_the_reference_counter() {
    let facts = facts("import * as entities from './entities';\nentities.spawn(1);\n");
    assert!(
        facts.identifiers.contains_key("spawn"),
        "a namespace member must be counted: {:?}",
        facts.identifiers.keys().collect::<Vec<_>>()
    );
}

#[test]
fn test_calls_mark_a_file_as_test_code() {
    let facts = analyze(
        "src/game.ts",
        "it('spawns', () => {});\ntest('ticks', () => {});\n",
    )
    .expect("the fixture parses");
    assert_eq!(facts.test_functions, 2);
    assert!(facts.is_test, "a file that declares tests is test code");
}

/// **The TypeScript calibration.** The hungriest bracket-free shape parses on the stack the
/// per-byte derivation gives it — *unclamped*, so what is exercised is the derivation itself
/// rather than the 64 MiB floor that would otherwise dominate at a testable size.
///
/// This is what keeps `STACK_BYTES_PER_SOURCE_BYTE` honest for this front end. It cannot
/// prove the figure is not too *small* by finding the shape that overflows — an overflow is
/// `SIGABRT` and would abort the test binary — so it proves the opposite direction: the
/// derivation, with its documented safety factor, still carries the worst shape measured.
#[test]
fn typescript_stack_per_byte_calibration() {
    const SOURCE_BYTES: usize = 32 * 1024;
    let prelude = "const a = 1;\nexport const b = a";
    let assertions = "!".repeat(SOURCE_BYTES - prelude.len() - 1);
    let program = format!("{prelude}{assertions};");
    assert_eq!(program.len(), SOURCE_BYTES);

    let derived = derived_stack_bytes(SOURCE_BYTES);
    let parsed = on_stack(derived, || analyze("deep.ts", &program))
        .expect("the parse thread starts and does not panic");
    assert!(
        parsed.is_some(),
        "the derived {derived}-byte stack must carry a {SOURCE_BYTES}-byte chain of the \
         hungriest measured shape"
    );
}
