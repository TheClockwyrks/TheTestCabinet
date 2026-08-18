//! What gg does to a model's Kotlin before the compiler sees it, asserted without starting one: the
//! code-module wrapper, the export scan, and the three lexical answers Kotlin needs that Java's
//! reading of the same question does not have.

use super::*;
use crate::sandbox::export_names;

/// The names [`Lexer::top_level_functions`] finds, with whether each is hidden.
fn scanned(source: &str) -> Vec<(String, bool)> {
    Lexer::new(source)
        .top_level_functions()
        .into_iter()
        .map(|function| (function.name, function.hidden))
        .collect()
}

/// **gg writes nothing at all into a program**, which is the whole of this arm's authorship claim
/// and the one thing this file exists to state as text.
#[test]
fn there_is_nothing_here_that_touches_a_program() {
    // There is no `wrap_program` on this arm any more, and the compiler enforces that far better
    // than a test could. What is left to state is the one convention: the facade class gg's second
    // compilation unit NAMES, which is the shape ruling D2 blessed.
    assert_eq!(PROGRAM_CLASS, "ProgramKt");
    assert_eq!(crate::sandbox::language::jvm::ENTRY_CLASS, "GgEntry");
}

#[test]
fn a_module_goes_in_a_package_of_its_own_on_the_author_s_own_first_line() {
    let wrapped = wrap_module(
        "fun greet(who: String) = \"hello $who\"\n\
         private fun hidden() = 1\n\
         internal fun alsoHidden() = 2\n\
         val limit = 3\n\
         class Helper { fun method() = 4 }\n\
         fun add(a: Int, b: Int) = a + b\n",
        &module_package("csvTools"),
    )
    .expect("wrapped");
    assert_eq!(export_names(&wrapped.exports), ["greet", "add"]);
    // The package declaration shares the author's own line 1, terminated by the semicolon Kotlin
    // allows, so a module whose first line is an `import` still parses and NO LINE MOVES.
    assert!(
        wrapped
            .source
            .starts_with("package lib.csvTools; fun greet(who: String)"),
        "{}",
        wrapped.source.lines().next().unwrap_or_default(),
    );
    assert_eq!(
        wrapped.source.lines().count(),
        6,
        "the module's own lines are exactly where the author put them",
    );
}

#[test]
fn a_module_whose_first_line_is_an_import_still_parses() {
    // The semicolon is what buys this: `package lib.module import kotlin.math.abs` on one line is
    // not something Kotlin's grammar reads, and `package lib.module; import kotlin.math.abs` is.
    // The real compiler is what proves it — `kotlin.compile.test.rs` compiles this very shape — and
    // what is asserted here is that gg wrote the terminator at all.
    let wrapped = wrap_module(
        "import kotlin.math.abs\nfun distance(a: Int): Int = abs(a)\n",
        MODULE_CHECK_PACKAGE,
    )
    .expect("wrapped");
    assert!(
        wrapped
            .source
            .starts_with("package lib.module; import kotlin.math.abs\n"),
        "{}",
        wrapped.source.lines().next().unwrap_or_default(),
    );
    assert_eq!(export_names(&wrapped.exports), ["distance"]);
    assert_eq!(wrapped.source.lines().count(), 2);
}

#[test]
fn a_package_declaration_in_a_module_is_refused_by_name() {
    let failure = wrap_module(
        "package example.thing\nfun one() = 1\n",
        MODULE_CHECK_PACKAGE,
    )
    .expect_err("gg names the package a module goes in, and two would not parse");
    let rendered = failure.to_string();
    assert!(rendered.contains("line 1"), "{rendered}");
    assert!(rendered.contains("package example.thing"), "{rendered}");
    // Silently dropping it would leave an author wondering why their own names did not resolve,
    // which is the misattribution this codebase spends the most effort not making.
    assert!(rendered.contains("Remove it"), "{rendered}");
}

#[test]
fn a_module_that_offers_nothing_is_refused_with_a_sentence() {
    let failure = wrap_module(
        "private fun helper() = 1\nval limit = 2\n",
        MODULE_CHECK_PACKAGE,
    )
    .expect_err("refused");
    assert!(failure.to_string().contains("offers nothing"));
    // An empty namespace bound with no error is the quiet kind of wrong, and the author is told what
    // a module has to offer rather than left to guess.
    assert!(failure.to_string().contains("public top-level functions"));
}

