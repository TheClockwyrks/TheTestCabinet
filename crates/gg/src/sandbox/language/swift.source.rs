//! **What gg puts around a code module's Swift**, which is one word on the lines that need it —
//! because a **program** is written around by nothing at all.
//!
//! # A program is not here, and that is the point
//!
//! Every other compiled arm has a wrapper in this position: Rust's program is a function body, the
//! JVM arms' is a class or a script preamble, and each of them pays a line offset for it. Swift's is
//! the model's reply, byte for byte, compiled as `main.swift`. Swift refuses `extension`, `protocol`
//! and `import` inside a function body, so a wrapper of that shape would forbid the construct the
//! language is built around; a top-level file is the only Swift context that admits declarations and
//! bare statements together. See [`compile`](super::compile) for how gg's shell reaches the entry
//! point Swift lowers such a file into.
//!
//! # A code module is a **Swift module of its own**
//!
//! A code [skill](crate::skills)'s or [memory](crate::memories)'s file is compiled by
//! [`compile_module`](super::compile::compile_module) into a Swift module named for the key it is
//! bound under, and the program's compile is handed the `-I` that resolves it and the object it
//! compiled to. That is the mechanism this arm supplies its own SDK through, so the line a program
//! writes to reach an author's module is the line it writes to reach gg's:
//!
//! ```swift
//! import csvTools
//!
//! print(csvTools.parse("a,b", delimiter: ",").cells.count)
//! ```
//!
//! Supplying a module declares no name. A program that writes no import line reaches nothing the
//! module carries, and `swiftc` says so at the line that named it.
//!
//! # The one word gg writes
//!
//! A Swift declaration is `internal` by default, which is invisible across a module boundary — so
//! [`module_source`] writes `public` in front of a top-level declaration whose author wrote no
//! access level. Three properties follow, and they are why it is written *there* rather than
//! anywhere else.
//!
//! **Every line number is preserved.** The word goes in front of the declaration's own modifiers, on
//! the line they stand on, so a diagnostic in a module's file is at the author's own line and only
//! the columns of that one line move.
//!
//! **The declaration keeps everything a Swift declaration has.** Argument labels, default parameter
//! values, generic parameters, `where` clauses, `throws`, overloads: all of it survives, because
//! nothing is re-synthesized — the author's own declaration is what the compiler reads and what a
//! program calls. The shape that would have given those up is *forwarders* — binding each export as
//! a value (`static let parse = csvTools.parse`) inside a namespace of gg's — which loses argument
//! labels and cannot bind an overload or a generic at all. Nothing here forwards.
//!
//! **What the author wrote is left alone.** A `private` or `fileprivate` declaration stays inside
//! the module, an `internal` one means what it says, and a member of a type or of an `extension`
//! carries the access its author gave it, exactly as in any Swift library. gg supplies a level where
//! there was none rather than overriding one.
//!
//! An `import` is a file-scoped declaration in Swift, so a module that calls gg's surface writes
//! `import gg` exactly as a program does, and gg puts no line above the author's first.

use super::super::mask::CodeMask;
use crate::sandbox::{ModuleExport, ModuleExportKind};

use super::mask::{code_mask, declaration_keyword, identifier};

/// The file a code module is compiled from, given its binding key — `module_csvTools.swift`.
///
/// A fixed name per key inside a workspace that is private per preparation, on the same terms
/// [`PROGRAM_FILE`](super::compile::PROGRAM_FILE) is. The key is already a Swift identifier
/// ([`binding_name`](super::binding_name)) so it cannot produce a path component that is not one.
pub(super) fn module_file(key: &str) -> String {
    format!("{MODULE_FILE_PREFIX}{key}.swift")
}

/// What a code module's file name begins with — which is also how a diagnostic located in one is
/// told from a diagnostic located in gg's own inputs.
pub(super) const MODULE_FILE_PREFIX: &str = "module_";

