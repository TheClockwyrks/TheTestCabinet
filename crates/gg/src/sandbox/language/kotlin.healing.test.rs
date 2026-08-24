//! The answers that are Kotlin's own, and the lexer underneath them.
//!
//! What is deliberately **not** here is a second copy of the skeleton's tests. Fence stripping, prose
//! stripping, the fixpoint loop, the operator's record and the delete-only invariant are asserted
//! once in `healing.test.rs` against every registered dialect, this one included. What this file
//! asserts is the part that is Kotlin's — and, because this arm shares a compiler road with
//! [Java's](super::super::java::healing), some of it is written as a **comparison against that arm**:
//! two answers differ, and each test that turns on one names it.

use test_cabinet_core::gg::GgProgramLanguage;

use super::KOTLIN_DIALECT;
use crate::healing::{Dialect, Healed, HealingConfig, heal};

/// Replies in Kotlin that the [delete-only invariant](crate::healing::Dialect::fixtures) is re-earned
/// over.
///
/// A corpus rather than a list of expected repairs: what each reply has to survive is the whole
/// pipeline, under every configuration, with nothing invented and nothing moved. Between them they
/// carry a fenced program with prose on both sides, imports of three kinds, the concurrency wrappers
/// and the `suspend` modifier a Kotlin author reaches for, a raw string whose body must not be read
/// as code, a `${…}` template with a quote inside it, a program written out twice, a `#` line that
/// is prose here, and a reply that is no program at all. Only some of those are shapes one of this
/// arm's four readings turns on; a wrapper, an import and a doubled program are read by nothing at
/// all now, which is exactly what makes them worth keeping in a corpus whose claim is that nothing
/// is ever added or moved.
///
/// Each reply is a **whole Kotlin file** with its own `fun main()` and its own `import` lines, spelled
/// the way this arm's catalogue spells them, because that is what a program on this arm is.
pub(super) const FIXTURES: &[&str] = &[
    "Here is the program.\n\n```kotlin\nimport gg.files.*\nimport gg.views.*\n\nfun main() {\n    openText(\"rows\", listDir(\"src\").toString())\n}\n```\n\nThat lists the directory.",
    "import gg.files.*\nimport gg.views.*\nimport kotlinx.coroutines.runBlocking\n\nfun main() {\n    runBlocking {\n        openText(\"rows\", listDir(\"src\").toString())\n    }\n}",
    "import gg.views.*\nimport kotlin.concurrent.thread\n\nfun main() {\n    thread {\n        openText(\"note\", \"done\")\n    }.join()\n}",
    "import gg.views.*\n\nfun main() {\n    val worker = Thread {\n        openText(\"note\", \"done\")\n    }\n    worker.start()\n    worker.join()\n}",
    "import gg.files.*\nimport gg.views.*\n\nsuspend fun gather(): String = readFile(\"notes.md\")\n\nfun main() {\n    runBlocking {\n        openText(\"notes\", gather())\n    }\n}",
    "import gg.files.*\nimport gg.views.*\nimport kotlin.math.abs\n\nfun main() {\n    val drift = abs(listDir(\"src\").size - 3)\n    openText(\"drift\", drift.toString())\n}",
    "fun main() {\n    val usage = \"\"\"\n        Example:\n\n        runBlocking {\n            val total = 1\n        }\n        \"\"\"\n    val total = 2\n}\n",
    "import gg.views.*\n\nfun main() {\n    val rows = mapOf(\"n\" to 1)\n    openText(\"n\", \"total: ${rows[\"n\"]}\")\n}\n",
    "import gg.views.*\n\nfun helper(): Int = 1\n\nfun main() {\n    openText(\"n\", helper().toString())\n}\n\nimport gg.views.*\n\nfun helper(): Int = 1\n\nfun main() {\n    openText(\"n\", helper().toString())\n}",
    "# Plan\n\nimport gg.views.*\n\nfun main() {\n    val total = 1\n    openText(\"total\", total.toString())\n}",
    "I have finished the task. Everything works.",
];

/// Heal `reply` with **this** language's dialect and the default configuration.
fn healed(reply: &str) -> Healed {
    heal(
        reply,
        &HealingConfig::SAFE_REPAIRS,
        crate::sandbox::language(GgProgramLanguage::Kotlin).healing(),
    )
}

/// This dialect, as the skeleton takes it.
fn kotlin() -> &'static dyn Dialect {
    &KOTLIN_DIALECT
}

/// [Java's](super::super::java::healing), for the two comparisons this file makes.
fn java() -> &'static dyn Dialect {
    crate::sandbox::language(GgProgramLanguage::Java).healing()
}

// ---------------------------------------------------------------------------------------------
// The two predicates
// ---------------------------------------------------------------------------------------------

