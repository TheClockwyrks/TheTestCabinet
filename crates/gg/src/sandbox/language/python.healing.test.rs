//! Tests for **Python's [healing dialect](crate::healing::Dialect)** — the answers whose rule is a
//! fact about Python rather than about gg's contract.
//!
//! Almost every case drives the whole of [`heal`](crate::healing::heal) rather than calling a
//! predicate directly, because a predicate's answer only matters through the deletion it authorises
//! — and a test that asserted the answer alone would keep passing while the deletion it licenses
//! stopped happening.

use test_cabinet_core::gg::GgProgramLanguage;

use crate::healing::{Dialect, Healed, HealingConfig, HealingStrategy, heal};

use super::*;

/// Replies this language contributes to the [delete-only invariant](crate::healing::Dialect)
/// corpus, returned by [`PythonDialect::fixtures`].
///
/// A fenced program with prose around it, a program built around an `asyncio` runner, a program that
/// opens with two imports, a docstring carrying text that reads exactly like a top level, an f-string
/// carrying braces and a quote, a program pasted twice, a comment-only reply, and a reply that is
/// nothing but prose.
///
/// Some of those turn on a reading that is this dialect's rather than the skeleton's; the runner, the
/// imports and the doubled program turn on nothing, because no strategy examines any of them. They
/// stay because the invariant this corpus re-earns is that a reply nothing repairs comes out exactly
/// as it went in.
pub(super) const FIXTURES: &[&str] = &[
    "Here is the program.\n\n```python\nimport gg\n\nrows = gg.files.list_dir(\"src\")\ngg.views.open_text(\"rows\", repr(rows))\n```\n\nThat should list the directory.",
    "import asyncio\n\nimport gg\n\nasync def main():\n    rows = await gg.files.list_dir(\"src\")\n    gg.views.open_text(\"rows\", repr(rows))\n\nasyncio.run(main())",
    "import json\nimport re\n\npayload = json.dumps({\"ok\": True})\nfs.write_file(\"out.json\", payload)",
    "\"\"\"Usage:\n\nimport asyncio\ntotal = 1\n\"\"\"\ntotal = 2\n",
    "import gg\n\nname = \"world\"\ngg.views.open_text(\"greeting\", f\"hello {name!r}, {len(name)} letters\")",
    "import gg\n\ntotal = 1\ngg.views.open_text(\"total\", str(total))\n\ntotal = 1\ngg.views.open_text(\"total\", str(total))",
    "# I have already written MANIFEST.md.\n# Nothing left to do.",
    "I have finished the task. Everything works.",
];

/// Heal `reply` with **this** language's dialect and the default configuration.
fn healed(reply: &str) -> Healed {
    heal(
        reply,
        &HealingConfig::default(),
        crate::sandbox::language(GgProgramLanguage::Python).healing(),
    )
}

/// This dialect, as the skeleton takes it.
fn python() -> &'static dyn Dialect {
    &PYTHON_DIALECT
}

// ---------------------------------------------------------------------------------------------
// The doubled response
// ---------------------------------------------------------------------------------------------

/// **`drop-doubled-response` fires on this arm too.**
///
/// It is the transport-level doubling — a completion concatenated with a byte-identical copy of
/// itself — and it is the one strategy that asks a dialect nothing at all. Armed explicitly, because
/// it is the one strategy gg does not arm by default.
#[test]
fn a_doubled_response_is_still_halved() {
    let program =
        "import gg\n\nrows = gg.files.list_dir(\"src\")\ngg.views.open_text(\"rows\", repr(rows))";
    let mut config = HealingConfig::default();
    config.set(HealingStrategy::DropDoubledResponse, true);
    let result = heal(
        &format!("{program}{program}"),
        &config,
        crate::sandbox::language(GgProgramLanguage::Python).healing(),
    );
    assert_eq!(result.program, program);
    assert_eq!(
        result.strategies(),
        vec![HealingStrategy::DropDoubledResponse]
    );
}

// ---------------------------------------------------------------------------------------------
// The lexical mask
// ---------------------------------------------------------------------------------------------

/// **A triple-quoted string is string text, newlines and all** — so a docstring whose content reads
/// exactly like a top level is left where the model put it.
#[test]
fn a_docstring_is_not_code() {
    let reply = "\"\"\"Example:\n\nasync def main():\n    pass\n\nmain()\n\"\"\"\ntotal = 1";
    let result = healed(reply);
    assert_eq!(result.program, reply);
    assert!(result.strategies().is_empty());
}

/// **A single-quoted string still open at a newline means the scan lost its place**, so the mask is
/// `None` and every caller that needs one declines rather than working from a reading already known
/// to be wrong.
#[test]
fn an_unterminated_string_declines_every_masked_strategy() {
    let mask = python().code_mask("total = 'unterminated\nimport asyncio\n");
    assert!(mask.is_none());
}

/// **A backslash-newline inside a string is a line continuation, not an unterminated string** —
/// Python accepts it, so the lexer has to as well or an ordinary program would disable healing
/// outright.
#[test]
fn a_continued_string_lexes() {
    assert!(python().code_mask("total = 'one \\\ntwo'\n").is_some());
}

