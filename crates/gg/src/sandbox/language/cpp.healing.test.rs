//! The answers that are C++'s own, and the lexer underneath them.
//!
//! What is deliberately **not** here is a second copy of the skeleton's tests. Fence stripping,
//! prose stripping, the fixpoint loop, the honesty disclosure and the delete-only invariant are
//! asserted once in `healing.test.rs` against every registered dialect, this one included. What this
//! file asserts is the part that is C++'s — and much of it is written as a **comparison against
//! another arm**, because this dialect answers two of the seam's questions differently from every
//! arm before it: `#` is a heading *and* a directive, and there is no concurrency wrapper to unwrap
//! at all.

use test_cabinet_core::gg::GgProgramLanguage;

use super::CPP_DIALECT;
use crate::healing::{Dialect, Healed, HealingConfig, HealingStrategy, heal};

/// Replies in C++ that the [delete-only invariant](crate::healing::Dialect::fixtures) is re-earned
/// over.
///
/// Every one of them exercises an answer that is this dialect's rather than the skeleton's: a
/// `#include` that must **survive** every strategy, a `#define` that must not be deleted as prose, a
/// Markdown heading that must stay deletable beside it, a doubled program whose repeat redefines
/// `main`, a doubled fragment whose repeat redefines a helper, a raw string whose body is full of
/// code-shaped text, a digit separator, a block comment that does not nest, a `template` and a
/// `concept` in one program, an apostrophe in a line of English, and two replies that are no program
/// at all.
pub(super) const FIXTURES: &[&str] = &[
    "Here is the program.\n\n```cpp\n#include <vector>\n\nint main() {\n  const auto rows = fs::list_dir(\"src\");\n  view::open_text(\"rows\", std::format(\"{}\", rows.size()));\n  return 0;\n}\n```\n\nThat lists the directory.",
    "#include <vector>\n#include <string>\n\nint main() {\n  std::vector<std::string> rows;\n  view::open_text(\"rows\", std::format(\"{}\", rows.size()));\n  return 0;\n}\n",
    "#define LIMIT 40\n\nint main() {\n  const auto notes = fs::read_text_file(\"notes.md\", {.limit = LIMIT});\n  view::open_text(\"notes\", notes);\n  return 0;\n}\n",
    "# Plan\n\nI will read the manifest and show it to myself.\n\n```c++\nint main() {\n  view::open_text(\"notes\", fs::read_text_file(\"notes.md\"));\n  return 0;\n}\n```",
    "int main() {\n  view::open_text(\"n\", \"1\");\n  return 0;\n}\nint main() {\n  view::open_text(\"n\", \"1\");\n  return 0;\n}\n",
    "int helper() { return 1; }\nint main() { view::open_text(\"n\", std::format(\"{}\", helper())); return 0; }\nint helper() { return 1; }\nint main() { view::open_text(\"n\", std::format(\"{}\", helper())); return 0; }\n",
    "int main() {\n  const char *usage = R\"gg(int main() { \"unbalanced\n  and a \\ backslash )gg\";\n  view::open_text(\"usage\", usage);\n  return 0;\n}\n",
    "int main() {\n  const int big = 1'000'000;\n  view::open_text(\"big\", std::format(\"{}\", big));\n  return 0;\n}\n",
    "/* outer /* inner */\nint main() {\n  view::open_text(\"note\", \"done\");\n  return 0;\n}\n",
    "template <typename T>\nconcept summable = requires(T value) { value + value; };\n\ntemplate <summable T>\nT twice(T value) {\n  return value + value;\n}\n\nint main() {\n  view::open_text(\"n\", std::format(\"{}\", twice(21)));\n  return 0;\n}\n",
    "I couldn't finish that, and it doesn't work yet.\n\n```cpp\nint main() {\n  view::open_text(\"note\", \"partial\");\n  return 0;\n}\n```",
    "namespace helpers {\nint one() { return 1; }\n}  // namespace helpers\n\nnamespace helpers {\nint two() { return 2; }\n}  // namespace helpers\n\nint main() {\n  view::open_text(\"n\", std::format(\"{}\", helpers::one() + helpers::two()));\n  return 0;\n}\n",
    "I have finished the task. Everything works.",
];

