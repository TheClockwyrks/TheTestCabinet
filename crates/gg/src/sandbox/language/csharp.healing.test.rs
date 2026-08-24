//! The answers that are C#'s own, and the lexer underneath them.
//!
//! What is deliberately **not** here is a second copy of the skeleton's tests. Fence stripping,
//! prose stripping, the fixpoint loop, the operator's record and the delete-only invariant are
//! asserted once in `healing.test.rs` against every registered dialect, this one included. What this
//! file asserts is the part that is C#'s — the `#` that is both a heading and a directive, and the
//! lexer whose raw strings, interpolation holes and doubled verbatim quotes are shapes no other
//! arm's scan has to read.

use super::CSHARP_DIALECT;
use crate::healing::Dialect;

/// Replies in C# that the [delete-only invariant](crate::healing::Dialect::fixtures) is re-earned
/// over.
///
/// Every one of them is a reply written the way a C# author really writes one: a `using` above a
/// fenced program, a `#nullable` that must not be deleted as prose, a Markdown heading that must
/// stay deletable beside it, a program pasted twice over, a program pasted twice over that opens
/// with a `record`, an `async Task Main` wrapper, a raw string full of code-shaped text, an
/// interpolated string with a string inside its hole, a verbatim string with doubled quotes, a
/// block comment that does not nest, an apostrophe in a line of English, a `partial class` written
/// out twice, and a reply that is no program at all.
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
// The lexer
// ---------------------------------------------------------------------------------------------

/// **An ordinary string literal hides what it holds**, however much of a program that text spells.
///
/// `"var total = 1;"` is a line of text and the mask says so, which is what keeps a reader of the
/// mask from taking a statement a program merely quotes for one the program makes.
#[test]
fn an_ordinary_string_literal_hides_what_it_holds() {
    let source = "var sample = \"var total = 1;\";\n";
    let mask = mask(source);
    let at = source
        .find("var total")
        .expect("the needle is in the source");
    assert!(!mask.is_code(at));
}

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

/// **A reading that did not hold together is refused**, so nothing acts on the strength of it.
///
/// Four states end a scan uncleanly, and each is a shape a model really sends: an unterminated block
/// comment, a `"…"` still open at a newline, a `'…'` still open at a newline, and a raw string never
/// closed. The correct answer to all four is `None` — the alternative is answering on a reading
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
