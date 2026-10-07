//! What gg does to a model's Java before javac sees it, read as text rather than through a compiler.
//!
//! Everything here is a pure function over a string, so these are microseconds where
//! [the substrate's](super::super::substrate) are seconds. The two halves are complementary: this
//! file says the wrapper is the wrapper it claims — and, for a **program**, that there is none — and
//! that one says javac and TeaVM agree.

use super::*;
use crate::sandbox::export_names;

/// The binding key these cases wrap a module under.
///
/// One key, because the wrap is the same shape for every key and what these cases read is the shape.
const MODULE_CHECK_CLASS: &str = "Module";

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
    assert!(lines[0].starts_with("package lib; import java.nio.charset.StandardCharsets; "));
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
    assert_eq!(crate::sandbox::language::jvm::ENTRY_CLASS, "GgEntry");
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
        !wrapped
            .source
            .starts_with("package lib; import java.util.List;"),
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
    assert_eq!(export_names(&wrapped.exports), ["importantThing"]);
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
    assert_eq!(export_names(&wrapped.exports), ["greet", "add"]);
}

#[test]
fn a_module_that_offers_nothing_is_refused_rather_than_bound_empty() {
    let failure = wrap_module("static int helper() { return 1; }\n", MODULE_CHECK_CLASS)
        .expect_err("a module with no exports is refused");
    assert!(failure.to_string().contains("public static"), "{failure}");
}

/// **A body that writes the wrapper's own class name is refused at the read**, at the author's own
/// line.
///
/// The one thing that means something different under the two class names a module body is compiled
/// under: `Module()` is a constructor while this read checks it and
/// `invalid method declaration; return type required` in every program that uses it. Refusing it
/// here is what keeps the read's promise — a module that passes it compiles in a program.
#[test]
fn a_body_that_names_the_class_gg_wraps_it_in_is_refused_at_the_read() {
    for body in [
        "public static String only() { return \"\"; }\npublic Module() { }\n",
        "static String helper() { return \"\"; }\npublic static String only() { return Module.helper(); }\n",
    ] {
        let failure = wrap_module(body, MODULE_CHECK_CLASS)
            .expect_err("a body naming the wrapper's class is refused");
        assert!(failure.to_string().contains("line 2"), "{failure}");
        assert!(
            failure.to_string().contains(MODULE_CHECK_CLASS),
            "{failure}"
        );
    }

    // Not a name that merely contains it, not a qualified name whose last segment is it, and not one
    // inside a string or a comment: each of those means the same thing under either class name.
    let wrapped = wrap_module(
        "// Module\npublic static String only() { return \"Module\"; }\n\
         public static Class<?> other() { return java.lang.Module.class; }\n\
         static int ModuleCount = 0;\n",
        MODULE_CHECK_CLASS,
    )
    .expect("wraps");
    assert_eq!(export_names(&wrapped.exports), ["only", "other"]);
}

/// **A module is a `public` class of package `lib` named by its binding key**, which is the whole of
/// what makes `lib.csvTools.parse(…)` a name javac resolves — and the whole of what gg does to make
/// it one.
///
/// The class is what a program is handed as a **classpath entry**, so it is `public` (a program in
/// another package names it) and `final` (nothing extends it). gg writes nothing into the program:
/// the name above is either written in full or brought in by the program's own
/// `import lib.csvTools;`.
#[test]
fn a_module_is_a_public_class_of_package_lib_named_by_its_key() {
    let wrapped =
        wrap_module("public static int one() { return 1; }\n", "csvTools").expect("wraps");
    assert!(
        wrapped
            .source
            .starts_with("package lib; public final class csvTools { "),
        "{}",
        wrapped.source
    );
    assert_eq!(MODULE_PACKAGE, "lib");
    // And the header still shares the author's first line, so nothing moved.
    assert_eq!(wrapped.source.lines().count(), 2, "{}", wrapped.source);
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
        wrapped
            .source
            .starts_with("package lib; import java.util.List; "),
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
        !wrapped
            .source
            .contains("import java.nio.file.Paths; public"),
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
    assert_eq!(export_names(&wrapped.exports), ["twice"]);
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
    assert_eq!(export_names(&wrapped.exports), ["outer"]);
}