/// Heal `reply` with **this** language's dialect and the default configuration.
fn healed(reply: &str) -> Healed {
    heal(
        reply,
        &HealingConfig::default(),
        crate::sandbox::language(GgProgramLanguage::Cpp).healing(),
    )
}

/// This dialect, as the skeleton takes it.
fn cpp() -> &'static dyn Dialect {
    &CPP_DIALECT
}

/// [Rust's](super::super::rust::healing), whose concurrency wrapper this arm deliberately has no
/// counterpart to.
fn rust() -> &'static dyn Dialect {
    crate::sandbox::language(GgProgramLanguage::Rust).healing()
}

/// The mask of `src`, for a test that is about what the lexer read.
fn mask(src: &str) -> crate::healing::CodeMask {
    cpp().code_mask(src).expect("this source lexes")
}

/// Whether every byte of `needle` inside `src` was read as code.
fn read_as_code(src: &str, needle: &str) -> bool {
    let mask = mask(src);
    let at = src.find(needle).expect("the needle is in the source");
    (at..at + needle.len()).all(|index| mask.is_code(index))
}

// ---------------------------------------------------------------------------------------------
// `#` is a heading and a directive
// ---------------------------------------------------------------------------------------------

/// **A Markdown heading is prose and a preprocessor directive is not**, and case is the whole of the
/// difference.
///
/// This is the one question C++ asks that no other arm's dialect does. Every other dialect can keep
/// `#` off its prose test and lose nothing; here `#include` and `#define` open the file and
/// `# Heading` opens the reply, and both are the same byte. Getting it backwards either deletes a
/// line of the program or gives up a repair on almost every fenced reply.
#[test]
fn a_heading_is_prose_and_a_directive_is_code() {
    for directive in [
        "#include <vector>",
        "#include \"sandbox.h\"",
        "#  define LIMIT 40",
        "#pragma once",
        "#ifndef GG_ONCE",
        "#endif",
    ] {
        assert!(
            cpp().looks_like_code(directive),
            "`{directive}` is a preprocessor directive"
        );
        assert!(
            !cpp().is_prose_line(directive),
            "`{directive}` must never be deleted as prose"
        );
    }
    for heading in ["# Plan", "## What I did", "# Include the manifest"] {
        assert!(
            cpp().is_prose_line(heading),
            "`{heading}` is a Markdown heading and must stay deletable"
        );
    }
}

/// **A `#include` a model wrote survives every strategy**, because the line works.
///
/// The third arm to answer `is_import_statement` with `false`, and the argument is the strongest of
/// the three: gg's surface and the standard library are already in front of the program, put there
/// by a precompiled prelude, so a redundant include is de-duplicated against that header for
/// nothing — and a header the prelude does not carry is a located diagnostic naming it, which is a
/// better answer than a silent deletion.
#[test]
fn an_include_is_never_deleted() {
    let reply = "#include <vector>\n#include <algorithm>\n\n\
                 int main() {\n  \
                 std::vector<int> values{3, 1, 2};\n  \
                 std::ranges::sort(values);\n  \
                 view::open_text(\"n\", std::format(\"{}\", values.front()));\n  \
                 return 0;\n\
                 }\n";
    let result = healed(reply);
    assert!(
        result.program.contains("#include <vector>")
            && result.program.contains("#include <algorithm>"),
        "an include was deleted: {}",
        result.program
    );
    assert!(
        !cpp().is_import_statement("#include <vector>"),
        "this dialect does not treat an include as something to hoist"
    );
}

// ---------------------------------------------------------------------------------------------
// The concurrency wrapper that is not there
// ---------------------------------------------------------------------------------------------

