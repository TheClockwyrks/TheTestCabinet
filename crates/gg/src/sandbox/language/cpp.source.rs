//! **What gg reads out of a model's C++ before handing it to the compiler** — which for a
//! *program* is exactly one thing, whether the reply defines a `main` — and **what gg writes around
//! a code module**, which is the named module and namespace its declarations are opened inside, with
//! the author's own `#include` lines lifted to where that construct requires them.
//!
//! Nothing here rewrites a program's text. A C++ program is compiled
//! [verbatim](super::compile::PROGRAM_FILE), so for that half this module is a *reader* rather than
//! a lowering, and the lexer below is the arm's own byte-level scan
//! ([`mask`](super::mask)) — which is why it masks strings and
//! comments properly rather than scanning the raw bytes.
//!
//! # A code module is a named C++ module exporting a namespace of the author's own file
//!
//! A code [skill](crate::skills)'s or [memory](crate::memories)'s namespace is `lib::<key>`, and on
//! a compiled arm reaching it is a **link**: the module has to be built into the same artifact as
//! the program that uses it. C++ has both a real nested namespace and a real module system, so
//! [`namespaced`] declares `export module lib.<key>;`, opens `export namespace lib::<key> {` above
//! the author's first line and closes it below their last, and nothing in between is touched:
//!
//! ```text
//! module;                                       // gg's line
//! #include <gg.hpp>                             // gg's line
//! #line 4 "module_csv_tools.cppm"               // gg's line
//! #include <vector>                             // as authored, from the author's own line 4
//! #line 6 "module_csv_tools.cppm"               // gg's line, restoring this file's numbering
//! export module lib.csv_tools;                  // gg's line
//! export namespace lib::csv_tools {             // gg's line
//! #line 1 "module_csv_tools.cppm"               // gg's line
//! std::vector<row> parse(std::string_view text, char delimiter = ',') {   // as authored
//! ```
//!
//! **The module declaration is what keeps gg's surface out of the program.** Names a global module
//! fragment includes are attached to the global module and reach nobody who imports this one, so a
//! program with a code module in scope reaches `lib::<key>` and reaches gg's surface only through a
//! line it wrote itself.
//!
//! **The program's own line is [`module_import`]**, which it writes exactly as it writes the
//! `#include` that reaches gg's surface. Nothing is written in front of `main.cpp`: the compile is
//! told where the interface is and declares no name, so a program that omits the import earns
//! *use of undeclared identifier 'lib'*.
//!
//! **`#line` is why no line number moves**, and it is the reason this arm needs no offset
//! arithmetic anywhere: C++ is the one language here with a line-control directive, so gg says what
//! the author's first line is instead of subtracting two from every diagnostic afterwards. Every
//! default argument, template parameter and overload survives for the same reason Swift's do —
//! nothing is re-synthesized, the author's own text is what the compiler reads — and unlike that
//! arm's, *every* declaration goes in, `struct`, `using`, `concept` and operator alike, because a
//! namespace admits everything a file's top level does.
//!
//! Two modules may therefore declare the same name, which is a thing the [Swift](super::super::swift)
//! arm cannot say: two `struct row`s in two modules are `lib::a::row` and `lib::b::row`.
//!
//! # The one thing that is moved: an author's `#include`
//!
//! **A `#include` at a module's top level is hoisted into the global module fragment**, beside the
//! [one gg writes](SURFACE_INCLUDE) and above `export module lib.<key>;`. It is moved rather than
//! left where it stands because `#include` is *textual*: a line inside `export namespace lib::<key>`
//! expands the whole of the included header into that namespace, so `std::vector` would be declared
//! at `lib::<key>::std::vector` and nothing the author wrote afterwards would resolve.
//!
//! The fragment is where it belongs for the same reason gg's own line is there. Names a global
//! module fragment includes are attached to the global module and reach no importer, so a module's
//! own headers stay the module's own: a program that binds this module still earns *use of
//! undeclared identifier 'std'* for a `std::vector` it wrote no include for.
//!
//! Moving a line an author wrote is the wrapper
//! [a module is allowed and a program is not](https://docs.testcabinet.ai/gg/responses-as-code/invariants/):
//! a module is a skill author's file that gg wraps, where a program is a model's reply that gg does
//! not touch. It is the same hoist the [C#](super::super::csharp::source) arm does with a `using`,
//! for the same reason — the construct an author writes at the top of a file has nowhere to live
//! inside the one gg opened around it.
//!
//! It is a **move and not a rewrite**: each hoisted line carries a `#line` stating where its author
//! wrote it, the numbering of this file is restored under the block, and the body keeps the blank
//! line each hoist left behind, so `#line 1` in front of it holds all the way down.
//!
//! The line is hoisted rather than refused because nothing else declares the standard library for a
//! module: gg precompiles no header in front of one, so an author who cannot write `#include` has no
//! route to `std::vector` at all.
//!
//! # Why gg has to look at all
//!
//! Because `wasm-ld` will not. wasi-libc's `__main_void.o` — the object that adapts clang's two
//! spellings of an entry point to one symbol — references `main` **weakly**, so a program that
//! defines none *links successfully*: the reference resolves to a stub that traps, the compiler
//! exits zero, and what a model gets back is an opaque trap on a turn whose program never ran.
//!
//! That was measured rather than assumed, and so were the ways round it. `-Wl,--undefined=main`
//! does nothing, because a weak undefined symbol is a resolution `wasm-ld` considers complete;
//! `--unresolved-symbols=report-all` does nothing for the same reason; and `--export=main` fails
//! for `int main()` and *also* fails for `int main(int, char **)`, because the two are lowered to
//! different symbols and neither is called `main`. There is no linker flag that asks this question.
//!
//! So gg asks it, and refuses the program with a sentence at prepare time — which is the same
//! answer the [Rust](super::super::rust) arm gives to the opposite shape. Rust has no `main` and
//! refuses a program that defines one; C++ has nowhere else to put a statement and refuses a
//! program that does not.
//!
//! # Why the reading can only be wrong in the safe direction
//!
//! The scan looks for the *token* `main` followed by an open parenthesis, anywhere in the reply's
//! **code** bytes. It is deliberately not a parse:
//!
//! * A refusal happens only when there is no such token **anywhere** in the code. A reply that
//!   defines `main` cannot fail to contain one, so a false refusal would take a lexer that mistook
//!   real code for a string or a comment — which is what the masking below is for, and what its
//!   tests are about.
//! * The reverse — a reply that has the token and no definition (a member function called `main`,
//!   a forward declaration and nothing else) — is accepted, compiled, and traps. That is the same
//!   outcome as not looking at all, so the scan can only improve on it.
//!
//! Being wrong in that direction is the rule this whole subsystem is built on: a model told to fix
//! a program that was never wrong is the misattribution this codebase spends the most effort not
//! making.

