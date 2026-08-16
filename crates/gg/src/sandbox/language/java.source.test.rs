//! What gg does to a model's Java before javac sees it, read as text rather than through a compiler.
//!
//! Everything here is a pure function over a string, so these are microseconds where
//! [the substrate's](super::super::substrate) are seconds. The two halves are complementary: this
//! file says the wrapper is the wrapper it claims — and, for a **program**, that there is none — and
//! that one says javac and TeaVM agree.

use super::*;

/// The module's own body: everything the wrapper's header on line 1 is not, plus every line after.
fn body(wrapped: &Wrapped) -> String {
    let header = wrapped
        .source
        .find(&format!("class {} {{ ", MODULE_CHECK_CLASS))
        .map(|at| at + format!("class {} {{ ", MODULE_CHECK_CLASS).len())
        .expect("the wrapper's header is on line 1");
    wrapped.source[header..].to_string()
}

/// **A code module's wrapper costs no line at all**, which is what makes its diagnostics the
/// author's own coordinates with nothing subtracted from them.
#[test]
fn a_modules_wrapper_shares_the_authors_first_line_so_no_line_moves() {
    let author = "public static String greet(String who) { return who; }\n\
                  public static int add(int left, int right) { return left + right; }\n";
    let wrapped = wrap_module(author, MODULE_CHECK_CLASS).expect("wraps");
    let lines: Vec<&str> = wrapped.source.lines().collect();
    assert!(
        lines[0].ends_with("public static String greet(String who) { return who; }"),
        "the author's first line is not on line 1: {:?}",
        lines[0]
    );
    assert_eq!(lines[1], author.lines().nth(1).expect("a second line"));
    assert_eq!(
        wrapped.source.lines().count(),
        author.lines().count() + 1,
        "one line for the closing brace and not one more: {}",
        wrapped.source
    );
}

/// **A module's own `import` is lifted onto line 1 and blanked where it stood**, so the lines below
/// it do not move either.
#[test]
fn an_import_is_hoisted_onto_the_first_line_and_blanked_where_it_stood() {
    let wrapped = wrap_module(
        "import java.nio.charset.StandardCharsets;\n\
         import java.util.concurrent.atomic.AtomicInteger;\n\
         \n\
         public static int count() { return new AtomicInteger().get(); }\n",
        MODULE_CHECK_CLASS,
    )
    .expect("wraps");
    let lines: Vec<&str> = wrapped.source.lines().collect();
    assert!(lines[0].starts_with("import java.nio.charset.StandardCharsets; "));
    assert!(lines[0].contains("import java.util.concurrent.atomic.AtomicInteger; "));
    // The two import lines are blanked where they stood and line 4 is still line 4.
    assert_eq!(lines[1], "");
    assert_eq!(lines[2], "");
    assert_eq!(
        lines[3],
        "public static int count() { return new AtomicInteger().get(); }"
    );
}

/// **gg writes nothing at all into a program**, which is the whole of this arm's authorship claim
/// and the one thing this file exists to state as text.
#[test]
fn there_is_nothing_here_that_touches_a_program() {
    // The module names a class; the program names none, because nothing wraps it. What gg writes
    // beside a program is a second compilation unit that NAMES this class, which is the shape
    // ruling D2 blessed — and the constant is the whole of the convention.
    assert_eq!(PROGRAM_CLASS, "Program");
    assert_eq!(ENTRY_CLASS, "GgEntry");
}

#[test]
fn a_package_declaration_in_a_module_is_refused_by_name() {
    let failure = wrap_module(
        "package com.example;\npublic static int one() { return 1; }\n",
        MODULE_CHECK_CLASS,
    )
    .expect_err("a package has nowhere to go");
    assert!(
        failure.to_string().contains("package com.example"),
        "{failure}"
    );
    assert!(failure.to_string().contains("line 1"), "{failure}");
}

#[test]
fn something_that_merely_looks_like_an_import_is_left_alone() {
    // A text block whose content opens with `import` is content, not an import — and hoisting it
    // would silently change what the module returns while leaving a header nothing needed.
    let wrapped = wrap_module(
        "public static String snippet() { return \"\"\"\nimport java.util.List;\nclass A {}\"\"\"; }\n",
        MODULE_CHECK_CLASS,
    )
    .expect("wraps");
    assert!(body(&wrapped).contains("import java.util.List;"));
    assert!(
        !wrapped.source.starts_with("import java.util.List;"),
        "it did not reach the header: {}",
        wrapped.source
    );

    // The same for a commented-out one, and for an identifier that merely starts with the word.
    let wrapped = wrap_module(
        "// import java.util.List;\npublic static int importantThing() { return 1; }\n",
        MODULE_CHECK_CLASS,
    )
    .expect("wraps");
    assert!(body(&wrapped).contains("// import java.util.List;"));
    assert_eq!(wrapped.exports, ["importantThing"]);
}

#[test]
fn a_module_exports_its_public_static_methods_and_nothing_else() {
    let wrapped = wrap_module(
        "public static String greet(String who) { return who; }\n\
         public static final String LABEL = \"greet(\";\n\
         static int helper() { return 1; }\n\
         private static String hidden() { return \"\"; }\n\
         public String instanceMethod() { return \"\"; }\n\
         public static int add(int left, int right) { return left + right; }\n",
        MODULE_CHECK_CLASS,
    )
    .expect("wraps");
    assert_eq!(wrapped.exports, ["greet", "add"]);
}

