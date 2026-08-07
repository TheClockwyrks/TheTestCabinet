//! The answers that are Kotlin's own, and the lexer underneath them.
//!
//! What is deliberately **not** here is a second copy of the skeleton's tests. Fence stripping, prose
//! stripping, the fixpoint loop, the honesty disclosure and the delete-only invariant are asserted
//! once in `healing.test.rs` against every registered dialect, this one included. What this file
//! asserts is the part that is Kotlin's — and, because this arm shares a compiler road with
//! [Java's](super::super::java::healing), most of it is written as a **comparison against that arm**:
//! five answers differ, and each test below names the one it is about.

use test_cabinet_core::gg::GgProgramLanguage;

use super::KOTLIN_DIALECT;
use crate::healing::{
    AsyncWrapper, Dialect, Healed, HealingConfig, HealingDetail, HealingStrategy, heal,
};

/// Replies in Kotlin that the [delete-only invariant](crate::healing::Dialect::fixtures) is re-earned
/// over.
///
/// Every one of them exercises an answer that is this dialect's rather than the skeleton's: the three
/// wrapper heads and both of their shapes, the coroutine import that comes off with one, a `suspend`
/// modifier the repair deletes, an import that must survive, a raw string whose body must not be read
/// as code — including one carrying a `${…}` template with a quote inside it — a doubled program
/// whose repeat redeclares a `fun` rather than a `val`, a `#` line that is prose here, and two replies
/// that are no program at all.
pub(super) const FIXTURES: &[&str] = &[
    "Here is the program.\n\n```kotlin\nval rows = fs.listDir(\"src\")\nview.openText(\"rows\", rows.toString())\n```\n\nThat lists the directory.",
    "import kotlinx.coroutines.runBlocking\n\nrunBlocking {\n    val rows = fs.listDir(\"src\")\n    view.openText(\"rows\", rows.toString())\n}",
    "import kotlin.concurrent.thread\n\nthread {\n    view.openText(\"note\", \"done\")\n}.join()",
    "val worker = Thread {\n    view.openText(\"note\", \"done\")\n}\nworker.start()\nworker.join()",
    "runBlocking {\n    suspend fun gather(): String = fs.readTextFile(\"notes.md\")\n    view.openText(\"notes\", gather())\n}",
    "import kotlin.math.abs\n\nval drift = abs(fs.listDir(\"src\").size - 3)\nview.openText(\"drift\", drift.toString())",
    "val usage = \"\"\"\n    Example:\n\n    runBlocking {\n        val total = 1\n    }\n    \"\"\"\nval total = 2\n",
    "val rows = mapOf(\"n\" to 1)\nview.openText(\"n\", \"total: ${rows[\"n\"]}\")\n",
    "fun helper(): Int = 1\nview.openText(\"n\", helper().toString())\n\nfun helper(): Int = 1\nview.openText(\"n\", helper().toString())",
    "# Plan\n\nval total = 1\nview.openText(\"total\", total.toString())",
    "I have finished the task. Everything works.",
];

/// Heal `reply` with **this** language's dialect and the default configuration.
fn healed(reply: &str) -> Healed {
    heal(
        reply,
        &HealingConfig::default(),
        crate::sandbox::language(GgProgramLanguage::Kotlin).healing(),
    )
}

/// This dialect, as the skeleton takes it.
fn kotlin() -> &'static dyn Dialect {
    &KOTLIN_DIALECT
}

/// [Java's](super::super::java::healing), for the comparisons this file is largely made of.
fn java() -> &'static dyn Dialect {
    crate::sandbox::language(GgProgramLanguage::Java).healing()
}

// ---------------------------------------------------------------------------------------------
// The concurrency wrapper
// ---------------------------------------------------------------------------------------------

