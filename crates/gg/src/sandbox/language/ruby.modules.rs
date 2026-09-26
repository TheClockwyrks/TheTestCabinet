//! **What a Ruby code module offers** — reading a [skill](crate::skills)'s or
//! [memory](crate::memories)'s own top level for the names its namespace will carry.
//!
//! # Why there is anything to read at all
//!
//! A Ruby file has no exports. Its top level defines methods on `Object`, which is what `require`
//! gives a Ruby program and exactly not what `lib.<key>` needs — so the
//! [compile step](super::compile::compile_module) wraps the author's source in the call that
//! evaluates it against a fresh anonymous `Module`, and what the body defined is what the namespace
//! offers. There is no export protocol for a skill's author to remember.
//!
//! What the guest cannot supply is the **list**, because that list is model-facing: using a code
//! skill opens a [documentation view](crate::docs) per declaration the module offers, each carrying
//! that declaration and the comment written above it. The seam is explicit that the names travel
//! *beside* the source rather than being recovered from it later, so this is where they are read.
//!
//! # Why a type view is empty here
//!
//! A Ruby `def` writes no types: neither a parameter nor a return position carries one, and a YARD
//! `@param` tag is prose an author may write and usually does not. So an export's
//! [`returns`](super::super::ModuleExport::returns) and
//! [`parameters`](super::super::ModuleExport::parameters) are empty on this arm — there is nothing
//! in a declaration to read them off — and an agent whose `docViewTypes` flags ask for the types
//! around a module function is given the declaration alone.
//!
//! # What is read, and the two things that are deliberately not
//!
//! The module's own **methods**: `def name` and `def self.name`, unindented, in code context, in
//! source order, first spelling wins. Ruby's own privacy is honoured — a bare `private` line makes
//! everything below it private, and `private def name` makes that one method private — because those
//! are the two ways a Ruby author says "not part of my interface", and reporting a private method
//! would tell a model about a call that raises `NoMethodError`.
//!
//! **A constant is not reported**, and this is a fact about how the wrapper evaluates rather than a
//! choice: the author's source is a *block*, and a constant assigned inside a block belongs to the
//! block's lexical scope — the top level — rather than to the module the block is evaluated against.
//! `lib.helpers.LIMIT` does not exist however the file is written, so it is not named.
//!
//! **An `attr_reader` is not reported either**, on the weaker ground that under-reporting is free.
//! It really does define a method on the namespace, but a reader over a module with no instance
//! state is a shape a code skill has no use for, and a name gg failed to list is bound by the guest
//! all the same.
//!
//! # None of this is a parser
//!
//! There is no Ruby on the host that costs less than [a process](super::compile), which is a great
//! deal more than reading a list of names may cost. So this is a line scan over the
//! [dialect's own mask](super::mask), and where it cannot tell, it says nothing.

use super::super::mask::{CodeMask, lines_with_offsets};

use super::super::{ModuleExport, ModuleExportKind};

/// Every public method `source`'s top level defines, in source order and without repeats.
pub(super) fn exports(source: &str) -> Vec<ModuleExport> {
    // An unlexable module is scanned as though it were all code. The mask exists to keep a `def`
    // inside a heredoc from being read as a definition; where the lexer lost its place there is
    // nothing better to do than read the lines, and the cost of being wrong is a name in a list
    // rather than a deletion.
    let mask = super::mask::code_mask(source);
    let lines: Vec<&str> = source.lines().collect();
    let mut out: Vec<ModuleExport> = Vec::new();
    let mut private = false;
    for (number, (offset, line)) in lines_with_offsets(source).enumerate() {
        if line.starts_with([' ', '\t']) || !is_code(mask.as_ref(), offset) {
            continue;
        }
        let trimmed = line.trim();
        // Everything below a bare `private` is private, which is how Ruby's own visibility works.
        if matches!(trimmed, "private" | "protected") {
            private = true;
            continue;
        }
        if matches!(trimmed, "public") {
            private = false;
            continue;
        }
        let Some((name, declared_private)) = defined_method(trimmed) else {
            continue;
        };
        if private || declared_private || out.iter().any(|seen| seen.name == name) {
            continue;
        }
        out.push(ModuleExport {
            name: name.to_string(),
            // Every name this scan reports is a `def`, because a method is the only thing the
            // wrapper's module ends up offering — the module documentation above says why a
            // constant and an `attr_reader` are not here.
            kind: ModuleExportKind::Function,
            declaration: head(trimmed),
            doc: super::super::comments::line_doc(&lines, number, &["#"]),
            // Empty because a Ruby declaration writes no type in either position; the module
            // documentation above says what follows from that.
            returns: Vec::new(),
            parameters: Vec::new(),
        });
    }
    out
}

