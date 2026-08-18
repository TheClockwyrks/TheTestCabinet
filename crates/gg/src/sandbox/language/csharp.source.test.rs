//! What gg writes around a code module, and what it reads out of one, held to the C# a skill author
//! actually writes.

use super::*;
use crate::sandbox::export_names;

/// The mask, as a string of one character per byte — `c` for code, `t` for text, `h` for a hole —
/// which is what makes an expectation here readable beside its input.
fn shape(source: &str) -> String {
    mask(source)
        .into_iter()
        .map(|byte| match byte {
            Mask::Code => 'c',
            Mask::Text => 't',
            Mask::Hole => 'h',
        })
        .collect()
}

#[test]
fn a_skills_name_becomes_the_class_it_is_reached_through() {
    // PascalCase, because here the key names a TYPE — which is the one thing that is different
    // about this arm's answer, and the reason it can promise the next assertion.
    assert_eq!(binding_name("csv-tools"), "CsvTools");
    assert_eq!(binding_name("csv_tools"), "CsvTools");
    assert_eq!(binding_name("my_helpers.v2"), "MyHelpersV2");
    assert_eq!(binding_name("CsvTools"), "CsvTools");

    // Every C# keyword is lower-case, so a PascalCase key can never be one — which no other arm's
    // spelling can promise, and which is why nothing here needs a `@`.
    for reserved in ["class", "string", "is", "namespace", "static", "void"] {
        let key = binding_name(reserved);
        assert!(
            key.starts_with(|character: char| character.is_ascii_uppercase()),
            "a key spelled from `{reserved}` is not safely cased: {key}"
        );
    }

    // The two shapes an identifier must not have.
    assert_eq!(binding_name("9lives"), "_9lives");
    assert_eq!(binding_name("---"), CHECK_KEY);
}

#[test]
fn a_module_is_a_class_body_under_the_key_it_is_bound_at() {
    let module = wrap_module(
        "public static string Slugify(string text) => text.ToLowerInvariant();\n",
        "CsvTools",
    )
    .expect("a module declaring something public wraps");

    assert!(
        module.source.starts_with("namespace lib;\n"),
        "a module is not in the namespace the binding names: {}",
        module.source
    );
    assert!(
        module.source.contains("public static class CsvTools\n{\n"),
        "a module is not the body of the class its key names: {}",
        module.source
    );
    // The author's own bytes, untouched, and told they are line 1 — so a diagnostic reads
    // `module_CsvTools.cs(1,…)` however tall the header gg wrote above it happens to be.
    assert!(
        module
            .source
            .contains("#line 1 \"module_CsvTools.cs\"\npublic static string Slugify"),
        "the author's first line is not line 1: {}",
        module.source
    );
    assert!(
        module.source.ends_with("#line default\n}\n"),
        "the class gg opened is not closed outside the author's coordinates: {}",
        module.source
    );
    assert_eq!(export_names(&module.exports), vec!["Slugify".to_string()]);
}

#[test]
fn the_using_lines_a_c_sharp_file_opens_with_are_lifted_out_of_the_class_body() {
    let module = wrap_module(
        "// helpers for the ledger\nusing System.Text.Json;\nusing Json = System.Text.Json.JsonSerializer;\n\npublic static int Count(string text) => text.Length;\n",
        "Ledger",
    )
    .expect("a module opening with usings wraps");

    // Each is lifted with a `#line` of its own, so a `using` naming something this guest does not
    // carry is reported where the author wrote it rather than where gg moved it to.
    assert!(
        module
            .source
            .contains("#line 2 \"module_Ledger.cs\"\nusing System.Text.Json;\n#line default\n"),
        "a hoisted using lost the line it was written on: {}",
        module.source
    );
    assert!(
        module.source.contains(
            "#line 3 \"module_Ledger.cs\"\nusing Json = System.Text.Json.JsonSerializer;\n"
        ),
        "an alias directive was not hoisted: {}",
        module.source
    );
    // Blanked rather than deleted, so everything below is still where the author put it: the body
    // has as many lines as the file did.
    let body = module
        .source
        .split_once("#line 1 \"module_Ledger.cs\"\n")
        .expect("the body is announced")
        .1;
    assert_eq!(
        body.lines()
            .position(|line| line.contains("public static int Count")),
        Some(4),
        "the author's line 5 did not stay line 5: {body}"
    );
    assert_eq!(export_names(&module.exports), vec!["Count".to_string()]);
}

#[test]
fn only_the_run_of_usings_at_the_top_is_taken() {
    // C#'s other meaning for the word is a statement inside a method body, and it must survive
    // untouched — which is what restricting the hoist to the leading run buys.
    let module = wrap_module(
        "public static string Read(string path)\n{\n    using var stream = File.OpenRead(path);\n    return stream.Length.ToString();\n}\n",
        "Files",
    )
    .expect("a module whose only `using` is a statement wraps");
    assert!(
        module
            .source
            .contains("    using var stream = File.OpenRead(path);"),
        "a `using` statement was hoisted out of the body it belongs to: {}",
        module.source
    );
    assert_eq!(export_names(&module.exports), vec!["Read".to_string()]);
}