/// **`runBlocking { … }` comes off, and the `kotlinx.coroutines` import comes off with it.**
///
/// The whole-program shape a Kotlin author reaches for, and the one whose repair would be useless
/// without the import deletion: `kotlinx.coroutines` is deliberately not on this arm's program
/// classpath, so leaving the line behind would leave the one line of the repaired program that still
/// fails to compile.
#[test]
fn the_run_blocking_wrapper_comes_off_with_its_import() {
    let result = healed(
        "import kotlinx.coroutines.runBlocking\n\n\
         runBlocking {\n    \
             val rows = fs.listDir(\"src\")\n    \
             view.openText(\"rows\", rows.toString())\n\
         }",
    );
    assert_eq!(
        result.program,
        "val rows = fs.listDir(\"src\")\nview.openText(\"rows\", rows.toString())"
    );
    assert_eq!(result.strategies(), vec![HealingStrategy::UnwrapAsync]);
    assert!(
        matches!(
            result
                .applied
                .first()
                .map(|application| &application.detail),
            Some(HealingDetail::Async {
                wrapper: AsyncWrapper::Immediate,
                awaits: 0,
            })
        ),
        "{:?}",
        result.applied
    );
}

/// **This is where the two JVM arms disagree about an import**, and the disagreement is about the
/// classpath rather than about the language family.
///
/// Java keeps `import java.util.concurrent.CompletableFuture;` above its wrapper, because that
/// package is in its declared library set and an unused import is legal. Kotlin's wrapper library is
/// not reachable at all, so the same rule — never delete a working line, never leave a dead one —
/// reaches the opposite conclusion.
#[test]
fn the_wrappers_import_is_deleted_here_and_kept_on_the_other_jvm_arm() {
    let kotlin = healed(
        "import kotlinx.coroutines.*\n\nrunBlocking {\n    view.openText(\"note\", \"done\")\n}",
    );
    assert_eq!(kotlin.program, "view.openText(\"note\", \"done\")");

    let java = heal(
        "import java.util.concurrent.CompletableFuture;\n\n\
         CompletableFuture.runAsync(() -> {\n    \
             view.openText(\"note\", \"done\");\n\
         }).join();",
        &HealingConfig::default(),
        java(),
    );
    assert!(
        java.program.starts_with("import java.util.concurrent"),
        "the comparison this test is about no longer holds:\n{}",
        java.program
    );
}

/// **An import that is not the wrapper's own makes the match decline**, rather than being deleted
/// alongside.
///
/// A program with a working import above its wrapper is not a program that is *entirely* made of one,
/// and `import kotlin.math.abs` is a line the body below may well depend on.
#[test]
fn an_unrelated_import_above_the_wrapper_declines_the_repair() {
    let reply =
        "import kotlin.math.abs\n\nrunBlocking {\n    view.openText(\"n\", abs(-1).toString())\n}";
    assert_eq!(healed(reply).program, reply);
}

/// **`thread { … }` comes off with no runner call, and `Thread { … }` needs one.**
///
/// `kotlin.concurrent.thread` starts by default, so writing it is enough to have run the body;
/// a bare `java.lang.Thread` has to be told to, and a wrapper that is only constructed ran nothing —
/// so unwrapping it would execute statements the response never asked to execute.
#[test]
fn a_thread_that_starts_itself_needs_no_runner_and_one_that_does_not_does() {
    let started = healed("thread {\n    view.openText(\"note\", \"done\")\n}");
    assert_eq!(started.program, "view.openText(\"note\", \"done\")");

    let joined =
        healed("kotlin.concurrent.thread {\n    view.openText(\"note\", \"done\")\n}.join()");
    assert_eq!(joined.program, "view.openText(\"note\", \"done\")");

    let unstarted = "Thread {\n    view.openText(\"note\", \"done\")\n}";
    assert_eq!(healed(unstarted).program, unstarted);

    let running = healed("Thread {\n    view.openText(\"note\", \"done\")\n}.start()");
    assert_eq!(running.program, "view.openText(\"note\", \"done\")");
}

