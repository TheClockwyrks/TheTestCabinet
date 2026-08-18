//! **What a PureScript code module offers** — reading a [skill](crate::skills)'s or
//! [memory](crate::memories)'s own header for the names its namespace will carry.
//!
//! # Why there is anything to read at all
//!
//! A PureScript module has a real export protocol, which is more than either of the other compiled
//! arms had: `module Helpers (greet, add) where` says exactly what it offers, and a header with no
//! list — `module Helpers where` — offers everything its top level declares. `purs` honours both,
//! and the bundle's entry module re-exports whatever came out, so the namespace bound at `lib.<key>`
//! is the module's own answer rather than a convention gg imposed.
//!
//! What the compiler cannot supply is the **list**, because that list is model-facing: the reply
//! that binds a code skill names the key and says what it offers, and a model told nothing spends a
//! turn finding out. The seam is explicit that the names travel *beside* the source rather than
//! being recovered from it later, so this is where they are read.
//!
//! # What is read, and the one thing that deliberately is not
//!
//! **Values.** A lower-case name is what `lib.<key>.name` can be written as, so a header's export
//! list contributes its lower-case entries in the order it lists them, and a header with no list
//! contributes every top-level value declaration in source order — `name ::` (a type declaration),
//! `name arg… =` (a definition) and `foreign import name ::`, first spelling wins.
//!
//! **A data constructor is not reported.** `purs` really does export one — `module M (Colour(..))`
//! puts `Red` and `Green` in the emitted JavaScript, and so does a header with no list — but naming
//! it would take reading the `data` declaration the header refers to in order to learn what its arms
//! are, and a code skill whose interface is a bare constructor is a shape that does not occur.
//! Under-reporting is free: a name gg failed to list is bound by the guest all the same. Over-reporting
//! is not, so the constructors are left out rather than guessed at.
//!
//! **An operator is not reported either**, on stronger ground: `lib.<key>.<>` is not a chain a
//! program can write at all.
//!
//! # None of this is a parser
//!
//! `purs` is a process, and the [compile](super::compile) that already runs one is the expensive
//! half of this arm's turn. Reading a list of names must not be a second one. So this is a line scan
//! over the [dialect's own mask](super::healing), and where it cannot tell, it says nothing.

use crate::healing::{CodeMask, Dialect, lines_with_offsets};

use super::super::{ModuleExport, ModuleExportKind};

/// Every name `source`'s namespace offers, in source order and without repeats.
pub(super) fn exports(source: &str) -> Vec<ModuleExport> {
    // An unlexable module is scanned as though it were all code. The mask exists to keep a `data`
    // inside a string literal from being read as a declaration; where the lexer lost its place there
    // is nothing better to do than read the lines, and the cost of being wrong is a name in a list
    // rather than a deletion.
    let mask = super::healing::PURESCRIPT_DIALECT.code_mask(source);
    let declared = declared(source, mask.as_ref());
    match export_list(source, mask.as_ref()) {
        Some(listed) => listed
            .into_iter()
            .map(
                |name| match declared.iter().find(|export| export.name == name) {
                    Some(export) => export.clone(),
                    // A header may list a name this file does not declare — something it imported and
                    // passed on. What its author wrote about it is then the export list entry itself.
                    None => ModuleExport {
                        declaration: name.clone(),
                        name,
                        kind: ModuleExportKind::Value,
                        doc: None,
                        returns: Vec::new(),
                        parameters: Vec::new(),
                    },
                },
            )
            .collect(),
        None => declared,
    }
}

/// The lower-case names a `module … ( … ) where` header lists, or `None` when the header carries no
/// list — which in PureScript means "everything".
///
/// The list may run over as many lines as it likes, so it is read as the byte range between the
/// parenthesis that follows the module name and its match. A header gg cannot find the end of is
/// answered `None`, which falls back to reading the declarations: over-reporting a name the header
/// withheld is a name the model is told about and finds missing, where under-reporting is silence.
fn export_list(source: &str, mask: Option<&CodeMask>) -> Option<Vec<String>> {
    let open = header_list_start(source, mask)?;
    let close = matching_paren(source, mask, open)?;
    let mut out: Vec<String> = Vec::new();
    for entry in split_entries(&source[open + 1..close]) {
        // `Colour(..)`, `class Show2`, `module Gg` and `(<>)` are exports of something a
        // `lib.<key>.` chain cannot reach; `greet` is the one shape it can.
        let Some(name) = value_name(entry) else {
            continue;
        };
        if !out.iter().any(|seen| seen == name) {
            out.push(name.to_string());
        }
    }
    Some(out)
}