#[test]
fn a_module_that_offers_nothing_is_refused_rather_than_bound_empty() {
    let failure = wrap_module("static int helper() { return 1; }\n", MODULE_CHECK_CLASS)
        .expect_err("a module with no exports is refused");
    assert!(failure.to_string().contains("public static"), "{failure}");
}

#[test]
fn a_constructor_is_not_something_a_namespace_can_offer() {
    // gg names the class, so no constructor an author writes can carry its name — and one that is
    // not `static` is not an export whatever it is called.
    let wrapped = wrap_module(
        "public Module() { }\npublic static String only() { return \"\"; }\n",
        MODULE_CHECK_CLASS,
    )
    .expect("wraps");
    assert_eq!(wrapped.exports, ["only"]);
}

/// **`Lib` reaches each module by inheritance**, which is what Java has instead of a type alias.
#[test]
fn lib_binds_one_nested_class_per_module_extending_that_modules_own() {
    let generated = lib_class(&["csvTools", "helpers"]);
    assert!(
        generated.contains("public static final class csvTools extends GgModule_csvTools {"),
        "{generated}"
    );
    assert!(
        generated.contains("public static final class helpers extends GgModule_helpers {"),
        "{generated}"
    );
    assert!(
        generated.contains(&format!("private {LIB_CLASS}()")),
        "nothing constructs it: {generated}"
    );
    assert_eq!(module_file("csvTools"), "GgModule_csvTools.java");
}

#[test]
fn the_lexer_tells_code_from_everything_that_looks_like_it() {
    let source = "a \"str\\\"ing\" b /* comment */ c // line\nd '\\'' e \"\"\"\nblock\"\"\" f";
    let mask = Lexer::new(source).code_mask();
    let coded: String = source
        .char_indices()
        .filter(|(at, _)| mask[*at])
        .map(|(_, character)| character)
        .collect();
    // Everything quoted or commented is gone; the loose identifiers and the whitespace between them
    // are what is left.
    assert_eq!(
        coded.split_whitespace().collect::<Vec<_>>(),
        ["a", "b", "c", "d", "e", "f"]
    );
}

/// **A module that is not ASCII is read rather than crashed on.**
///
/// The lexer walks one **byte** at a time, so slicing the source at every step would panic on any
/// index that is not a character boundary — and `&source[at..]` was exactly what it did. A single
/// `é` in a string, a comment or an identifier would have taken the read down with a slice index
/// error rather than reaching javac. Every delimiter this lexer looks for is ASCII, and an ASCII
/// byte never appears inside a multi-byte UTF-8 sequence, so byte comparisons find exactly what
/// string comparisons would.
#[test]
fn a_module_that_is_not_ascii_is_read_rather_than_crashed_on() {
    let wrapped = wrap_module(
        "String gruss = \"grüße, wörld — ✅\";\n\
         // a cömment\n\
         char accented = 'é';\n\
         import java.util.List;\n\
         public static String greeting() { return \"grüße\"; }\n",
        MODULE_CHECK_CLASS,
    )
    .expect("wraps");
    // The import was still hoisted out of the body, which is the reading that had to survive.
    assert!(
        wrapped.source.starts_with("import java.util.List; "),
        "{}",
        wrapped.source
    );
    assert!(
        wrapped.source.contains("grüße, wörld — ✅"),
        "{}",
        wrapped.source
    );
    // And it was blanked where it stood, so nothing below it moved.
    assert!(
        wrapped
            .source
            .contains("char accented = 'é';\n\npublic static String greeting()"),
        "{}",
        wrapped.source
    );

    // And the mask really did keep the non-ASCII text out of the code, rather than merely not
    // panicking: an `import` inside a text block full of it is not an import.
    let wrapped = wrap_module(
        "public static String usage() { return \"\"\"\n    \
             Beispiel — über alles:\n    \
             import java.nio.file.Paths;\n    \
             \"\"\"; }\n",
        MODULE_CHECK_CLASS,
    )
    .expect("wraps");
    assert!(
        !wrapped.source.starts_with("import java.nio.file.Paths;"),
        "an import inside a text block was hoisted: {}",
        wrapped.source
    );
}

#[test]
fn a_declaration_is_found_past_its_own_annotations_and_generics() {
    let wrapped = wrap_module(
        "@Deprecated\n\
         public static <T> List<T> twice(T value) { return List.of(value, value); }\n",
        MODULE_CHECK_CLASS,
    )
    .expect("wraps");
    assert_eq!(wrapped.exports, ["twice"]);
}

#[test]
fn a_nested_type_does_not_offer_its_own_methods_to_the_namespace() {
    // Only the module's own level is a namespace. A method of a nested class is reached through that
    // class from inside the module, and a namespace that claimed it would name a call that is not
    // bound.
    let wrapped = wrap_module(
        "public static String outer() { return Inner.inner(); }\n\
         static final class Inner {\n\
         \x20   public static String inner() { return \"in\"; }\n\
         }\n",
        MODULE_CHECK_CLASS,
    )
    .expect("wraps");
    assert_eq!(wrapped.exports, ["outer"]);
}
