//! What gg does to a model's Java before javac sees it, read as text rather than through a compiler.
//!
//! Everything here is a pure function over a string, so these are microseconds where
//! [the substrate's](super::super::substrate) are seconds. The two halves are complementary: this
//! file says the transform is the transform it claims, and that one says javac and TeaVM agree.

use super::*;

/// The body of a wrapped unit — everything after the header gg put in front of it.
fn body(wrapped: &Wrapped) -> String {
    wrapped
        .source
        .lines()
        .skip(wrapped.shift)
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn a_program_becomes_the_body_of_a_method_and_its_lines_do_not_move() {
    let wrapped = wrap_program("int total = 1;\nSystem.out.println(total);\n").expect("wraps");
    // The model's first line is at `shift + 1`, which is what makes subtracting `shift` from a
    // diagnostic's line give the model's own coordinate.
    let lines: Vec<&str> = wrapped.source.lines().collect();
    assert_eq!(lines[wrapped.shift], "int total = 1;");
    assert_eq!(lines[wrapped.shift + 1], "System.out.println(total);");
    assert!(wrapped.source.contains(&format!("class {PROGRAM_CLASS} ")));
    assert!(
        wrapped
            .source
            .contains(&format!("{PROGRAM_METHOD}() throws Throwable"))
    );
    assert!(wrapped.exports.is_empty());
}

#[test]
fn an_import_is_hoisted_into_the_header_and_blanked_where_it_stood() {
    let wrapped = wrap_program(
        "import java.nio.charset.StandardCharsets;\n\
         import java.util.concurrent.atomic.AtomicInteger;\n\
         \n\
         AtomicInteger counter = new AtomicInteger();\n",
    )
    .expect("wraps");
    let header: Vec<&str> = wrapped.source.lines().take(wrapped.shift).collect();
    assert!(header.contains(&"import java.nio.charset.StandardCharsets;"));
    assert!(header.contains(&"import java.util.concurrent.atomic.AtomicInteger;"));
    // gg's own generous set is there too, so `Map` and `Collectors` need no import.
    assert!(header.contains(&"import java.util.*;"));
    assert!(header.contains(&"import java.util.stream.*;"));

    // The body keeps every line it had, with the two imports blanked — so line 4 of the reply is
    // still line 4 of the body.
    let body = body(&wrapped);
    let lines: Vec<&str> = body.lines().collect();
    assert_eq!(lines[0], "");
    assert_eq!(lines[1], "");
    assert_eq!(lines[2], "");
    assert_eq!(lines[3], "AtomicInteger counter = new AtomicInteger();");
}

#[test]
fn a_package_declaration_is_refused_by_name() {
    let failure = wrap_program("package com.example;\nint total = 1;\n")
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
    // would silently change what the program prints while leaving a header nothing needed.
    let wrapped = wrap_program(
        "String snippet = \"\"\"\nimport java.util.List;\nclass A {}\"\"\";\nSystem.out.println(snippet);\n",
    )
    .expect("wraps");
    assert!(body(&wrapped).contains("import java.util.List;"));
    assert!(
        !wrapped
            .source
            .lines()
            .take(wrapped.shift)
            .any(|line| line == "import java.util.List;"),
        "it did not reach the header"
    );

    // The same for a commented-out one, and for an identifier that merely starts with the word.
    let wrapped =
        wrap_program("// import java.util.List;\nint importantThing = 1;\n").expect("wraps");
    assert!(body(&wrapped).contains("// import java.util.List;"));
    assert!(body(&wrapped).contains("int importantThing = 1;"));
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
    )
    .expect("wraps");
    assert_eq!(wrapped.exports, ["greet", "add"]);

    // The annotation is inserted INLINE, so the body still has one line per line the author wrote.
    let body = body(&wrapped);
    assert_eq!(
        body.lines().count(),
        7,
        "six declarations and the closing brace"
    );
    assert_eq!(
        body.lines().last(),
        Some("}"),
        "and nothing between them: {body:?}"
    );
    assert!(body.starts_with("@JSExport public static String greet"));
    assert!(!body.contains("@JSExport public static final String LABEL"));
    assert!(!body.contains("@JSExport static int helper"));
}

#[test]
fn a_module_that_offers_nothing_is_refused_rather_than_bound_empty() {
    let failure = wrap_module("static int helper() { return 1; }\n")
        .expect_err("a module with no exports is refused");
    assert!(failure.to_string().contains("public static"), "{failure}");
}

#[test]
fn a_constructor_is_not_something_a_namespace_can_offer() {
    let wrapped =
        wrap_module("public Module() { }\npublic static String only() { return \"\"; }\n")
            .expect("wraps");
    assert_eq!(wrapped.exports, ["only"]);
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

#[test]
fn a_declaration_is_found_past_its_own_annotations_and_generics() {
    let wrapped = wrap_module(
        "@Deprecated\n\
         public static <T> List<T> twice(T value) { return List.of(value, value); }\n",
    )
    .expect("wraps");
    assert_eq!(wrapped.exports, ["twice"]);
    // The annotation gg adds goes in front of the author's, which is where a Java author would put
    // another one — and it is on the author's own line, not a new one.
    assert!(body(&wrapped).starts_with("@JSExport @Deprecated\n"));
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
    )
    .expect("wraps");
    assert_eq!(wrapped.exports, ["outer"]);
}
