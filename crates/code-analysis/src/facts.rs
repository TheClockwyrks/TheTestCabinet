//! What a front end reports about one file, and the **single normative definition** of
//! complexity both front ends score against.
//!
//! The two front ends walk completely different trees. What keeps their numbers
//! comparable is that neither computes a complexity figure itself: both feed events into
//! [`ComplexityScorer`], which owns the definition. A cross-language comparison is only
//! honest if "the same control-flow shape" scores identically in each, and
//! `complexity_parity` asserts exactly that against paired fixtures.
//!
//! # The definition
//!
//! **Cyclomatic** (McCabe) — one, plus:
//!
//! - each branching construct (`if`; an `else if` is an `if` of its own)
//! - each non-default `case` or match arm
//! - each loop
//! - each `catch`
//! - each short-circuiting or nullish operator (`&&`, `||`, `??`)
//! - each conditional expression (`?:`)
//! - each optional chain (`?.`)
//! - Rust's `?`
//!
//! **Cognitive** (Sonar) — every branching construct scores one **plus the current nesting
//! depth**; `else` scores a flat one; a boolean-operator sequence scores once however long
//! it is. It is included deliberately alongside cyclomatic, which is famously blind to
//! nesting — and nesting is precisely what makes generated code unreadable.
//!
//! A `switch`/`match` is the one construct where the two measures disagree about what the
//! unit is, and the scorer keeps them apart rather than picking one: the construct itself
//! carries the **cognitive** weight (it is one decision the reader has to hold) while each
//! non-default arm carries a **cyclomatic** point (each is one more path). Scoring the
//! construct cyclomatically as well would count its first arm twice.

use std::collections::BTreeMap;

/// One function, method, closure or arrow the analysis scored.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct FunctionFacts {
    /// The declared name, or `<anonymous>` / `<default>` for one that has none.
    pub name: String,
    /// The 1-based line it starts on.
    pub line: u32,
    /// Lines it spans, at least one.
    pub lines: u32,
    /// McCabe cyclomatic complexity.
    pub cyclomatic: u32,
    /// Sonar cognitive complexity.
    pub cognitive: u32,
    /// The deepest nesting reached inside it.
    pub max_nesting: u32,
    /// Declared parameters.
    pub parameters: u32,
    /// Exit points: `return` and `throw`, plus Rust's `?`.
    pub exits: u32,
    /// Whether it is exported (TypeScript) or `pub` (Rust).
    pub exported: bool,
}

/// One import a file declares, before resolution.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportFacts {
    /// The specifier as written: a relative path, a bare package name, or — for Rust — a
    /// module or crate path.
    pub specifier: String,
    /// Whether the import re-exports wholesale (`export * from …`).
    ///
    /// A barrel is the single biggest source of false "unreferenced export" reports, so it
    /// is tracked rather than inferred: a name re-exported by a barrel is referenced by
    /// the barrel, whatever the importing file calls it.
    pub reexport: bool,
}

/// TypeScript-only counters, all syntactic. Neither front end performs type inference, so
/// there is no implicit-`any` detection here and no "is this cast actually unsound".
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TypeScriptFacts {
    /// Explicit `any` annotations.
    pub any_occurrences: u32,
    /// Explicit `unknown` annotations.
    pub unknown_occurrences: u32,
    /// `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck` and `eslint-disable` comments.
    pub suppression_comments: u32,
    /// Non-null assertions (`x!`).
    pub non_null_assertions: u32,
    /// `as T` and `<T>x`, excluding `as const`.
    pub assertion_casts: u32,
    /// Declared function parameters.
    pub parameters: u32,
    /// Of those, how many carry a type annotation.
    pub annotated_parameters: u32,
    /// Functions that could carry a return-type annotation.
    pub functions: u32,
    /// Of those, how many do.
    pub annotated_returns: u32,
    /// Exported functions.
    pub exported_functions: u32,
    /// Of those, how many carry a return-type annotation — the API-boundary version, and
    /// the one that actually matters.
    pub exported_annotated_returns: u32,
    /// Interfaces, type aliases and enums declared.
    pub type_declarations: u32,
}

/// Rust-only counters, chosen to mirror the TypeScript questions rather than to enumerate
/// Rust features.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RustFacts {
    /// `unsafe` blocks, functions and impls.
    pub unsafe_items: u32,
    /// `.unwrap()` calls.
    pub unwrap_calls: u32,
    /// `.expect(…)` calls.
    pub expect_calls: u32,
    /// `panic!` and `unreachable!`. Assertion macros are excluded — see
    /// [`CodeRustSummary::panic_sites`](test_cabinet_core::CodeRustSummary::panic_sites).
    pub panic_sites: u32,
    /// `todo!` and `unimplemented!`.
    pub todo_macros: u32,
    /// `#[allow(…)]` attributes.
    pub suppressed_lints: u32,
    /// `.clone()` calls.
    pub clone_calls: u32,
    /// Items declared with any `pub` visibility.
    pub public_items: u32,
    /// Items declared at all, public or not.
    pub items: u32,
    /// Traits declared.
    pub traits: u32,
    /// Items carrying generic parameters.
    pub generic_items: u32,
}

/// Everything a front end reports about one file.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FileFacts {
    /// Every function scored, in source order.
    pub functions: Vec<FunctionFacts>,
    /// Every import declared, in source order.
    pub imports: Vec<ImportFacts>,
    /// Names this file exports.
    pub exports: Vec<String>,
    /// Every identifier the file mentions, with how many times.
    ///
    /// The raw material for cross-file reference counting, and the reason that figure is
    /// labelled **approximate**: an identifier is matched by *name*, which cannot tell one
    /// module's `render` from another's. It also folds in static member-access property
    /// names, which is what lets a namespace import (`import * as ns` then `ns.render`) be
    /// seen at all.
    pub identifiers: BTreeMap<String, u32>,
    /// TypeScript counters. Zero for a Rust file.
    pub typescript: TypeScriptFacts,
    /// Rust counters. Zero for a TypeScript file.
    pub rust: RustFacts,
    /// Test functions this file declares.
    pub test_functions: u32,
    /// Whether the file is test code, by its path or its contents.
    pub is_test: bool,
}

