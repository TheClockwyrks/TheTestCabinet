//! The answers that are Swift's own, and the lexer underneath them.
//!
//! What is deliberately **not** here is a second copy of the skeleton's tests. Fence stripping,
//! prose stripping, the fixpoint loop, the honesty disclosure and the delete-only invariant are
//! asserted once in `healing.test.rs` against every registered dialect, this one included. What this
//! file asserts is the part that is Swift's — and much of it is written as a **comparison against
//! another arm**, because this dialect's redeclaration proof is the widest of any registered arm's
//! and its lexer survives text two of the others' do not.

use test_cabinet_core::gg::GgProgramLanguage;

use super::SWIFT_DIALECT;
use crate::healing::{
    AsyncWrapper, Dialect, Healed, HealingConfig, HealingDetail, HealingStrategy, heal,
};

/// Replies in Swift that the [delete-only invariant](crate::healing::Dialect::fixtures) is re-earned
/// over.
///
/// Every one of them exercises an answer that is this dialect's rather than the skeleton's: both
/// shapes of the `Task` wrapper, an `import` above one that must **survive** it, an `await` the
/// repair deletes, a doubled program whose repeat rebinds a `let` (which this arm's compiler refuses
/// where Rust's does not), a raw string and a multi-line string whose bodies must not be read as
/// code, an interpolation carrying a nested quote, an `extension` and a `protocol` in the same
/// program, an apostrophe in a line of English, a `#` line that is prose here, and two replies that
/// are no program at all.
pub(super) const FIXTURES: &[&str] = &[
    "Here is the program.\n\n```swift\nlet rows = try fs.listDir(\"src\")\ntry view.openText(\"rows\", rows.map(\\.name).joined(separator: \"\\n\"))\n```\n\nThat lists the directory.",
    "Task {\n    try view.openText(\"note\", \"done\")\n}",
    "import Collections\n\nTask {\n    let rows = try fs.listDir(\"src\")\n    try view.openText(\"rows\", rows.map(\\.name).joined(separator: \"\\n\"))\n}",
    "let work = Task {\n    try view.openText(\"note\", \"done\")\n}\n_ = await work.value",
    "Task {\n    let notes = try await fs.readTextFile(\"notes.md\")\n    try view.openText(\"notes\", notes)\n}",
    "import Foundation\n\nlet stamp = Date().timeIntervalSince1970\ntry view.openText(\"stamp\", \"\\(stamp)\")",
    "let total = 1\ntry view.openText(\"n\", \"\\(total)\")\nlet total = 1\ntry view.openText(\"n\", \"\\(total)\")",
    "func helper() -> Int { 1 }\ntry view.openText(\"n\", \"\\(helper())\")\nfunc helper() -> Int { 1 }\ntry view.openText(\"n\", \"\\(helper())\")",
    "let usage = #\"\"\"\n    Example:\n\n    Task {\n        let total = 1\n    }\n\"\"\"#\ntry view.openText(\"usage\", usage)",
    "let rows = [\"a\": 1]\ntry view.openText(\"n\", \"total: \\(rows[\"a\"] ?? 0)\")",
    "protocol Named {\n    var label: String { get }\n}\n\nextension DirEntry: Named {\n    var label: String { name }\n}\n\nlet rows = try fs.listDir(\"src\")\ntry view.openText(\"rows\", rows.map(\\.label).joined(separator: \"\\n\"))",
    "I couldn't finish that.\n\n```swift\ntry view.openText(\"note\", \"partial\")\n```",
    "# Plan\n\nlet total = 1\ntry view.openText(\"total\", \"\\(total)\")",
    "I have finished the task. Everything works.",
];

/// Heal `reply` with **this** language's dialect and the default configuration.
fn healed(reply: &str) -> Healed {
    heal(
        reply,
        &HealingConfig::default(),
        crate::sandbox::language(GgProgramLanguage::Swift).healing(),
    )
}

/// This dialect, as the skeleton takes it.
fn swift() -> &'static dyn Dialect {
    &SWIFT_DIALECT
}

