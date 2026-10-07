//! What the shared body cut owes the five arms whose declarations open a body with a brace.

use super::head;

/// **A body is cut and the declaration is kept**, for a function and for a type alike.
#[test]
fn a_body_is_cut_at_the_brace_that_opens_it() {
    assert_eq!(
        head("pub fn widen(text: &str) -> String {"),
        "pub fn widen(text: &str) -> String"
    );
    assert_eq!(
        head("export class Row extends Base {"),
        "export class Row extends Base"
    );
    assert_eq!(
        head("public static class Helpers {"),
        "public static class Helpers"
    );
}

/// **A brace inside a parameter list is not a body**, which is the whole reason the brackets are
/// counted: a destructured parameter is how a great deal of JavaScript is written.
#[test]
fn a_brace_inside_a_parameter_list_is_not_the_body() {
    assert_eq!(
        head("export function widen({ text, width }) {"),
        "export function widen({ text, width })"
    );
    assert_eq!(
        head("public static void render(Options o = {}) {"),
        "public static void render(Options o = {})"
    );
}

/// **A value is part of its declaration**, so a `=` at the top level cuts nothing.
#[test]
fn a_values_own_value_is_not_cut_away() {
    assert_eq!(
        head("constexpr int limits[] = {1, 2};"),
        "constexpr int limits[] = {1, 2};"
    );
    assert_eq!(
        head("pub static ROOT: Row = Row { id: 0 };"),
        "pub static ROOT: Row = Row { id: 0 };"
    );
    assert_eq!(
        head("export const limits = { rows: 10 };"),
        "export const limits = { rows: 10 };"
    );
}

/// **An arrow opens a body too**, which is how C# writes most of a small class and how ECMAScript
/// writes most of a small module.
#[test]
fn an_arrow_is_a_body_and_is_cut() {
    assert_eq!(head("public int Rows => rows.Count;"), "public int Rows");
    assert_eq!(
        head("public static int Add(int a, int b) => a + b;"),
        "public static int Add(int a, int b)"
    );
}

/// **A `=` before an arrow is still a value**, so a field holding a lambda is quoted whole rather
/// than cut in the middle of it.
#[test]
fn a_lambda_held_in_a_field_is_quoted_whole() {
    assert_eq!(
        head("public Func<int, int> Twice = x => x * 2;"),
        "public Func<int, int> Twice = x => x * 2;"
    );
    assert_eq!(
        head("export const twice = (x) => x * 2;"),
        "export const twice = (x) => x * 2;"
    );
}

/// **A brace left at the end of the line goes**, whether the cut found it or a value's line simply
/// ended on one.
#[test]
fn a_trailing_brace_is_never_left_behind() {
    assert_eq!(
        head("export const twice = (x) => {"),
        "export const twice = (x) =>"
    );
    assert_eq!(head("public var name: String {"), "public var name: String");
}

/// **A declaration with no body is quoted whole**, semicolon and all: that is a line a reader can
/// trust, and cutting anything off it would make it one they cannot.
#[test]
fn a_declaration_with_no_body_is_left_alone() {
    assert_eq!(head("pub struct Row;"), "pub struct Row;");
    assert_eq!(
        head("std::string widen(std::string_view text);"),
        "std::string widen(std::string_view text);"
    );
}

/// **An `==` opens neither**, so an operator declaration is not mistaken for a value.
#[test]
fn a_doubled_equals_is_not_a_value() {
    assert_eq!(
        head("public static bool operator ==(Row a, Row b) {"),
        "public static bool operator ==(Row a, Row b)"
    );
}
