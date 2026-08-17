//! The two answers that are Java's own, and the lexer underneath them.
//!
//! What is deliberately **not** here is a second copy of the skeleton's tests. Fence stripping,
//! prose stripping, the fixpoint loop, the honesty disclosure and the delete-only invariant are
//! asserted once in `healing.test.rs` against every registered dialect, this one included. What this
//! file asserts is the part that is Java's: the `#` line it reads as prose, the backtick it does not
//! read as code punctuation, and the lexer that keeps a text block's body out of the code.

use test_cabinet_core::gg::GgProgramLanguage;

use super::JAVA_DIALECT;
use crate::healing::{Dialect, Healed, HealingConfig, HealingStrategy, heal};

/// Replies in Java that the [delete-only invariant](crate::healing::Dialect::fixtures) is re-earned
/// over.
///
/// Every one of them carries a shape this dialect has to read correctly: a fenced program, both of
/// the concurrency wrappers a model writes, an import, a text block whose body must not be read as
/// code, a character literal, a doubled program, a `#` line that is prose here and is not on two
/// other arms, an inline code span that is deletable here and is not on any other C-shaped arm, and
/// two replies that are no program at all. No strategy now touches a wrapper or a doubled program,
/// which is precisely why they belong in a corpus asserting that nothing is ever added or moved.
///
/// Each reply is a **whole compilation unit** with its own `import` lines and its own
/// `public final class Program`, spelled the way this arm's catalogue spells them, because that is
/// what a program on this arm is.
pub(super) const FIXTURES: &[&str] = &[
    "Here is the program.\n\n```java\nimport gg.files.Files;\nimport gg.views.Views;\n\npublic final class Program {\n    public static void main(String[] args) {\n        Views.openText(\"rows\", Files.listDir().toString());\n    }\n}\n```\n\nThat lists the directory.",
    "import gg.files.Files;\nimport gg.views.Views;\n\npublic final class Program {\n    public static void main(String[] args) {\n        new Thread(() -> {\n            Views.openText(\"rows\", Files.listDir().toString());\n        }).start();\n    }\n}",
    "import gg.views.Views;\n\npublic final class Program {\n    public static void main(String[] args) throws InterruptedException {\n        Thread worker = new Thread(() -> {\n            Views.openText(\"note\", \"done\");\n        });\n        worker.start();\n        worker.join();\n    }\n}",
    "import gg.views.Views;\nimport java.util.concurrent.CompletableFuture;\n\npublic final class Program {\n    public static void main(String[] args) {\n        CompletableFuture.runAsync(() -> {\n            Views.openText(\"note\", \"done\");\n        }).join();\n    }\n}",
    "import gg.files.Files;\nimport gg.views.Views;\nimport java.util.stream.Collectors;\n\npublic final class Program {\n    public static void main(String[] args) {\n        String joined = Files.listDir().stream()\n            .map(Files.DirEntry::name)\n            .collect(Collectors.joining(\", \"));\n        Views.openText(\"names\", joined);\n    }\n}",
    "public final class Program {\n    public static void main(String[] args) {\n        String usage = \"\"\"\n            Example:\n\n            new Thread(() -> {\n                int total = 1;\n            }).start();\n            \"\"\";\n        int total = 2;\n    }\n}\n",
    "import gg.views.Views;\nimport java.util.Arrays;\n\npublic final class Program {\n    public static void main(String[] args) {\n        char comma = \',\';\n        String[] parts = \"a,b\".split(String.valueOf(comma));\n        Views.openText(\"parts\", Arrays.toString(parts));\n    }\n}",
    "import gg.views.Views;\n\npublic final class Program {\n    public static void main(String[] args) {\n        int total = 1;\n        Views.openText(\"total\", String.valueOf(total));\n    }\n}\n\nimport gg.views.Views;\n\npublic final class Program {\n    public static void main(String[] args) {\n        int total = 1;\n        Views.openText(\"total\", String.valueOf(total));\n    }\n}",
    "# Plan\n\nimport gg.views.Views;\n\npublic final class Program {\n    public static void main(String[] args) {\n        int total = 1;\n        Views.openText(\"total\", String.valueOf(total));\n    }\n}",
    "I\'ll read `Main.java` first.\n\nimport gg.files.Files;\nimport gg.views.Views;\n\npublic final class Program {\n    public static void main(String[] args) {\n        Views.openText(\"source\", Files.readTextFile(\"Main.java\"));\n    }\n}\n\nThat should be enough.",
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

/// **A text block's body is not code**, so an example program written inside one is not a program.
///
/// This is the shape a naive scan loses the source on: `"""` also starts with `"`, and reading it as
/// an empty string followed by another would put the whole body back in the code — where the
/// statements inside it would be read as the reply's own.
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

    // And the mask says so directly: the `int total = 1;` inside the block is not code.
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
/// The lexer walks one **byte** at a time over the whole source, so slicing at every step panics on
/// an index that is not a character boundary. A single `é` in a string, a comment or an identifier
/// would take the turn down with a slice index error rather than being healed, and a model writing a
/// message in any language but English produces one on its first turn. What is asserted is not
/// merely that nothing panics but that the reading is still right: the text block's contents are
/// still not code, and the code around them still is.
#[test]
fn a_reply_that_is_not_ascii_is_read_rather_than_crashed_on() {
    let reply = "// a cömment: don\u{2019}t lose the place\n\
                 System.out.println(\'é\');\n\
                 view.openText(\"grüße — wörld ✅\", \"\"\"\n    \
                     Beispiel — über alles:\n    \
                     int total = 1;\n    \
                     \"\"\");\n";
    let mask = java().code_mask(reply).expect("it lexes");

    // The text block's body is still not code, and the accented comment above it has not lost the
    // scan its place: the call that opens the block is.
    let inside = reply.find("int total = 1;").expect("the block holds one");
    assert!(!mask.is_code(inside));
    let outside = reply.find("view.openText").expect("the program holds one");
    assert!(mask.is_code(outside));

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