use super::super::{ModuleExport, ModuleExportKind};

/// The file a code module is compiled under, given its binding key — `module_csv_tools.cppm`.
///
/// A fixed name per key inside a workspace that is private per preparation, on the same terms
/// [`PROGRAM_FILE`](super::compile::PROGRAM_FILE) is. The key is already a C++ identifier
/// ([`binding_name`](super::binding_name)) so it cannot produce a path component that is not one.
///
/// `.cppm` because a code module here is a **C++ named module** rather than a header: it is
/// precompiled into a module interface of its own and the program's translation unit imports it.
pub(super) fn module_file(key: &str) -> String {
    format!("{MODULE_FILE_PREFIX}{key}.cppm")
}

/// The name a code module is declared and imported under, given its binding key — `lib.csv_tools`.
///
/// A module name is a dotted sequence of identifiers where a namespace is a `::`-separated one, so
/// the two spellings of the same module differ by that and nothing else — except for the two words
/// a module-name component may not be. `module` and `import` are legal namespace names and illegal
/// module-name components, and both are reachable keys: [`binding_name`](super::binding_name)
/// answers `module` for a slug that is nothing but separators. They are escaped by upper-casing the
/// first letter, which no key can collide with because that function lower-cases everything it
/// produces.
pub(super) fn module_name(key: &str) -> String {
    match key {
        "module" | "import" => format!("lib.{}{}", key[..1].to_uppercase(), &key[1..]),
        _ => format!("lib.{key}"),
    }
}