#[test]
fn a_module_names_every_public_thing_it_offers_and_nothing_else() {
    let module = wrap_module(
        concat!(
            "public static string Slugify(string text) => text;\n",
            "public static T First<T>(IReadOnlyList<T> items) => items[0];\n",
            "public const int Ceiling = 40;\n",
            "public static readonly Regex Word = new(\"[a-z]+\");\n",
            "public static int Total { get; } = 3;\n",
            "public sealed record Row(string Name, int Age);\n",
            "public enum Colour { Red, Green }\n",
            "public delegate int Score(Row row);\n",
            "public static class Nested\n{\n    public static void Buried() { }\n}\n",
            "private static void Hidden() { }\n",
            "static void AlsoHidden() { }\n",
        ),
        "Kit",
    )
    .expect("a module of public members wraps");

    assert_eq!(
        export_names(&module.exports),
        vec![
            "Slugify", "First", "Ceiling", "Word", "Total", "Row", "Colour", "Score", "Nested",
        ],
        "the exports are not what `lib.Kit.` offers"
    );
}

/// **What a declaration writes in return and parameter position**, read off the same line the
/// export was read off.
///
/// They are what an agent's `docViewTypes` flags open beside a function, resolved by simple name
/// against the module's own exports and gg's catalogue — so every identifier a type position spells
/// is read, and the built-in keywords, which name nothing a view could open, are not.
#[test]
fn a_declaration_says_which_types_it_names_and_where() {
    let module = wrap_module(
        concat!(
            "public static Row Parse(string line, Options options) => new(line);\n",
            "public static IReadOnlyList<Row> Rows(Source source) => [];\n",
            "public static string Join(IReadOnlyList<string> parts, string separator = \", \") =>\n",
            "    string.Join(separator, parts);\n",
            "public static int Count => 0;\n",
            "public sealed record Row(string Name, Age age);\n",
            "public delegate int Score(Row row);\n",
        ),
        "Kit",
    )
    .expect("a module of typed declarations wraps");

    let named = |name: &str| {
        let export = module
            .exports
            .iter()
            .find(|export| export.name == name)
            .unwrap_or_else(|| panic!("`{name}` is one of this module\'s exports"));
        (export.returns.clone(), export.parameters.clone())
    };

    assert_eq!(
        named("Parse"),
        (vec!["Row".to_string()], vec!["Options".to_string()]),
        "a method does not say what it takes and hands back"
    );
    // Every identifier a type position spells, because either half may be the name that opens.
    assert_eq!(
        named("Rows"),
        (
            vec!["IReadOnlyList".to_string(), "Row".to_string()],
            vec!["Source".to_string()]
        ),
        "a generic return type was read as one name or as none"
    );
    // A default value is text: the `, ` in it is not a parameter separator and the `string` before
    // it is not a second type.
    assert_eq!(
        named("Join"),
        (Vec::new(), vec!["IReadOnlyList".to_string()]),
        "a default value was read as a type or as another parameter"
    );
    // Nothing to open: the built-in keywords name no declaration a view could be opened on.
    assert_eq!(named("Count"), (Vec::new(), Vec::new()));
    // A type names itself, which is not a type it writes — and its positional parameters are read
    // the way a method's are.
    assert_eq!(
        named("Row"),
        (Vec::new(), vec!["Age".to_string()]),
        "a record was read as returning itself"
    );
    assert_eq!(
        named("Score"),
        (Vec::new(), vec!["Row".to_string()]),
        "a delegate does not say what it is handed"
    );
}

#[test]
fn a_module_that_offers_nothing_is_refused_with_what_to_write() {
    let refusal = wrap_module("static int Add(int a, int b) => a + b;\n", "Maths")
        .expect_err("a module with nothing public offers nothing");
    match refusal {
        PrepareFailure::Program(PrepareError::Unsupported(message)) => {
            assert!(
                message.contains("`static class`")
                    && message.contains("public static string Greet"),
                "the refusal does not say what to write instead: {message}"
            );
        }
        other => panic!("a module that offers nothing is a refusal, not {other:?}"),
    }
}

#[test]
fn the_two_declarations_with_nowhere_to_go_are_refused_at_the_authors_own_line() {
    let namespaced = wrap_module(
        "namespace Ledger;\n\npublic static int One() => 1;\n",
        "Kit",
    )
    .expect_err("a module cannot declare a namespace");
    match namespaced {
        PrepareFailure::Program(PrepareError::Unsupported(message)) => assert!(
            message.starts_with("line 1:") && message.contains("Ledger"),
            "the namespace refusal is not located and specific: {message}"
        ),
        other => panic!("a namespace in a module is a refusal, not {other:?}"),
    }

    let global = wrap_module(
        "using System.Text;\nglobal using System.Linq;\n\npublic static int One() => 1;\n",
        "Kit",
    )
    .expect_err("a module cannot declare a global using");
    match global {
        PrepareFailure::Program(PrepareError::Unsupported(message)) => assert!(
            message.starts_with("line 2:") && message.contains("ordinary `using`"),
            "the global-using refusal does not name the answer: {message}"
        ),
        other => panic!("a global using in a module is a refusal, not {other:?}"),
    }
}

