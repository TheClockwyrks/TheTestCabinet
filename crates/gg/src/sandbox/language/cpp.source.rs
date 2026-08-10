//! **What gg reads out of a model's C++ before handing it to the compiler** — which for a
//! *program* is exactly one thing, whether the reply defines a `main` — and **the one thing gg
//! writes**, which is the namespace a **code module**'s declarations are moved into.
//!
//! Nothing here rewrites a program's text. A C++ program is compiled
//! [verbatim](super::compile::PROGRAM_FILE), so for that half this module is a *reader* rather than
//! a lowering, and the lexer below is the same one the arm's
//! [healing dialect](super::healing) reads a reply with — which is why it masks strings and
//! comments properly rather than scanning the raw bytes.
//!
//! # A code module is a namespace opened around the author's own file
//!
//! A code [skill](crate::skills)'s or [memory](crate::memories)'s namespace is bound at `lib::<key>`
//! for every program the agent writes afterwards, and on a compiled arm that binding is a **link**:
//! the module has to be built into the same artifact as the program that uses it. C++ has a real
//! nested namespace, so the shape is the plainest one any compiled arm here has —
//! [`namespaced`] opens `namespace lib::<key> {` above the author's first line and closes it below
//! their last, and nothing in between is touched:
//!
//! ```text
//! namespace lib::csv_tools {                    // gg's line
//! #line 1 "module_csv_tools.hpp"                // gg's line
//! std::vector<row> parse(std::string_view text, char delimiter = ',') {   // as authored
//! ```
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
//! # The one refusal, and why it is a refusal rather than a rewrite
//!
//! **A `#include` at a module's top level.** `#include` is textual, so one inside a namespace puts
//! the whole of the included header inside `lib::<key>` — and when the header is one the
//! [prelude](super::compile) already read, its include guard is already defined and it expands to
//! *nothing at all*, which is worse: the module would compile, and the same line would detonate the
//! day somebody wrote a header the prelude does not carry.
//!
//! Hoisting it out is the alternative and it is the one thing this arm has never done to anybody's
//! text. It does not need to: the precompiled prelude puts the standard library **and** gg's whole
//! surface in front of a module exactly as it does in front of a program, so a module that includes
//! nothing already has `std::vector` and `files::read_file`. The refusal says that, at the author's
//! own
//! line, and it is the whole of what a module author has to know that a program author does not.
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

use crate::sandbox::PrepareError;

/// The file a code module is compiled under, given its binding key — `module_csv_tools.hpp`.
///
/// A fixed name per key inside a workspace that is private per preparation, on the same terms
/// [`PROGRAM_FILE`](super::compile::PROGRAM_FILE) is. The key is already a C++ identifier
/// ([`binding_name`](super::binding_name)) so it cannot produce a path component that is not one.
///
/// `.hpp` rather than `.cpp` because of how a module reaches a program: it is put in front of the
/// model's file with `clang++ -include`, which is the same thing a header is for and the one way to
/// add a declaration to a translation unit whose first line must stay the model's own.
pub(super) fn module_file(key: &str) -> String {
    format!("{MODULE_FILE_PREFIX}{key}.hpp")
}

/// What a code module's file name begins with — which is also how a diagnostic located in one is
/// told from a diagnostic located in the model's own program.
pub(super) const MODULE_FILE_PREFIX: &str = "module_";

/// The key a module is namespaced under while it is being **checked on its own**, before any program
/// has asked for it.
///
/// A module's own preparation is handed no key — the seam binds one when the module is loaded, not
/// when it is read — so the check compiles it under a fixed one. Which key it is changes nothing it
/// could catch: the wrap is the same shape for every key, and a name that resolves under one
/// resolves under all of them.
pub(super) const CHECK_KEY: &str = "module";