/// **A backtick is code punctuation here and is not on the other JVM arm.**
///
/// Kotlin has backquoted identifiers, so a line carrying a backtick may perfectly well be code and
/// the rule that every clause of `is_prose_line` be a shape *only English has* forbids deleting it.
/// Java has no backtick anywhere in its grammar, so it may — and does.
#[test]
fn an_inline_code_span_is_prose_on_the_java_arm_and_is_not_here() {
    let line = "The plan is to read `Main.kt` first.";
    assert!(!kotlin().is_prose_line(line));
    assert!(
        java().is_prose_line(line),
        "the comparison this test is about no longer holds"
    );
    assert!(
        crate::sandbox::language(GgProgramLanguage::TypeScript)
            .healing()
            .is_prose_line(line)
            == kotlin().is_prose_line(line),
        "this arm answers the backtick question the way every non-Java C-shaped arm does"
    );
}

/// **A `#` line is prose here, and is deleted** — where Python's and Ruby's arms refuse to touch one.
///
/// Those two refuse because `# Plan` is a comment in their language as well as a Markdown heading,
/// and nothing lexical tells the two apart. Kotlin has no `#` at all, so a `#` line is certainly not
/// Kotlin and leaving one in a program is a syntax error rather than a surviving comment. What is
/// never prose here is a `//` line.
#[test]
fn a_hash_line_is_prose_and_a_slash_line_is_not() {
    assert!(kotlin().is_prose_line("# Plan"));
    assert!(kotlin().is_prose_line("Here is what I will do."));
    assert!(!kotlin().is_prose_line("// the plan"));
    assert!(!kotlin().is_prose_line("/* the plan */"));

    let result = healed("# Plan\n\nval total = 1\ngg.views.openText(\"total\", total.toString())");
    assert_eq!(
        result.program,
        "val total = 1\ngg.views.openText(\"total\", total.toString())"
    );
}

/// **The shapes only Kotlin code has, and the shapes only English has.**
///
/// The first list is what carries this dialect where Java's is carried by the semicolon: two of these
/// lines end in no punctuation at all and are read by the keyword clause, the chain clause and the
/// assignment clause instead.
#[test]
fn the_two_predicates_point_their_errors_in_the_safe_direction() {
    for line in [
        "val total = 1",
        "gg.views.openText(\"note\", body)",
        "}",
        "// a note",
        "@JvmStatic",
        "    .map { it.name }",
        "?.let { gg.views.openText(\"it\", it) }",
        "rows.forEach { entry ->",
        "for (name in names) {",
        "total += 1",
        "when (mode) {",
        "fun helper(): Int = 1",
    ] {
        assert!(kotlin().looks_like_code(line), "not read as code: {line}");
    }

    for line in [
        // Case matters: `For` opens a sentence and `for` opens a loop.
        "For each file I will read the header.",
        "Done.",
        // A bullet is not a KDoc continuation. `strip-fences` declines outright when any line
        // outside the fences is code-shaped, so reading this as code would send the most common
        // real reply shape — prose, one fenced program, prose — to the compiler whole.
        "* read the manifest",
        // The soft keywords deliberately left off the list, each of which opens an ordinary
        // sentence and none of which opens a Kotlin statement.
        "it reads the manifest first",
        "in the workspace there is a manifest",
        "value is discarded unless you open a view of it",
    ] {
        assert!(!kotlin().looks_like_code(line), "read as code: {line}");
        assert!(kotlin().is_prose_line(line), "not read as prose: {line}");
    }

    // And the block a leading `*` would have protected is protected by its own opener instead: a
    // reply that starts with a KDoc comment loses no line of it, because `strip-prose` only deletes
    // runs from the two ends and the run stops at `/**`.
    let reply = "/**\n\
                  * Reads the manifest and shows what is in it.\n\
                  */\n\
                 gg.views.openText(\"manifest\", gg.files.readFile(\"manifest.json\"))\n";
    assert_eq!(healed(reply).program, reply.trim_end());
}

// ---------------------------------------------------------------------------------------------
// The lexer
// ---------------------------------------------------------------------------------------------

/// **A raw string's body is not code**, and the brace and the declaration inside it are data.
///
/// This is the shape a naive scan loses the source on: `"""` also starts with `"`, and reading it as
/// an empty string followed by another would put the whole body back in the code — where the `{`
/// would be counted and the `val` inside it read as the program's.
#[test]
fn a_raw_string_carries_data_rather_than_code() {
    let reply = "val usage = \"\"\"\n    \
                     Example:\n\n    \
                     runBlocking {\n        \
                         val total = 1\n    \
                     }\n    \
                     \"\"\"\n\
                 val total = 2\n";
    let result = healed(reply);
    assert_eq!(result.program, reply.trim_end());
    assert!(result.applied.is_empty(), "{:?}", result.applied);

    let mask = kotlin().code_mask(reply).expect("it lexes");
    let inside = reply.find("val total = 1").expect("the block holds one");
    assert!(!mask.is_code(inside));
    let outside = reply.rfind("val total = 2").expect("the program holds one");
    assert!(mask.is_code(outside));
}