#[test]
fn a_module_s_package_is_the_path_a_program_writes() {
    // `lib.<key>.<name>` is what a program writes, so the package a module is compiled into and the
    // access the seam publishes have to be the same string. One derives the other.
    assert_eq!(module_package("csvTools"), "lib.csvTools");
    // The file is named for the key, so every diagnostic about a module carries in its file
    // position the one coordinate a model has for code it did not write.
    assert_eq!(module_file("csvTools"), "csvTools.kt");
    assert_ne!(module_file("a"), module_file("b"));
}

#[test]
fn the_export_scan_reads_the_declarations_kotlin_really_has() {
    // An extension function is known by its own name rather than by its receiver's, and a generic
    // one by the name after its type parameters.
    assert_eq!(
        scanned("fun String.shout() = uppercase()\nfun <T> List<T>.second(): T = this[1]\n"),
        [("shout".into(), false), ("second".into(), false)],
    );
    // A `fun interface` is a type rather than a function, and an anonymous `fun` has no name for a
    // namespace to bind.
    assert_eq!(
        scanned("fun interface Greeter { fun greet(): String }\nval f = fun(x: Int) = x\n"),
        Vec::<(String, bool)>::new(),
    );
    // Modifiers before the keyword are read as the declaration's own, in any order, and an unknown
    // word ends the run rather than being swallowed — so a `private` belonging to the declaration
    // ABOVE is never read as this one's.
    assert_eq!(
        scanned("private inline fun one() = 1\ninline fun two() = 2\nsuspend fun three() = 3\n"),
        [
            ("one".into(), true),
            ("two".into(), false),
            ("three".into(), false),
        ],
    );
    // A backquoted name is a name, which is legal Kotlin and would otherwise be read as a string.
    assert_eq!(
        scanned("fun `a name with spaces`(): Int = 1\n"),
        [("a name with spaces".into(), false)],
    );
    // A function inside a class or an object is not the file's own, however it is indented.
    assert_eq!(
        scanned("class Holder {\n    fun method() = 1\n}\nfun top() = 2\n"),
        [("top".into(), false)],
    );
}

#[test]
fn the_lexer_answers_the_three_questions_kotlin_asks_that_java_does_not() {
    let code = |source: &str| {
        let mask = Lexer::new(source).code_mask();
        source
            .char_indices()
            .filter(|(at, _)| mask[*at])
            .map(|(_, character)| character)
            .collect::<String>()
    };

    // 1. A STRING TEMPLATE with a quote in it. `"total: ${rows["n"]}"` is ONE string, and a scan that
    //    stopped at the quote before `n` would read the rest of the line as code — which on a module
    //    is a brace-depth error and on any file is a `package` line that was never one.
    assert_eq!(
        code("val x = \"total: ${rows[\"n\"]}\"\nfun a() = 1\n"),
        "val x = \nfun a() = 1\n"
    );
    // A template holding a whole lambda, braces and all, is still one string.
    assert_eq!(
        code("val x = \"${rows.map { it + 1 }}\"\nfun a() = 1\n"),
        "val x = \nfun a() = 1\n",
    );

    // 2. A NESTED BLOCK COMMENT. `/* a /* b */ c */` is one comment in Kotlin and two in Java, and
    //    reading it Java's way leaves ` c */` behind as code.
    assert_eq!(code("/* a /* b */ c */fun a() = 1\n"), "fun a() = 1\n");

    // 3. A BACKQUOTED IDENTIFIER, which may hold a brace or the word `package` and mean neither.
    assert_eq!(
        code("val `a {name}` = 1\nfun a() = 2\n"),
        "val  = 1\nfun a() = 2\n"
    );

    // And the ordinary ones, which Kotlin shares with every C-shaped language.
    assert_eq!(code("// comment\nval a = 'x'\n"), "\nval a = \n");
    assert_eq!(
        code("val a = \"escaped \\\" quote\"\nval b = 1\n"),
        "val a = \nval b = 1\n"
    );

    // A raw string is read as one span rather than as two empty strings and a body: `\"\"\"` opens
    // with a `\"`, and reading it the other way would put the whole body back in the code.
    assert_eq!(
        code("val a = \"\"\"\nnot code\n\"\"\"\nval b = 1\n"),
        "val a = \nval b = 1\n"
    );

    // A line that opens with `package` inside a raw string is not a package declaration, and
    // refusing a module for one would be gg reading the author's own data as code.
    let inside = "fun one() = 1\nval text = \"\"\"\npackage example\n\"\"\"\n";
    assert!(wrap_module(inside, MODULE_CHECK_PACKAGE).is_ok());
}