/// **The declared shape comes off too**, and only when something actually starts it.
#[test]
fn the_declared_thread_wrapper_comes_off_only_when_it_is_started() {
    let started = healed(
        "val worker = Thread {\n    \
             view.openText(\"note\", \"done\")\n\
         }\n\
         worker.start()\n\
         worker.join()",
    );
    assert_eq!(started.program, "view.openText(\"note\", \"done\")");
    assert!(matches!(
        started
            .applied
            .first()
            .map(|application| &application.detail),
        Some(HealingDetail::Async {
            wrapper: AsyncWrapper::Declared,
            awaits: 0,
        })
    ));

    let unstarted = "val worker = Thread {\n    view.openText(\"note\", \"done\")\n}";
    assert_eq!(healed(unstarted).program, unstarted);
}

/// **A trailing lambda after an argument list is still the wrapper**, which is a shape Java's arm
/// cannot have.
///
/// Kotlin puts the block *outside* the parentheses, so `runBlocking(Dispatchers.Default) { … }` and
/// `thread(start = false) { … }` are the same wrapper with an argument list in the middle — where the
/// equivalent Java wrapper has its lambda inside the call.
#[test]
fn an_argument_list_between_the_head_and_the_lambda_is_still_the_wrapper() {
    let result = healed(
        "import kotlinx.coroutines.*\n\n\
         runBlocking(Dispatchers.Default) {\n    \
             view.openText(\"note\", \"done\")\n\
         }",
    );
    assert_eq!(result.program, "view.openText(\"note\", \"done\")");

    let declared = healed(
        "import kotlin.concurrent.thread\n\n\
         val worker = thread(start = false) {\n    \
             view.openText(\"note\", \"done\")\n\
         }\n\
         worker.start()",
    );
    assert_eq!(declared.program, "view.openText(\"note\", \"done\")");
}

/// **The `suspend` modifier goes with the wrapper, and is counted** — the one arm whose suspension
/// count is not zero for a language with no `await`.
///
/// Kotlin marks suspension on the *declaration* rather than at the call site, so a `suspend fun`
/// declared inside the wrapper is exactly the thing that cannot survive the wrapper coming off:
/// without this the repaired program is refused with `Suspend function … should be called only from
/// a coroutine`. Java's and Ruby's zero is the honest number for languages with no such token; this
/// is the honest number for one that keeps it somewhere unusual.
#[test]
fn a_suspend_modifier_comes_off_with_the_wrapper_and_is_counted() {
    let result = healed(
        "runBlocking {\n    \
             suspend fun gather(): String = fs.readTextFile(\"notes.md\")\n    \
             view.openText(\"notes\", gather())\n\
         }",
    );
    assert_eq!(
        result.program,
        "fun gather(): String = fs.readTextFile(\"notes.md\")\nview.openText(\"notes\", gather())"
    );
    assert!(
        matches!(
            result
                .applied
                .first()
                .map(|application| &application.detail),
            Some(HealingDetail::Async {
                wrapper: AsyncWrapper::Immediate,
                awaits: 1,
            })
        ),
        "{:?}",
        result.applied
    );

    // And the word inside a string is not a modifier: the mask is what tells the two apart.
    let quoted = healed("runBlocking {\n    view.openText(\"note\", \"suspend nothing\")\n}");
    assert_eq!(
        quoted.program,
        "view.openText(\"note\", \"suspend nothing\")"
    );
}

/// **A wrapper that is not the whole program is left alone.**
///
/// The match is anchored to the head, which matters more here than on any other arm: Kotlin's
/// trailing-lambda syntax makes `something { … }` the shape of half the expressions a program writes,
/// so without the anchor a reply whose last statement was `rows.forEach { … }` would have every
/// statement above it deleted.
#[test]
fn a_wrapper_that_is_not_the_whole_program_is_left_alone() {
    for reply in [
        "fs.writeFile(\"out.txt\", \"hello\")\nrunBlocking {\n    view.openText(\"note\", \"done\")\n}",
        "val rows = fs.listDir(\"src\")\nrows.forEach {\n    view.openText(it.name, it.name)\n}",
    ] {
        assert_eq!(healed(reply).program, reply);
    }
}

