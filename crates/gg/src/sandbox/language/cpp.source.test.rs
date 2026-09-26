//! Whether a reply defines an entry point, and whether the lexer that decides it can be fooled.
//!
//! Everything here is about the one direction this reading may be wrong in. Accepting a reply that
//! has no real `main` costs nothing that not looking at all would not have cost — the program links
//! and traps either way. **Refusing one that has** costs a whole turn on a program that was correct,
//! so every case below that ends in `false` is a case where the model really wrote nothing to run.

use super::*;

#[test]
fn an_ordinary_program_defines_main_in_every_spelling_a_model_writes() {
    assert!(defines_main("int main() { return 0; }\n"));
    assert!(defines_main(
        "int main(int argc, char **argv) { return 0; }\n"
    ));
    assert!(defines_main("auto main() -> int { return 0; }\n"));
    // Whitespace and comments between the name and its parameter list: still one declaration.
    assert!(defines_main("int main\n() {}\n"));
    assert!(defines_main("int main /* the entry point */ () {}\n"));
    // Below other declarations, which is where a model actually puts it.
    assert!(defines_main(
        "#include <vector>\n\
         namespace helpers {\n\
         template <typename T> T twice(T value) { return value + value; }\n\
         }\n\
         \n\
         int main() {\n\
         \x20 return helpers::twice(1);\n\
         }\n"
    ));
}

#[test]
fn a_reply_with_nothing_to_run_is_the_one_that_is_refused() {
    assert!(!defines_main("void helper() {}\n"));
    assert!(!defines_main(""));
    // A `main` that is only ever mentioned: in a comment, in a string, in a heading a model left in
    // its reply. None of these is a program.
    assert!(!defines_main(
        "// put your work in main()\nvoid helper() {}\n"
    ));
    assert!(!defines_main(
        "/* the entry point is main() */\nvoid helper() {}\n"
    ));
    assert!(!defines_main(
        "#include <string>\nstd::string note = \"call main() next\";\n"
    ));
    // A member function called `main` on a class is not this program's entry point, and neither is a
    // call to somebody else's.
    assert!(!defines_main(
        "struct App { void run() { other.main(); } };\n"
    ));
    assert!(!defines_main("void go() { helpers::main(); }\n"));
    // A longer identifier that merely contains the token.
    assert!(!defines_main("int mainLoop() { return 0; }\n"));
    assert!(!defines_main("int gg_main() { return 0; }\n"));
}

#[test]
fn a_raw_string_hides_what_is_inside_it_however_it_is_fenced() {
    // The shape a naive scan loses the file on: a raw string's body may contain `"`, `\`, and the
    // token being looked for. Reading the fence rather than looking for a quote is what keeps the
    // rest of the program masked correctly.
    assert!(!defines_main(
        "const char *usage = R\"(write main() here)\";\n"
    ));
    assert!(!defines_main(
        "const char *usage = R\"gg(he said \"main()\" loudly)gg\";\n"
    ));
    // And the mask ends where the fence does, so a real `main` after one is still found.
    assert!(defines_main(
        "const char *usage = R\"(main())\";\nint main() { return 0; }\n"
    ));
    // An `R` that merely ends an identifier does not open a raw string.
    let mask = code_mask("int VAR\"x\";\n");
    assert!(!mask[8], "the ordinary string after an identifier is code");
}

#[test]
fn a_digit_separator_is_not_a_character_literal() {
    // `1'000'000` is C++14 and a model writes it. Reading the first `'` as a quote would mask
    // `000` and `1'` alternately and leave the rest of the line wrong.
    let source = "int big = 1'000'000;\nint main() { return big; }\n";
    assert!(defines_main(source));
    let mask = code_mask(source);
    assert!(
        mask.iter().take(20).all(|byte| *byte),
        "a digit separator masked part of an ordinary declaration"
    );
}

#[test]
fn an_unterminated_literal_does_not_swallow_the_rest_of_the_reply() {
    // A `"` a model left open is a compile error clang will report at its own line. What must not
    // happen is this scan masking everything after it and then answering "no main" for a file that
    // has one — which would replace the compiler's precise diagnostic with gg's blunt refusal.
    assert!(defines_main(
        "const char *broken = \"oops;\nint main() { return 0; }\n"
    ));
}

#[test]
fn a_comment_is_masked_and_a_block_comment_does_not_nest() {
    // C++ block comments do not nest — unlike Swift's — so the first `*/` closes, and text after it
    // is code. Getting that backwards would mask a real `main` on the line below.
    let source = "/* outer /* inner */ int main() { return 0; }\n";
    assert!(defines_main(source));
    assert!(!defines_main("// int main() { return 0; }\n"));
    let mask = code_mask("int a; // int main()\nint b;\n");
    assert!(mask[0] && !mask[7] && mask[21]);
}