/// **The line a program writes to reach one code module's namespace** — `import lib.csv_tools;`.
///
/// The model's own line, in the model's own reply: nothing is written in front of `main.cpp`, and
/// the [compile](super::compile::compile_program) that names the module's interface with
/// `-fmodule-file=` declares no name, so a program that omits this line earns *use of undeclared
/// identifier 'lib'*. It is [what this arm answers `lib_import` with](crate::sandbox::ProgramLanguage::lib_import), which
/// is where a model reads it: the documentation view of the module and of each of its declarations.
///
/// The [module name](module_name) rather than the namespace, because that is what an import
/// declaration resolves — so a key of `module` is imported as `import lib.Module;` and written
/// `lib::module::<name>`.
pub(super) fn module_import(key: &str) -> String {
    format!("import {};", module_name(key))
}

/// What a code module's file name begins with — which is also how a diagnostic located in one is
/// told from a diagnostic located in the model's own program.
pub(super) const MODULE_FILE_PREFIX: &str = "module_";

/// A code module's own file: a global module fragment carrying gg's surface and the author's own
/// `#include` lines, the module declaration, and `export namespace lib::<key> {` around the rest of
/// the author's source verbatim — with `#line` directives so that every line of it is reported where
/// its author wrote it.
///
/// ```text
/// module;                                       // gg's line
/// #include <gg.hpp>                             // gg's line
/// #line 4 "module_csv_tools.cppm"               // gg's line
/// #include <vector>                             // as authored, from the author's own line 4
/// #line 6 "module_csv_tools.cppm"               // gg's line, restoring this file's numbering
/// export module lib.csv_tools;                  // gg's line
/// export namespace lib::csv_tools {             // gg's line
/// #line 1 "module_csv_tools.cppm"               // gg's line
/// std::vector<row> parse(std::string_view text, char delimiter = ',') {   // as authored
/// ```
///
/// **A named module is what keeps gg's surface out of the program that binds this one.** Everything
/// the global module fragment includes — gg's line and the author's alike — is attached to the
/// global module and is invisible to whoever imports this one, so a program with a code module in
/// scope reaches `lib::<key>` and still earns `use of undeclared identifier 'gg'` for a gg name it
/// wrote no line for.
///
/// **Three `#line` directives, and each is doing a different job.** The one in front of a hoisted
/// include says where its author wrote it, so a header this guest does not carry is reported at the
/// author's own line rather than where gg moved it to. The one under the hoisted block restores
/// *this* file's own numbering, so a diagnostic on the two lines gg writes next is not reported
/// against a line of the author's that has nothing to do with it. And the `#line 1` in front of the
/// body is what makes the author's first line line 1, whatever stands above it — the body keeps the
/// blank line every hoist left behind, so that stays true to the last line.
pub(super) fn namespaced(source: &str, key: &str) -> String {
    let quoted = serde_json::Value::String(module_file(key)).to_string();
    let (body, includes) = hoist(source);

    let mut lines = vec!["module;".to_string(), SURFACE_INCLUDE.to_string()];
    for (number, directive) in &includes {
        lines.push(format!("#line {number} {quoted}"));
        lines.push(directive.clone());
    }
    if !includes.is_empty() {
        // What follows is gg's own, so it is reported at the line it really is on. `#line N` names
        // the line AFTER the directive, and the directive itself is the line this is counting from —
        // hence two rather than one. This is gg stating where its own text is, which is the one
        // thing a line-control directive is for; no diagnostic's coordinates are computed from it.
        lines.push(format!("#line {} {quoted}", lines.len() + 2));
    }
    lines.push(format!("export module {};", module_name(key)));
    lines.push(format!("export namespace lib::{key} {{"));
    lines.push(format!("#line 1 {quoted}"));

    // The closing brace is on a line of its own AFTER the author's last, and the newline in front of
    // it is unconditional: a module whose final line is `int last() { return 1; }` with no trailing
    // newline would otherwise have gg's brace glued to it.
    format!(
        "{}\n{body}\n}}  // namespace lib::{key}\n",
        lines.join("\n")
    )
}

