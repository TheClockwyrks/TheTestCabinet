//! **The parity suite.** The same control-flow shape, written in each language, must score
//! identically.
//!
//! This is what makes a cross-language comparison honest, and it is the only thing that
//! keeps it honest: the two front ends walk completely different trees, so nothing but a
//! paired fixture can catch one of them drifting from the shared definition. A change to
//! either walk that alters a score fails here rather than quietly making Rust runs look
//! simpler than TypeScript ones.

use crate::caps::parse_guarded;

/// Score the single function in each program and assert the pair agrees.
fn parity(shape: &str, typescript: &str, rust: &str, cyclomatic: u32, cognitive: u32) {
    let ts = one_function(shape, "typescript", typescript, |source| {
        crate::typescript::analyze("shape.ts", source)
    });
    let rs = one_function(shape, "rust", rust, |source| {
        crate::rust::analyze("shape.rs", source)
    });

    assert_eq!(
        (ts.cyclomatic, ts.cognitive),
        (cyclomatic, cognitive),
        "`{shape}` in TypeScript scored ({}, {}), expected ({cyclomatic}, {cognitive})",
        ts.cyclomatic,
        ts.cognitive
    );
    assert_eq!(
        (rs.cyclomatic, rs.cognitive),
        (cyclomatic, cognitive),
        "`{shape}` in Rust scored ({}, {}), expected ({cyclomatic}, {cognitive})",
        rs.cyclomatic,
        rs.cognitive
    );
    assert_eq!(
        ts.max_nesting, rs.max_nesting,
        "`{shape}` nests to depth {} in TypeScript and {} in Rust",
        ts.max_nesting, rs.max_nesting
    );
}

/// Parse one program and return its only function.
fn one_function(
    shape: &str,
    language: &str,
    source: &str,
    analyze: impl FnOnce(&str) -> Option<crate::facts::FileFacts> + Send,
) -> crate::facts::FunctionFacts {
    let facts = parse_guarded(source, analyze)
        .unwrap_or_else(|refusal| panic!("`{shape}` ({language}) was refused: {refusal:?}"))
        .unwrap_or_else(|| panic!("`{shape}` ({language}) did not parse"));
    assert_eq!(
        facts.functions.len(),
        1,
        "`{shape}` ({language}) must hold exactly one function, found {}",
        facts.functions.len()
    );
    facts.functions[0].clone()
}

#[test]
fn complexity_parity() {
    parity(
        "a straight line",
        "export function f(a: number): number { return a; }",
        "pub fn f(a: i32) -> i32 { return a; }",
        1,
        0,
    );

    parity(
        "one branch",
        "export function f(a: boolean): number { if (a) { return 1; } return 0; }",
        "pub fn f(a: bool) -> i32 { if a { return 1; } return 0; }",
        2,
        1,
    );

    parity(
        "a branch and its else",
        "export function f(a: boolean): number { if (a) { return 1; } else { return 0; } }",
        "pub fn f(a: bool) -> i32 { if a { return 1; } else { return 0; } }",
        2,
        2,
    );

    parity(
        "an else-if ladder",
        "export function f(a: number): number { if (a === 1) { return 1; } \
         else if (a === 2) { return 2; } else { return 0; } }",
        "pub fn f(a: i32) -> i32 { if a == 1 { return 1; } \
         else if a == 2 { return 2; } else { return 0; } }",
        3,
        3,
    );

    parity(
        "a branch inside a branch",
        "export function f(a: boolean, b: boolean): number { if (a) { if (b) { return 2; } } return 0; }",
        "pub fn f(a: bool, b: bool) -> i32 { if a { if b { return 2; } } return 0; }",
        3,
        3,
    );

    parity(
        "a branch inside a loop",
        "export function f(n: number): number { for (let i = 0; i < n; i++) \
         { if (i) { return i; } } return 0; }",
        "pub fn f(n: i32) -> i32 { for i in 0..n { if i > 0 { return i; } } return 0; }",
        3,
        3,
    );

    parity(
        "a multi-way switch with a default",
        "export function f(a: number): number { switch (a) { case 1: return 1; \
         case 2: return 2; case 3: return 3; default: return 0; } }",
        "pub fn f(a: i32) -> i32 { match a { 1 => return 1, 2 => return 2, \
         3 => return 3, _ => return 0 } }",
        4,
        1,
    );

    parity(
        "a run of one boolean operator",
        "export function f(a: boolean, b: boolean, c: boolean): number \
         { if (a && b && c) { return 1; } return 0; }",
        "pub fn f(a: bool, b: bool, c: bool) -> i32 { if a && b && c { return 1; } return 0; }",
        4,
        2,
    );

    parity(
        "a run whose operator changes",
        "export function f(a: boolean, b: boolean, c: boolean): number \
         { if (a && b || c) { return 1; } return 0; }",
        "pub fn f(a: bool, b: bool, c: bool) -> i32 { if a && b || c { return 1; } return 0; }",
        4,
        3,
    );

    parity(
        "a loop inside a loop",
        "export function f(n: number): number { for (let i = 0; i < n; i++) \
         { while (i > 0) { return i; } } return 0; }",
        "pub fn f(n: i32) -> i32 { for i in 0..n { while i > 0 { return i; } } return 0; }",
        3,
        3,
    );
}
