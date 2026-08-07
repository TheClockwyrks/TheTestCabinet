//! The four answers that are Java's own, and the lexer underneath them.
//!
//! What is deliberately **not** here is a second copy of the skeleton's tests. Fence stripping,
//! prose stripping, the fixpoint loop, the honesty disclosure and the delete-only invariant are
//! asserted once in `healing.test.rs` against every registered dialect, this one included. What this
//! file asserts is the part that is Java's: the wrapper it takes off, the import it refuses to
//! delete, the declaration it reads as a redeclaration, and the lexer that keeps a text block's body
//! out of the code.

use test_cabinet_core::gg::GgProgramLanguage;

use super::JAVA_DIALECT;
use crate::healing::{
    AsyncWrapper, Dialect, Healed, HealingConfig, HealingDetail, HealingStrategy, heal,
};

/// Replies in Java that the [delete-only invariant](crate::healing::Dialect::fixtures) is re-earned
/// over.
///
/// Every one of them exercises an answer that is this dialect's rather than the skeleton's: the two
/// wrapper shapes, an import that must survive, a text block whose body must not be read as code, a
/// character literal, a doubled program whose repeat redeclares a local, a `#` line that is prose
/// here and is not on two other arms, an inline code span that is deletable here and is not on any
/// other C-shaped arm, and two replies that are no program at all.
pub(super) const FIXTURES: &[&str] = &[
    "Here is the program.\n\n```java\nList<DirEntry> rows = fs.listDir(\"src\");\nview.openText(\"rows\", rows.toString());\n```\n\nThat lists the directory.",
    "new Thread(() -> {\n    List<DirEntry> rows = fs.listDir(\"src\");\n    view.openText(\"rows\", rows.toString());\n}).start();",
    "Thread worker = new Thread(() -> {\n    view.openText(\"note\", \"done\");\n});\nworker.start();\nworker.join();",
    "import java.util.concurrent.CompletableFuture;\n\nCompletableFuture.runAsync(() -> {\n    view.openText(\"note\", \"done\");\n}).join();",
    "import java.util.stream.Collectors;\n\nString joined = fs.listDir(\"src\").stream()\n    .map(DirEntry::name)\n    .collect(Collectors.joining(\", \"));\nview.openText(\"names\", joined);",
    "String usage = \"\"\"\n    Example:\n\n    new Thread(() -> {\n        int total = 1;\n    }).start();\n    \"\"\";\nint total = 2;\n",
    "char comma = ',';\nString[] parts = \"a,b\".split(String.valueOf(comma));\nview.openText(\"parts\", Arrays.toString(parts));",
    "int total = 1;\nview.openText(\"total\", String.valueOf(total));\n\nint total = 1;\nview.openText(\"total\", String.valueOf(total));",
    "# Plan\n\nint total = 1;\nview.openText(\"total\", String.valueOf(total));",
    "I'll read `Main.java` first.\n\nString source = fs.readTextFile(\"Main.java\");\nview.openText(\"source\", source);\n\nThat should be enough.",
    "I have finished the task. Everything works.",
];

/// Heal `reply` with **this** language's dialect and the default configuration.
fn healed(reply: &str) -> Healed {
    heal(
        reply,
        &HealingConfig::default(),
        crate::sandbox::language(GgProgramLanguage::Java).healing(),
    )
}

/// This dialect, as the skeleton takes it.
fn java() -> &'static dyn Dialect {
    &JAVA_DIALECT
}

// ---------------------------------------------------------------------------------------------
// The concurrency wrapper
// ---------------------------------------------------------------------------------------------

/// **The immediate thread wrapper comes off.**
///
/// Java has no `async` keyword, so the shape a model wraps a whole program in is a thread it creates
/// and starts where it writes it. The wrapper is not merely redundant here: TeaVM schedules a
/// started thread with `setTimeout`, which this sandbox denies, so a program wearing one fails
/// before a line of the model's own work runs.
#[test]
fn the_immediate_thread_wrapper_comes_off() {
    let result = healed(
        "new Thread(() -> {\n    \
             List<DirEntry> rows = fs.listDir(\"src\");\n    \
             view.openText(\"rows\", rows.toString());\n\
         }).start();",
    );
    assert_eq!(
        result.program,
        "List<DirEntry> rows = fs.listDir(\"src\");\nview.openText(\"rows\", rows.toString());"
    );
    assert_eq!(result.strategies(), vec![HealingStrategy::UnwrapAsync]);
    assert!(
        matches!(
            result
                .applied
                .first()
                .map(|application| &application.detail),
            // Zero, and that is the honest number: Java has no suspension token, so a count here
            // would report a repair that never happened.
            Some(HealingDetail::Async {
                wrapper: AsyncWrapper::Immediate,
                awaits: 0,
            })
        ),
        "{:?}",
        result.applied
    );
}

