//! The answers that are C#'s own, and the lexer underneath them.
//!
//! What is deliberately **not** here is a second copy of the skeleton's tests. Fence stripping,
//! prose stripping, the fixpoint loop, the honesty disclosure and the delete-only invariant are
//! asserted once in `healing.test.rs` against every registered dialect, this one included. What this
//! file asserts is the part that is C#'s — the redeclaration proof the language hands this arm for
//! free, the `#` that is both a heading and a directive, the `using` that is never touched, and the
//! concurrency wrapper this arm declines to remove **because it works**.

use test_cabinet_core::gg::GgProgramLanguage;

use super::CSHARP_DIALECT;
use crate::healing::{Dialect, Healed, HealingConfig, HealingStrategy, heal};

/// Replies in C# that the [delete-only invariant](crate::healing::Dialect::fixtures) is re-earned
/// over.
///
/// Every one of them exercises an answer that is this dialect's rather than the skeleton's: a
/// `using` that must **survive** every strategy, a `#nullable` that must not be deleted as prose, a
/// Markdown heading that must stay deletable beside it, a doubled program whose repeat redeclares a
/// top-level local, a doubled program whose repeat redeclares a `record`, an `async Task Main`
/// wrapper that must come through untouched, a raw string full of code-shaped text, an interpolated
/// string with a string inside its hole, a verbatim string with doubled quotes, a block comment that
/// does not nest, an apostrophe in a line of English, and two replies that are no program at all.
pub(super) const FIXTURES: &[&str] = &[
    "Here is the program.\n\n```csharp\nusing System.Text.Json;\n\nvar rows = Files.ListDir(\"src\");\nViews.OpenText(\"rows\", JsonSerializer.Serialize(rows.Count));\n```\n\nThat lists the directory.",
    "using System.Text.Json;\nusing System.Globalization;\n\nvar rows = Files.ListDir(\"src\");\nViews.OpenText(\"rows\", rows.Count.ToString(CultureInfo.InvariantCulture));\n",
    "#nullable enable\n\nvar notes = Files.ReadTextFile(\"notes.md\", limit: 40);\nViews.OpenText(\"notes\", notes);\n",
    "# Plan\n\nI will read the manifest and show it to myself.\n\n```cs\nViews.OpenText(\"notes\", Files.ReadTextFile(\"notes.md\"));\n```",
    "var total = 1;\nViews.OpenText(\"n\", total.ToString());\nvar total = 1;\nViews.OpenText(\"n\", total.ToString());\n",
    "record Point(int X, int Y);\nvar here = new Point(1, 2);\nViews.OpenText(\"p\", here.ToString());\nrecord Point(int X, int Y);\nvar here = new Point(1, 2);\nViews.OpenText(\"p\", here.ToString());\n",
    "using System.Threading.Tasks;\n\nclass Program\n{\n    static async Task Main()\n    {\n        var notes = Files.ReadTextFile(\"notes.md\");\n        Views.OpenText(\"notes\", notes);\n        await Task.CompletedTask;\n    }\n}\n",
    "var usage = \"\"\"\nvar x = \"unbalanced\nand a \\ backslash\n\"\"\";\nViews.OpenText(\"usage\", usage);\n",
    "var names = new[] { \"a\", \"b\" };\nViews.OpenText(\"names\", $\"{names.First(n => $\"{n}\")}\");\n",
    "var path = @\"C:\\logs\\\"\"quoted\"\"\\out.txt\";\nViews.OpenText(\"path\", path);\n",
    "/* outer /* inner */\nViews.OpenText(\"note\", \"done\");\n",
    "I couldn't finish that, and it doesn't work yet.\n\n```csharp\nViews.OpenText(\"note\", \"partial\");\n```",
    "partial class Helpers\n{\n    public static int One() => 1;\n}\n\npartial class Helpers\n{\n    public static int Two() => 2;\n}\n\nViews.OpenText(\"n\", (Helpers.One() + Helpers.Two()).ToString());\n",
    "I have finished the task. Everything works.",
];

/// Heal `reply` with **this** language's dialect and the default configuration.
fn healed(reply: &str) -> Healed {
    heal(
        reply,
        &HealingConfig::default(),
        crate::sandbox::language(GgProgramLanguage::CSharp).healing(),
    )
}

