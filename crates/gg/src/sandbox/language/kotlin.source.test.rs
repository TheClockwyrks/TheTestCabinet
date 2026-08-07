//! What gg does to a model's Kotlin before the compiler sees it, asserted without starting one: the
//! import hoist, the export scan, and the three lexical answers Kotlin needs that Java's reading of
//! the same question does not have.

use super::*;

/// The names [`Lexer::top_level_functions`] finds, with whether each is hidden.
fn scanned(source: &str) -> Vec<(String, bool)> {
    Lexer::new(source)
        .top_level_functions()
        .into_iter()
        .map(|function| (function.name, function.hidden))
        .collect()
}

#[test]
fn a_program_with_nothing_to_hoist_is_the_model_s_own_bytes() {
    // The property the script shape buys, and the one no other compiled arm has: there is nothing to
    // wrap a Kotlin script in, so with no import to lift the compiler reads exactly what the model
    // wrote and every diagnostic coordinate is the model's with no arithmetic at all.
    let source = "val rows = listOf(1, 2)\nprintln(rows.sum())\n";
    let wrapped = wrap_program(source).expect("wrapped");
    assert_eq!(wrapped.source, source);
    assert_eq!(wrapped.shift, 0);
    assert!(wrapped.exports.is_empty());
}

#[test]
fn an_import_is_hoisted_and_blanked_where_it_stood() {
    let wrapped = wrap_program(
        "import kotlin.math.sqrt\nimport java.time.LocalDate;\n\nprintln(sqrt(4.0))\n",
    )
    .expect("wrapped");
    assert_eq!(wrapped.shift, 2);
    // The header carries both, the trailing `;` a model may have typed is dropped rather than
    // refused, and the body keeps a line for each so nothing below them moves.
    assert_eq!(
        wrapped.source,
        "import kotlin.math.sqrt\nimport java.time.LocalDate\n\n\n\nprintln(sqrt(4.0))\n",
    );
    assert_eq!(
        wrapped.source.lines().count() - wrapped.shift,
        4,
        "the body has exactly as many lines as the reply did",
    );
}

#[test]
fn only_a_real_import_is_hoisted() {
    // `importantThing()` is not an import, a commented-out one is not an import, and a line inside a
    // raw string that happens to start with the word is emphatically not an import — deleting one
    // would take a line out of the model's own data.
    let source = "val importantThing = 1\n// import kotlin.math.sqrt\nval text = \"\"\"\nimport kotlin.math.sqrt\n\"\"\"\nprintln(text)\n";
    let wrapped = wrap_program(source).expect("wrapped");
    assert_eq!(wrapped.source, source, "nothing was hoisted");
    assert_eq!(wrapped.shift, 0);
}

#[test]
fn a_package_declaration_is_refused_by_name_rather_than_dropped() {
    let failure = wrap_program("package example.thing\n\nprintln(1)\n").expect_err("refused");
    let rendered = failure.to_string();
    assert!(rendered.contains("line 1"), "{rendered}");
    assert!(rendered.contains("package example.thing"), "{rendered}");
    // Silently dropping it would leave a model wondering why its own names did not resolve, which is
    // the misattribution this codebase spends the most effort not making.
    assert!(rendered.contains("Remove it"), "{rendered}");
}

#[test]
fn a_module_offers_its_public_top_level_functions_and_nothing_else() {
    let wrapped = wrap_module(
        "fun greet(who: String) = \"hello $who\"\n\
         private fun hidden() = 1\n\
         internal fun alsoHidden() = 2\n\
         val limit = 3\n\
         class Helper { fun method() = 4 }\n\
         fun add(a: Int, b: Int) = a + b\n",
    )
    .expect("wrapped");
    assert_eq!(wrapped.exports, ["greet", "add"]);
    // Inline insertion, so no line moves: the annotation goes in front of the `fun` keyword on the
    // line the author wrote it on.
    assert!(wrapped.source.contains("@JSExport fun greet"));
    assert!(wrapped.source.contains("@JSExport fun add"));
    assert!(!wrapped.source.contains("@JSExport private"));
    // A method of a class the author declared is that class's business rather than the namespace's,
    // and the scan only ever looks at the file's own level.
    assert!(!wrapped.source.contains("@JSExport fun method"));
    assert_eq!(
        wrapped.source.lines().count() - wrapped.shift,
        6,
        "the module's own lines are where the author put them",
    );
    // The header renames the facade class off the export name. They must differ: TeaVM declares both
    // in the bundle's scope, and when they are the same word the inner declaration shadows the outer
    // one and the namespace gg hands back is `undefined` — measured.
    assert!(
        wrapped
            .source
            .contains(&format!("@file:JvmName(\"{MODULE_CLASS}\")"))
    );
    assert!(
        wrapped
            .source
            .contains(&format!("@file:JSClass(name = \"{MODULE_GLOBAL}\")"))
    );
    assert_ne!(MODULE_CLASS, MODULE_GLOBAL);
}

#[test]
fn a_module_that_offers_nothing_is_refused_with_a_sentence() {
    let failure = wrap_module("private fun helper() = 1\nval limit = 2\n").expect_err("refused");
    assert!(failure.to_string().contains("offers nothing"));
    // An empty namespace bound with no error is the quiet kind of wrong, and the author is told what
    // a module has to offer rather than left to guess.
    assert!(failure.to_string().contains("public top-level functions"));
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
    //    is a brace-depth error and on any file is a hoisted "import" that was never one.
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

    // 3. A BACKQUOTED IDENTIFIER, which may hold a brace or the word `import` and mean neither.
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
}

#[test]
fn every_scan_is_a_byte_comparison_rather_than_a_slice() {
    // A model writing a message in any language but English produces this on its first turn, and a
    // scan that sliced the source at a byte index would take the whole turn down with a slice index
    // error rather than reaching the compiler.
    let source = "val message = \"café — déjà vu\"\nprintln(message)\n";
    assert_eq!(wrap_program(source).expect("wrapped").source, source);
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
        "val a = \"unterminated\n",
        "/* unterminated\nfun a() = 1\n",
        "val a = \"${unterminated\n",
        "val a = `unterminated\n",
    ] {
        let _ = wrap_program(source).expect("an unterminated anything is the compiler's to refuse");
        let _ = scanned(source);
    }
}