/// The offset of the `(` that opens the export list of the module header, or `None` for a header
/// with no list, no header at all, or a header gg cannot read.
fn header_list_start(source: &str, mask: Option<&CodeMask>) -> Option<usize> {
    let bytes = source.as_bytes();
    let mut at = 0;
    // The header is the first code-context `module` at the start of a line; everything above it is
    // comment or blank, both of which the mask and the trim below step over.
    for (offset, line) in lines_with_offsets(source) {
        if line.trim().is_empty() || !is_code(mask, offset) {
            continue;
        }
        at = offset + (line.len() - line.trim_start().len());
        break;
    }
    let rest = source[at..].strip_prefix("module")?;
    if !rest.starts_with(|character: char| character.is_whitespace()) {
        return None;
    }
    let mut cursor = source.len() - rest.len();
    cursor += rest.len() - rest.trim_start().len();
    // The module's own (qualified) name, then whatever follows it.
    while cursor < bytes.len() && is_module_name_byte(bytes[cursor]) {
        cursor += 1;
    }
    let after = source[cursor..].trim_start();
    let at = source.len() - after.len();
    after.starts_with('(').then_some(at)
}

/// Whether a byte may appear in a qualified module name (`Data.Map.Internal`).
fn is_module_name_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'_' || byte == b'\''
}

/// The offset of the `)` that closes the `(` at `open`, counting nesting and skipping anything the
/// mask says is not code.
fn matching_paren(source: &str, mask: Option<&CodeMask>, open: usize) -> Option<usize> {
    let mut depth = 0usize;
    for (offset, byte) in source.bytes().enumerate().skip(open) {
        if !is_code(mask, offset) {
            continue;
        }
        match byte {
            b'(' => depth += 1,
            b')' => {
                depth -= 1;
                if depth == 0 {
                    return Some(offset);
                }
            }
            _ => {}
        }
    }
    None
}

/// The export list's entries: split on the commas that are not inside a nested `( … )`, so
/// `Colour(..)` and `EntryKind(FileEntry, DirEntry)` each stay one entry.
fn split_entries(list: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut depth = 0usize;
    let mut start = 0;
    for (offset, character) in list.char_indices() {
        match character {
            '(' => depth += 1,
            ')' => depth = depth.saturating_sub(1),
            ',' if depth == 0 => {
                out.push(list[start..offset].trim());
                start = offset + 1;
            }
            _ => {}
        }
    }
    out.push(list[start..].trim());
    out
}

/// The value an export-list entry names — a lower-case identifier and nothing else.
fn value_name(entry: &str) -> Option<&str> {
    let name = identifier(entry)?;
    // A `type Colour`, `class Show2` or `module Gg` re-export names something that is not a value.
    if matches!(name, "type" | "class" | "module" | "data" | "kind") {
        return None;
    }
    // `greet` is a value; `Colour` and `Colour(..)` are a type and its constructors.
    let first = name.chars().next()?;
    (first.is_lowercase() || first == '_').then_some(name)
}

/// Every top-level value `source` declares, in source order and without repeats — what a header with
/// no export list offers, and where a header *with* one finds what it listed.
///
/// A value written in the idiomatic two lines — `greet :: String -> String` above
/// `greet who = "hi " <> who` — is **one** declaration, quoted as its signature. First spelling wins,
/// which is what makes that so: the signature is the line an author writes for a reader, and a
/// definition's left-hand side says nothing a caller needs. A value written with no signature is
/// quoted as its definition's head, since that is the only line there is.
fn declared(source: &str, mask: Option<&CodeMask>) -> Vec<ModuleExport> {
    let lines: Vec<&str> = source.lines().collect();
    let mut out: Vec<ModuleExport> = Vec::new();
    for (number, (offset, line)) in lines_with_offsets(source).enumerate() {
        // A declaration is at column zero; anything indented belongs to the one above it.
        if line.starts_with([' ', '\t']) || !is_code(mask, offset) {
            continue;
        }
        let line = line.trim_end();
        let Some(name) = declared_value(line) else {
            continue;
        };
        if out.iter().any(|seen| seen.name == name) {
            continue;
        }
        out.push(ModuleExport {
            name: name.to_string(),
            kind: kind(line),
            declaration: head(line),
            doc: super::super::comments::line_doc(&lines, number, &["-- |", "--"]),
            returns: Vec::new(),
            parameters: Vec::new(),
        });
    }
    out
}

/// What a program does with the value `line` declares.
///
/// PureScript has one namespace-level thing a `lib.<key>.` chain can reach — a value — so the
/// question is only whether that value is one you apply. Its **signature** answers it: a `->` at the
/// top level of a type is a function and nothing else is. A value with no signature is read from its
/// own definition instead, where an argument between the name and the `=` says the same thing.
///
/// A curried function is a function however many arrows it has, and a `Number` is a value however it
/// was computed; neither is a case this has to think about.
fn kind(line: &str) -> ModuleExportKind {
    let line = line.strip_prefix("foreign import ").unwrap_or(line);
    let rest = match line.split_once("::") {
        Some((_, signature)) => return arrow(signature),
        None => line,
    };
    // A definition: `greet who = …` takes an argument and `limit = 10` does not.
    let Some((head, _)) = rest.split_once('=') else {
        return ModuleExportKind::Value;
    };
    match head.split_whitespace().count() > 1 {
        true => ModuleExportKind::Function,
        false => ModuleExportKind::Value,
    }
}