/// **A raw string's escaped quote does not end it.** `r"\""` is one string in Python, not two, so
/// treating the backslash as an escape is the accurate reading rather than a convenient one.
#[test]
fn a_raw_strings_escaped_quote_does_not_end_it() {
    let source = "pattern = r\"\\\"\"\ntotal = 1\n";
    let mask = python().code_mask(source).expect("it lexes");
    let total_at = source.find("total").expect("the second statement");
    assert!(mask.is_code(total_at));
}

/// **An f-string's substitution is string text**, deliberately: since 3.12 the expression inside
/// `{…}` may re-use the outer quote, and following it as code is a scan that loses its place on
/// exactly the input hardest to notice.
#[test]
fn an_f_strings_substitution_is_not_code() {
    let source = "label = f\"{'a' if x else 'b'} done\"\ntotal = 1\n";
    let mask = python().code_mask(source).expect("it lexes");
    let inner = source.find("if x").expect("the substitution");
    assert!(!mask.is_code(inner));
    assert!(mask.is_code(source.find("total").expect("the second statement")));
}

// ---------------------------------------------------------------------------------------------
// The two line predicates
// ---------------------------------------------------------------------------------------------

/// **A fenced Python program is unwrapped**, which is the tag list and both predicates working
/// together on the shape models send most often.
#[test]
fn a_fenced_program_is_unwrapped() {
    for tag in ["python", "py", "python3", ""] {
        let result = healed(&format!(
            "Here is the program.\n\n```{tag}\ntotal = 1\nviews.open_text(\"total\", str(total))\n```"
        ));
        assert_eq!(
            result.program, "total = 1\nviews.open_text(\"total\", str(total))",
            "a block tagged `{tag}` was not unwrapped"
        );
    }
}

/// **A `#` line is never deleted as prose**, because a Python comment and a Markdown heading are the
/// same three bytes and nothing lexical tells them apart.
///
/// The cost is a heading that survives into the program, where the interpreter reads it as a
/// comment. The alternative is deleting the model's own comments, which is a deletion of code.
#[test]
fn a_hash_line_is_never_prose() {
    for line in ["# Plan", "## What I did", "# read the manifest first"] {
        assert!(!python().is_prose_line(line), "`{line}` was read as prose");
    }
}

/// **A block opener is code and a sentence ending in a colon is not.**
///
/// A trailing `:` on its own proves nothing — `Here is the plan:` is the most ordinary sentence a
/// model writes above its program — so the clause pairs the colon with the keyword that opened the
/// block.
#[test]
fn a_trailing_colon_is_code_only_with_a_block_keyword() {
    for line in [
        "def widen(text):",
        "if total > 1:",
        "for row in rows:",
        "with open(path) as handle:",
        "try:",
        "except ToolError as failure:",
        "class Row:",
        "match kind:",
    ] {
        assert!(
            python().looks_like_code(line),
            "`{line}` was not read as code"
        );
    }
    for line in ["Here is the plan:", "The files I changed:"] {
        assert!(!python().looks_like_code(line), "`{line}` was read as code");
    }
}

/// **A keyword is matched case-sensitively**, which is the difference between the `if` that opens a
/// statement and the `If` that opens a sentence.
#[test]
fn a_capitalised_keyword_is_prose() {
    assert!(python().is_prose_line("If the manifest is missing I will write one."));
    assert!(!python().is_prose_line("if manifest is None:"));
    assert!(!python().is_prose_line("return total"));
}

/// **The shapes only Python has are read as code**, one clause each.
#[test]
fn each_code_clause_reads_its_own_shape() {
    for line in [
        "import json",                       // a statement keyword
        "@dataclass",                        // a decorator
        ") -> None",                         // a closer
        "rows = gg.files.list_dir(\"src\")", // an assignment
        "total: int = 0",                    // an annotated assignment
        "self.count += 1",                   // an augmented assignment
        "gg.views.open_text(\"a\", \"b\")",  // a call
        "entries = [",                       // left open
        "    \"one\",",                      // left open
    ] {
        assert!(
            python().looks_like_code(line),
            "`{line}` was not read as code"
        );
    }
}

/// **Prose is deleted from around a bare program**, which is the repair both predicates exist for.
#[test]
fn prose_around_a_bare_program_is_deleted() {
    let result = healed(
        "I will list the source directory and show myself the result.\n\
         import gg\n\
         \n\
         rows = gg.files.list_dir(\"src\")\n\
         gg.views.open_text(\"rows\", repr(rows))\n\
         That should be everything.",
    );
    assert_eq!(
        result.program,
        "import gg\n\nrows = gg.files.list_dir(\"src\")\ngg.views.open_text(\"rows\", repr(rows))"
    );
    assert_eq!(result.strategies(), vec![HealingStrategy::StripProse]);
}

/// **This dialect's tags are its own**, and the ECMAScript arm's are not among them — a reply
/// carrying one fenced block tagged for each language is the crispest evidence that the tag list is
/// read from the dialect rather than from a constant in the skeleton.
#[test]
fn the_fence_tags_are_pythons() {
    let tags = python().program_fence_tags();
    assert!(tags.contains(&"python") && tags.contains(&"py"));
    assert!(!tags.contains(&"ts") && !tags.contains(&"js"));
    // A transcript is not a program: every line of one is prefixed `>>>` and the interpreter's own
    // answers are interleaved with it.
    assert!(!tags.contains(&"pycon") && !tags.contains(&"doctest"));
}