/// **This arm has no concurrency wrapper to unwrap, and the Rust arm does.**
///
/// Two independent reasons, and the test asserts the shape rather than the reasoning: a reply's top
/// level here is a translation unit rather than a statement list, so a program that is nothing but a
/// wrapper does not exist in this grammar; and every header that would express one is off the
/// library set, so a program reaching for concurrency is a located diagnostic on the turn that wrote
/// it. The Rust arm's `std::thread::spawn` **compiles** and then does nothing at run time, which is
/// why that arm deletes it and this one has nothing to delete.
#[test]
fn there_is_no_concurrency_wrapper_here_and_rusts_is_still_taken_off() {
    let program = "int main() {\n  \
                   std::thread worker([] { view::open_text(\"note\", \"done\"); });\n  \
                   worker.join();\n  \
                   return 0;\n\
                   }\n";
    let result = healed(program);
    assert_eq!(
        result.program,
        program.trim_end(),
        "nothing about a threaded C++ program is healed — the compiler is what answers it"
    );
    assert!(
        cpp().unwrap_async(program, &mask(program)).is_none(),
        "this dialect recognises no whole-program wrapper"
    );

    // The same question asked of the arm that does have one, so this test is a comparison rather
    // than an assertion that a method returns `None`.
    let rusty =
        "std::thread::spawn(|| {\n    view::open_text(\"note\", \"done\")?;\n    Ok(())\n});";
    assert!(
        rust()
            .unwrap_async(rusty, &rust().code_mask(rusty).expect("this source lexes"))
            .is_some(),
        "the Rust arm still takes its own wrapper off, so the absence here is this language's"
    );
}

// ---------------------------------------------------------------------------------------------
// Redeclaration
// ---------------------------------------------------------------------------------------------

/// **A doubled program is provably dead code here, because every program defines `main`.**
///
/// The strongest redeclaration proof of any registered arm, and this arm gets it from the shape of
/// the language rather than from the reading: gg refuses a reply that defines no `main`, so a reply
/// that is one program pasted after an identical copy of itself always carries two definitions of
/// `main` — `redefinition of 'main'`, before a statement runs.
#[test]
fn a_doubled_program_redefines_main() {
    let once = "int main() {\n  view::open_text(\"n\", \"1\");\n  return 0;\n}\n";
    let result = healed(&format!("{once}{once}"));
    assert_eq!(result.program, once.trim_end());
    assert!(
        result
            .applied
            .iter()
            .any(|repair| repair.strategy == HealingStrategy::DropDuplicateProgram),
        "the repair is disclosed: {:?}",
        result.applied
    );
}

/// **A reopened `namespace` is not a redefinition**, which is the one shape this reading must not
/// get wrong.
///
/// C++ lets a namespace be opened as many times as an author likes, so `namespace helpers {`
/// appearing twice is ordinary code. Reading it as a redefinition would let
/// `drop-duplicate-program` delete a tail that would have run — the one failure this strategy must
/// never have.
#[test]
fn a_reopened_namespace_is_not_a_redefinition() {
    let source = "namespace helpers {\nint one() { return 1; }\n}\n";
    let mask = mask(source);
    assert!(
        !cpp().declares_a_redeclarable_binding("namespace helpers {\n", &mask, 0),
        "a namespace may be reopened, so opening one proves nothing"
    );
    assert!(
        cpp().declares_a_redeclarable_binding("int one() { return 1; }\n", &mask, 20),
        "a function definition may not appear twice"
    );
}

/// **A declaration is not a definition**, which is the distinction the proof rests on.
///
/// `int helper();` written twice is legal C++ and `int helper() { … }` written twice is not, so a
/// reading that could not tell them apart would either give up the strategy or delete a tail that
/// could have run.
#[test]
fn a_forward_declaration_proves_nothing_and_a_definition_proves_everything() {
    let cases: [(&str, bool); 6] = [
        ("int helper();", false),
        ("int helper() { return 1; }", true),
        ("struct row;", false),
        ("struct row {", true),
        ("constexpr int limit = 40;", true),
        ("extern \"C\" {", false),
    ];
    for (line, expected) in cases {
        let source = format!("{line}\n");
        let mask = mask(&source);
        assert_eq!(
            cpp().declares_a_redeclarable_binding(&source, &mask, 0),
            expected,
            "`{line}`"
        );
    }
}

// ---------------------------------------------------------------------------------------------
// The lexer
// ---------------------------------------------------------------------------------------------