/// Lift every `#include` an author wrote out of the module's body, leaving a blank line where each
/// stood, and hand back the body beside the lines and the 1-based numbers they were written on.
///
/// Every one of them, at whatever depth, rather than only the run at the top of the file the
/// [C#](super::super::csharp::source) arm takes: `#include` has exactly one meaning in C++, where
/// `using` has two and only one of them is hoistable. A directive inside a `#ifdef` is hoisted out
/// of the condition with it, which is the one shape this is wrong about and one no skill file in
/// this repository has.
///
/// The mask is what decides: an `#include` behind a `//` or inside a raw string is text rather than
/// a directive, and this arm's lexer is what knows the difference. The line's own terminator stays
/// in the body, so the body has exactly as many lines as the author wrote — which is what makes the
/// `#line 1` above it true all the way down.
fn hoist(source: &str) -> (String, Vec<(usize, String)>) {
    let code = code_mask(source);
    let mut body = String::with_capacity(source.len());
    let mut includes: Vec<(usize, String)> = Vec::new();
    let mut offset = 0usize;
    for (index, line) in source.split_inclusive('\n').enumerate() {
        let start = offset;
        offset += line.len();
        // The directive's own `#`, which is where the mask is asked.
        let hash = start + (line.len() - line.trim_start().len());
        if opens_an_include(line) && code.get(hash) == Some(&true) {
            includes.push((index + 1, line.trim().to_string()));
            body.push_str(match line.ends_with('\n') {
                true => "\n",
                false => "",
            });
            continue;
        }
        body.push_str(line);
    }
    (body, includes)
}

/// The one line gg writes into a code module's global module fragment: gg's whole surface, included
/// **above** the module declaration so it is attached to the global module rather than exported.
///
/// It is gg's rather than the author's because a compiled arm cannot link a module to gg's surface
/// without it, which is the [module wrapper](https://docs.testcabinet.ai/gg/responses-as-code/invariants/)
/// a code module is allowed and a *program* is not: a module is a skill's or a memory's source
/// rather than a model's reply, and it never crosses the line an authorship rule is about. The
/// author's own includes are [hoisted](hoist) into the fragment beside it, where the same property
/// holds for them — a name in it reaches this module and reaches nobody who imports it.
///
/// The umbrella rather than a module header, because gg has no way to know which of the thirteen an
/// author will reach for and a wrong guess is a diagnostic in somebody else's coordinates.
///
/// Above the `#line 1` directive, so it cannot move a number: the directive is what says the
/// author's first line is line 1, whatever stands in front of it.
pub(super) const SURFACE_INCLUDE: &str = "#include <gg.hpp>";

/// Whether `line`'s own text is a preprocessor `#include` directive.
///
/// A `#` may be separated from its directive by whitespace (`#  include <vector>`) and the whole
/// thing may be indented, both of which are legal C++ that a scan looking for `"#include"` would
/// miss.
fn opens_an_include(line: &str) -> bool {
    let Some(rest) = line.trim_start().strip_prefix('#') else {
        return false;
    };
    rest.trim_start()
        .strip_prefix("include")
        .is_some_and(|after| {
            after.starts_with(|byte: char| byte.is_whitespace() || byte == '<' || byte == '"')
        })
}