/// The Swift module name a code module is **checked under**, before any program has asked for it.
///
/// A module's own preparation is handed no key — the seam binds one when the module is loaded, not
/// when it is read — so the check compiles it under a fixed one. Which name it is changes nothing it
/// could catch: the file is the same bytes either way, and a declaration that type-checks under one
/// module name type-checks under all of them.
pub(super) const CHECK_MODULE: &str = "module";

/// A code module's own file: the author's source with `public` written in front of each top-level
/// declaration that carries no access level of its own.
///
/// The key is not needed and not taken. The file gg compiles as `csvTools` is byte for byte the file
/// it checked when the module was read, which is what makes that check a check of this.
pub(super) fn module_source(source: &str) -> String {
    let Some(items) = declarations(source) else {
        // The source did not lex, which means an unterminated string or comment, which means
        // `swiftc` is about to say so at the author's own line. Handing it over untouched is what
        // lets it: an access level guessed at from a reading already known to be wrong would put
        // gg's own word in front of the compiler's account of the real fault.
        return source.to_string();
    };
    let lines: Vec<&str> = source.lines().collect();
    let mut public_at: Vec<Option<usize>> = vec![None; lines.len()];
    for item in &items {
        if item.access.is_none() {
            public_at[item.keyword_line] = Some(item.public_at);
        }
    }

    let mut out = String::with_capacity(source.len() + items.len() * 8);
    for (line, at) in lines.iter().zip(public_at) {
        match at {
            Some(at) => {
                out.push_str(&line[..at]);
                out.push_str("public ");
                out.push_str(&line[at..]);
            }
            None => out.push_str(line),
        }
        out.push('\n');
    }
    // A source with no trailing newline is given one rather than losing its last line: `lines()`
    // drops the distinction and nothing downstream depends on it.
    out
}

/// The names a code module offers, in source order — the entries a use of it opens a documentation
/// view of.
///
/// Read from the module's **own source** rather than out of anything the compiler produced, for the
/// reason every other arm reads its own: these are what the skill's author is *told* the module
/// holds, and a second reading of the same fact is a second chance for the two to disagree.
///
/// Every top-level declaration a program can reach is one of them, whatever kind it is — `func`,
/// `struct`, `enum`, `class`, `actor`, `protocol`, `typealias`, `let`, `var` — which is wider than
/// the function lists the interpreted arms report and is right for the same reason Rust's is: a
/// module whose surface is a `struct` and its methods offers that type, and a listing that named
/// only its functions would be describing something else.
///
/// What is **not** listed is what a program could not reach across the module boundary: a
/// declaration its author marked `private`, `fileprivate`, `internal` or `package`, and an
/// `import`, an `extension` or an operator, which name nothing a program imports the module for.
pub(super) fn exports(source: &str) -> Vec<ModuleExport> {
    let Some(items) = declarations(source) else {
        return Vec::new();
    };
    let lines: Vec<&str> = source.lines().collect();
    let mut out: Vec<ModuleExport> = Vec::new();
    for item in items {
        if !item.reachable() {
            continue;
        }
        let Some(name) = item.name else {
            continue;
        };
        if out.iter().any(|seen| seen.name == name) {
            continue;
        }
        let declaration = super::super::heads::head(
            lines
                .get(item.keyword_line)
                .copied()
                .unwrap_or_default()
                .trim(),
        );
        let (returns, parameters) = types(&declaration, item.keyword);
        out.push(ModuleExport {
            name,
            kind: kind(item.keyword),
            // Above the item's **first** line rather than above its keyword: an attribute written on
            // a line of its own stands between the two, and the documentation is above both.
            doc: super::super::comments::block_doc(&lines, item.first)
                .or_else(|| super::super::comments::line_doc(&lines, item.first, &["///", "//"])),
            declaration,
            returns,
            parameters,
        });
    }
    out
}

/// What a program does with the declaration `keyword` opens.
fn kind(keyword: &str) -> ModuleExportKind {
    match keyword {
        "func" => ModuleExportKind::Function,
        "struct" | "class" | "enum" | "actor" | "protocol" | "typealias" => ModuleExportKind::Type,
        _ => ModuleExportKind::Value,
    }
}

