//! Tests for **Python's [healing dialect](crate::healing::Dialect)** — the answers whose rule is a
//! fact about Python rather than about gg's contract.
//!
//! Three of them are answers this arm gives and the ECMAScript arm does not, and those get the most
//! attention here, because a "no" that is *correct* looks exactly like a "no" that was never
//! implemented: an import is never dropped, a repeated program is never halved, and the concurrency
//! wrapper that does come off takes its `import asyncio` with it.
//!
//! Almost every case drives the whole of [`heal`](crate::healing::heal) rather than calling a
//! predicate directly, because a predicate's answer only matters through the deletion it authorises
//! — and a test that asserted the answer alone would keep passing while the deletion it licenses
//! stopped happening.

use test_cabinet_core::gg::GgProgramLanguage;

use crate::healing::{
    AsyncWrapper, Dialect, Healed, HealingConfig, HealingDetail, HealingStrategy, heal,
};

use super::*;

/// Replies this language contributes to the [delete-only invariant](crate::healing::Dialect)
/// corpus, returned by [`PythonDialect::fixtures`].
///
/// Each is a shape whose repair — or whose deliberate *refusal* to repair — is this dialect's rather
/// than the skeleton's: a fenced program with prose around it, the three-part `asyncio` wrapper, a
/// program whose imports must survive, a docstring carrying text that reads exactly like a top
/// level, an f-string carrying braces and a quote, a doubled program that must be left doubled, a
/// comment-only reply, and a reply that is nothing but prose.
pub(super) const FIXTURES: &[&str] = &[
    "Here is the program.\n\n```python\nrows = fs.list_dir(\"src\")\nview.open_text(\"rows\", repr(rows))\n```\n\nThat should list the directory.",
    "import asyncio\n\nasync def main():\n    rows = await fs.list_dir(\"src\")\n    view.open_text(\"rows\", repr(rows))\n\nasyncio.run(main())",
    "import json\nimport re\n\npayload = json.dumps({\"ok\": True})\nfs.write_file(\"out.json\", payload)",
    "\"\"\"Usage:\n\nimport asyncio\ntotal = 1\n\"\"\"\ntotal = 2\n",
    "name = \"world\"\nview.open_text(\"greeting\", f\"hello {name!r}, {len(name)} letters\")",
    "total = 1\nview.open_text(\"total\", str(total))\n\ntotal = 1\nview.open_text(\"total\", str(total))",
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
// The three answers that are Python's own
// ---------------------------------------------------------------------------------------------

/// **An import is never deleted**, because on this arm an import is as likely to be load-bearing as
/// it is to be dead.
///
/// The ECMAScript guest is baked with no module system, so `drop-imports` there deletes text that
/// could not have run. Here `import json` runs, `from math import hypot` runs, and
/// `from gg import ToolError` runs — the SDK is an ordinary package rather than names injected into
/// a scope — so a strategy that deleted them would delete the program's own first three lines.
#[test]
fn an_import_survives_because_this_guest_has_a_module_system() {
    let reply = "import json\nfrom math import hypot\nfrom gg import ToolError\n\n\
                 fs.write_file(\"a.json\", json.dumps({\"d\": hypot(3, 4)}))";
    let result = healed(reply);
    assert_eq!(result.program, reply.trim());
    assert!(
        result.strategies().is_empty(),
        "something repaired a program that needed nothing: {:?}",
        result.strategies()
    );
    for line in [
        "import json",
        "from math import hypot",
        "from gg import ToolError",
    ] {
        assert!(
            !python().is_import_statement(line),
            "`{line}` was recognised"
        );
    }
}

/// **A repeated program is left repeated**, because Python refuses no declaration twice.
///
/// `drop-duplicate-program`'s whole warrant is that the reply as sent could not have run: ECMAScript
/// makes redeclaring a `const` an early error, so deleting the second copy changes no behaviour
/// because there was none. Python has no such rule — `total = 1` twice is legal, `def main():` twice
/// is legal, and a program pasted twice *runs twice*. Without the proof, deleting it would delete
/// work the model literally asked to have done.
#[test]
fn a_repeated_program_is_not_halved() {
    let program = "total = 1\nview.open_text(\"total\", str(total))";
    let result = healed(&format!("{program}\n\n{program}"));
    assert_eq!(result.program, format!("{program}\n\n{program}"));
    assert!(
        !result
            .strategies()
            .contains(&HealingStrategy::DropDuplicateProgram)
    );
}

/// **`drop-doubled-response` still fires**, which is what makes the answer above a decision rather
/// than a gap.
///
/// It is the transport-level doubling — a completion concatenated with a byte-identical copy of
/// itself — and it is the one strategy that asks a dialect nothing at all. A dialect that gave up
/// the *finer* duplicate check has not given up this one. Armed explicitly, because it is the one
/// strategy gg does not arm by default.
#[test]
fn a_doubled_response_is_still_halved() {
    let program = "rows = fs.list_dir(\"src\")\nview.open_text(\"rows\", repr(rows))";
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

/// **The concurrency wrapper comes off whole — its `import asyncio` included.**
///
/// Python's runner is a module rather than a keyword, so the shape a model writes is three parts.
/// Unwrapping the middle and leaving the first would produce a program whose very first line raises
/// `ModuleNotFoundError`, because this guest is deliberately baked without `asyncio` — which is why
/// this dialect can answer "no import is ever deleted" and still deliver the repair.
#[test]
fn the_asyncio_wrapper_comes_off_with_its_import() {
    let result = healed(
        "import asyncio\n\n\
         async def main():\n    \
             rows = await fs.list_dir(\"src\")\n    \
             await view.open_text(\"rows\", repr(rows))\n\n\
         asyncio.run(main())",
    );
    assert_eq!(
        result.program,
        "rows = fs.list_dir(\"src\")\nview.open_text(\"rows\", repr(rows))"
    );
    assert_eq!(result.strategies(), vec![HealingStrategy::UnwrapAsync]);
    assert!(matches!(
        result
            .applied
            .first()
            .map(|application| &application.detail),
        Some(HealingDetail::Async {
            wrapper: AsyncWrapper::Declared,
            awaits: 2
        })
    ));
}

/// **A statement that opened with `await` keeps its indentation legal.**
///
/// The token takes the whitespace after it, which is the one place this dialect's unwrap differs
/// from the ECMAScript arm's — and it is not a nicety. `    await work()` dedents to `await work()`,
/// and deleting the token alone would leave ` work()`: a line opening with a space, which is an
/// `IndentationError` rather than a program.
#[test]
fn a_stripped_await_leaves_no_leading_space() {
    let result = healed(
        "async def main():\n    await system.shell(\"ls\")\n    total = await count()\n\nmain()",
    );
    assert_eq!(result.program, "system.shell(\"ls\")\ntotal = count()");
}

/// **The three ways this dialect accepts the wrapper's invocation, and the shapes it refuses.**
///
/// The invocation is *required*, on the skeleton's own warrant: a wrapper the program never calls
/// ran nothing, so unwrapping it would execute statements the reply never asked to execute. And a
/// call whose result the program then uses declines, because deleting it would delete code with it.
#[test]
fn the_wrapper_is_recognised_only_when_the_program_runs_it() {
    let body = "async def main():\n    total = 1\n";
    for invocation in [
        "main()",
        "await main()",
        "asyncio.run(main())",
        "asyncio.get_event_loop().run_until_complete(main())",
    ] {
        assert_eq!(
            healed(&format!("{body}\n{invocation}")).program,
            "total = 1",
            "`{invocation}` was not recognised as running the wrapper"
        );
    }
    for tail in [
        "",
        "\nresult = asyncio.run(main())",
        "\nasyncio.run(main())\nview.open_text(\"done\", \"yes\")",
        "\nasyncio.run(other())",
    ] {
        let reply = format!("{body}{tail}");
        assert!(
            healed(&reply).program.contains("async def main"),
            "the wrapper came off a program that does not run it:\n{reply}"
        );
    }
}

/// **A declaration whose parameter list runs onto a second line declines**, because delimiting it is
/// a parse and this is not a parser.
#[test]
fn a_wrapper_split_across_lines_declines() {
    let reply = "async def main(\n    argument,\n):\n    total = 1\n\nmain()";
    assert_eq!(healed(reply).program, reply);
}

// ---------------------------------------------------------------------------------------------
// The lexical mask
// ---------------------------------------------------------------------------------------------

/// **A triple-quoted string is string text, newlines and all** — which is what stops a docstring
/// that shows a wrapper from having that wrapper unwrapped out from under it.
#[test]
fn a_docstring_is_not_code() {
    let reply = "\"\"\"Example:\n\nasync def main():\n    pass\n\nmain()\n\"\"\"\ntotal = 1";
    let result = healed(reply);
    assert_eq!(result.program, reply);
    assert!(result.strategies().is_empty());
}

/// **A single-quoted string still open at a newline means the scan lost its place**, so every
/// strategy that needs the mask declines rather than deleting text on a reading already known to be
/// wrong.
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
            "Here is the program.\n\n```{tag}\ntotal = 1\nview.open_text(\"total\", str(total))\n```"
        ));
        assert_eq!(
            result.program, "total = 1\nview.open_text(\"total\", str(total))",
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
        "import json",                  // a statement keyword
        "@dataclass",                   // a decorator
        ") -> None",                    // a closer
        "rows = fs.list_dir(\"src\")",  // an assignment
        "total: int = 0",               // an annotated assignment
        "self.count += 1",              // an augmented assignment
        "view.open_text(\"a\", \"b\")", // a call
        "entries = [",                  // left open
        "    \"one\",",                 // left open
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
         rows = fs.list_dir(\"src\")\n\
         view.open_text(\"rows\", repr(rows))\n\
         That should be everything.",
    );
    assert_eq!(
        result.program,
        "rows = fs.list_dir(\"src\")\nview.open_text(\"rows\", repr(rows))"
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
