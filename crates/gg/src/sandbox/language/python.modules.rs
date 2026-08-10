//! **What a Python code module offers** — reading a [skill](crate::skills)'s or
//! [memory](crate::memories)'s own top level for the names its namespace will carry.
//!
//! # Why there is anything to read at all
//!
//! A Python module's namespace *is* its exports. There is no `export` keyword, nothing for gg to
//! append, and the shim binds `lib.<key>` straight from the names the module body left behind — so
//! [preparing one](super::super::ProgramLanguage::prepare_module) hands the source across untouched. What it cannot
//! hand across untouched is the **list**, because that list is model-facing: the reply that binds a
//! code skill names the key and says what it offers, and a model that is told nothing spends a turn
//! finding out.
//!
//! The seam is explicit that the names travel *beside* the source rather than being recovered from
//! it later, so this is where they are read.
//!
//! # What is read, and the one thing that is deliberately not
//!
//! The module's own **definitions**: `def`, `async def`, `class`, and a top-level assignment to a
//! plain name. Unindented, in code context, in source order, first spelling wins, and a name opening
//! with `_` is private by the language's own convention and is skipped — which is the same rule the
//! shim applies when it builds the namespace.
//!
//! What is **not** reported is a name the module *imported*. `import json` really does put `json`
//! into the namespace, so `lib.helpers.json` really does exist — and saying so would be telling a
//! model about a module it can already `import` itself, under a longer name, as though it were
//! something the skill offers. The list is what the model is *told*, and under-reporting a name that
//! works costs nothing while over-reporting one that does not costs a turn.
//!
//! # None of this is a parser either
//!
//! For [the same reason](super) nothing else on this arm is: there is no host-side Python, and a
//! second implementation of the grammar would be a liability. So this is a line scan over the
//! [dialect's own mask](super::healing), and where it cannot tell, it says nothing — a module whose
//! exports were under-read binds every one of them all the same, because the binding is the guest's.

use crate::healing::{CodeMask, Dialect, lines_with_offsets};

/// Every public name `source`'s top level defines, in source order and without repeats.
pub(super) fn exports(source: &str) -> Vec<String> {
    // An unlexable module is scanned as though it were all code. The mask exists to keep a `def`
    // inside a docstring from being read as a definition; where the lexer lost its place there is
    // nothing better to do than read the lines, and the cost of being wrong is a name in a list
    // rather than a deletion.
    let mask = super::healing::PYTHON_DIALECT.code_mask(source);
    let mut out: Vec<String> = Vec::new();
    for (offset, line) in lines_with_offsets(source) {
        if line.starts_with([' ', '\t']) || !is_code(mask.as_ref(), offset) {
            continue;
        }
        let Some(name) = defined_name(line) else {
            continue;
        };
        if name.starts_with('_') || out.iter().any(|seen| seen == name) {
            continue;
        }
        out.push(name.to_string());
    }
    out
}

/// Whether the byte at `offset` is code, treating an unlexable source as all code.
fn is_code(mask: Option<&CodeMask>, offset: usize) -> bool {
    mask.is_none_or(|mask| mask.is_code(offset))
}

/// The name `line` defines at the module's top level, if it defines one.
fn defined_name(line: &str) -> Option<&str> {
    for keyword in ["def ", "class "] {
        if let Some(rest) = line.strip_prefix(keyword) {
            return identifier(rest.trim_start());
        }
    }
    if let Some(rest) = line.strip_prefix("async ") {
        return identifier(rest.trim_start().strip_prefix("def ")?.trim_start());
    }
    assigned_name(line)
}

/// The name `line` assigns to, when it is a plain top-level assignment.
///
/// `TOTAL = 1` and `TOTAL: int = 1` both count; `rows[0] = 1`, `a, b = 1, 2` and `total += 1` do
/// not. Each of the three is a shape whose target only a parser could name confidently, and a
/// binding gg failed to list is bound by the guest anyway.
fn assigned_name(line: &str) -> Option<&str> {
    let (target, value) = line.split_once('=')?;
    // `==`, `<=`, `!=` — a comparison at a module's top level is a statement that binds nothing.
    if value.starts_with('=') || target.ends_with(['=', '!', '<', '>']) {
        return None;
    }
    let target = target.trim_end();
    // An augmented assignment reads a name that already exists rather than defining one.
    if target.ends_with(|c: char| !c.is_alphanumeric() && c != '_' && c != ':' && c != ']') {
        return None;
    }
    let target = match target.split_once(':') {
        Some((name, _annotation)) => name.trim(),
        None => target,
    };
    identifier(target).filter(|name| *name == target)
}

/// The identifier `text` opens with, or `None`.
fn identifier(text: &str) -> Option<&str> {
    let end = text
        .char_indices()
        .take_while(|(index, c)| {
            if *index == 0 {
                c.is_alphabetic() || *c == '_'
            } else {
                c.is_alphanumeric() || *c == '_'
            }
        })
        .map(|(index, c)| index + c.len_utf8())
        .last()?;
    Some(&text[..end])
}

#[cfg(test)]
#[path = "python.modules.test.rs"]
mod tests;