// ---------------------------------------------------------------------------------------------
// The import that is never deleted
// ---------------------------------------------------------------------------------------------

/// **No line is ever an import, so `drop-imports` never fires here.**
///
/// gg's preparation hoists every `import` a model wrote into the script's header before the compiler
/// sees it, so the line resolves and does its job. On the ECMAScript arms the same line is dead text
/// and dropping it can only help; here dropping it would delete a working line.
#[test]
fn an_import_is_a_working_line_and_is_never_deleted() {
    for line in [
        "import kotlin.math.abs",
        "import kotlin.collections.*",
        "import java.time.Instant",
    ] {
        assert!(!kotlin().is_import_statement(line), "{line}");
    }

    let reply = "import kotlin.math.abs\n\n\
                 val drift = abs(fs.listDir(\"src\").size - 3)\n\
                 view.openText(\"drift\", drift.toString())";
    let result = healed(reply);
    assert_eq!(result.program, reply);
    assert!(result.applied.is_empty(), "{:?}", result.applied);
}

// ---------------------------------------------------------------------------------------------
// Redeclaration
// ---------------------------------------------------------------------------------------------

/// **A repeated tail that redeclares a `fun` is deleted**, which is a proof no other arm has.
///
/// A program here is a Kotlin **script**, whose top level is a class body rather than a block — so
/// the compiler refuses a second `fun` of one name (`Overload resolution ambiguity`) exactly as it
/// refuses a second `val`. Java's program is a method body, where a `fun` has no counterpart at all,
/// so that arm's proof is a local variable and nothing else.
#[test]
fn a_doubled_program_that_redeclares_a_function_is_halved() {
    let half = "fun helper(): Int = 1\nview.openText(\"n\", helper().toString())";
    let result = healed(&format!("{half}\n\n{half}"));
    assert_eq!(result.program, half);
    assert!(
        result
            .strategies()
            .contains(&HealingStrategy::DropDuplicateProgram),
        "{:?}",
        result.applied
    );
}