/// The names a code module's namespace offers, in source order — what the reply that binds it tells
/// the model it may call.
///
/// Read from the module's **own source** rather than out of anything the compiler produced, for the
/// reason every other arm reads its own: these are what the skill's author is *told* the namespace
/// holds, and a second reading of the same fact is a second chance for the two to disagree.
///
/// C++ has no access control at namespace scope, so **everything a module declares at its top level
/// is one of its names** — a function, a `struct`, a `class`, an `enum`, a `using` alias, a
/// `constexpr` constant. That is wider than the function lists the interpreted arms report and it is
/// right, the same way the [Rust](super::super::rust) arm's is: a module whose namespace is a type
/// and the free functions over it offers that type.
///
/// The scan is lexical and reads the module's **outermost** scope only, which is what `lib::<key>`
/// is: a braces count over the code bytes keeps a declaration inside a `struct`, inside a
/// `namespace` of the author's own or inside a function body — where C++ authors do not indent the
/// first of those two anyway — from being reported as a name the program reaches at
/// `lib::<key>::<name>`. The author's own `namespace detail` *is* reported, because
/// `lib::<key>::detail` is a name; what is inside it is not.
///
/// An indented line is skipped on top of that, which catches the one shape the brace count cannot:
/// the continuation of a signature broken across lines, where the identifier before the `)` is a
/// parameter rather than the declarator.
///
/// Where it cannot tell what a line declares it reports nothing, which is the safe direction — an
/// unreported name is a call the model was not told about and the compiler still resolves, where a
/// wrong one is a call that does not compile.
pub(super) fn exports(source: &str) -> Vec<ModuleExport> {
    let mut names: Vec<ModuleExport> = Vec::new();
    let lines: Vec<&str> = source.lines().collect();
    let code = code_mask(source);
    let mut offset = 0usize;
    let mut depth = 0usize;
    for (number, line) in source.split_inclusive('\n').enumerate() {
        let start = offset;
        offset += line.len();
        let outermost = depth == 0;
        for (at, byte) in line.bytes().enumerate() {
            if code.get(start + at) != Some(&true) {
                continue;
            }
            match byte {
                b'{' => depth += 1,
                b'}' => depth = depth.saturating_sub(1),
                _ => {}
            }
        }
        if !outermost || line.starts_with([' ', '\t']) || code.get(start) == Some(&false) {
            continue;
        }
        let Some((name, kind)) = declared_name(line.trim_end()) else {
            continue;
        };
        if names.iter().any(|seen| seen.name == name) {
            continue;
        }
        let declaration = super::super::heads::head(line.trim_end());
        let (returns, parameters) = signature_types(&declaration, kind);
        names.push(ModuleExport {
            name: name.to_string(),
            kind,
            declaration,
            doc: super::super::comments::block_doc(&lines, number)
                .or_else(|| super::super::comments::line_doc(&lines, number, &["///", "//"])),
            returns,
            parameters,
        });
    }
    names
}

/// The name `line` declares at namespace scope and what a program does with it, if this reading can
/// tell.
fn declared_name(line: &str) -> Option<(&str, ModuleExportKind)> {
    let line = line.trim();
    if line.is_empty() || line.starts_with(['#', '}', ')', '/', '*']) {
        return None;
    }
    // A tag or alias declaration says what it names in its second word, whatever stands to the right
    // of it. `enum class kind` carries one more, and `template` carries none at all — its declaration
    // is on the line below, which this scan reaches on its own.
    for keyword in ["struct", "class", "union", "enum", "namespace", "concept"] {
        if let Some(rest) = word(line, keyword) {
            let rest = word(rest, "class")
                .or_else(|| word(rest, "struct"))
                .unwrap_or(rest);
            // A `namespace` is neither a type nor a function: a program writes its name on the way
            // to something inside it, which is what it does with a value.
            let kind = match keyword {
                "namespace" => ModuleExportKind::Value,
                _ => ModuleExportKind::Type,
            };
            return identifier(rest).map(|name| (name, kind));
        }
    }
    if let Some(rest) = word(line, "using") {
        // `using row = …` names `row`; `using std::swap;` and `using namespace std;` name nothing
        // this namespace offers.
        return line
            .contains('=')
            .then(|| identifier(rest))
            .flatten()
            .map(|name| (name, ModuleExportKind::Type));
    }
    if word(line, "template").is_some() || word(line, "typedef").is_some() {
        return None;
    }
    // A function or a variable, which is everything left. The declarator's name is the last
    // identifier before the first `(` that opens a parameter list, or before the `=`, `{` or `;`
    // that ends a variable's declarator — so `std::vector<row> parse(std::string_view text)` names
    // `parse` and `constexpr double pi = 3.14;` names `pi`. Which of the two it was is what that
    // first character says: a parameter list is what makes a declarator a function.
    let end = line
        .find(['(', '=', '{', ';'])
        .filter(|at| !line[..*at].ends_with("operator"))?;
    let kind = match line.as_bytes()[end] {
        b'(' => ModuleExportKind::Function,
        _ => ModuleExportKind::Value,
    };
    last_identifier(&line[..end]).map(|name| (name, kind))
}