/// **A raw string's fence is read rather than looked for**, so its body may hold anything at all.
///
/// `R"gg(…)gg"` may carry a `"`, a `\` and an unbalanced brace, and a scan that read the first inner
/// quote as a delimiter would leave every byte after it masked wrongly — which is a mask every
/// deleting strategy would then be reading.
#[test]
fn a_raw_string_hides_a_quote_a_backslash_and_a_brace() {
    let source =
        "int main() {\n  const char *usage = R\"gg(say \"no\" \\ and {)gg\";\n  return 0;\n}\n";
    let mask = mask(source);
    let at = source
        .find("say \"no\"")
        .expect("the body is in the source");
    assert!(!mask.is_code(at), "the raw string's body was read as code");
    assert!(
        read_as_code(source, "return 0;"),
        "the code after the raw string was lost"
    );
}

/// **`1'000'000` is a digit separator, not a character literal.**
///
/// C++14's separator and Rust's lifetime tick are the same hazard reached from different directions:
/// a `'` that opens nothing. Reading this one as a quote would mask `000` and `1'` alternately and
/// leave the rest of the line wrong.
#[test]
fn a_digit_separator_is_not_a_quote() {
    let source = "int main() {\n  const int big = 1'000'000;\n  return big;\n}\n";
    assert!(
        read_as_code(source, "1'000'000"),
        "the separator was masked"
    );
    assert!(read_as_code(source, "return big;"));
}

/// **Block comments do not nest here**, which is the opposite of the Swift and Kotlin arms.
///
/// `/* a /* b */` ends at the first `*/` in C++. Reading it their way would leave the code after it
/// masked and every strategy blind to it.
#[test]
fn a_block_comment_ends_at_the_first_close() {
    let source = "/* outer /* inner */ int main() { return 0; }\n";
    assert!(
        read_as_code(source, "int main()"),
        "the code after the first `*/` was still masked"
    );
}

/// **A scan that lost its place declines**, and the two readers of this lexer differ exactly there.
///
/// Healing gets `None` and every strategy that needs a mask stands down, because a reading already
/// known to be wrong is the worst possible basis for deleting text. The
/// [entry-point reader](super::super::source::code_mask) takes the same mask anyway, because its
/// errors are safe in the accepting direction — and that is the whole of the difference between the
/// two.
#[test]
fn an_unterminated_construct_declines_for_healing_and_not_for_the_entry_point_reader() {
    for source in [
        "int main() {\n  /* never closed\n  return 0;\n}\n",
        "int main() {\n  const char *usage = R\"gg(never closed\n  return 0;\n}\n",
        "int main() {\n  const char *broken = \"oops;\n  return 0;\n}\n",
    ] {
        assert!(
            cpp().code_mask(source).is_none(),
            "healing must decline a reading that lost its place:\n{source}"
        );
        assert_eq!(
            super::super::source::code_mask(source).len(),
            source.len(),
            "the entry-point reader still takes a mask"
        );
    }
    // And the accepting direction really is accepting: the reply above still defines `main`, so
    // nothing is refused over a lexer that could not finish.
    assert!(super::super::source::defines_main(
        "int main() {\n  const char *broken = \"oops;\n  return 0;\n}\n"
    ));
}

/// **`::` is the one piece of punctuation English has no version of**, and it is what makes a
/// qualified call code.
#[test]
fn a_qualified_call_is_code_and_a_sentence_is_not() {
    assert!(cpp().looks_like_code("view::open_text(\"n\", body)"));
    assert!(cpp().looks_like_code("std::ranges::sort(values);"));
    assert!(cpp().looks_like_code("const auto rows = fs::list_dir(\"src\");"));
    assert!(cpp().looks_like_code("}"));
    assert!(!cpp().looks_like_code("Then I read the manifest and summarised it."));
    assert!(cpp().is_prose_line("Then I read the manifest and summarised it."));
    // An apostrophe is ordinary punctuation here rather than an unterminated literal, so a reply
    // wrapped in English still lexes — the reading that leaves Kotlin's mask with nothing.
    assert!(cpp().is_prose_line("I couldn't finish that."));
    assert!(cpp().code_mask("I couldn't finish that.\n").is_some());
}
