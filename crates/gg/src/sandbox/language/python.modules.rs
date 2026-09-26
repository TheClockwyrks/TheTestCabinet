//! **What a Python code module offers** — reading a [skill](crate::skills)'s or
//! [memory](crate::memories)'s own top level for the names its namespace will carry.
//!
//! # Why there is anything to read at all
//!
//! A Python module's namespace *is* its exports. There is no `export` keyword, nothing for gg to
//! append, and the shim registers the module's submodule of `lib` straight from the names the module
//! body left behind — so [preparing one](super::super::ProgramLanguage::prepare_module) hands the
//! source across untouched. What it cannot hand across untouched is the **list**, because that list
//! is what a use of the module turns into [documentation](crate::docs): one view per declaration,
//! rendered from the declaration its author wrote and the prose written on it.
//!
//! The seam is explicit that the names travel *beside* the source rather than being recovered from
//! it later, so this is where they are read.
//!
//! # The types a declaration writes
//!
//! An export also carries the type names its declaration writes in
//! [return](ModuleExport::returns) and [parameter](ModuleExport::parameters) position, which is what
//! an agent's `docViewTypes` flags open beside a function's own view. Python writes them as
//! annotations, so a `def` carries what its author annotated and nothing more: an unannotated one
//! carries neither list, and a `class` or a constant carries neither either, because the flags are
//! read off a function alone.
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
//! [dialect's own mask](super::mask), and where it cannot tell, it says nothing — a module whose
//! exports were under-read binds every one of them all the same, because the binding is the guest's.

use super::super::mask::{CodeMask, lines_with_offsets};

use super::super::{ModuleExport, ModuleExportKind};

/// Every public name `source`'s top level defines, in source order and without repeats.
pub(super) fn exports(source: &str) -> Vec<ModuleExport> {
    // An unlexable module is scanned as though it were all code. The mask exists to keep a `def`
    // inside a docstring from being read as a definition; where the lexer lost its place there is
    // nothing better to do than read the lines, and the cost of being wrong is a name in a list
    // rather than a deletion.
    let mask = super::mask::code_mask(source);
    let lines: Vec<&str> = source.lines().collect();
    let mut out: Vec<ModuleExport> = Vec::new();
    for (number, (offset, line)) in lines_with_offsets(source).enumerate() {
        if line.starts_with([' ', '\t']) || !is_code(mask.as_ref(), offset) {
            continue;
        }
        let Some(name) = defined_name(line) else {
            continue;
        };
        if name.starts_with('_') || out.iter().any(|seen| seen.name == name) {
            continue;
        }
        let kind = kind(line);
        let declaration = head(line);
        let (returns, parameters) = match kind {
            ModuleExportKind::Function => annotated_types(&declaration),
            _ => (Vec::new(), Vec::new()),
        };
        out.push(ModuleExport {
            name: name.to_string(),
            kind,
            declaration,
            doc: doc(&lines, number),
            returns,
            parameters,
        });
    }
    out
}

/// What a program does with the name `line` defines.
fn kind(line: &str) -> ModuleExportKind {
    if line.starts_with("class ") {
        return ModuleExportKind::Type;
    }
    match line.starts_with("def ") || line.starts_with("async ") {
        true => ModuleExportKind::Function,
        false => ModuleExportKind::Value,
    }
}

/// `line` without the body it opens — what a documentation view quotes.
///
/// A `def` and a `class` open their body with the colon that closes the header, so the header is
/// everything up to and including it. The colon is *kept*, because `def widen(text)` without one is
/// not a line of Python and the point of quoting a declaration is that a reader can trust it. An
/// assignment has no body at all: what it binds is what it is, so the whole line is the declaration.
///
/// The colon is looked for at the header's own [top level](depths), so a dict, a `lambda` or a
/// string written as a default value cannot end the header early.
fn head(line: &str) -> String {
    let line = line.trim_end();
    if !(line.starts_with("def ") || line.starts_with("async ") || line.starts_with("class ")) {
        return line.to_string();
    }
    for (at, character, depth) in depths(line) {
        if character == ':' && depth == 0 {
            return line[..=at].to_string();
        }
    }
    line.to_string()
}

