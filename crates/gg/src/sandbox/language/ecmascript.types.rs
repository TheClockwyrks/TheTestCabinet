//! **The type names a declaration writes**, read off the declaration text the
//! [export scan](crate::sandbox::language::ecmascript::exports_of) already quoted.
//!
//! An agent whose [`docViewTypes`](crate::config) flags ask for the types around a function is
//! handed a view of each name that function's declaration writes in return position and in parameter
//! position, one level deep. This is where those names come from on the two ECMAScript arms:
//! [TypeScript](crate::sandbox::language::typescript), whose declarations carry annotations, and
//! [JavaScript](crate::sandbox::language::javascript), whose declarations carry none, so every reading here
//! comes back empty there without anything having to ask which arm it is on.
//!
//! # It reads a type expression, not a program
//!
//! The reading is lexical, like every other scan these arms make of an author's file: brackets are
//! counted, string literals are skipped, and what is left is taken as names. It reports what it can
//! see — a name it never read is a view the model was not offered, and a name it read that resolves
//! to no declaration opens nothing, so the reading errs towards reporting.
//!
//! Two things it deliberately does not report. A **built-in** — `string`, `void`, `unknown` — names
//! no declaration in any module and would widen the `type` search filter to every function that
//! takes text. A **type parameter** is a name the declaration itself binds, so the `T` of
//! `identity<T>(value: T): T` belongs to the signature rather than to anything a model could open.

use super::ModuleExportKind;

/// The type names `declaration` writes in return position and in parameter position, in that order.
///
/// Only a [function](ModuleExportKind::Function) has either: a class has no signature to read and a
/// value's annotation stands in neither position. Both lists come back empty for anything else, and
/// for a declaration whose author wrote no annotation at all.
pub(super) fn types_of(declaration: &str, kind: ModuleExportKind) -> (Vec<String>, Vec<String>) {
    if kind != ModuleExportKind::Function {
        return (Vec::new(), Vec::new());
    }
    let Some((before, list, after)) = parameter_list(declaration) else {
        return (Vec::new(), Vec::new());
    };
    let bound = type_parameters(before);
    let annotated: Vec<&str> = split(list).into_iter().filter_map(annotation).collect();
    let parameters = names(&annotated.join(","), &bound);
    let returns = names(return_annotation(after).unwrap_or_default(), &bound);
    (returns, parameters)
}

/// A declaration split at its parameter list: what stands before the `(`, what stands between it and
/// its own `)`, and what follows.
///
/// The first `(` opens the list on both shapes these arms declare a function in —
/// `function rows(…)` and `const rows = (…) =>` — and the parentheses are counted from there, so a
/// default value's own parentheses do not close it early. A declaration with no parameter list is an
/// arrow written with a bare parameter (`const twice = x => x * 2`), which annotates nothing.
fn parameter_list(declaration: &str) -> Option<(&str, &str, &str)> {
    let open = declaration.find('(')?;
    let rest = &declaration[open + 1..];
    let mut depth = 1usize;
    let mut cursor = 0usize;
    loop {
        let at = cursor + rest[cursor..].find([')', '('])?;
        match rest.as_bytes()[at] {
            b'(' => depth += 1,
            _ => depth -= 1,
        }
        cursor = at + 1;
        if depth == 0 {
            return Some((&declaration[..open], &rest[..at], &rest[cursor..]));
        }
    }
}

/// The names a `<…>` list standing before the parameter list binds.
///
/// One per entry, taken from the identifier each opens with, so `<T extends Row, U = string>` binds
/// `T` and `U`. A bound and a default stand in neither the return nor the parameter position, so
/// nothing else in the list is read.
fn type_parameters(before: &str) -> Vec<String> {
    let Some(open) = before.find('<') else {
        return Vec::new();
    };
    let rest = &before[open + 1..];
    let mut depth = 1usize;
    let mut cursor = 0usize;
    let close = loop {
        // An unclosed list is a declaration the compiler will reject; nothing here guesses.
        let Some(offset) = rest[cursor..].find(['<', '>']) else {
            return Vec::new();
        };
        let at = cursor + offset;
        match rest.as_bytes()[at] {
            b'<' => depth += 1,
            _ => depth -= 1,
        }
        cursor = at + 1;
        if depth == 0 {
            break at;
        }
    };
    split(&rest[..close])
        .into_iter()
        .filter_map(|entry| identifier(entry.trim_start()))
        .map(str::to_string)
        .collect()
}

/// The identifier `text` opens with, or `None` where it opens with something else.
fn identifier(text: &str) -> Option<&str> {
    let end = text
        .find(|c: char| !is_part(c) || c == '.')
        .unwrap_or(text.len());
    (end > 0 && !text.starts_with(|c: char| c.is_ascii_digit())).then(|| &text[..end])
}

/// One parameter's declared type: what stands after its own `:` and before any default value.
///
/// The `:` is looked for at the top level of the parameter, so a destructured parameter's own
/// properties (`{ text, width }: Options`) are not mistaken for it and an unannotated destructuring
/// annotates nothing. The `=` ends it for the same reason: a default value is an expression, and the
/// names in one are values rather than types.
fn annotation(parameter: &str) -> Option<&str> {
    let at = top_level(parameter, |rest| rest.starts_with(':'))?;
    let annotated = &parameter[at + 1..];
    Some(
        match top_level(annotated, |rest| {
            rest.starts_with('=') && !rest.starts_with("=>")
        }) {
            Some(end) => &annotated[..end],
            None => annotated,
        },
    )
}