/// The one place a complexity figure is computed.
///
/// Both front ends drive this rather than counting themselves, which is what makes the two
/// languages' numbers mean the same thing. Every method's contribution is documented at the
/// method, and the module docs above hold the definition as a whole.
#[derive(Debug, Clone)]
pub struct ComplexityScorer {
    cyclomatic: u32,
    cognitive: u32,
    nesting: u32,
    max_nesting: u32,
    exits: u32,
}

impl Default for ComplexityScorer {
    fn default() -> Self {
        Self::new()
    }
}

impl ComplexityScorer {
    /// A fresh function's score: cyclomatic starts at **one** (the single path through a
    /// function with no branches), cognitive at zero (a function with no branches costs
    /// the reader nothing).
    pub fn new() -> Self {
        Self {
            cyclomatic: 1,
            cognitive: 0,
            nesting: 0,
            max_nesting: 0,
            exits: 0,
        }
    }

    /// A branching construct that also nests: `if`, every loop, `catch`, and a conditional
    /// expression. One cyclomatic point, `1 + depth` cognitive, and it opens a nesting
    /// level until [`leave`](Self::leave).
    pub fn enter_branch(&mut self) {
        self.cyclomatic += 1;
        self.cognitive += 1 + self.nesting;
        self.enter_nesting();
    }

    /// An `else if`: a branch like any other cyclomatically, but a **flat** cognitive
    /// point rather than a nesting-aware one, and it opens a nesting level for its own
    /// body.
    ///
    /// This is the whole reason both front ends walk their `if` chains by hand instead of
    /// letting the generic tree walk find each `if`. `else if (a) … else if (b) …` reads as
    /// one flat ladder, and charging the second rung for being "nested inside" the first
    /// would make a `switch` written as an `if` chain score arbitrarily worse the longer it
    /// got — the opposite of what cognitive complexity is for.
    pub fn enter_else_if(&mut self) {
        self.cyclomatic += 1;
        self.cognitive += 1;
        self.enter_nesting();
    }

    /// A `switch` or `match`: cognitive weight and a nesting level, but **no** cyclomatic
    /// point of its own — each arm pays that through [`case_arm`](Self::case_arm), and
    /// charging the construct too would count its first arm twice.
    pub fn enter_switch(&mut self) {
        self.cognitive += 1 + self.nesting;
        self.enter_nesting();
    }

    /// A nesting level that is not a branch: a function declared inside another, whose own
    /// branches are harder to read for being buried.
    pub fn enter_nesting(&mut self) {
        self.nesting += 1;
        self.max_nesting = self.max_nesting.max(self.nesting);
    }

    /// Close whatever [`enter_branch`](Self::enter_branch),
    /// [`enter_switch`](Self::enter_switch) or [`enter_nesting`](Self::enter_nesting)
    /// opened.
    pub fn leave(&mut self) {
        self.nesting = self.nesting.saturating_sub(1);
    }

    /// A non-default `case` or match arm: one more path, no extra cognitive weight beyond
    /// the `switch` that contains it.
    pub fn case_arm(&mut self) {
        self.cyclomatic += 1;
    }

    /// An `else` (or `else if`'s `else` half): a flat cognitive point, and no cyclomatic
    /// point — the `if` it belongs to already paid for the branch.
    pub fn else_clause(&mut self) {
        self.cognitive += 1;
    }

    /// A decision that adds a path without adding anything the reader has to hold: an
    /// optional chain (`?.`) or Rust's `?`.
    pub fn decision(&mut self) {
        self.cyclomatic += 1;
    }

    /// One short-circuiting or nullish operator: always a cyclomatic point, and a cognitive
    /// point **only when it starts a new sequence**.
    ///
    /// `a && b && c && d` is one thing to understand however long it runs, so Sonar charges
    /// it once; `a && b || c` is two, because the operator changed. The caller decides which
    /// this is, since only it can see the parent operator.
    pub fn boolean_operator(&mut self, starts_sequence: bool) {
        self.cyclomatic += 1;
        if starts_sequence {
            self.cognitive += 1;
        }
    }

    /// A `return`, a `throw`, or a Rust `?`.
    pub fn exit(&mut self) {
        self.exits += 1;
    }

    /// The figures, for the function this scorer was scoring.
    pub fn finish(self) -> (u32, u32, u32, u32) {
        (
            self.cyclomatic,
            self.cognitive,
            self.max_nesting,
            self.exits,
        )
    }
}

/// Whether a path names test code.
///
/// Path-based, and shared by both front ends so `src/foo.test.ts` and `src/foo.test.rs` are
/// classified by one rule. Rust's in-file `#[cfg(test)]` module is caught separately, by
/// the front end that can see it.
pub fn is_test_path(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    let stem = name.rsplit_once('.').map(|(stem, _)| stem).unwrap_or(name);
    path.split('/')
        .any(|segment| matches!(segment, "__tests__" | "tests" | "test" | "e2e" | "spec"))
        || stem.ends_with(".test")
        || stem.ends_with(".spec")
        || stem.ends_with("_test")
}

#[cfg(test)]
#[path = "facts.test.rs"]
mod tests;

#[cfg(test)]
#[path = "facts.parity.test.rs"]
mod parity_tests;