/// Whether `signature` writes a `->` outside any bracket of its own — the arrow that makes a type a
/// function, rather than one inside a parameter's own type or a constraint's.
fn arrow(signature: &str) -> ModuleExportKind {
    let bytes = signature.as_bytes();
    let mut depth = 0usize;
    for (at, byte) in bytes.iter().enumerate() {
        match byte {
            b'(' | b'[' | b'{' => depth += 1,
            b')' | b']' | b'}' => depth = depth.saturating_sub(1),
            b'-' if depth == 0 && bytes.get(at + 1) == Some(&b'>') => {
                return ModuleExportKind::Function;
            }
            _ => {}
        }
    }
    ModuleExportKind::Value
}

/// `line` without the body it opens — what a documentation view quotes.
///
/// A signature has no body, so it is quoted whole. A definition's body is everything after its `=`,
/// and cutting there is right for exactly the definitions that *have* one: `greet who = "hi " <> who`
/// binds an argument, and what a caller needs from it is the name and the arguments and not the
/// expression they are used in.
///
/// A definition binding **no** arguments is a value, and a value's own value is part of its
/// declaration — the same rule the [brace-bodied arms](super::super::heads) keep from the other side.
/// Cutting `limit = 10` at its `=` would quote `limit =`, which is not a line of PureScript and has
/// had the one thing a reader opened the view for taken out of it. The test is the one
/// [`kind`] already applies, so the two readings of a definition cannot disagree.
fn head(line: &str) -> String {
    let line = line.trim_end();
    if line.contains("::") {
        return line.to_string();
    }
    let Some((head, _)) = line.split_once('=') else {
        return line.to_string();
    };
    match head.split_whitespace().count() > 1 {
        true => format!("{} =", head.trim_end()),
        false => line.to_string(),
    }
}

/// The value `line` declares at the module's top level, or `None`.
///
/// Three shapes declare one: `name :: Type`, `name arg… = body`, and `foreign import name :: Type`.
/// The keywords that open a *type*, class or instance declaration are refused first, because
/// `type Alias = Int` is otherwise an assignment whose target is a name.
pub(super) fn declared_value(line: &str) -> Option<&str> {
    let line = match line.strip_prefix("foreign import ") {
        Some(rest) => rest.trim_start(),
        None => line,
    };
    let name = identifier(line)?;
    if DECLARATION_KEYWORDS.contains(&name) {
        return None;
    }
    if !name.starts_with(|character: char| character.is_lowercase() || character == '_') {
        return None;
    }
    let rest = line[name.len()..].trim_start();
    // A type declaration, or a definition — with or without arguments before its `=`.
    if rest.starts_with("::") {
        return Some(name);
    }
    binds(rest).then_some(name)
}

/// The keywords that open a declaration of something other than a value, and which would otherwise
/// read as the name being declared.
const DECLARATION_KEYWORDS: [&str; 10] = [
    "module", "import", "data", "newtype", "type", "class", "instance", "derive", "infixl",
    "infixr",
];

/// Whether `rest` — what follows a declaration's name — reaches a top-level `=` before anything that
/// says this is not a definition.
///
/// The arguments between the name and the `=` are patterns, which may nest (`f (Just x) [y] = …`),
/// so the scan counts brackets and refuses a `=` that is part of `==`, `=>` or `<=`.
fn binds(rest: &str) -> bool {
    let bytes = rest.as_bytes();
    let mut depth = 0usize;
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'(' | b'[' | b'{' => depth += 1,
            b')' | b']' | b'}' => depth = depth.saturating_sub(1),
            b'=' if depth == 0 => {
                let joined = bytes.get(index + 1) == Some(&b'=')
                    || bytes.get(index + 1) == Some(&b'>')
                    || matches!(
                        index.checked_sub(1).map(|at| bytes[at]),
                        Some(b'<' | b'>' | b'/')
                    );
                if !joined {
                    return true;
                }
                index += 1;
            }
            // A line comment ends the declaration's head; a `::` means this was a type declaration
            // and the `=` below belongs to something else.
            b'-' if bytes.get(index + 1) == Some(&b'-') => return false,
            _ => {}
        }
        index += 1;
    }
    false
}

/// The identifier `text` opens with, or `None`.
///
/// PureScript identifiers may carry a prime — `total'` is an ordinary name, and one a program has to
/// be able to write back — so `'` continues a name here where it would open a character literal
/// anywhere else.
fn identifier(text: &str) -> Option<&str> {
    let mut end = 0;
    for (index, character) in text.char_indices() {
        let ok = match index {
            0 => character.is_alphabetic() || character == '_',
            _ => character.is_alphanumeric() || character == '_' || character == '\'',
        };
        if !ok {
            break;
        }
        end = index + character.len_utf8();
    }
    (end > 0).then(|| &text[..end])
}

/// Whether the byte at `offset` is code, treating an unlexable source as all code.
fn is_code(mask: Option<&CodeMask>, offset: usize) -> bool {
    mask.is_none_or(|mask| mask.is_code(offset))
}

#[cfg(test)]
#[path = "purescript.modules.test.rs"]
mod tests;