/// `line` without the body it opens — what a documentation view quotes.
///
/// A `def` line *is* the declaration: Ruby's body starts on the line below, so there is nothing to
/// cut but an endless method's `=`, which opens a body of exactly one expression.
///
/// That `=` is the one **outside** the parameter list, and the distinction is the whole of this
/// function. `def widen(text, width = 8)` writes a default value with an `=` around it in exactly
/// the spelling an endless method uses, so a cut at the first one quotes `def widen(text, width` —
/// a declaration that is not a line of Ruby and whose second parameter has gone missing. An
/// endless method's `=` is at bracket depth zero and a default value's never is.
fn head(line: &str) -> String {
    let mut depth = 0usize;
    let mut cut = None;
    for (at, character) in line.char_indices() {
        match character {
            '(' | '[' | '{' => depth += 1,
            ')' | ']' | '}' => depth = depth.saturating_sub(1),
            // Matched with its spaces, which is also what tells an endless method's `=` from the
            // `=` a name ends in: `def width=(value)` declares a setter and opens no body, and
            // neither does `def ==(other)`.
            ' ' if depth == 0 && line[at..].starts_with(" = ") => {
                cut = Some(at);
                break;
            }
            _ => {}
        }
    }
    cut.map_or(line, |at| &line[..at]).trim_end().to_string()
}

/// Whether the byte at `offset` is code, treating an unlexable source as all code.
fn is_code(mask: Option<&CodeMask>, offset: usize) -> bool {
    mask.is_none_or(|mask| mask.is_code(offset))
}

/// The method `line` defines at the module's top level, and whether it was declared private there —
/// `(name, private)`.
///
/// `def self.name` counts: the wrapper's module extends itself, so an instance method and a
/// singleton method are both reached as `lib.<key>.name`.
fn defined_method(line: &str) -> Option<(&str, bool)> {
    let (rest, private) = match line.strip_prefix("private ") {
        Some(rest) => (rest.trim_start(), true),
        None => (line, false),
    };
    let rest = rest.strip_prefix("def ")?.trim_start();
    let rest = rest.strip_prefix("self.").unwrap_or(rest);
    identifier(rest).map(|name| (name, private))
}

/// The method name `text` opens with, or `None`.
///
/// A trailing `?` or `!` is part of the name — `empty?` and `save!` are what a Ruby author writes and
/// what a program has to type back — and an operator method (`==`, `<<`, `[]`) is not a name a
/// `lib.<key>.` chain can reach, so it is not read.
fn identifier(text: &str) -> Option<&str> {
    let mut end = 0;
    for (index, character) in text.char_indices() {
        let ok = match index {
            0 => character.is_alphabetic() || character == '_',
            _ => character.is_alphanumeric() || character == '_',
        };
        if !ok {
            // One `?` or `!` may end a method name, and nothing may follow it.
            if index > 0 && (character == '?' || character == '!') {
                end = index + character.len_utf8();
            }
            break;
        }
        end = index + character.len_utf8();
    }
    (end > 0).then(|| &text[..end])
}

#[cfg(test)]
#[path = "ruby.modules.test.rs"]
mod tests;