/// **The type names one declaration writes in return position and in parameter position** — the two
/// lists an [export](ModuleExport) carries, and what the type views beside a function's
/// documentation view are opened from.
///
/// Only a function writes those two positions, so a `struct`, a `using` alias, a `namespace` and a
/// constant answer with nothing: a variable's type is not a return type, and reporting it as one
/// would put gg's reading of a declaration in front of the author's own.
///
/// **Every type name the position writes is one of them**, template arguments included and in source
/// order, because the name a model wants a view of is as often inside a container as it is the
/// container — `std::vector<row>` writes `std::vector` and `row`, and it is `row` that this module
/// declares. What is dropped is everything that is not a type name: the decoration around a type
/// (`const`, `&`, `*`), a parameter's own name, its default argument, and the specifiers a
/// declaration may open with.
///
/// It reads the declaration [`exports`] already quoted, so a signature written across several lines
/// is read as far as its first — and a position this scan cannot take apart contributes nothing,
/// which is the direction every reading in this module is wrong in.
fn signature_types(declaration: &str, kind: ModuleExportKind) -> (Vec<String>, Vec<String>) {
    if kind != ModuleExportKind::Function {
        return (Vec::new(), Vec::new());
    }
    // A default argument may be a string or a character literal carrying a `,`, a `(` or a `=`, and
    // every reading below is structural — so the literals go first, exactly as they do everywhere
    // else in this module.
    let text = without_literals(declaration);
    let Some((open, close)) = parameter_list(&text) else {
        return (Vec::new(), Vec::new());
    };
    // A trailing return type is the return type; the `auto` in front of the declarator is the syntax
    // that announces one rather than a type of its own.
    let returns = match text[close + 1..].trim_start().strip_prefix("->") {
        Some(trailing) => type_names(trailing),
        None => type_names(without_declarator(&text[..open])),
    };
    let mut parameters = Vec::new();
    for parameter in split_outside_brackets(&text[open + 1..close]) {
        parameters.extend(type_names(without_parameter_name(parameter)));
    }
    (deduplicated(returns), deduplicated(parameters))
}

/// `text` with every byte a literal or a comment replaced by a space, so a structural reading of it
/// cannot be fooled by what an author wrote inside one.
///
/// The same [mask](code_mask) the rest of this module reads, applied rather than consulted: nothing
/// below maps an index back to the original text, so blanking is simpler than carrying a mask
/// beside every slice.
fn without_literals(text: &str) -> String {
    let code = code_mask(text);
    text.char_indices()
        .map(|(at, character)| match code.get(at) {
            Some(true) => character,
            _ => ' ',
        })
        .collect()
}

/// Where the declaration's parameter list opens and closes — the first `(` and the `)` that matches
/// it.
fn parameter_list(text: &str) -> Option<(usize, usize)> {
    let open = text.find('(')?;
    let mut depth = 0usize;
    for (at, byte) in text.bytes().enumerate().skip(open) {
        match byte {
            b'(' => depth += 1,
            b')' => {
                depth -= 1;
                if depth == 0 {
                    return Some((open, at));
                }
            }
            _ => {}
        }
    }
    None
}

/// `text` split on the commas that are the parameter list's own, which is those outside every
/// bracket a parameter may carry: a template argument list, a nested parameter list, an array bound
/// and a braced default argument all hold commas that separate nothing here.
fn split_outside_brackets(text: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut depth = 0usize;
    let mut start = 0usize;
    for (at, byte) in text.bytes().enumerate() {
        match byte {
            b'(' | b'[' | b'{' | b'<' => depth += 1,
            b')' | b']' | b'}' | b'>' => depth = depth.saturating_sub(1),
            b',' if depth == 0 => {
                parts.push(&text[start..at]);
                start = at + 1;
            }
            _ => {}
        }
    }
    parts.push(&text[start..]);
    parts
        .into_iter()
        .filter(|part| !part.trim().is_empty())
        .collect()
}

/// What stands in front of a function's parameter list without the declarator's own name — the
/// return type, and whatever specifiers the author opened the declaration with.
fn without_declarator(text: &str) -> &str {
    let text = text.trim_end();
    text[..identifier_start(text)].trim_end()
}