/// [Rust's](super::super::rust::healing), for the comparisons this file is largely made of.
fn rust() -> &'static dyn Dialect {
    crate::sandbox::language(GgProgramLanguage::Rust).healing()
}

/// [Kotlin's](super::super::kotlin::healing), whose lexer an apostrophe defeats and this one's does
/// not.
fn kotlin() -> &'static dyn Dialect {
    crate::sandbox::language(GgProgramLanguage::Kotlin).healing()
}

/// The mask of `src`, for a test that is about what the lexer read.
fn mask(src: &str) -> crate::healing::CodeMask {
    swift().code_mask(src).expect("this source lexes")
}

/// Whether every byte of `needle` inside `src` was read as code.
fn read_as_code(src: &str, needle: &str) -> bool {
    let mask = mask(src);
    let at = src.find(needle).expect("the needle is in the source");
    (at..at + needle.len()).all(|index| mask.is_code(index))
}

// ---------------------------------------------------------------------------------------------
// The concurrency wrapper
// ---------------------------------------------------------------------------------------------

/// **`Task { … }` comes off, and the `import` above it stays.**
///
/// The whole-program shape a Swift author reaches for the moment anything looks asynchronous, and
/// the repair is worth making because the failure is the worst one there is: the artifact compiles,
/// the task is scheduled, the program returns, and nothing ever runs it — a clean turn over a
/// program that did nothing.
///
/// The import survives, which is [Rust's answer](super::super::rust::healing) and reached from the
/// same fact: `Collections` really is linked here, so the line resolves where it stands.
#[test]
fn the_task_wrapper_comes_off_and_the_import_stays() {
    let result = healed(
        "import Collections\n\n\
         Task {\n    \
             let rows = try fs.listDir(\"src\")\n    \
             try view.openText(\"rows\", rows.map(\\.name).joined(separator: \"\\n\"))\n\
         }",
    );
    assert_eq!(
        result.program,
        "import Collections\n\n\
         let rows = try fs.listDir(\"src\")\n\
         try view.openText(\"rows\", rows.map(\\.name).joined(separator: \"\\n\"))",
    );
    assert!(
        result
            .applied
            .iter()
            .any(|repair| matches!(repair.detail, HealingDetail::Async { .. })),
        "the repair is disclosed: {:?}",
        result.applied
    );
}

/// **A declared task comes off too, with the wait that followed it.**
///
/// `let work = Task { … }` and then `await work.value` is the shape a model writes when it wants the
/// result rather than the effect. The trailing wait is required: a handle nothing touches is a
/// program whose author may have meant something else, and declining costs only a repair that was
/// never certain.
#[test]
fn a_declared_task_and_the_wait_on_it_both_come_off() {
    let result = healed(
        "let work = Task {\n    try view.openText(\"note\", \"done\")\n}\n_ = await work.value",
    );
    assert_eq!(result.program, "try view.openText(\"note\", \"done\")");
    let wrapper = result
        .applied
        .iter()
        .find_map(|repair| match repair.detail {
            HealingDetail::Async { wrapper, .. } => Some(wrapper),
            _ => None,
        });
    assert_eq!(wrapper, Some(AsyncWrapper::Declared));
}

/// **`await` is deleted as a prefix, which is where Swift puts it.**
///
/// Rust's suspension marker is a postfix `.await` and Swift's is a leading keyword, so what comes
/// off is the word and the space behind it. Leaving one behind would leave the one part of the
/// repaired program that still fails to compile.
#[test]
fn the_awaits_inside_the_wrapper_are_deleted_from_the_front() {
    let result = healed(
        "Task {\n    let notes = try await fs.readTextFile(\"notes.md\")\n    try view.openText(\"notes\", notes)\n}",
    );
    assert_eq!(
        result.program,
        "let notes = try fs.readTextFile(\"notes.md\")\ntry view.openText(\"notes\", notes)",
    );
    let awaits = result
        .applied
        .iter()
        .find_map(|repair| match repair.detail {
            HealingDetail::Async { awaits, .. } => Some(awaits),
            _ => None,
        });
    assert_eq!(awaits, Some(1));
}