#[test]
fn every_scan_is_a_byte_comparison_rather_than_a_slice() {
    // A model writing a message in any language but English produces this on its first turn, and a
    // scan that sliced the source at a byte index would take the whole turn down with a slice index
    // error rather than reaching the compiler.
    let source = "fun one(): String = \"café — déjà vu\"\n";
    assert!(wrap_module(source, MODULE_CHECK_PACKAGE).is_ok());
    // And a name written in any script is reported under its own name: a module offering `café`
    // that gg called `caf` would be a namespace missing the member it just bound.
    assert_eq!(
        scanned("fun café(): String = \"naïve\"\n"),
        [("café".into(), false)],
    );

    // An unterminated string, an unterminated comment and an unterminated template are all things a
    // reply can contain; each must end the scan rather than panic. What follows is the compiler's
    // problem, and it has a diagnostic for it.
    for source in [
        "fun one() = \"unterminated\n",
        "/* unterminated\nfun a() = 1\n",
        "fun one() = \"${unterminated\n",
        "fun one() = `unterminated\n",
    ] {
        let _ = wrap_module(source, MODULE_CHECK_PACKAGE);
        let _ = scanned(source);
    }
}

/// **An export carries what a documentation view is rendered from**, cut at whichever of the two
/// things opens a Kotlin body: the brace, or the `=` of an expression body.
#[test]
fn an_export_carries_its_kind_its_declaration_and_its_documentation() {
    let wrapped = wrap_module(
        "/** Greet someone. */\n\
         fun greet(who: String): String {\n\
        \x20   return \"hi $who\"\n\
         }\n\
         \n\
         fun add(a: Int, b: Int) = a + b\n",
        &module_package("csvTools"),
    )
    .expect("wrapped");
    assert_eq!(export_names(&wrapped.exports), ["greet", "add"]);

    // Only a top-level `fun` reaches the namespace, so there is one kind here.
    assert_eq!(wrapped.exports[0].kind, ModuleExportKind::Function);
    assert_eq!(
        wrapped.exports[0].declaration,
        "fun greet(who: String): String"
    );
    assert_eq!(wrapped.exports[0].doc.as_deref(), Some("Greet someone."));

    assert_eq!(wrapped.exports[1].kind, ModuleExportKind::Function);
    assert_eq!(wrapped.exports[1].declaration, "fun add(a: Int, b: Int)");
    assert_eq!(wrapped.exports[1].doc, None);

    // The types the declaration writes, in the two positions a documentation view asks about.
    assert_eq!(wrapped.exports[0].returns, ["String"]);
    assert_eq!(wrapped.exports[0].parameters, ["String"]);
    // A `fun` that declares no return type returns `Unit`, and the author wrote no name there — so
    // there is no type for a view to open and none is recorded.
    assert!(wrapped.exports[1].returns.is_empty());
    assert_eq!(wrapped.exports[1].parameters, ["Int"]);
}

/// **The type names an export carries are the ones its own declaration writes**, in return position
/// and in parameter position, whatever else the declaration is carrying.
#[test]
fn an_export_carries_the_types_its_declaration_writes() {
    let wrapped = wrap_module(
        "fun rows(\n\
        \x20   source: kotlin.collections.List<Row>,\n\
        \x20   limit: Int = 10,\n\
        \x20   vararg tags: String,\n\
         ): Map<String, List<Row>> {\n\
        \x20   return emptyMap()\n\
         }\n\
         \n\
         fun <T : Comparable<T>> Sequence<T>.largest(): T? = null\n\
         \n\
         fun report(): Unit {\n\
         }\n",
        &module_package("csvTools"),
    )
    .expect("wrapped");
    assert_eq!(
        export_names(&wrapped.exports),
        ["rows", "largest", "report"]
    );

    // A qualified name is recorded by its last segment, a generic argument is a name of its own,
    // and a default value is an expression rather than a type.
    assert_eq!(
        wrapped.exports[0].parameters,
        ["List", "Row", "Int", "String"]
    );
    assert_eq!(wrapped.exports[0].returns, ["Map", "String", "List", "Row"]);

    // An extension function's receiver stands in front of its name rather than in its parameter
    // list, so what it writes in parameter position is nothing; the nullable return is the name
    // without its `?`.
    assert!(wrapped.exports[1].parameters.is_empty());
    assert_eq!(wrapped.exports[1].returns, ["T"]);

    // `Unit` written out is a name the author wrote, so it is a view that can be opened.
    assert_eq!(wrapped.exports[2].returns, ["Unit"]);
    assert!(wrapped.exports[2].parameters.is_empty());
}