/// One parameter without the parts of it that are not its type: its default argument, its array
/// bound, and its own name.
///
/// **A trailing identifier is the parameter's name only when a type stands in front of it.** An
/// unnamed parameter is all type, so `std::string_view` keeps its last component, `std::vector<row>`
/// ends in a bracket and loses nothing, and `unsigned int` keeps the word that is its type rather
/// than losing it to a name it never had.
fn without_parameter_name(parameter: &str) -> &str {
    let parameter = parameter
        .split_once('=')
        .map_or(parameter, |(declarator, _)| declarator);
    let parameter = parameter
        .split_once('[')
        .map_or(parameter, |(declarator, _)| declarator);
    let text = parameter.trim();
    let start = identifier_start(text);
    let trailing = &text[start..];
    if start == 0 || trailing.is_empty() || text[..start].ends_with(':') || fundamental(trailing) {
        return text;
    }
    text[..start].trim_end()
}

/// Where the identifier `text` ends with begins, or its own length when it ends with anything else.
///
/// By character rather than by byte, because a C++ identifier may carry one this reading does not
/// recognise and a slice through the middle of one is a panic on the turn path.
fn identifier_start(text: &str) -> usize {
    text.char_indices()
        .rev()
        .find(|(_, character)| !is_identifier_char(*character))
        .map_or(0, |(at, character)| at + character.len_utf8())
}

/// Every type name `text` writes, in source order — an identifier and the `::`-qualified name it
/// opens, at every depth of a template argument list.
fn type_names(text: &str) -> Vec<String> {
    let bytes = text.as_bytes();
    let mut names = Vec::new();
    let mut at = 0usize;
    while at < bytes.len() {
        if !is_identifier_start(bytes[at]) {
            at += 1;
            continue;
        }
        let start = at;
        loop {
            while at < bytes.len() && is_identifier_char(bytes[at] as char) {
                at += 1;
            }
            let qualified = bytes.get(at) == Some(&b':')
                && bytes.get(at + 1) == Some(&b':')
                && bytes.get(at + 2).copied().is_some_and(is_identifier_start);
            if !qualified {
                break;
            }
            at += 2;
        }
        let name = &text[start..at];
        if !NOT_A_TYPE.contains(&name) {
            names.push(name.to_string());
        }
    }
    names
}

/// `names` with every repeat after the first dropped, order kept — one view per type, opened where
/// the declaration first named it.
fn deduplicated(names: Vec<String>) -> Vec<String> {
    let mut kept: Vec<String> = Vec::with_capacity(names.len());
    for name in names {
        if !kept.contains(&name) {
            kept.push(name);
        }
    }
    kept
}

/// The words a declaration writes beside its types that name none of them.
///
/// Specifiers, the two elaborations of a tag name, and the words that stand where a type would be
/// without being one. `void` is not here: a declaration that writes it has written a type name, and
/// what a reader does with a type nothing declares is drop it.
const NOT_A_TYPE: [&str; 25] = [
    "const",
    "volatile",
    "constexpr",
    "consteval",
    "constinit",
    "static",
    "inline",
    "extern",
    "export",
    "virtual",
    "explicit",
    "friend",
    "mutable",
    "typename",
    "class",
    "struct",
    "enum",
    "union",
    "auto",
    "decltype",
    "template",
    "operator",
    "noexcept",
    "requires",
    "thread_local",
];

/// Whether `word` is one of the language's own type names, which an unnamed parameter may be all of.
fn fundamental(word: &str) -> bool {
    matches!(
        word,
        "void"
            | "bool"
            | "char"
            | "char8_t"
            | "char16_t"
            | "char32_t"
            | "wchar_t"
            | "short"
            | "int"
            | "long"
            | "float"
            | "double"
            | "signed"
            | "unsigned"
    )
}

/// Whether `byte` may open an identifier.
fn is_identifier_start(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || byte == b'_'
}

/// The rest of `text` when it opens with `word` at an identifier boundary.
fn word<'a>(text: &'a str, word: &str) -> Option<&'a str> {
    text.strip_prefix(word)
        .filter(|rest| !rest.starts_with(|byte: char| is_identifier_char(byte)))
        .map(str::trim_start)
}

/// The identifier at the front of `text`.
fn identifier(text: &str) -> Option<&str> {
    let text = text.trim_start();
    let end = text
        .find(|byte: char| !is_identifier_char(byte))
        .unwrap_or(text.len());
    (end > 0 && !text.starts_with(|byte: char| byte.is_ascii_digit())).then(|| &text[..end])
}