/// Whether `strategy` fired on a healed reply.
fn fired(result: &Healed, strategy: HealingStrategy) -> bool {
    result
        .applied
        .iter()
        .any(|repair| repair.strategy == strategy)
}

/// This dialect, as the skeleton takes it.
fn csharp() -> &'static dyn Dialect {
    &CSHARP_DIALECT
}

/// The mask of `src`, for a test that is about what the lexer read.
fn mask(src: &str) -> crate::healing::CodeMask {
    csharp().code_mask(src).expect("this source lexes")
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
/// The second arm to face this, after [C++](super::super::cpp::healing), and it takes the same
/// answer: `#nullable enable` and `#region parsing` are lines a C# author really writes, and
/// `# Nullable reference types` is a heading, and both are the same byte. Getting it backwards
/// either deletes a line of the program or gives up a repair on almost every fenced reply.
#[test]
fn a_heading_is_prose_and_a_directive_is_code() {
    for directive in [
        "#nullable enable",
        "#  region parsing",
        "#endregion",
        "#pragma warning disable CS8600",
        "#if DEBUG",
        "#endif",
    ] {
        assert!(
            csharp().looks_like_code(directive),
            "`{directive}` is a preprocessor directive"
        );
        assert!(
            !csharp().is_prose_line(directive),
            "`{directive}` must never be deleted as prose"
        );
    }
    for heading in ["# Plan", "## What I did", "# Region of interest"] {
        assert!(
            csharp().is_prose_line(heading),
            "`{heading}` is a Markdown heading and must stay deletable"
        );
    }
}

// ---------------------------------------------------------------------------------------------
// A `using` is left alone
// ---------------------------------------------------------------------------------------------

/// **A `using` a model wrote survives every strategy**, because the line works.
///
/// The fourth arm to answer `is_import_statement` with `false`. gg's surface arrives through a
/// `global using` the SDK declares in its own file, so a model's own `using Gg;` is a redundant
/// directive C# accepts in silence — and a namespace the reference set does not carry is a located
/// `CS0246` naming it, which is a better answer than a silent deletion.
#[test]
fn a_using_is_never_deleted() {
    for line in [
        "using System.Text.Json;",
        "using Gg;",
        "using static System.Math;",
        "using Json = System.Text.Json.JsonSerializer;",
        "global using System.Numerics;",
    ] {
        assert!(
            !csharp().is_import_statement(line),
            "`{line}` must not be treated as an import to delete"
        );
    }
    let reply = "using System.Text.Json;\n\nViews.OpenText(\"n\", JsonSerializer.Serialize(1));\n";
    let result = healed(reply);
    assert_eq!(result.program, reply.trim_end());
    assert!(!fired(&result, HealingStrategy::DropImports));
}

// ---------------------------------------------------------------------------------------------
// The redeclaration proof
// ---------------------------------------------------------------------------------------------

/// **A doubled program is deleted, because C#'s top-level statements are one scope.**
///
/// This is the everyday case rather than the exotic one, and it is the language's own rather than a
/// shape that had to be found: `var total = 1;` written twice is `CS0128`, *a local variable named
/// 'total' is already defined in this scope*, before a statement runs. So the deleted half could
/// never have executed.
#[test]
fn a_doubled_program_that_declares_a_local_is_deleted() {
    let program = "var total = 1;\nViews.OpenText(\"n\", total.ToString());\n";
    let result = healed(&format!("{program}{program}"));
    assert_eq!(result.program, program.trim_end());
    assert!(
        fired(&result, HealingStrategy::DropDuplicateProgram),
        "the repair is disclosed: {:?}",
        result.applied
    );
}

/// **A doubled program that declares a type is deleted too**, by `CS0101` rather than `CS0128`.
#[test]
fn a_doubled_program_that_declares_a_type_is_deleted() {
    let program =
        "record Point(int X, int Y);\nViews.OpenText(\"p\", new Point(1, 2).ToString());\n";
    let result = healed(&format!("{program}{program}"));
    assert_eq!(result.program, program.trim_end());
    assert!(
        fired(&result, HealingStrategy::DropDuplicateProgram),
        "the repair is disclosed: {:?}",
        result.applied
    );
}

/// **A `partial` type is not a redeclaration**, and neither is a reopened `namespace`.
///
/// The two shapes C# really does allow twice, and the reason the exclusion list exists at all:
/// reading one as a redeclaration would let `drop-duplicate-program` delete a tail that would have
/// run.
#[test]
fn the_two_declarations_c_sharp_allows_twice_are_not_a_proof() {
    for line in [
        "partial class Helpers",
        "public partial record Row(int N);",
        "namespace helpers;",
        "namespace helpers {",
        "using System.Text;",
        "global using System.Numerics;",
    ] {
        let mask = mask(line);
        assert!(
            !csharp().declares_a_redeclarable_binding(line, &mask, 0),
            "`{line}` is legal twice in one compilation"
        );
    }
}

/// **An assignment is not a declaration**, which is the whole of the rule that keeps this from
/// firing on a program that merely reassigns.
///
/// `total = 0;` re-binds nothing and is legal as often as an author likes; `var total = 0;` is a
/// declaration and is not. Two identifiers before the initialiser is what tells them apart.
#[test]
fn an_assignment_is_not_a_declaration() {
    for line in [
        "total = 0;",
        "rows[0] = \"a\";",
        "counts[\"word\"] = 1;",
        "entry.Kind = EntryKind.File;",
        "Views.OpenText(\"n\", \"1\");",
        "Console.WriteLine(total);",
        "names.Sort((a, b) => a.Length - b.Length);",
    ] {
        let mask = mask(line);
        assert!(
            !csharp().declares_a_redeclarable_binding(line, &mask, 0),
            "`{line}` declares nothing"
        );
    }
    for line in [
        "var total = 0;",
        "List<string> names = [];",
        "int[] counts = [1, 2];",
        "string Slug(string text) => text.ToLowerInvariant();",
        "record Point(int X, int Y);",
        "class Parser {",
        "enum Kind { A, B }",
    ] {
        let mask = mask(line);
        assert!(
            csharp().declares_a_redeclarable_binding(line, &mask, 0),
            "`{line}` declares a name C# refuses twice"
        );
    }
}

/// **A declaration inside a string is not one**, because the mask says so.
#[test]
fn a_declaration_inside_a_literal_is_not_one() {
    let source = "var sample = \"var total = 1;\";\n";
    let mask = mask(source);
    let at = source
        .find("var total")
        .expect("the needle is in the source");
    assert!(!mask.is_code(at));
}

// ---------------------------------------------------------------------------------------------
// The wrapper that works
// ---------------------------------------------------------------------------------------------

/// **The concurrency wrapper a model reaches for is left exactly as written.**
///
/// This arm's answer differs from every other arm's in its *reason*. [C++](super::super::cpp::healing)
/// declines because the shape cannot be written — a translation unit is not a statement list. Here it
/// can be written and it **works**: Roslyn lowers an `async Task Main` into a synthesized synchronous
/// entry point that blocks on the result, and that is the entry point the guest invokes, which
/// `csharp_runs_a_program_written_the_async_way_a_model_reaches_for` proves against the real compiler
/// and the real committed guest. Taking the wrapper off would delete a class declaration and
/// re-indent a body to no purpose.
#[test]
fn an_async_entry_point_is_not_unwrapped() {
    let reply = "using System.Threading.Tasks;\n\nclass Program\n{\n    static async Task Main()\n    \
                 {\n        Views.OpenText(\"notes\", Files.ReadTextFile(\"notes.md\"));\n        \
                 await Task.CompletedTask;\n    }\n}\n";
    let mask = mask(reply);
    assert!(csharp().unwrap_async(reply, &mask).is_none());
    let result = healed(reply);
    assert_eq!(result.program, reply.trim_end());
    assert!(!fired(&result, HealingStrategy::UnwrapAsync));
}

/// **A top-level `await` is left alone too**, for the same reason and by the same lowering.
#[test]
fn a_top_level_await_is_not_unwrapped() {
    let reply = "using System.Threading.Tasks;\n\nvar notes = Files.ReadTextFile(\"notes.md\");\n\
                 await Task.CompletedTask;\nViews.OpenText(\"notes\", notes);\n";
    let mask = mask(reply);
    assert!(csharp().unwrap_async(reply, &mask).is_none());
    assert_eq!(healed(reply).program, reply.trim_end());
}

// ---------------------------------------------------------------------------------------------
// The lexer
// ---------------------------------------------------------------------------------------------

/// **A raw string's body is text, however much of it looks like code.**
///
/// `"""…"""` escapes nothing and ends on a run of quotes long enough to close it, so a `"` or a `\`
/// inside one means nothing at all — and a scan that read this as three strings would leave every
/// byte after it masked wrongly.
#[test]
fn a_raw_string_hides_everything_inside_it() {
    let source = "var usage = \"\"\"\nvar x = \"unbalanced\nand a \\ backslash\n\"\"\";\nViews.OpenText(\"usage\", usage);\n";
    let mask = mask(source);
    let at = source.find("var x =").expect("the needle is in the source");
    assert!(!mask.is_code(at));
    assert!(read_as_code(source, "Views.OpenText"));
}

/// **A verbatim string escapes a quote by doubling it**, so a run of them is that many pairs and, if
/// the run is odd, the one that closes the literal.
#[test]
fn a_verbatim_string_reads_a_doubled_quote_as_one() {
    let source =
        "var path = @\"C:\\logs\\\"\"quoted\"\"\\out.txt\";\nViews.OpenText(\"path\", path);\n";
    let mask = mask(source);
    let at = source.find("quoted").expect("the needle is in the source");
    assert!(!mask.is_code(at));
    assert!(read_as_code(source, "Views.OpenText"));
}

/// **An interpolation hole is code, even when it holds another string.**
///
/// C# 11 allows a string inside a hole, and a scanner that stopped at the second quote would read
/// one expression as three strings.
#[test]
fn an_interpolation_hole_is_code_and_may_hold_another_string() {
    let source = "Views.OpenText(\"names\", $\"{names.First(n => $\"{n}\")}\");\n";
    let mask = mask(source);
    let at = source
        .find("names.First")
        .expect("the needle is in the source");
    assert!(mask.is_code(at), "a hole is an expression, so it is code");
}

/// **A block comment does not nest**, which is the opposite of Swift's and Kotlin's.
///
/// `/* a /* b */` is one comment ending at the first `*/`, and reading it their way would leave the
/// code after it masked as comment and lost.
#[test]
fn a_block_comment_ends_at_the_first_close() {
    let source = "/* outer /* inner */\nViews.OpenText(\"note\", \"done\");\n";
    assert!(read_as_code(source, "Views.OpenText"));
}

/// **A reading that did not hold together is refused**, so no strategy deletes on the strength of
/// it.
///
/// Four states end a scan uncleanly, and each is a shape a model really sends: an unterminated block
/// comment, a `"…"` still open at a newline, a `'…'` still open at a newline, and a raw string never
/// closed. The correct answer to all four is `None` — the alternative is deleting text on a reading
/// already known to be wrong.
#[test]
fn a_source_that_did_not_lex_is_declined() {
    for broken in [
        "/* never closed\nViews.OpenText(\"n\", \"1\");\n",
        "var s = \"never closed\nViews.OpenText(\"n\", s);\n",
        "var c = 'x\nViews.OpenText(\"n\", \"1\");\n",
        "var s = \"\"\"\nnever closed\n",
        "var s = @\"never closed\n",
    ] {
        assert!(
            csharp().code_mask(broken).is_none(),
            "this did not lex cleanly and must be declined:\n{broken}"
        );
    }
}

/// **An apostrophe in English is not a character literal.**
///
/// The one place C#'s `'` could have cost this dialect a reply, and it costs nothing: a prose line
/// with an apostrophe in it never closes, so the scan reports it and healing declines rather than
/// masking the program below it — which is exactly the state a fenced reply with a lead-in is in
/// before its fences come off.
#[test]
fn an_apostrophe_in_prose_is_a_reading_that_did_not_hold() {
    assert!(csharp().code_mask("I couldn't finish that.\n").is_none());
    assert!(csharp().is_prose_line("I couldn't finish that."));
}

/// **A non-ASCII reply does not take the turn down.**
///
/// The scan walks one byte at a time, and a model's reply is not ASCII. Slicing on a byte index that
/// is not a character boundary would panic; comparing bytes cannot.
#[test]
fn a_reply_with_non_ascii_text_in_it_lexes() {
    let source = "var note = \"café — done\";\nViews.OpenText(\"note\", note);\n";
    assert!(read_as_code(source, "Views.OpenText"));
}