#[test]
fn an_include_is_code_and_its_angle_brackets_are_not_a_string() {
    // The one preprocessor shape every C++ reply opens with. It carries `<` and `>` rather than
    // quotes, so nothing here should be masked — and a quoted include is an ordinary string as far
    // as this lexer is concerned, which costs nothing because no `main` hides in a path.
    let source = "#include <vector>\n#include \"sandbox.h\"\nint main() { return 0; }\n";
    assert!(defines_main(source));
}

/// **The line a program writes to reach a module**, and the two words a module name may not carry.
///
/// A namespace and a module name are the same identifiers separated differently, except for
/// `module` and `import`: both are legal namespace names, neither is a legal module-name component,
/// and both are keys [`binding_name`](super::super::binding_name) really produces.
#[test]
fn a_modules_import_line_names_the_module_and_escapes_the_two_words_it_may_not() {
    assert_eq!(module_import("csv_tools"), "import lib.csv_tools;");
    assert_eq!(module_name("csv_tools"), "lib.csv_tools");

    assert_eq!(module_import("module"), "import lib.Module;");
    assert_eq!(module_import("import"), "import lib.Import;");
}

/// **A function's two type positions, read off the declaration the scan already quoted.**
///
/// What each case is about is the one thing that is not a type name: a parameter's own name, its
/// default argument, the decoration around a type, the specifiers a declaration opens with, and the
/// container a name a model wants a view of sits inside.
#[test]
fn a_function_export_carries_the_types_its_declaration_writes() {
    let types = |declaration: &str| signature_types(declaration, ModuleExportKind::Function);

    // The ordinary shape: a template argument is a type name of its own, because it is the one this
    // module declares and the container is the standard library's.
    assert_eq!(
        types("std::vector<row> parse(std::string_view text, char sep = ',')"),
        (
            vec!["std::vector".to_string(), "row".to_string()],
            vec!["std::string_view".to_string(), "char".to_string()]
        )
    );

    // A default argument carrying a comma inside a literal is one argument, which is what reading
    // the declaration through the arm's own lexer buys.
    assert_eq!(
        types("int count(std::string_view text, char sep = ',')").1,
        ["std::string_view", "char"]
    );

    // Decoration is not a name, and a specifier is not one either.
    assert_eq!(
        types("static inline const row &widest(const std::vector<row> &rows, row *fallback)"),
        (
            vec!["row".to_string()],
            vec!["std::vector".to_string(), "row".to_string()]
        )
    );

    // A trailing return type is the return type, and the `auto` announcing one is not a type.
    assert_eq!(
        types("auto widen(int value) -> std::string").0,
        ["std::string"]
    );

    // An unnamed parameter is all type, at both spellings of "there is nothing to drop".
    assert_eq!(types("int one(std::string_view)").1, ["std::string_view"]);
    assert_eq!(types("int two(std::vector<row>)").1, ["std::vector", "row"]);
    assert_eq!(types("int three(int)").1, ["int"]);

    // A parameter list that names nothing writes no type, and neither does a declaration this
    // reading cannot take apart.
    assert!(types("int nothing()").1.is_empty());
    assert!(types("row make").0.is_empty());

    // One view per type, opened where the declaration first names it.
    assert_eq!(
        types("row merge(const row &left, const row &right)").1,
        ["row"]
    );
}

/// **Only a function writes the two positions**, so nothing else claims them.
///
/// A constant's own type is a type, and it is not a return type: a view saying it was would be gg's
/// reading of the declaration standing in front of the author's.
#[test]
fn a_type_and_a_value_write_neither_position() {
    for kind in [ModuleExportKind::Type, ModuleExportKind::Value] {
        assert_eq!(
            signature_types("constexpr double pi = 3.14;", kind),
            (Vec::new(), Vec::new())
        );
        assert_eq!(
            signature_types("struct row", kind),
            (Vec::new(), Vec::new())
        );
    }
}

/// **An operator's declaration writes types too**, and the word `operator` is not one of them.
///
/// The shape a namespace-scope C++ module really carries beside its functions: a comparison written
/// as a free function, whose return type and both operands are what a reader of it wants views of.
#[test]
fn an_operator_declaration_writes_its_operands_and_not_the_word_operator() {
    assert_eq!(
        signature_types(
            "bool operator==(const row &left, const row &right)",
            ModuleExportKind::Function
        ),
        (vec!["bool".to_string()], vec!["row".to_string()])
    );
}