// ---------------------------------------------------------------------------------------------
// Reading a module's top level
// ---------------------------------------------------------------------------------------------

/// One top-level declaration of a code module that gg has something to say about.
struct Item {
    /// The 0-based line it starts on — the attribute above it, where one is written on its own line,
    /// since that is where its documentation is written above.
    first: usize,
    /// The 0-based line its declaration keyword and modifiers stand on.
    keyword_line: usize,
    /// The byte offset in that line where `public` goes: in front of the modifiers, and behind any
    /// attribute written on the same line.
    public_at: usize,
    /// The keyword itself, which is what says whether a program calls this, names it, or reads it.
    keyword: &'static str,
    /// The name it declares, when it declares one gg can read.
    name: Option<String>,
    /// The access level its author wrote, and `None` where they wrote none and gg supplies `public`.
    access: Option<&'static str>,
}

impl Item {
    /// Whether a program that imports the module can reach it.
    fn reachable(&self) -> bool {
        matches!(self.access, None | Some("public") | Some("open"))
    }
}

/// Every top-level declaration `source` makes, in order — or `None` when the source did not lex.
///
/// "Top level" is read as *brace depth zero in code context*, which is what the seam's own lexer
/// already answers: [`code_mask`] is the one byte-level reading this arm keeps, so a
/// module and a program are read by one lexer rather than two.
fn declarations(source: &str) -> Option<Vec<Item>> {
    let mask = code_mask(source)?;
    let mut items: Vec<Item> = Vec::new();
    let mut depth = 0usize;
    let mut offset = 0usize;
    // An attribute written on a line of its own — `@discardableResult` above `public func …` —
    // belongs to the declaration below it, and its documentation is written above the attribute. So
    // the line is remembered rather than treated as a declaration of its own, and whatever
    // declaration comes next claims it.
    let mut attribute: Option<usize> = None;
    // `split_inclusive` rather than `lines`, because the offsets below index a mask built over the
    // source's own bytes: a line's terminator is part of what precedes the next one, and a `\r\n`
    // ending would put every offset after the first one out by a byte if the newline were assumed.
    // The line count is the same either way, which is what lets the line *numbers* here be the ones
    // `module_source` writes by.
    for (number, raw) in source.split_inclusive('\n').enumerate() {
        let line = raw.trim_end_matches(['\n', '\r']);
        let indent = line.len() - line.trim_start().len();
        let trimmed = line.trim_start();
        if depth == 0 && mask.is_code(offset + indent) {
            match opens_a_declaration(trimmed, number, indent) {
                Some(Opening::Attribute) => attribute = attribute.or(Some(number)),
                Some(Opening::Declaration(item)) => {
                    let first = attribute.take().unwrap_or(number);
                    if let Some(item) = item {
                        items.push(Item { first, ..item });
                    }
                }
                // A line that opens nothing continues whatever came before it — and, if an attribute
                // was waiting, ends the run rather than letting it reach a declaration further down.
                None if !trimmed.is_empty() => attribute = None,
                None => {}
            }
        }
        for (index, byte) in line.bytes().enumerate() {
            if !mask.is_code(offset + index) {
                continue;
            }
            match byte {
                b'{' => depth += 1,
                b'}' => depth = depth.saturating_sub(1),
                _ => {}
            }
        }
        offset += raw.len();
    }
    Some(items)
}

/// What a top-level line opens.
enum Opening {
    /// An attribute run that fills the line, which decorates whatever declaration comes next.
    Attribute,
    /// A declaration — `None` for one gg [leaves exactly as written](LEFT_AS_WRITTEN), which still
    /// ends the attribute run above it and still continues onto the lines below it.
    Declaration(Option<Item>),
}