/// **An export carries what a documentation view is rendered from**, and on this arm the prose is a
/// javadoc block: the shape a Java author writes.
#[test]
fn an_export_carries_its_kind_its_declaration_and_its_documentation() {
    let wrapped = wrap_module(
        "/** Greet someone. */\n\
         public static String greet(String who) { return who; }\n\
         @Deprecated\n\
         public static int add(int left, int right) { return left + right; }\n",
        MODULE_CHECK_CLASS,
    )
    .expect("wraps");
    assert_eq!(export_names(&wrapped.exports), ["greet", "add"]);

    // Every name a Java module offers is a `public static` method, so there is one kind here.
    assert_eq!(wrapped.exports[0].kind, ModuleExportKind::Function);
    assert_eq!(
        wrapped.exports[0].declaration,
        "public static String greet(String who)"
    );
    assert_eq!(wrapped.exports[0].doc.as_deref(), Some("Greet someone."));

    // An annotation is part of the declaration it stands on, and is quoted with it.
    assert_eq!(
        wrapped.exports[1].declaration,
        "@Deprecated\npublic static int add(int left, int right)"
    );
    assert_eq!(wrapped.exports[1].doc, None);

    // And the types each declaration writes, which is what an agent's `docViewTypes` flags open
    // beside the function.
    assert_eq!(wrapped.exports[0].returns, ["String"]);
    assert_eq!(wrapped.exports[0].parameters, ["String"]);
    assert_eq!(wrapped.exports[1].returns, ["int"]);
    assert_eq!(wrapped.exports[1].parameters, ["int"]);
}

/// **The type names an export writes are read off the declaration**, in return position and in
/// parameter position.
///
/// Java writes a type in both, so this arm answers both. What is recorded is what the author wrote,
/// reduced to the identifiers a documentation view can be opened under: a qualified name is its last
/// segment, a generic argument is a name of its own, and the annotations, modifiers and type
/// parameters in front of a return type are none of them types.
#[test]
fn an_export_records_the_types_its_declaration_writes() {
    let wrapped = wrap_module(
        "@SafeVarargs\n\
         public static <T> java.util.Map<String, java.util.List<T>> index(T... values) { \
         return java.util.Map.of(); }\n\
         public static void nothing(final Row row, int[] counts) { }\n\
         public static Row first(java.util.List<? extends Row> rows) { return rows.get(0); }\n\
         static final class Row { }\n",
        MODULE_CHECK_CLASS,
    )
    .expect("wraps");
    assert_eq!(
        export_names(&wrapped.exports),
        ["index", "nothing", "first"]
    );

    // The `<T>` type-parameter block and the `@SafeVarargs` in front of the return type are not the
    // return type; the generic arguments inside it are names of their own.
    assert_eq!(wrapped.exports[0].returns, ["Map", "String", "List", "T"]);
    // A varargs parameter is the type it repeats.
    assert_eq!(wrapped.exports[0].parameters, ["T"]);

    assert_eq!(wrapped.exports[1].returns, ["void"]);
    // `final` is not a type, and an array is the type it holds.
    assert_eq!(wrapped.exports[1].parameters, ["Row", "int"]);

    assert_eq!(wrapped.exports[2].returns, ["Row"]);
    // A wildcard bound names the type it is bounded by and nothing else.
    assert_eq!(wrapped.exports[2].parameters, ["List", "Row"]);

    // A declaration javac is about to refuse is read rather than crashed on: the scan runs before
    // any compiler does, so a parameter list that never closes must not take the turn down.
    let wrapped = wrap_module(
        "public static int broken(;\npublic static int one() { return 1; }\n",
        MODULE_CHECK_CLASS,
    )
    .expect("wraps; javac is what refuses it");
    assert!(wrapped.exports[0].parameters.is_empty());

    // A method taking nothing writes no parameter type at all.
    let wrapped = wrap_module(
        "public static String label() { return \"\"; }\n",
        MODULE_CHECK_CLASS,
    )
    .expect("wraps");
    assert_eq!(wrapped.exports[0].returns, ["String"]);
    assert!(wrapped.exports[0].parameters.is_empty());
}