/// The type names `declaration` writes in return position and in parameter position.
///
/// Python writes both as **annotations**, and an author annotates or does not: what is read is what
/// they wrote, so an unannotated `def` answers two empty lists and a partly annotated one answers
/// the parameters it annotated. Nothing is inferred from a default value or from a body, because a
/// type gg guessed at would open a documentation view about something the author never named.
///
/// The scan is over one line, which is the [declaration](head) as this arm reads it: a signature
/// wrapped across several lines is read as far as its first line goes, in keeping with the rest of
/// this scan being a line scan rather than a parser.
fn annotated_types(declaration: &str) -> (Vec<String>, Vec<String>) {
    let Some((parameters, after)) = parameter_list(declaration) else {
        return (Vec::new(), Vec::new());
    };
    let returns = return_annotation(after)
        .map(named_types)
        .unwrap_or_default();
    let mut written: Vec<String> = Vec::new();
    for parameter in split_top_level(parameters, ',') {
        let Some(annotation) = parameter_annotation(parameter) else {
            continue;
        };
        for name in named_types(annotation) {
            if !written.contains(&name) {
                written.push(name);
            }
        }
    }
    (returns, written)
}

/// What is between `declaration`'s outermost parentheses, and what follows the closing one.
///
/// `None` for a declaration with no parameter list at all, which on this arm is a `def` whose header
/// ran onto a second line — there is nothing to read rather than something to guess at.
fn parameter_list(declaration: &str) -> Option<(&str, &str)> {
    let open =
        depths(declaration).find(|(_, character, depth)| *character == '(' && *depth == 0)?;
    let close = depths(declaration)
        .skip_while(|(at, _, _)| *at <= open.0)
        .find(|(_, character, depth)| *character == ')' && *depth == 0)?;
    Some((
        &declaration[open.0 + 1..close.0],
        &declaration[close.0 + 1..],
    ))
}

/// The annotation `after` writes after `->`, without the colon that opens the body.
fn return_annotation(after: &str) -> Option<&str> {
    let annotation = after.split_once("->")?.1.trim();
    let annotation = annotation.strip_suffix(':').unwrap_or(annotation).trim();
    (!annotation.is_empty()).then_some(annotation)
}

/// The annotation one `parameter` of a list writes, if it wrote one.
///
/// The default value is cut off first and the annotation read out of what is left, because a colon
/// is written on both sides of an `=`: `rows: dict[str, int] = {}` annotates `dict[str, int]`, and
/// the colon of a `lambda` handed in as a default belongs to the default rather than to a
/// parameter.
fn parameter_annotation(parameter: &str) -> Option<&str> {
    let target = split_top_level(parameter, '=').first().copied()?;
    let annotation = split_top_level(target, ':').get(1).copied()?.trim();
    (!annotation.is_empty()).then_some(annotation)
}

/// `text` cut at every `separator` written at its own top level.
fn split_top_level(text: &str, separator: char) -> Vec<&str> {
    let mut out = Vec::new();
    let mut start = 0usize;
    for (at, character, depth) in depths(text) {
        if character == separator && depth == 0 {
            out.push(&text[start..at]);
            start = at + character.len_utf8();
        }
    }
    out.push(&text[start..]);
    out
}

/// Every character of `text` that is syntax, with the bracket depth it sits **outside** of.
///
/// A string's contents are not syntax and are walked over whole, which is what keeps the `)` of a
/// default value written as `")"` from closing a parameter list and the `:` of an
/// `Annotated[int, "a:b"]` from opening an annotation. A bracket reports the depth around it rather
/// than the one inside it, so a list's own `(` and `)` both read as depth 0.
fn depths(text: &str) -> impl Iterator<Item = (usize, char, usize)> + '_ {
    let mut quote: Option<char> = None;
    let mut escaped = false;
    let mut depth = 0usize;
    text.char_indices().filter_map(move |(at, character)| {
        if let Some(open) = quote {
            match character {
                _ if escaped => escaped = false,
                '\\' => escaped = true,
                _ if character == open => quote = None,
                _ => {}
            }
            return None;
        }
        match character {
            '"' | '\'' => {
                quote = Some(character);
                None
            }
            '(' | '[' | '{' => {
                depth += 1;
                Some((at, character, depth - 1))
            }
            ')' | ']' | '}' => {
                depth = depth.saturating_sub(1);
                Some((at, character, depth))
            }
            _ => Some((at, character, depth)),
        }
    })
}