/// The **last** identifier in `text` — the declarator's own name, once its return type, its
/// qualifiers and its template arguments have been walked past.
fn last_identifier(text: &str) -> Option<&str> {
    let bytes = text.as_bytes();
    let end = bytes
        .iter()
        .rposition(|byte| is_identifier_char(*byte as char))?
        + 1;
    let start = bytes[..end]
        .iter()
        .rposition(|byte| !is_identifier_char(*byte as char))
        .map_or(0, |at| at + 1);
    // A qualified name — `helpers::parse` — is not a declaration of anything this namespace offers,
    // and neither is a digit-led token out of a literal.
    if text[..start].ends_with(':')
        || text[start..end].starts_with(|byte: char| byte.is_ascii_digit())
    {
        return None;
    }
    Some(&text[start..end])
}

/// Whether `byte` may appear inside an identifier.
fn is_identifier_char(byte: char) -> bool {
    byte.is_ascii_alphanumeric() || byte == '_'
}

/// Whether `source` defines an entry point the [shell](super::compile) can call.
///
/// The token `main` in code, followed by an open parenthesis. See this module's own documentation
/// for why that is the question and why it is asked lexically.
pub(super) fn defines_main(source: &str) -> bool {
    let bytes = source.as_bytes();
    let code = code_mask(source);
    let mut at = 0;
    while let Some(found) = find_token(bytes, &code, at, b"main") {
        at = found + 4;
        // Whatever follows, skipping the whitespace and comments a declaration may carry between
        // the name and its parameter list — `int main /* entry */ ()` is one declaration.
        let mut after = at;
        while after < bytes.len() && (!code[after] || bytes[after].is_ascii_whitespace()) {
            after += 1;
        }
        if bytes.get(after) == Some(&b'(') {
            return true;
        }
    }
    false
}

/// The next occurrence of `token` in `bytes` at or after `from` that is **code** and stands on its
/// own — not part of a longer identifier, and not reached through `.`, `->` or `::`.
///
/// The qualification test is what keeps `std::main`-shaped text and `object.main(…)` from counting
/// as a definition of the entry point. It is not a correctness requirement — accepting one would
/// only mean a program that traps instead of being refused — but it is free and it makes the
/// refusal fire on the replies it is for.
fn find_token(bytes: &[u8], code: &[bool], from: usize, token: &[u8]) -> Option<usize> {
    let mut at = from;
    while at + token.len() <= bytes.len() {
        let found = bytes[at..]
            .windows(token.len())
            .position(|window| window == token)?
            + at;
        at = found + 1;
        if !code[found] {
            continue;
        }
        let before = bytes[..found]
            .iter()
            .rposition(|byte| !byte.is_ascii_whitespace());
        let follows = found + token.len();
        let identifier = |byte: u8| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'$';
        if found > 0 && identifier(bytes[found - 1]) {
            continue;
        }
        if bytes.get(follows).is_some_and(|byte| identifier(*byte)) {
            continue;
        }
        // `.main(`, `->main(`, `::main(`: a call or a qualified name, not this program's entry
        // point. `::main` at namespace scope really is the entry point, but a reply that writes it
        // that way also writes the definition it refers to, so nothing is lost by declining here.
        if let Some(before) = before
            && (bytes[before] == b'.'
                || bytes[before] == b':'
                || (bytes[before] == b'>' && before > 0 && bytes[before - 1] == b'-'))
        {
            continue;
        }
        return Some(found);
    }
    None
}

/// A byte-for-byte mask of `source`: `true` where the byte is **code**, `false` where it is inside
/// a string literal, a character literal, a raw string or a comment.
///
/// The [arm's own lexer](super::mask::scan), read leniently. This reader takes the best reading
/// whatever happened to the scan, because the question it answers — does this reply define `main`
/// — has its errors safe in the accepting direction: a program masked wrongly is at worst one that
/// is compiled and traps, which is exactly what not looking at all would have given.
pub(super) fn code_mask(source: &str) -> Vec<bool> {
    super::mask::scan(source).code
}

#[cfg(test)]
#[path = "cpp.source.test.rs"]
mod tests;