/// Whether `line` — trimmed, and standing `indent` bytes into the line it was trimmed from — opens a
/// top-level declaration, and what gg does with it if it does.
///
/// `None` is a line that opens nothing and therefore continues whatever came before it.
fn opens_a_declaration(line: &str, number: usize, indent: usize) -> Option<Opening> {
    let after_attributes = skip_attributes(line);
    if after_attributes.is_empty() {
        // A line of nothing but attributes decorates the declaration below it. An empty line opens
        // nothing at all, and must not be read as one that does.
        return line.starts_with('@').then_some(Opening::Attribute);
    }
    if LEFT_AS_WRITTEN
        .iter()
        .any(|keyword| opens_with(after_attributes, keyword))
    {
        return Some(Opening::Declaration(None));
    }
    let (keyword, after) = declaration_at(after_attributes)?;
    Some(Opening::Declaration(Some(Item {
        first: number,
        keyword_line: number,
        public_at: indent + (line.len() - after_attributes.len()),
        keyword,
        name: identifier(after.trim_start()).map(|(name, _)| name.to_string()),
        access: access_written(after_attributes, keyword),
    })))
}

/// The declaration keyword `text` opens with, and what follows it.
///
/// [`declaration_keyword`] and one recovery: it reads a run of modifiers and stops at the first word
/// that is not one, which a modifier carrying an argument — `private(set) var seen` — is. Such a
/// modifier is stepped over and the read continues behind it.
fn declaration_at(text: &str) -> Option<(&'static str, &str)> {
    let mut rest = text;
    loop {
        if let Some(found) = declaration_keyword(rest) {
            return Some(found);
        }
        let (_, after) = identifier(rest)?;
        if !after.starts_with('(') {
            return None;
        }
        rest = after[closing(after)? + 1..].trim_start();
    }
}

/// `line` with its leading attribute run removed — `@available(*, deprecated) public func f()`
/// becomes `public func f()`.
///
/// An attribute may carry a parenthesised argument, so the parentheses are counted rather than
/// looked for. A line that is nothing but attributes decorates the declaration below it.
fn skip_attributes(line: &str) -> &str {
    let mut rest = line;
    while let Some(after) = rest.strip_prefix('@') {
        let Some((_, after)) = identifier(after) else {
            return rest;
        };
        rest = match after.starts_with('(') {
            true => match closing(after) {
                Some(end) => after[end + 1..].trim_start(),
                None => return rest,
            },
            false => after.trim_start(),
        };
    }
    rest
}

/// The offset of the `)` that closes the `(` `text` opens with.
fn closing(text: &str) -> Option<usize> {
    let mut depth = 0usize;
    for (at, character) in text.char_indices() {
        match character {
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 {
                    return Some(at);
                }
            }
            _ => {}
        }
    }
    None
}

/// The access level written in front of `keyword` in `text`, and `None` where none was.
///
/// `private(set)` is not one: it is the access of a property's *setter*, and a declaration carrying
/// it and nothing else has no access level of its own — which is why the parenthesised form is
/// stepped over rather than read.
fn access_written(text: &str, keyword: &str) -> Option<&'static str> {
    let mut rest = text.trim_start();
    while let Some((word, after)) = identifier(rest) {
        if word == keyword {
            return None;
        }
        let parenthesised = after.starts_with('(');
        if !parenthesised && let Some(level) = ACCESS_LEVELS.iter().find(|level| **level == word) {
            return Some(level);
        }
        rest = match parenthesised {
            true => after[closing(after)? + 1..].trim_start(),
            false => after.trim_start(),
        };
    }
    None
}

/// Every access level Swift spells, which is the set gg reads and never writes over.
const ACCESS_LEVELS: [&str; 6] = [
    "public",
    "open",
    "package",
    "internal",
    "private",
    "fileprivate",
];

/// The declarations gg leaves exactly as they were written.
///
/// An `import` is file-scoped by definition, an `extension` is reached through the type it extends,
/// and an operator or a precedence group is global by design — none of them is a name a program
/// imports the module for, and none of them takes an access level gg would have anything to say
/// about. A `macro` needs a compiler plugin this sandbox has no way to load.
const LEFT_AS_WRITTEN: [&str; 5] = [
    "import",
    "extension",
    "operator",
    "precedencegroup",
    "macro",
];