/// Every type name `annotation` names, in the order it names them and without repeats.
///
/// An annotation is an expression, so what is read out of it are the names in it: `list[Row]` names
/// `list` and `Row`, and each is looked up when a view is opened rather than here. A **quoted**
/// name is a forward reference, which is how Python spells a type declared later in the same file,
/// so a string shaped like a name is one of the names — and a string shaped like anything else is a
/// value inside a `Literal` rather than a type.
///
/// `None` is left out. It is what a function returning nothing annotates, so reading it as a type
/// would file every such function under a type nothing declares.
fn named_types(annotation: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut push = |name: &str| {
        if name != "None" && !out.iter().any(|seen| seen == name) {
            out.push(name.to_string());
        }
    };
    let mut rest = annotation;
    while let Some(character) = rest.chars().next() {
        if character == '"' || character == '\'' {
            let (quoted, tail) = quoted_text(rest, character);
            if let Some(quoted) = quoted.filter(|text| path(text) == Some(*text)) {
                push(quoted);
            }
            rest = tail;
            continue;
        }
        if let Some(named) = path(rest) {
            push(named);
            rest = &rest[named.len()..];
            continue;
        }
        rest = &rest[character.len_utf8()..];
    }
    out
}

/// The string `text` opens with, and what follows it. `None` for one that never closed.
fn quoted_text(text: &str, quote: char) -> (Option<&str>, &str) {
    let opened = &text[quote.len_utf8()..];
    let mut escaped = false;
    for (at, character) in opened.char_indices() {
        match character {
            _ if escaped => escaped = false,
            '\\' => escaped = true,
            _ if character == quote => {
                return (Some(&opened[..at]), &opened[at + character.len_utf8()..]);
            }
            _ => {}
        }
    }
    (None, "")
}

/// The dotted name `text` opens with — `Row`, `models.Row` — or `None` when it opens with anything
/// else.
fn path(text: &str) -> Option<&str> {
    let mut end = identifier(text)?.len();
    while text[end..].starts_with('.') {
        let Some(segment) = identifier(&text[end + 1..]) else {
            break;
        };
        end += 1 + segment.len();
    }
    Some(&text[..end])
}

/// The documentation written on the declaration at `index` — the `#` comment above it, or, failing
/// that, the docstring below it.
///
/// Both, because Python has two and its authors write the second one. A run of `#` above a
/// declaration is the shape [every other arm shares](super::super::comments); a **docstring** is the shape
/// Python itself calls documentation, and it is the first thing *inside* the body rather than
/// anything above it. Reading only the comment would leave nearly every Python module's views empty
/// of the prose its author actually wrote.
fn doc(lines: &[&str], index: usize) -> Option<String> {
    super::super::comments::line_doc(lines, index, &["#"]).or_else(|| docstring(lines, index))
}

/// The docstring opening the body of the declaration on line `index`, if it opens with one.
///
/// The body's first statement, which is what a docstring is: the next line with anything on it. A
/// blank line or a comment in between is walked past, and anything that is not a quoted string ends
/// the search — a declaration whose body begins with code has no docstring, and reading further
/// would be quoting code as prose.
fn docstring(lines: &[&str], index: usize) -> Option<String> {
    let (at, line) = lines
        .iter()
        .enumerate()
        .skip(index + 1)
        .find(|(_, line)| !line.trim().is_empty() && !line.trim_start().starts_with('#'))?;
    let text = line.trim();
    let quote = QUOTES.into_iter().find(|quote| text.starts_with(quote))?;
    let opened = &text[quote.len()..];
    // A one-line docstring closes on the line it opened on.
    if let Some(closed) = opened.strip_suffix(quote) {
        return prose(vec![closed]);
    }
    let mut run: Vec<&str> = vec![opened.trim_end()];
    for line in lines.iter().skip(at + 1) {
        let text = line.trim();
        match text.strip_suffix(quote) {
            Some(last) => {
                run.push(last.trim_end());
                return prose(run);
            }
            None => run.push(text),
        }
    }
    // An unterminated docstring is a module the compiler will reject; nothing here guesses at where
    // its author meant it to end.
    None
}

/// The quotes a docstring may open with, triple first: a `"""` also starts with a `"`, and reading
/// it as the shorter one would close the string on its own opening delimiter.
const QUOTES: [&str; 4] = ["\"\"\"", "'''", "\"", "'"];

/// `run` as one document, or `None` when a docstring held nothing worth showing.
fn prose(run: Vec<&str>) -> Option<String> {
    let text = run.join("\n");
    let text = text.trim_matches('\n').trim_end();
    (!text.trim().is_empty()).then(|| text.to_string())
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