/// **What counts as a declaration, and what deliberately does not.**
///
/// Every entry in the first list is one the compiler refuses to see twice at a script's top level —
/// measured against the real one. Every entry in the second may legally be written twice, and each is
/// rejected **by construction** rather than by a deny list: Kotlin puts a keyword in front of every
/// declaration, so a line whose first word is neither a modifier nor a declaration keyword is not a
/// declaration, full stop. That is the whole difference from Java's reading of the same question,
/// which has to subtract two dozen statement keywords from "a type, a name and a terminator".
#[test]
fn a_declaration_is_told_from_everything_that_merely_looks_like_one() {
    let declares = |text: &str| {
        let mask = kotlin().code_mask(text).expect("it lexes");
        kotlin().declares_a_redeclarable_binding(text, &mask, 0)
    };

    for line in [
        "val total = 1",
        "var total = 1",
        "val plan: String = \"go\"",
        "val (first, second) = pair",
        "fun helper(): Int = 1",
        "private fun helper(): Int = 1",
        "suspend fun gather(): String = \"a\"",
        "class Helper",
        "data class Point(val x: Int, val y: Int)",
        "sealed interface Event",
        "enum class Mode { FAST, SLOW }",
        "object Registry",
        "typealias Rows = List<Int>",
        "const val MAX = 10",
    ] {
        assert!(declares(line), "not read as a declaration: {line}");
    }

    for line in [
        // No deny list is needed for any of these: none of them opens with a declaration keyword.
        "return value",
        "throw failure",
        "import kotlin.math.abs",
        "println(\"hi\")",
        "fs.writeFile(\"out.txt\", body)",
        "total = 1",
        "if (left < right) {",
        // A modifier that is really an identifier: `data.load()` is a call, not a `data class`.
        "data.load()",
        // Indented: a different scope, where the same name is legal again.
        "    val total = 1",
        // Inside a string, which the mask keeps out of the code.
        "\"val total = 1\"",
    ] {
        assert!(!declares(line), "read as a declaration: {line}");
    }
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

    let result = healed("# Plan\n\nval total = 1\nview.openText(\"total\", total.toString())");
    assert_eq!(
        result.program,
        "val total = 1\nview.openText(\"total\", total.toString())"
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
        "view.openText(\"note\", body)",
        "}",
        "// a note",
        "@JvmStatic",
        "    .map { it.name }",
        "?.let { view.openText(\"it\", it) }",
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
                 view.openText(\"manifest\", fs.readTextFile(\"manifest.json\"))\n";
    assert_eq!(healed(reply).program, reply.trim_end());
}

// ---------------------------------------------------------------------------------------------
// The lexer
// ---------------------------------------------------------------------------------------------

/// **A raw string's body is not code**, so a wrapper written inside one is not a wrapper.
///
/// This is the shape a naive scan loses the source on: `"""` also starts with `"`, and reading it as
/// an empty string followed by another would put the whole body back in the code — where the
/// `runBlocking { … }` inside it would be matched and the program around it deleted.
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
    let template = "view.openText(\"n\", \"total: ${rows[\"n\"]}\")\nval after = 1\n";
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

    let backquoted = "val `total count` = 1\nview.openText(\"n\", `total count`.toString())\n";
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
/// Both scans here walk one **byte** at a time — the lexer over the whole source, and the declaration
/// reader over one line — so slicing at every step panics on an index that is not a character
/// boundary. A single `é` in a string, a comment or an identifier would take the turn down with a
/// slice index error rather than being healed, and a model writing a message in any language but
/// English produces one on its first turn. What is asserted is not merely that nothing panics but
/// that the reading is still right: the raw string's contents are still not code, and the accented
/// declaration is still a declaration.
#[test]
fn a_reply_that_is_not_ascii_is_read_rather_than_crashed_on() {
    // Deliberately no top-level declaration, so the one *inside* the raw string is the only thing
    // that could make the reading below true.
    let reply = "// a cömment: don\u{2019}t lose the place\n\
                 println('é')\n\
                 view.openText(\"grüße — wörld ✅\", \"\"\"\n    \
                     Beispiel — über alles:\n    \
                     val total = 1\n    \
                     \"\"\")\n";
    let mask = kotlin().code_mask(reply).expect("it lexes");

    let inside = reply.find("val total = 1").expect("the block holds one");
    assert!(!mask.is_code(inside));
    assert!(!kotlin().declares_a_redeclarable_binding(reply, &mask, 0));

    // And an accented name is still read as a declaration rather than skipped.
    for line in ["val grüße = \"a\"", "data class Größe(val x: Int)"] {
        let mask = kotlin().code_mask(line).expect("it lexes");
        assert!(
            kotlin().declares_a_redeclarable_binding(line, &mask, 0),
            "{line}"
        );
    }

    // The whole pipeline runs over it, under every configuration, and only ever deletes.
    crate::healing::tests::assert_delete_only(kotlin(), &[reply], "Kotlin");
}

/// **The fence tags are Kotlin's**, and the script extension is among them.
#[test]
fn the_fence_tags_are_this_languages_own() {
    assert_eq!(kotlin().program_fence_tags(), ["kotlin", "kt", "kts"]);
    // `kts` is not a mistake: a program on this arm really is compiled as a Kotlin script, so a
    // model that tagged its block with the script extension tagged it correctly.
    assert!(!kotlin().program_fence_tags().contains(&"java"));
}