/// A code module's own file: `namespace lib::<key> {`, the author's source verbatim, and the brace
/// that closes it — with a `#line` directive in between so the author's first line is line 1.
///
/// This is what a program's compile writes beside the entry file, and it is **source rather than an
/// artifact** — which is what a linked language's module has to be. A module cannot be compiled into
/// anything reachable on its own: C++ links, so the only artifact a module can end up in is the
/// artifact of a program that was built against it.
///
/// The refusal is [`refuse_include`]'s and is made here rather than at the program's compile,
/// because a module is read once and used by every program the agent writes afterwards — so the
/// author is told at the read, in their own file's coordinates, rather than the model being handed a
/// diagnostic about a file it never wrote.
pub(super) fn namespaced(source: &str, key: &str) -> Result<String, PrepareError> {
    refuse_include(source)?;
    let file = module_file(key);
    // The closing brace is on a line of its own AFTER the author's last, and the newline in front of
    // it is unconditional: a module whose final line is `int last() { return 1; }` with no trailing
    // newline would otherwise have gg's brace glued to it.
    Ok(format!(
        "namespace lib::{key} {{\n#line 1 {}\n{source}\n}}  // namespace lib::{key}\n",
        serde_json::Value::String(file)
    ))
}

/// The refusal a module carrying a `#include` gets, with the author's own line.
///
/// It names what to do instead rather than only what is wrong, because the answer is *delete the
/// line and write nothing in its place* — which is a surprising enough instruction that it has to be
/// said outright.
fn refuse_include(source: &str) -> Result<(), PrepareError> {
    let code = code_mask(source);
    let Some(number) = source
        .split_inclusive('\n')
        .scan(0usize, |offset, line| {
            let start = *offset;
            *offset += line.len();
            Some((start, line))
        })
        .enumerate()
        // The directive's own `#`, which is where the mask is asked: a `#include` behind a `//` or
        // inside a raw string is text rather than a directive, and this arm's lexer is what knows
        // the difference.
        .find(|(_, (start, line))| {
            let hash = start + (line.len() - line.trim_start().len());
            opens_an_include(line) && code.get(hash) == Some(&true)
        })
        .map(|(number, _)| number + 1)
    else {
        return Ok(());
    };
    Err(PrepareError::Unsupported(format!(
        "line {number}: a code module here may not `#include` anything. Its declarations are \
         compiled inside `namespace lib::<key>`, and `#include` is textual — so the header would be \
         pulled into that namespace rather than into the file. Delete the line and write nothing in \
         its place: this sandbox compiles every module against a prelude that already declares the \
         C++ standard library and the whole of gg's own surface, so `std::vector`, `std::format` and \
         `files::read_file` are in scope with no include at all."
    )))
}

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
pub(super) fn exports(source: &str) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    let code = code_mask(source);
    let mut offset = 0usize;
    let mut depth = 0usize;
    for line in source.split_inclusive('\n') {
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
        let Some(name) = declared_name(line.trim_end()) else {
            continue;
        };
        if !names.iter().any(|seen| seen == name) {
            names.push(name.to_string());
        }
    }
    names
}

/// The name `line` declares at namespace scope, if this reading can tell.
fn declared_name(line: &str) -> Option<&str> {
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
            return identifier(rest);
        }
    }
    if let Some(rest) = word(line, "using") {
        // `using row = …` names `row`; `using std::swap;` and `using namespace std;` name nothing
        // this namespace offers.
        return line.contains('=').then(|| identifier(rest)).flatten();
    }
    if word(line, "template").is_some() || word(line, "typedef").is_some() {
        return None;
    }
    // A function or a variable, which is everything left. The declarator's name is the last
    // identifier before the first `(` that opens a parameter list, or before the `=`, `{` or `;`
    // that ends a variable's declarator — so `std::vector<row> parse(std::string_view text)` names
    // `parse` and `constexpr double pi = 3.14;` names `pi`.
    let end = line
        .find(['(', '=', '{', ';'])
        .filter(|at| !line[..*at].ends_with("operator"))?;
    last_identifier(&line[..end])
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
/// The [dialect's own lexer](super::healing::scan), read leniently. That module owns the scan
/// because healing is where the hardest questions are asked of it; what differs is only what the
/// two readers do with a source that did not lex cleanly. Healing
/// [declines](super::healing::code_mask) one, because every strategy that consults a mask is
/// deciding whether to delete text and a reading already known to be wrong is the worst possible
/// basis for that. This reader takes the best reading whatever happened, because the question it
/// answers — does this reply define `main` — has its errors safe in the accepting direction: a
/// program masked wrongly is at worst one that is compiled and traps, which is exactly what not
/// looking at all would have given.
pub(super) fn code_mask(source: &str) -> Vec<bool> {
    super::healing::scan(source).code
}

#[cfg(test)]
#[path = "cpp.source.test.rs"]
mod tests;