/// **A trailing closure that is not a `Task` is left alone.**
///
/// The match is anchored, which is what keeps a program whose *last* statement happens to take a
/// trailing closure from having every statement above it deleted.
#[test]
fn an_ordinary_trailing_closure_is_not_a_wrapper() {
    let reply = "let rows = try fs.listDir(\"src\")\nrows.forEach {\n    _ = $0.name\n}";
    let result = healed(reply);
    assert_eq!(result.program, reply);
}

/// **A `Task` with work after it is not the whole program, so nothing is unwrapped.**
#[test]
fn a_task_with_a_statement_after_it_declines() {
    let reply = "Task {\n    _ = 1\n}\ntry view.openText(\"note\", \"done\")";
    assert_eq!(healed(reply).program, reply);
}

// ---------------------------------------------------------------------------------------------
// Redeclaration
// ---------------------------------------------------------------------------------------------

/// **A duplicated program whose repeat only rebinds a `let` is deleted here and kept in Rust.**
///
/// The sharpest divergence between the two compiled arms' dialects, and it is a fact about the
/// languages rather than a choice: Swift refuses a second `let` of one name at one scope, and Rust
/// shadows. So the everyday doubled program — the one made of nothing but bindings and calls — is
/// provably dead code here and might have run there.
#[test]
fn a_repeated_let_is_a_redeclaration_here_and_not_in_rust() {
    let reply = "let total = 1\ntry view.openText(\"n\", \"\\(total)\")\nlet total = 1\ntry view.openText(\"n\", \"\\(total)\")";
    let source = "let total = 1\n";
    assert!(
        swift().declares_a_redeclarable_binding(source, &mask(source), 0),
        "Swift refuses a second `let` of one name",
    );
    assert!(
        !rust().declares_a_redeclarable_binding(
            source,
            &rust().code_mask(source).expect("this source lexes"),
            0
        ),
        "Rust shadows, so its dialect must not read a `let` as a redeclaration",
    );
    let result = healed(reply);
    assert_eq!(
        result.program,
        "let total = 1\ntry view.openText(\"n\", \"\\(total)\")",
    );
    assert!(
        result
            .strategies()
            .contains(&HealingStrategy::DropDuplicateProgram)
    );
}

/// **An `import` written twice is not a redeclaration, because Swift allows it.**
///
/// The one declaration excluded from the proof, and excluding it is what stops the strategy from
/// deleting a program that would have run.
#[test]
fn a_repeated_import_is_not_a_redeclaration() {
    let source = "import Foundation\n";
    assert!(!swift().declares_a_redeclarable_binding(source, &mask(source), 0));
}

/// **An `extension` written twice is not a redeclaration either**, because it declares no name of
/// its own — which is the very mechanism this arm binds a code module with.
#[test]
fn a_repeated_extension_is_not_a_redeclaration() {
    let source = "extension String {\n    var shouted: String { uppercased() }\n}\n";
    assert!(!swift().declares_a_redeclarable_binding(source, &mask(source), 0));
}

/// **A declaration nested inside a type is not a top-level one.**
///
/// Read as *unindented*, which is what keeps a `func` inside a `struct` — legal, and legal twice,
/// because it is a different scope — from being read as a redeclaration.
#[test]
fn an_indented_declaration_is_not_read_as_a_top_level_one() {
    let source = "struct Row {\n    let name: String\n}\n";
    let mask = mask(source);
    let found: Vec<&str> = super::declares_lexically(source, &mask, 0).collect();
    assert_eq!(found, vec!["Row"]);
}

// ---------------------------------------------------------------------------------------------
// The lexer
// ---------------------------------------------------------------------------------------------

/// **An apostrophe in a line of English is ordinary punctuation here.**
///
/// Swift has no character literal at all, so `'` is not a delimiter in this grammar — where Kotlin's
/// scan reads the same byte as an unterminated one and gives up the whole mask. That is what lets a
/// reply with prose wrapped around its program go on being repaired here.
#[test]
fn an_apostrophe_in_prose_lexes_here_and_not_in_kotlin() {
    let reply = "I couldn't finish that.\n\nlet total = 1\n";
    assert!(swift().code_mask(reply).is_some());
    assert!(
        kotlin().code_mask(reply).is_none(),
        "the comparison is the point: Kotlin's scan loses its place on the same byte",
    );
}