/// The return annotation standing after a parameter list, or `None` where the declaration writes
/// none.
///
/// It ends at the `=>` that opens an arrow's body, which is the one thing that can follow it on
/// these arms, and runs to the end of the declaration otherwise.
fn return_annotation(after: &str) -> Option<&str> {
    let annotated = after.trim_start().strip_prefix(':')?;
    Some(match top_level(annotated, |rest| rest.starts_with("=>")) {
        Some(end) => &annotated[..end],
        None => annotated,
    })
}

/// `text` split at its top-level commas, with any empty part dropped.
fn split(text: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut from = 0usize;
    while let Some(at) = top_level(&text[from..], |rest| rest.starts_with(',')) {
        parts.push(&text[from..from + at]);
        from += at + 1;
    }
    parts.push(&text[from..]);
    parts.into_iter().filter(|part| !part.is_empty()).collect()
}

/// The byte offset of the first position in `text` outside every bracket and every string literal at
/// which `matches` holds, or `None`.
///
/// `<` and `>` are counted as a pair alongside the other three, because a type argument list carries
/// commas that are not a parameter boundary. The `>` of an `=>` closes nothing, which is what keeps
/// a callback parameter's own arrow from unbalancing the count.
fn top_level(text: &str, matches: impl Fn(&str) -> bool) -> Option<usize> {
    let mut depth = 0usize;
    let mut at = 0usize;
    let mut previous = ' ';
    while let Some(character) = text[at..].chars().next() {
        match character {
            '"' | '\'' | '`' => {
                at = string_end(text, at, character);
                previous = character;
                continue;
            }
            '(' | '[' | '{' | '<' => depth += 1,
            ')' | ']' | '}' => depth = depth.saturating_sub(1),
            '>' if previous != '=' => depth = depth.saturating_sub(1),
            _ => {}
        }
        if depth == 0 && matches(&text[at..]) {
            return Some(at);
        }
        previous = character;
        at += character.len_utf8();
    }
    None
}

/// The offset just past the string literal opening at `at`, or the end of `text` where it never
/// closes.
fn string_end(text: &str, at: usize, quote: char) -> usize {
    let opened = at + quote.len_utf8();
    let mut characters = text[opened..].char_indices();
    while let Some((offset, character)) = characters.next() {
        match character {
            '\\' => {
                characters.next();
            }
            _ if character == quote => return opened + offset + character.len_utf8(),
            _ => {}
        }
    }
    text.len()
}

/// Every type name `text` writes, once each and in the order it writes them.
///
/// A qualified name is reported by its last segment, which is what the declaration it names is filed
/// under. An identifier followed by a `:` is a property of a type literal or the label of a tuple
/// element rather than a type, and the name after `typeof` is a value rather than a type.
fn names(text: &str, bound: &[String]) -> Vec<String> {
    let mut found: Vec<String> = Vec::new();
    let mut at = 0usize;
    let mut after_typeof = false;
    while let Some(character) = text[at..].chars().next() {
        match character {
            '"' | '\'' | '`' => {
                at = string_end(text, at, character);
                continue;
            }
            _ if !is_part(character) || character == '.' => {
                at += character.len_utf8();
                continue;
            }
            _ => {}
        }
        let (path, end) = qualified(text, at);
        at = end;
        let skipped = after_typeof;
        after_typeof = false;
        let Some(name) = path.rsplit('.').next().filter(|name| !name.is_empty()) else {
            continue;
        };
        if name == "typeof" {
            after_typeof = true;
            continue;
        }
        if skipped
            || KEYWORDS.contains(&name)
            || BUILT_IN.contains(&name)
            || name.starts_with(|c: char| c.is_ascii_digit())
            || bound.iter().any(|parameter| parameter == name)
            || text[end..].trim_start().starts_with(':')
            || found.iter().any(|seen| seen == name)
        {
            continue;
        }
        found.push(name.to_string());
    }
    found
}

/// The dotted path starting at `at`, and the offset just past it.
fn qualified(text: &str, at: usize) -> (&str, usize) {
    let end = text[at..]
        .find(|c: char| !is_part(c))
        .map_or(text.len(), |offset| at + offset);
    (text[at..end].trim_end_matches('.'), end)
}

/// Whether `character` may stand inside a qualified type name.
fn is_part(character: char) -> bool {
    character.is_alphanumeric() || character == '_' || character == '$' || character == '.'
}

/// The words a type expression writes that are part of its syntax rather than names of anything.
const KEYWORDS: &[&str] = &[
    "as",
    "asserts",
    "const",
    "extends",
    "in",
    "infer",
    "is",
    "keyof",
    "new",
    "out",
    "readonly",
    "satisfies",
];

/// The types the language itself defines, which name no declaration a documentation view could open.
const BUILT_IN: &[&str] = &[
    "any",
    "bigint",
    "boolean",
    "false",
    "never",
    "null",
    "number",
    "object",
    "string",
    "symbol",
    "this",
    "true",
    "undefined",
    "unknown",
    "void",
];

#[cfg(test)]
#[path = "ecmascript.types.test.rs"]
mod tests;