/// **The declared shape comes off too**, and only when something actually starts it.
#[test]
fn the_declared_thread_wrapper_comes_off_only_when_it_is_started() {
    let started = healed(
        "Thread worker = new Thread(() -> {\n    \
             view.openText(\"note\", \"done\");\n\
         });\n\
         worker.start();\n\
         worker.join();",
    );
    assert_eq!(started.program, "view.openText(\"note\", \"done\");");
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

    // A wrapper that is only constructed runs nothing at all, so unwrapping it would not repair a
    // broken program — it would execute statements the response never asked to execute.
    let unstarted = "Thread worker = new Thread(() -> {\n    \
                         view.openText(\"note\", \"done\");\n\
                     });";
    assert_eq!(healed(unstarted).program, unstarted);
}

/// **A `CompletableFuture` is the other shape, and its import survives the repair.**
///
/// This is where Java parts company with [Python](super::super::python::healing) and
/// [Ruby](super::super::ruby::healing), which both delete the import that made their runner
/// reachable. `java.util.concurrent` is in this arm's declared library set, so the line resolves;
/// an unused import is legal Java rather than an error; and deleting a working line is the one thing
/// this subsystem must never do.
#[test]
fn the_future_wrapper_comes_off_and_leaves_its_import_standing() {
    let result = healed(
        "import java.util.concurrent.CompletableFuture;\n\n\
         CompletableFuture.runAsync(() -> {\n    \
             view.openText(\"note\", \"done\");\n\
         }).join();",
    );
    assert_eq!(
        result.program,
        "import java.util.concurrent.CompletableFuture;\n\nview.openText(\"note\", \"done\");"
    );
    assert_eq!(result.strategies(), vec![HealingStrategy::UnwrapAsync]);
}

/// **A wrapper that is not the whole program is left alone.**
///
/// The match is anchored to the constructor, so a program whose *last* statement happens to start a
/// thread keeps every statement above it. Without the anchor this strategy would delete a model's
/// work on the strength of a lambda it found somewhere in the text.
#[test]
fn a_thread_that_is_not_the_whole_program_is_left_alone() {
    let reply = "fs.writeFile(\"out.txt\", \"hello\");\n\
                 new Thread(() -> {\n    \
                     view.openText(\"note\", \"done\");\n\
                 }).start();";
    assert_eq!(healed(reply).program, reply);
}

// ---------------------------------------------------------------------------------------------
// The import that is never deleted
// ---------------------------------------------------------------------------------------------

/// **No line is ever an import, so `drop-imports` never fires here.**
///
/// gg's wrapper hoists every `import` a model wrote into the compilation unit's header before javac
/// sees it, so the line resolves and does its job. On the ECMAScript arms the same line is dead text
/// and dropping it can only help; here dropping it would delete a working line.
#[test]
fn an_import_is_a_working_line_and_is_never_deleted() {
    for line in [
        "import java.util.List;",
        "import static java.util.Map.entry;",
        "import java.util.*;",
    ] {
        assert!(!java().is_import_statement(line), "{line}");
    }

    let reply = "import java.util.stream.Collectors;\n\n\
                 String joined = fs.listDir(\"src\").stream()\n    \
                     .map(DirEntry::name)\n    \
                     .collect(Collectors.joining(\", \"));\n\
                 view.openText(\"names\", joined);";
    let result = healed(reply);
    assert_eq!(result.program, reply);
    assert!(result.applied.is_empty(), "{:?}", result.applied);
}

// ---------------------------------------------------------------------------------------------
// Redeclaration
// ---------------------------------------------------------------------------------------------