/// **An interpolation's contents are code, and a quote inside one closes nothing.**
///
/// `"total: \(rows["a"] ?? 0)"` is one string. A scan that stopped at the quote before `a` would
/// read the rest of the line as code and every strategy consulting the mask would be reading the
/// wrong text.
#[test]
fn an_interpolation_is_followed_through_with_its_nested_quotes() {
    let src = "try view.openText(\"n\", \"total: \\(rows[\"a\"] ?? 0)\")\nlet after = 1\n";
    assert!(read_as_code(src, "rows["), "the splice is code");
    assert!(read_as_code(src, "let after"), "and the scan came back out");
    assert!(!mask(src).is_code(src.find("total: ").expect("the literal is there")));
}

/// **A raw string's `\` and `"` mean nothing, and its fence has to be counted.**
#[test]
fn a_raw_strings_fence_is_counted() {
    let src = "let usage = #\"a \" b \\(not) c\"#\nlet after = 1\n";
    assert!(!mask(src).is_code(src.find("not").expect("the body is there")));
    assert!(read_as_code(src, "let after"));
}

/// **A multi-line string may carry a newline and a single-line one may not.**
///
/// Both open with the same byte, so the triple has to be recognised first; and a `"` still open at a
/// `\n` is a scan that has lost its place, which is the state that declines the mask.
#[test]
fn a_multiline_string_spans_newlines_and_a_plain_one_declines() {
    let multiline = "let usage = \"\"\"\nTask {\n}\n\"\"\"\nlet after = 1\n";
    assert!(!mask(multiline).is_code(multiline.find("Task").expect("the body is there")));
    assert!(read_as_code(multiline, "let after"));
    assert!(
        swift()
            .code_mask("let broken = \"open\nlet after = 1\n")
            .is_none(),
        "a single-line string cannot carry a newline, so the scan gives up",
    );
}

/// **A nested block comment is one comment**, as it is in Kotlin and Rust and is not in Java.
#[test]
fn block_comments_nest() {
    let src = "/* a /* b */ c */\nlet after = 1\n";
    assert!(!mask(src).is_code(src.find(" c ").expect("the tail is there") + 1));
    assert!(read_as_code(src, "let after"));
}

// ---------------------------------------------------------------------------------------------
// The predicates
// ---------------------------------------------------------------------------------------------

/// **Nothing is done about an import**, which is the second arm to answer so and the second to
/// answer so because the line works.
#[test]
fn an_import_is_never_deleted() {
    assert!(!swift().is_import_statement("import Foundation"));
    assert!(!swift().is_import_statement("import struct Foundation.Data"));
    let reply = "import Collections\n\nlet rows = Deque<Int>()\ntry view.openText(\"n\", \"\\(rows.count)\")";
    assert_eq!(healed(reply).program, reply);
}

/// **A statement without a `;` is still code**, which is the ending every other C-shaped arm reads
/// first and this one does not have.
#[test]
fn a_call_with_no_semicolon_is_code() {
    assert!(swift().looks_like_code("try view.openText(\"n\", body)"));
    assert!(swift().looks_like_code("let rows = try fs.listDir(\"src\")"));
    assert!(swift().looks_like_code("rows.forEach {"));
}

/// **A lead-in that opens with `open` stays deletable**, which is the one keyword this dialect
/// leaves off its list on purpose.
#[test]
fn a_sentence_beginning_open_is_prose() {
    assert!(swift().is_prose_line("open a view of the value you computed"));
    assert!(!swift().is_prose_line("public func parse"));
}

/// **A Markdown bullet is not code**, which is what keeps a reply of prose, fence and prose from
/// being sent to the compiler whole.
#[test]
fn a_bullet_is_not_code() {
    assert!(!swift().looks_like_code("* read the manifest"));
    assert!(!swift().looks_like_code("- list the directory"));
}