/// Whether `line` opens with `word` at an identifier boundary — including behind an operator's own
/// placement modifier, since `infix operator ***` opens with `infix`.
fn opens_with(line: &str, word: &str) -> bool {
    let mut rest = line;
    for placement in ["infix", "prefix", "postfix"] {
        if let Some(after) = rest
            .strip_prefix(placement)
            .filter(|after| after.starts_with(char::is_whitespace))
        {
            rest = after.trim_start();
        }
    }
    rest.strip_prefix(word)
        .is_some_and(|after| after.chars().next().is_none_or(|c| !c.is_alphanumeric()))
}

// ---------------------------------------------------------------------------------------------
// The types a declaration writes
// ---------------------------------------------------------------------------------------------

/// The type names `declaration` writes in return position and in parameter position, for an export
/// whose keyword is `keyword`.
///
/// What they are for: an agent whose `docViewTypes` flags ask for the types around a function is
/// given a view of each of these beside the function's own. So a name is worth reporting when a
/// model could open it, which is what decides both readings below.
///
/// A `func` writes both — its parameter list, and whatever follows its `->`. A `let` or a `var`
/// writes one, its type annotation, which is the type reading it hands back. Every other keyword
/// writes neither: a `struct`, an `enum` or a `protocol` **is** the type, and the names in its
/// inheritance clause are what it conforms to rather than anything it returns.
fn types(declaration: &str, keyword: &str) -> (Vec<String>, Vec<String>) {
    match keyword {
        "func" => function_types(declaration),
        "let" | "var" => (annotation(declaration), Vec::new()),
        _ => (Vec::new(), Vec::new()),
    }
}

/// A function's return types and its parameter types, read off its own declaration.
///
/// Everything is located from the `func` keyword forwards, so an attribute carrying a parenthesised
/// argument is not mistaken for the parameter list — and the generic clause is read only where it
/// opens immediately after the name, so the `<` of an `Array<Int>` parameter is not mistaken for one.
fn function_types(declaration: &str) -> (Vec<String>, Vec<String>) {
    let Some(mask) = code_mask(declaration) else {
        return (Vec::new(), Vec::new());
    };
    let Some(after_keyword) = keyword_end(declaration, "func") else {
        return (Vec::new(), Vec::new());
    };
    let after_name = match identifier(declaration[after_keyword..].trim_start()) {
        Some((_, after)) => declaration.len() - after.len(),
        None => after_keyword,
    };
    let (generics, from) = match declaration[after_name..].trim_start().starts_with('<') {
        true => match bracketed(declaration, &mask, after_name, '<', '>') {
            Some((open, close)) => (
                split(declaration, &mask, open + 1, close)
                    .into_iter()
                    .filter_map(|part| {
                        identifier(part.trim_start()).map(|(name, _)| name.to_string())
                    })
                    .collect(),
                close,
            ),
            None => (Vec::new(), after_name),
        },
        false => (Vec::new(), after_name),
    };
    let Some((open, close)) = bracketed(declaration, &mask, from, '(', ')') else {
        return (Vec::new(), Vec::new());
    };
    let parameters = split(declaration, &mask, open + 1, close)
        .into_iter()
        // A parameter is `label name: Type = default`, so its type is what stands between its own
        // first colon and whatever default value follows.
        .filter_map(|part| part.split_once(':').map(|(_, kind)| kind))
        .flat_map(|kind| type_names(kind.split('=').next().unwrap_or(kind), &generics))
        .collect();
    let returns = declaration[close..]
        .split_once("->")
        .map(|(_, kind)| kind)
        // A `where` clause constrains the return type rather than naming another one.
        .map(|kind| kind.split(" where ").next().unwrap_or(kind))
        .map(|kind| type_names(kind, &generics))
        .unwrap_or_default();
    (returns, parameters)
}