/// **The three readings Java's lexer does not need**: a string template, a nested block comment and a
/// backquoted identifier.
///
/// Each is a place a Java-shaped scan silently loses the source rather than declining. The template
/// is the sharpest of the three — a scan that stopped at the quote before `n` would read the rest of
/// the line as code, and the `}` inside it as a brace.
#[test]
fn the_lexer_reads_the_three_shapes_kotlin_has_and_java_does_not() {
    let template = "gg.views.openText(\"n\", \"total: ${rows[\"n\"]}\")\nval after = 1\n";
    let mask = kotlin().code_mask(template).expect("it lexes");
    // The template's own contents are code, because they are.
    let inside = template.find("rows[").expect("the template holds one");
    assert!(mask.is_code(inside));
    // The prose half of the string is not.
    let prose = template.find("total: ").expect("the string holds one");
    assert!(!mask.is_code(prose));
    // And the scan came back out of the string in the right place.
    assert!(mask.is_code(template.find("val after").expect("it is there")));

    let nested = "/* a /* b */ c */\nval total = 1\n";
    let mask = kotlin().code_mask(nested).expect("it lexes");
    assert!(!mask.is_code(nested.find(" c */").expect("it is there")));
    assert!(mask.is_code(nested.find("val total").expect("it is there")));
    // Java's lexer, on the same text, comes out one comment early — which is the whole point of
    // this arm having its own.
    assert!(
        java()
            .code_mask(nested)
            .is_some_and(|mask| mask.is_code(nested.find(" c */").expect("it is there"))),
        "the comparison this test is about no longer holds"
    );

    let backquoted = "val `total count` = 1\ngg.views.openText(\"n\", `total count`.toString())\n";
    let mask = kotlin().code_mask(backquoted).expect("it lexes");
    assert!(!mask.is_code(backquoted.find("total count").expect("it is there")));
}

/// **Strings, character literals and both comment forms are read**, and a scan that lost its place
/// gives up the whole mask rather than reporting string bytes as code.
#[test]
fn the_lexer_declines_the_shapes_it_cannot_read() {
    let source = "val comma = ','\n\
                  val quote = \"a \\\" b\"\n\
                  /* a block\n   comment */\n\
                  // a line comment\n\
                  val total = 1\n";
    let mask = kotlin().code_mask(source).expect("it lexes");
    for (what, needle) in [
        ("the character literal", "','"),
        ("the escaped quote", "\\\""),
        ("the block comment", "a block"),
        ("the line comment", "a line comment"),
    ] {
        let at = source.find(needle).unwrap_or_else(|| panic!("{what}"));
        assert!(!mask.is_code(at), "{what} was read as code");
    }
    assert!(mask.is_code(source.find("val total").expect("it is there")));

    // Unterminated, each in a way Kotlin itself forbids: the scan has lost its place, and giving up
    // is the correct failure mode for a reading already known to be wrong.
    for source in [
        "val open = \"unterminated\n",
        "/* never closed\nval total = 1\n",
        "/* a /* b */ never closed\n",
        "val block = \"\"\"\nnever closed\n",
        "val name = `never closed\n",
    ] {
        assert!(kotlin().code_mask(source).is_none(), "{source}");
    }
}

/// **A reply that is not ASCII is read rather than crashed on.**
///
/// The lexer walks one **byte** at a time, so slicing at every step panics on an index that is not a
/// character boundary. A single `é` in a string, a comment or an identifier would take the turn down
/// with a slice index error rather than being healed, and a model writing a message in any language
/// but English produces one on its first turn. What is asserted is not merely that nothing panics but
/// that the reading is still right: the raw string's contents are still not code, and the accented
/// name outside it still is.
#[test]
fn a_reply_that_is_not_ascii_is_read_rather_than_crashed_on() {
    let reply = "// a cömment: don\u{2019}t lose the place\n\
                 println('é')\n\
                 gg.views.openText(\"grüße — wörld ✅\", \"\"\"\n    \
                     Beispiel — über alles:\n    \
                     val total = 1\n    \
                     \"\"\")\n";
    let mask = kotlin().code_mask(reply).expect("it lexes");

    let inside = reply.find("val total = 1").expect("the block holds one");
    assert!(!mask.is_code(inside));

    // And an accented name outside a string is still read as code rather than lost.
    for (line, name) in [
        ("val grüße = \"a\"", "grüße"),
        ("data class Größe(val x: Int)", "Größe"),
    ] {
        let mask = kotlin().code_mask(line).expect("it lexes");
        let at = line.find(name).expect("the line holds it");
        assert!(mask.is_code(at), "{line}");
        assert!(kotlin().looks_like_code(line), "{line}");
    }

    // The whole pipeline runs over it, under every configuration, and only ever deletes.
    crate::healing::tests::assert_delete_only(kotlin(), &[reply], "Kotlin");
}

/// **The fence tags are Kotlin's**, and the script extension is among them.
#[test]
fn the_fence_tags_are_this_languages_own() {
    assert_eq!(kotlin().program_fence_tags(), ["kotlin", "kt", "kts"]);
    // `kts` is not a mistake, though a program is compiled as an ordinary `.kt` file: a model that
    // reached for the script extension has still written the Kotlin its block holds, and refusing
    // to read the block over its tag would cost a turn for a label.
    assert!(!kotlin().program_fence_tags().contains(&"java"));
}