#[test]
fn a_declaration_that_is_only_text_is_not_one() {
    // The three ways C# spells "this is not code", each hiding a line that would otherwise be read
    // as a declaration or as a directive.
    let module = wrap_module(
        concat!(
            "public static string Sample() =>\n",
            "    \"\"\"\n",
            "    namespace NotReally;\n",
            "    public static void NotAMember() { }\n",
            "    \"\"\";\n",
            "// public static void Commented() { }\n",
            "/* public static void Blocked() { } */\n",
        ),
        "Kit",
    )
    .expect("a module whose only declaration is real wraps");
    assert_eq!(export_names(&module.exports), vec!["Sample".to_string()]);
}

#[test]
fn the_lexer_knows_what_is_code_and_what_only_looks_like_it() {
    assert_eq!(shape("a // b\nc"), "ccttttcc");
    assert_eq!(shape("a /* b */ c"), "cctttttttcc");
    assert_eq!(shape("x = \"a\";"), "cccctttc");
    // A verbatim string escapes a quote by doubling it, so the middle pair is text rather than an
    // end followed by a fresh literal.
    assert_eq!(shape("@\"a\"\"b\";"), "tttttttc");
    // A raw string ends on a run long enough to close it, and escapes nothing in between.
    assert_eq!(shape("\"\"\"a\"b\"\"\";"), "tttttttttc");
    // A character literal, including an escaped quote.
    assert_eq!(shape("'\\''+1"), "ttttcc");
    // An interpolation hole is CODE again — which is what keeps its braces out of a class body's
    // depth — and a string inside that hole is text again.
    assert_eq!(shape("$\"a{b}c\""), "tttthttt");
    assert_eq!(shape("$\"{f(\"x\")}\""), "ttthhttthtt");
    // `{{` is a literal brace and opens no hole.
    assert_eq!(shape("$\"{{}}\""), "ttttttt");
}

#[test]
fn a_brace_that_is_only_text_does_not_hide_a_declaration() {
    // The failure this closes: a string or an interpolation whose braces were counted would leave
    // the scan believing it was still inside something, and every later export would be lost.
    let module = wrap_module(
        concat!(
            "public static string Open() => \"{\";\n",
            "public static string Interpolated(int n) => $\"{{{n}}}\";\n",
            "public static int Last() => 1;\n",
        ),
        "Kit",
    )
    .expect("a module whose strings contain braces wraps");
    assert_eq!(
        export_names(&module.exports),
        vec![
            "Open".to_string(),
            "Interpolated".to_string(),
            "Last".to_string()
        ],
    );
}

#[test]
fn a_modules_file_is_named_so_a_diagnostic_in_one_is_never_the_models() {
    assert_eq!(module_file("CsvTools"), "module_CsvTools.cs");
    assert!(module_file(CHECK_KEY).starts_with(MODULE_FILE_PREFIX));
}

/// **An export carries what a documentation view is rendered from**, cut at whichever of the three
/// things a C# member opens a body with — a brace, an `=>`, or nothing at all.
#[test]
fn an_export_carries_its_kind_its_declaration_and_its_documentation() {
    let module = wrap_module(
        "/// Slugify a string.\n\
         public static string Slugify(string text) => text.ToLowerInvariant();\n\
         public const int Limit = 3;\n\
         public static int Rows { get; set; }\n\
         public sealed class Row { }\n",
        "CsvTools",
    )
    .expect("a module declaring something public wraps");
    assert_eq!(
        export_names(&module.exports),
        ["Slugify", "Limit", "Rows", "Row"]
    );

    // An expression-bodied member: the arrow is the boundary, not the value.
    assert_eq!(module.exports[0].kind, ModuleExportKind::Function);
    assert_eq!(
        module.exports[0].declaration,
        "public static string Slugify(string text)"
    );
    assert_eq!(module.exports[0].doc.as_deref(), Some("Slugify a string."));

    // A field's `=` opens its value, and the value is part of the declaration.
    assert_eq!(module.exports[1].kind, ModuleExportKind::Value);
    assert_eq!(module.exports[1].declaration, "public const int Limit = 3;");
    assert_eq!(module.exports[1].doc, None);

    // A property's accessors are a body, and the brace is the boundary.
    assert_eq!(module.exports[2].kind, ModuleExportKind::Value);
    assert_eq!(module.exports[2].declaration, "public static int Rows");

    assert_eq!(module.exports[3].kind, ModuleExportKind::Type);
    assert_eq!(module.exports[3].declaration, "public sealed class Row");

    assert!(
        module
            .exports
            .iter()
            .all(|export| export.returns.is_empty())
    );
    assert!(
        module
            .exports
            .iter()
            .all(|export| export.parameters.is_empty())
    );
}