/// The offset just past `keyword` in `declaration`, where it stands as a whole word.
fn keyword_end(declaration: &str, keyword: &str) -> Option<usize> {
    declaration
        .match_indices(keyword)
        .find(|(at, _)| {
            let before = declaration[..*at].chars().next_back();
            let after = declaration[at + keyword.len()..].chars().next();
            before.is_none_or(|c| !c.is_alphanumeric() && c != '_')
                && after.is_none_or(|c| !c.is_alphanumeric() && c != '_')
        })
        .map(|(at, _)| at + keyword.len())
}

/// A stored declaration's type annotation — the names between its `:` and whatever value follows.
fn annotation(declaration: &str) -> Vec<String> {
    let Some(mask) = code_mask(declaration) else {
        return Vec::new();
    };
    let Some(at) = declaration
        .char_indices()
        .find(|(at, character)| *character == ':' && mask.is_code(*at))
        .map(|(at, _)| at)
    else {
        return Vec::new();
    };
    let annotated = &declaration[at + 1..];
    type_names(annotated.split('=').next().unwrap_or(annotated), &[])
}

/// The names a type expression writes, minus the declaration's own generic parameters.
///
/// **Capitalised identifiers**, which is what a Swift type is called by every convention the
/// language's own libraries follow. It is what separates a type from the words around it that are
/// not one: `some`, `any`, `inout`, `borrowing`, an argument label and a tuple element's label are
/// all lowercase, and a name gg reported that is not a type is a documentation view a model opens to
/// find nothing.
fn type_names(kind: &str, generics: &[String]) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    let mut rest = kind;
    while !rest.is_empty() {
        let trimmed = rest.trim_start();
        match identifier(trimmed) {
            Some((name, after)) => {
                if name.starts_with(char::is_uppercase)
                    && !generics.iter().any(|generic| generic == name)
                    && !names.iter().any(|seen| seen == name)
                {
                    names.push(name.to_string());
                }
                rest = after;
            }
            None => {
                let mut characters = trimmed.chars();
                characters.next();
                rest = characters.as_str();
            }
        }
    }
    names
}

/// The offsets of the first balanced `open`/`close` pair at or after `from`, in code context.
///
/// `None` where there is no pair, which for `<`/`>` is the ordinary answer: most declarations are
/// not generic, and the `>` of a `->` is not a closing bracket — which is what requiring the
/// **balance** rules out.
fn bracketed(
    text: &str,
    mask: &CodeMask,
    from: usize,
    open: char,
    close: char,
) -> Option<(usize, usize)> {
    let mut opened: Option<usize> = None;
    let mut depth = 0usize;
    for (at, character) in text.char_indices().filter(|(at, _)| *at >= from) {
        if !mask.is_code(at) {
            continue;
        }
        if character == open {
            opened = opened.or(Some(at));
            depth += 1;
        } else if character == close {
            depth = depth.saturating_sub(1);
            if depth == 0
                && let Some(opened_at) = opened
            {
                return Some((opened_at, at));
            }
        }
    }
    None
}

/// `text[from..to]` split on the commas that are its own — outside every bracket and every string.
fn split<'a>(text: &'a str, mask: &CodeMask, from: usize, to: usize) -> Vec<&'a str> {
    let mut parts = Vec::new();
    let mut depth = 0usize;
    let mut opened = from;
    for (at, character) in text
        .char_indices()
        .filter(|(at, _)| *at >= from && *at < to)
    {
        if !mask.is_code(at) {
            continue;
        }
        match character {
            '(' | '[' | '<' => depth += 1,
            ')' | ']' | '>' => depth = depth.saturating_sub(1),
            ',' if depth == 0 => {
                parts.push(&text[opened..at]);
                opened = at + 1;
            }
            _ => {}
        }
    }
    if opened < to {
        parts.push(&text[opened..to]);
    }
    parts
}

#[cfg(test)]
#[path = "swift.source.test.rs"]
mod tests;