/// **A repeated tail that redeclares a local is deleted, because the reply as sent could not have
/// compiled.**
///
/// Java refuses two declarations of one name in one block (`variable total is already defined`), and
/// a program's statements are one block — so the reply as sent would have been refused by javac
/// before a statement of it ran, which is exactly the proof this strategy needs before it deletes.
#[test]
fn a_doubled_program_that_redeclares_a_local_is_halved() {
    let half = "int total = 1;\nview.openText(\"total\", String.valueOf(total));";
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
/// The declines are where the correctness is: every entry in the second list may legally appear
/// twice, so reading one as a redeclaration would let a doubled reply lose work the model asked to
/// have done.
#[test]
fn a_declaration_is_told_from_everything_that_merely_looks_like_one() {
    let declares = |text: &str| {
        let mask = java().code_mask(text).expect("it lexes");
        java().declares_a_redeclarable_binding(text, &mask, 0)
    };

    for line in [
        "int total = 1;",
        "final String plan = \"go\";",
        "var rows = fs.listDir(\"src\");",
        "Map<String, List<Integer>> index = new HashMap<>();",
        "String[] parts = source.split(\",\");",
        "Object pending;",
        "class Helper {",
        "record Point(int x, int y) {}",
        "enum Mode { FAST, SLOW }",
    ] {
        assert!(declares(line), "not read as a declaration: {line}");
    }

    for line in [
        // A statement keyword followed by a name and a terminator is not a declaration, and every
        // one of these may be written twice.
        "return value;",
        "throw failure;",
        "assert ok;",
        // Two identical imports are legal Java, and gg hoists both.
        "import java.util.List;",
        // A call, an assignment and a comparison.
        "System.out.println(\"hi\");",
        "fs.writeFile(\"out.txt\", body);",
        "total = 1;",
        "if (left < right) {",
        // Indented: a different block, where the same name is legal again.
        "    int total = 1;",
        // Inside a string, which the mask keeps out of the code.
        "\"int total = 1;\"",
    ] {
        assert!(!declares(line), "read as a declaration: {line}");
    }
}

// ---------------------------------------------------------------------------------------------
// The two predicates
// ---------------------------------------------------------------------------------------------

/// **A `#` line is prose here, and is deleted** — where Python's and Ruby's arms refuse to touch one.
///
/// Those two refuse because `# Plan` is a comment in their language as well as a Markdown heading,
/// and nothing lexical tells the two apart. Java has no `#` at all, so a `#` line is certainly not
/// Java and leaving one in a program is a syntax error rather than a surviving comment. What is
/// never prose here is a `//` line.
#[test]
fn a_hash_line_is_prose_and_a_slash_line_is_not() {
    assert!(java().is_prose_line("# Plan"));
    assert!(java().is_prose_line("Here is what I will do."));
    assert!(!java().is_prose_line("// the plan"));
    assert!(!java().is_prose_line("/* the plan */"));

    let result =
        healed("# Plan\n\nint total = 1;\nview.openText(\"total\", String.valueOf(total));");
    assert_eq!(
        result.program,
        "int total = 1;\nview.openText(\"total\", String.valueOf(total));"
    );
}

/// **A backtick is not code punctuation here**, so a lead-in written with an inline code span is
/// deletable — which it is not on any other C-shaped arm.
///
/// Java has no template literal and no backtick anywhere in its grammar, so a line carrying one is
/// certainly not Java. TypeScript's dialect has to keep such a line because there a backtick may
/// open a string.
#[test]
fn an_inline_code_span_is_prose_here_and_is_not_in_typescript() {
    let line = "I'll read `Main.java` first.";
    assert!(java().is_prose_line(line));
    assert!(
        !crate::sandbox::language(GgProgramLanguage::TypeScript)
            .healing()
            .is_prose_line(line),
        "the comparison this test is about no longer holds"
    );

    let result = healed(&format!(
        "{line}\n\nString source = fs.readTextFile(\"Main.java\");\nview.openText(\"source\", \
         source);\n\nThat should be enough."
    ));
    assert_eq!(
        result.program,
        "String source = fs.readTextFile(\"Main.java\");\nview.openText(\"source\", source);"
    );
    assert_eq!(result.strategies(), vec![HealingStrategy::StripProse]);
}

/// **The shapes only Java code has, and the shapes only English has.**
#[test]
fn the_two_predicates_point_their_errors_in_the_safe_direction() {
    for line in [
        "int total = 1;",
        "view.openText(\"note\", body);",
        "}",
        "// a note",
        "@Override",
        "rows.stream().map(DirEntry::name)",
        "items.forEach(entry -> {",
        "for (String name : names) {",
        "case DONE:",
    ] {
        assert!(java().looks_like_code(line), "not read as code: {line}");
    }

    for line in [
        // Case matters: `For` opens a sentence and `for` opens a loop.
        "For each file I will read the header.",
        "Done.",
        // A bullet is not a Javadoc continuation. `strip-fences` declines outright when any line
        // outside the fences is code-shaped, so reading this as code would send the most common
        // real reply shape — prose, one fenced program, prose — to javac whole.
        "* read the manifest",
    ] {
        assert!(!java().looks_like_code(line), "read as code: {line}");
        assert!(java().is_prose_line(line), "not read as prose: {line}");
    }

    // And the block a leading `*` would have protected is protected by its own opener instead: a
    // reply that starts with a Javadoc comment loses no line of it, because `strip-prose` only
    // deletes runs from the two ends and the run stops at `/**`.
    let reply = "/**\n\
                  * Reads the manifest and shows what is in it.\n\
                  */\n\
                 view.openText(\"manifest\", fs.readTextFile(\"manifest.json\"));\n";
    assert_eq!(healed(reply).program, reply.trim_end());
}

// ---------------------------------------------------------------------------------------------
// The lexer
// ---------------------------------------------------------------------------------------------

/// **A text block's body is not code**, so a wrapper written inside one is not a wrapper.
///
/// This is the shape a naive scan loses the source on: `"""` also starts with `"`, and reading it as
/// an empty string followed by another would put the whole body back in the code — where the
/// `new Thread(…)` inside it would be matched and the program around it deleted.
#[test]
fn a_text_block_carries_data_rather_than_code() {
    let reply = "String usage = \"\"\"\n    \
                     Example:\n\n    \
                     new Thread(() -> {\n        \
                         int total = 1;\n    \
                     }).start();\n    \
                     \"\"\";\n\
                 int total = 2;\n";
    let result = healed(reply);
    assert_eq!(result.program, reply.trim_end());
    assert!(result.applied.is_empty(), "{:?}", result.applied);

    // And the mask says so directly: the `int total = 1;` inside the block is not a declaration.
    let mask = java().code_mask(reply).expect("it lexes");
    let inside = reply.find("int total = 1;").expect("the block holds one");
    assert!(!mask.is_code(inside));
    let outside = reply
        .rfind("int total = 2;")
        .expect("the program holds one");
    assert!(mask.is_code(outside));
}

/// **Strings, character literals and both comment forms are read**, and a scan that lost its place
/// gives up the whole mask rather than reporting string bytes as code.
#[test]
fn the_lexer_reads_every_shape_java_has_and_declines_the_one_it_cannot() {
    let source = "char comma = ',';\n\
                  String quote = \"a \\\" b\";\n\
                  /* a block\n   comment */\n\
                  // a line comment\n\
                  int total = 1;\n";
    let mask = java().code_mask(source).expect("it lexes");
    for (what, needle) in [
        ("the character literal", "','"),
        ("the escaped quote", "\\\""),
        ("the block comment", "a block"),
        ("the line comment", "a line comment"),
    ] {
        let at = source.find(needle).unwrap_or_else(|| panic!("{what}"));
        assert!(!mask.is_code(at), "{what} was read as code");
    }
    assert!(mask.is_code(source.find("int total").expect("it is there")));

    // Unterminated, each in a way Java itself forbids: the scan has lost its place, and giving up
    // is the correct failure mode for a reading already known to be wrong.
    for source in [
        "String open = \"unterminated\n",
        "/* never closed\nint total = 1;\n",
        "String block = \"\"\"\nnever closed\n",
    ] {
        assert!(java().code_mask(source).is_none(), "{source}");
    }
}

/// **A reply that is not ASCII is read rather than crashed on.**
///
/// Both scans here walk one **byte** at a time — the lexer over the whole source, and the
/// declaration reader over one line — so slicing at every step panics on an index that is not a
/// character boundary. A single `é` in a string, a comment or an identifier would take the turn
/// down with a slice index error rather than being healed, and a model writing a message in any
/// language but English produces one on its first turn. What is asserted is not merely that nothing
/// panics but that the reading is still right: the text block's contents are still not code, and
/// the accented declaration is still a declaration.
#[test]
fn a_reply_that_is_not_ascii_is_read_rather_than_crashed_on() {
    // Deliberately no top-level declaration, so the one *inside* the text block is the only thing
    // that could make the reading below true.
    let reply = "// a cömment: don\u{2019}t lose the place\n\
                 System.out.println(\'é\');\n\
                 view.openText(\"grüße — wörld ✅\", \"\"\"\n    \
                     Beispiel — über alles:\n    \
                     int total = 1;\n    \
                     \"\"\");\n";
    let mask = java().code_mask(reply).expect("it lexes");

    // The text block's body is still not code, so the declaration inside it is not one.
    let inside = reply.find("int total = 1;").expect("the block holds one");
    assert!(!mask.is_code(inside));
    assert!(!java().declares_a_redeclarable_binding(reply, &mask, 0));

    // And an accented type or name is still read as a declaration rather than skipped.
    for line in ["String grüße = \"a\";", "Größe size = new Größe();"] {
        let mask = java().code_mask(line).expect("it lexes");
        assert!(
            java().declares_a_redeclarable_binding(line, &mask, 0),
            "{line}"
        );
    }

    // The whole pipeline runs over it, under every configuration, and only ever deletes.
    crate::healing::tests::assert_delete_only(java(), &[reply], "Java");
}

/// **The fence tags are Java's**, and a transcript is not among them.
#[test]
fn the_fence_tags_are_this_languages_own() {
    assert_eq!(java().program_fence_tags(), ["java", "jav"]);
    // `jshell` names a transcript of an interactive session rather than a program, on the same
    // terms Python's dialect excludes `pycon` and Ruby's excludes `irb`.
    assert!(!java().program_fence_tags().contains(&"jshell"));
    assert!(!java().program_fence_tags().contains(&"ts"));
}
