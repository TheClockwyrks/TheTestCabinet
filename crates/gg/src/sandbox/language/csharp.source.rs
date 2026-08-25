//! What gg writes around a **code module**, and the lexer that lets it look at C# without parsing it.
//!
//! A model's **program** is not here at all, and that is the point: this arm compiles a reply
//! [verbatim](super::compile), so there is nothing to wrap, no line to shift and no offset to
//! subtract. Everything below is about the other source a C# preparation can be handed — a code
//! [skill](crate::skills)'s or [memory](crate::memories)'s module.
//!
//! # Where an author's declarations land, and why it is a class rather than a namespace
//!
//! A module's namespace is bound at `lib.<key>` for every program the agent writes afterwards. Every
//! other arm answers "what is `lib.<key>`?" with the thing its language uses to hold functions:
//! C++'s is a `namespace`, Rust's a `mod`, Python's a module object. **C# has no free functions at
//! all** — a function is a member of a type, and a namespace may hold only types — so
//! `namespace lib.CsvTools { … }` would be a namespace nobody could call anything on, and the model
//! would have to write `lib.CsvTools.Helpers.Slugify(…)` with `Helpers` a name only the skill's
//! author knows.
//!
//! So `lib.<key>` is a **`static class`**, in `namespace lib`, and a module is that class's **body**:
//!
//! ```text
//! namespace lib;                                  // gg's line
//! #line 4 "module_CsvTools.cs"                    // gg's line
//! using System.Text;                              // as authored, on the author's own line 4
//! #line default                                   // gg's line
//! public static class CsvTools                    // gg's line
//! {                                               // gg's line
//! #line 1 "module_CsvTools.cs"                    // gg's line
//! public static string Slugify(string text) => …  // as authored, on the author's own line 1
//! ```
//!
//! It is the shape a C# author already writes when they write a file of helpers, and it is
//! [Java](super::super::java)'s answer to the same problem for the same reason — that arm's module is
//! a class body too, and its `public static` methods are what `lib.<key>` offers.
//!
//! What [`compile`](super::compile) does with that unit is compile it into `lib.<key>.dll` and hand
//! the program `-r:` of it, which is the supply gg's own SDK gets. So a program reaches
//! `lib.CsvTools.Slugify` by writing the whole path and reaches `CsvTools.Slugify` after writing
//! `using lib;` of its own.
//!
//! # Why no line moves
//!
//! **`#line`.** C# is one of the two languages in this study with a line-control directive — the
//! other is [C++](super::super::cpp) — so gg *says* what the author's first line is instead of
//! subtracting a header's height from every diagnostic afterwards. A module's own compile therefore
//! reports `module_CsvTools.cs(3,17)` at the author's line 3, whatever gg wrote above it, and this
//! arm keeps the property it has for programs: there is no offset arithmetic anywhere in it.
//!
//! # The one thing that is moved, and the two that are refused
//!
//! **A `using` directive is hoisted**, because a C# file begins with its `using` lines and inside a
//! class body every one of them is a syntax error. They are moved rather than refused, exactly as
//! [Java](super::super::java)'s `import`s are, and each is given a `#line` of its own so that a
//! `using` naming a namespace this guest does not carry is reported at the line the author wrote it
//! on. Only the run of them at the **top** of the file is taken: a `using var stream = …;` — C#'s
//! other meaning for the word — is a statement inside a method and cannot be in that run.
//!
//! **A `namespace` declaration is refused**, because a module is a class body and there is nowhere
//! for a namespace to be. Silently dropping one would leave an author wondering why their own type
//! names did not resolve.
//!
//! **A `global using` is refused**, because it may only appear at the top of a compilation unit and
//! a module is compiled inside one. The message names `using` as the answer, which is what the
//! author meant, and an ordinary `using` is hoisted to where it applies to the whole module.
//!
//! # Why gg looks at C# lexically at all
//!
//! Because three of the questions above are asked of *bytes* rather than of a parse: which line a
//! `using` is on, which brace is a class body's and which is inside a string, and what a module
//! offers. [`mask`] answers them by classifying every byte as code, string-ish text, or the inside of
//! an interpolation hole — which is code again. Where it cannot tell what a line declares it reports
//! nothing, which is the safe direction: an unlisted export is a call the model was not told about
//! and the compiler still resolves, where a wrong one is a name that does not exist.

use crate::sandbox::{ModuleExport, ModuleExportKind, PrepareError, PrepareFailure};

/// The namespace every code module's class is declared in — the `lib` of `lib.<key>`.
///
/// Lower-case, which no C# style guide would write and which this arm does not get to choose: the
/// binding is identity (`language/agreement.rs`), shared with every other arm, and a namespace
/// called `Lib` would be a different one.
pub(super) const NAMESPACE: &str = "lib";

/// What a code module's file is called inside a preparation's own workspace — which is also how a
/// diagnostic located in one is told from a diagnostic located in the model's own program.
pub(super) const MODULE_FILE_PREFIX: &str = "module_";

/// A code module's file name, for a module bound at `lib.<key>`.
///
/// A fixed name per key inside a workspace that is private per preparation, on the same terms
/// [`PROGRAM_FILE`](super::compile::PROGRAM_FILE) is. The key is already a C# identifier
/// ([`binding_name`]) so it cannot produce a path component that is not one.
pub(super) fn module_file(key: &str) -> String {
    format!("{MODULE_FILE_PREFIX}{key}.cs")
}

/// The key a module is wrapped under while it is being **checked on its own**, before any program has
/// asked for it.
///
/// A module's own preparation is handed no key — the seam binds one when the module is loaded, not
/// when it is read — so the check compiles it under a fixed one. Which key it is changes nothing the
/// check could catch: the wrap is the same shape for every key, and a member that resolves under one
/// resolves under all of them.
pub(super) const CHECK_KEY: &str = "Module";

/// A code module, lowered: the compilation unit `csc` reads, and the names its class offers.
#[derive(Debug)]
pub(super) struct Module {
    /// `namespace lib;`, the hoisted `using` lines, and the author's own body inside
    /// `public static class <key>`.
    pub source: String,
    /// What `lib.<key>` offers, in source order.
    pub exports: Vec<ModuleExport>,
}

/// The identifier a code [skill](crate::skills) or [memory](crate::memories) called `name` is bound
/// at — the `<key>` of `lib.<key>`, spelled the way C# spells the thing it becomes.
///
/// **`PascalCase`, because here the key names a `type`.** Every other arm's key names a namespace or
/// a module and is spelled in that language's namespace convention; this one is a `static class`, and
/// a class called `csv_tools` is a thing no C# author would write beside `Enumerable` and
/// `JsonSerializer`.
///
/// It also closes a hole no other arm's spelling can: **every C# keyword is lower-case**, so a
/// PascalCase key can never collide with one. A skill called `class` or `string` binds at `lib.Class`
/// and `lib.String` and compiles, where a lower-cased key would have needed a `@` nobody would think
/// to type at the call site.
///
/// A name with no alphanumerics at all is `Module`, and one beginning with a digit is prefixed with
/// an underscore — the two cases an identifier must not have.
pub(super) fn binding_name(name: &str) -> String {
    let mut out = String::new();
    let mut capitalize = true;
    for character in name.chars() {
        if character.is_ascii_alphanumeric() {
            match capitalize {
                true => out.extend(character.to_uppercase()),
                false => out.push(character),
            }
            capitalize = false;
        } else {
            capitalize = true;
        }
    }
    if out.is_empty() {
        return CHECK_KEY.to_string();
    }
    if out.starts_with(|character: char| character.is_ascii_digit()) {
        out.insert(0, '_');
    }
    out
}

/// Lower a code module's source into the compilation unit `csc` reads, and read the names its class
/// will offer.
///
/// `key` is the `<key>` of `lib.<key>`, already through [`binding_name`].
pub(super) fn wrap_module(source: &str, key: &str) -> Result<Module, PrepareFailure> {
    let import = super::SURFACE_IMPORT;
    let (body, usings) = hoist(source, &mask(source))?;
    // Re-lexed rather than re-used: a hoisted `using` leaves a blank line behind, so every byte
    // after the first one is at a different offset in the body than it was in the file, and a mask
    // read at the old offsets would answer about the wrong bytes.
    let exports = exports(&body, &mask(&body));
    if exports.is_empty() {
        return Err(PrepareFailure::Program(PrepareError::Unsupported(format!(
            "this module offers nothing: gg binds a code module's `public` members at `lib.<key>`, \
             and there are none. A module here is the body of a `static class`, so declare at \
             least one, as `public static string Greet(string who) => $\"hello {{who}}\";`. \
             Everything that is not `public` is the module's own business, exactly as it is in any \
             C# class — and gg's surface is reached here as it is in a program, by writing \
             `{import}` at the top of this module or by writing `Gg.Views.OpenText` in full."
        ))));
    }

    let file = module_file(key);
    let quoted = serde_json::Value::String(file);
    let mut unit = format!("namespace {NAMESPACE};\n");
    for (line, directive) in &usings {
        // Its own `#line`, so a `using` naming something this guest does not carry is reported where
        // the author wrote it rather than where gg moved it to.
        unit.push_str(&format!(
            "#line {line} {quoted}\n{directive}\n#line default\n"
        ));
    }
    unit.push_str(&format!("public static class {key}\n{{\n"));
    unit.push_str(&format!("#line 1 {quoted}\n"));
    unit.push_str(&body);
    // Unconditional, so a body whose last line has no terminator does not get gg's `#line` glued to
    // it — and `#line default` so the brace below is reported where it really is.
    if !body.ends_with('\n') {
        unit.push('\n');
    }
    unit.push_str("#line default\n}\n");

    Ok(Module {
        source: unit,
        exports,
    })
}

// ---------------------------------------------------------------------------------------------
// The `using` hoist
// ---------------------------------------------------------------------------------------------

/// Lift the run of `using` directives at the top of a module into the compilation unit, leaving a
/// blank line where each stood, and refuse the two declarations that have nowhere to go.
///
/// Only the **leading** run, and that is what makes this safe without a parser: `using` is also how
/// C# spells a disposable's scope (`using var stream = File.OpenRead(path);`), and that spelling is a
/// statement inside a method body — which cannot be the first thing in a class body. Blank lines and
/// comments are part of the run, because a file that opens with a licence header still opens with
/// its `using`s.
///
/// Each hoisted line comes back with the 1-based line it was written on, which is what
/// [`wrap_module`] gives back to it with a `#line`.
fn hoist(source: &str, mask: &[Mask]) -> Result<(String, Vec<(usize, String)>), PrepareFailure> {
    let mut body = String::with_capacity(source.len());
    let mut usings = Vec::new();
    let mut leading = true;
    let mut at = 0usize;
    for (index, line) in source.split_inclusive('\n').enumerate() {
        let start = at;
        at += line.len();
        let trimmed = line.trim();
        let offset = line.len() - line.trim_start().len();
        // Only a line that *starts* in code is a candidate: the first byte of `using` inside a raw
        // string literal is text, and so is a commented-out one.
        let code = mask.get(start + offset) == Some(&Mask::Code);
        if trimmed.is_empty() || !code {
            body.push_str(line);
            continue;
        }
        if let Some(rest) = keyword(trimmed, "namespace") {
            return Err(refusal(format!(
                "line {}: a code module here is the body of a `static class` — gg compiles it as \
                 `public static class {}`, inside `namespace {NAMESPACE}` — so `namespace {}` has \
                 nowhere to go. Remove it: everything you declare is already reached as \
                 `lib.<key>.<name>`, and a type you want to nest is an ordinary nested type.",
                index + 1,
                CHECK_KEY,
                rest.trim_end_matches(&[';', '{'][..]).trim(),
            )));
        }
        if keyword(trimmed, "global")
            .is_some_and(|rest| keyword(rest.trim_start(), "using").is_some())
        {
            return Err(refusal(format!(
                "line {}: a `global using` may only appear at the top of a whole compilation unit, \
                 and this module is compiled inside one gg wrote. Write it as an ordinary `using` \
                 instead — gg lifts the `using` lines at the top of a module out of the class body \
                 for you, so it will apply to everything below it.",
                index + 1,
            )));
        }
        match keyword(trimmed, "using").filter(|_| leading && trimmed.ends_with(';')) {
            Some(_) => {
                usings.push((index + 1, trimmed.to_string()));
                // The line's own terminator is kept, so the body has exactly as many lines as the
                // author wrote — which is what makes the `#line 1` above the body true all the way
                // down.
                body.push_str(match line.ends_with('\n') {
                    true => "\n",
                    false => "",
                });
            }
            None => {
                leading = false;
                body.push_str(line);
            }
        }
    }
    Ok((body, usings))
}

/// A refusal the author of the skill or memory reads, on the call that tried to use it.
fn refusal(message: String) -> PrepareFailure {
    PrepareFailure::Program(PrepareError::Unsupported(message))
}

/// The rest of `line` when it opens with `word` followed by whitespace — `None` otherwise, so
/// `usingTheThing()` is not read as a `using`.
fn keyword<'a>(line: &'a str, word: &str) -> Option<&'a str> {
    line.strip_prefix(word)
        .filter(|rest| rest.starts_with(char::is_whitespace))
}

// ---------------------------------------------------------------------------------------------
// The export scan
// ---------------------------------------------------------------------------------------------

/// The names `lib.<key>` offers: every `public` declaration at the **top level of the class body**,
/// in source order.
///
/// A member and a nested type both count, and both are true: `lib.CsvTools.Parse` and
/// `lib.CsvTools.Row` are equally things a program writes, so listing only the methods would tell a
/// model half of what it was handed. Anything that is not `public` is the module's own business,
/// which is the visibility rule a C# author already writes.
///
/// Read from the byte mask rather than from a parse, so a `public` inside a string or a comment is
/// not one, and a `public` nested inside another declaration is at a depth this does not report. A
/// line it cannot make a name out of is skipped rather than guessed at.
fn exports(body: &str, mask: &[Mask]) -> Vec<ModuleExport> {
    let mut names: Vec<ModuleExport> = Vec::new();
    let lines: Vec<&str> = body.lines().collect();
    let mut depth = 0usize;
    let mut at = 0usize;
    for (number, line) in body.split_inclusive('\n').enumerate() {
        let start = at;
        at += line.len();
        let offset = line.len() - line.trim_start().len();
        let outermost = depth == 0;
        for (index, byte) in line.bytes().enumerate() {
            // A brace inside a literal is text, and one inside an interpolation hole belongs to that
            // hole rather than to the class body.
            if mask.get(start + index) != Some(&Mask::Code) {
                continue;
            }
            match byte {
                b'{' => depth += 1,
                b'}' => depth = depth.saturating_sub(1),
                _ => {}
            }
        }
        if !outermost || mask.get(start + offset) != Some(&Mask::Code) {
            continue;
        }
        if let Some((name, kind)) = declared_name(line.trim()) {
            let (returns, parameters) = declared_types(line.trim());
            names.push(ModuleExport {
                name,
                kind,
                declaration: super::super::heads::head(line.trim()),
                // Above the declaration, past the attribute lines a C# author writes between the
                // two: `[Obsolete]` under three lines of `///` has not detached them.
                doc: {
                    let above =
                        super::super::comments::above(&lines, number, |line| line.starts_with('['));
                    super::super::comments::line_doc(&lines, above, &["///", "//"])
                        .or_else(|| super::super::comments::block_doc(&lines, above))
                },
                returns,
                parameters,
            });
        }
    }
    names
}

/// Modifiers a `public` declaration may carry before the thing that names it.
const MODIFIERS: &[&str] = &[
    "public", "static", "readonly", "const", "partial", "sealed", "abstract", "virtual",
    "override", "new", "unsafe", "extern", "required", "volatile", "ref",
    // A `delegate` names its identifier the way a method does — after a return type — so it is read
    // as a member rather than as one of the type keywords below.
    "delegate",
];

/// The kinds of declaration whose name is the identifier that follows the keyword.
const TYPE_KEYWORDS: &[&str] = &["class", "record", "struct", "enum", "interface"];

/// The name a `public` line declares and what a program does with it, or `None` for a line this
/// cannot read.
///
/// Two shapes, which is all a class body has: a **type**, whose name follows its keyword, and a
/// **member**, whose name is the last identifier before its parameter list or its initialiser. The
/// generic argument lists are cut out first, so `public static T First<T>(…)` names `First` rather
/// than `T`.
///
/// Which kind a member is comes off the same cut: a parameter list is what makes a member a method,
/// and a member with none is a field or a property — something a program reads.
fn declared_name(line: &str) -> Option<(String, ModuleExportKind)> {
    let mut words = line.split_whitespace().peekable();
    if words.peek() != Some(&"public") {
        return None;
    }
    // Everything up to the parameter list, the initialiser or the body — whichever comes first.
    let cut = line
        .find(['(', '=', '{', ';'])
        .unwrap_or(line.len())
        .min(line.find("=>").unwrap_or(line.len()));
    let member = line[cut..].starts_with('(');
    let head: String = without_generics(&line[..cut]);
    let mut tokens = head
        .split(|character: char| !(character.is_alphanumeric() || character == '_'))
        .filter(|token| !token.is_empty())
        .peekable();

    let mut seen = Vec::new();
    while let Some(token) = tokens.next() {
        if MODIFIERS.contains(&token) {
            continue;
        }
        if TYPE_KEYWORDS.contains(&token) {
            // `record class` and `record struct` name the identifier after the second word.
            let next = tokens.next()?;
            let name = match TYPE_KEYWORDS.contains(&next) {
                true => tokens.next()?,
                false => next,
            };
            return Some((name.to_string(), ModuleExportKind::Type));
        }
        seen.push(token);
    }
    // A member: its type, then its name. One token alone is a return type with no name — a line this
    // cannot read, which is reported as nothing rather than guessed at.
    // A `delegate` is read like a method — its name follows a return type — and is a **type** all
    // the same: a program names it where a parameter's type goes rather than calling it.
    let kind = match (
        line.split_whitespace().any(|word| word == "delegate"),
        member,
    ) {
        (true, _) => ModuleExportKind::Type,
        (false, true) => ModuleExportKind::Function,
        (false, false) => ModuleExportKind::Value,
    };
    (seen.len() >= 2).then(|| (seen[seen.len() - 1].to_string(), kind))
}

/// **The type names a declaration writes**, in return position and in parameter position.
///
/// What they are for: an agent whose `docViewTypes` flags ask for the types around a function is
/// given a documentation view of each of these, one level deep, so the shape a call hands back is
/// documented beside the call. They are resolved by **simple name** against the module's own exports
/// and gg's catalogue, so what is read here is every identifier a type position spells —
/// `IReadOnlyList<Entry>` is `IReadOnlyList` and `Entry`, and whichever of the two names something
/// is what opens.
///
/// The **return** names are what stands between the modifiers and the declared name, so a type
/// declaration has none: `public sealed record Entry(…)` returns nothing, and its positional
/// parameters are read the way a method's are.
///
/// The **parameter** names are read one parameter at a time, because the last identifier in a
/// parameter is its own name rather than a type. A default value is cut off first, so a `string` in
/// one is text and not a type.
///
/// C#'s built-in type keywords are left out. They name no declaration a view could be opened on, and
/// a list of them would be noise in front of the names that do.
fn declared_types(line: &str) -> (Vec<String>, Vec<String>) {
    let code = mask(line);
    let readable = |at: usize| code.get(at) == Some(&Mask::Code);
    let cut = line
        .find(|character| "(={;".contains(character))
        .unwrap_or(line.len())
        .min(line.find("=>").unwrap_or(line.len()));
    let head = &line[..cut];

    let declaration = declared_name(line);
    let returns = match declaration {
        // A type names itself, which is not a type it writes.
        Some((_, ModuleExportKind::Type))
            if !line.split_whitespace().any(|word| word == "delegate") =>
        {
            Vec::new()
        }
        Some((name, _)) => {
            let mut named = identifiers(head, 0, &readable);
            // The declared name is the last identifier the head spells outside its generic
            // parameters, and it is the one identifier here that is not a type.
            if let Some(at) = named.iter().rposition(|found| *found == name) {
                named.remove(at);
            }
            named
        }
        None => Vec::new(),
    };

    let parameters = match line[cut..].starts_with('(') {
        false => Vec::new(),
        true => {
            let mut named = Vec::new();
            for (at, parameter) in parameter_list(line, cut, &readable) {
                let mut spelled = identifiers(&parameter, at, &readable);
                // The parameter's own name, which every parameter that has a type ends with.
                spelled.pop();
                named.extend(spelled);
            }
            named
        }
    };
    (dedupe(returns), dedupe(parameters))
}

/// The identifiers `text` spells, in order, skipping the bytes `readable` says are not code and the
/// words that name something other than a type.
///
/// `at` is where `text` begins in the line `readable` answers about, so a fragment taken out of the
/// middle of a declaration is still read against the right bytes.
fn identifiers(text: &str, at: usize, readable: &impl Fn(usize) -> bool) -> Vec<String> {
    let mut found = Vec::new();
    let mut current = String::new();
    let mut start = 0usize;
    for (offset, character) in text.char_indices() {
        match character.is_alphanumeric() || character == '_' {
            true => {
                if current.is_empty() {
                    start = offset;
                }
                current.push(character);
            }
            false => {
                take(&mut found, &current, at + start, readable);
                current.clear();
            }
        }
    }
    take(&mut found, &current, at + start, readable);
    found
}

/// Keep one identifier if it is code and names a type rather than a keyword.
fn take(found: &mut Vec<String>, word: &str, at: usize, readable: &impl Fn(usize) -> bool) {
    if word.is_empty() || !readable(at) {
        return;
    }
    if MODIFIERS.contains(&word) || TYPE_KEYWORDS.contains(&word) || BUILT_IN_TYPES.contains(&word)
    {
        return;
    }
    found.push(word.to_string());
}

/// The parameters of the list opening at `at`, one at a time, each with where it begins in the line.
///
/// Split on the commas of the list itself: a comma inside `<…>`, inside a nested call in a default
/// value, or inside a literal belongs to something else. A default value is cut off, so what comes
/// back is the parameter's modifiers, its type and its name.
fn parameter_list(
    line: &str,
    at: usize,
    readable: &impl Fn(usize) -> bool,
) -> Vec<(usize, String)> {
    let mut parameters = Vec::new();
    let mut current = String::new();
    let mut start = at + 1;
    let mut depth = 0usize;
    for (offset, character) in line[at..].char_indices() {
        let index = at + offset;
        let nested = readable(index).then_some(character);
        match nested {
            Some('(' | '<' | '[') => depth += 1,
            Some(')' | '>' | ']') => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    parameters.push((start, current));
                    return parameters;
                }
            }
            Some(',') if depth == 1 => {
                parameters.push((start, std::mem::take(&mut current)));
                start = index + 1;
                continue;
            }
            _ => {}
        }
        if index > at {
            current.push(character);
        }
    }
    parameters.push((start, current));
    parameters
}

/// One copy of each name, in the order they were read.
fn dedupe(named: Vec<String>) -> Vec<String> {
    let mut seen: Vec<String> = Vec::new();
    for name in named {
        if !seen.contains(&name) {
            seen.push(name);
        }
    }
    seen
}

/// The type keywords C# builds in, which name nothing a documentation view could be opened on.
const BUILT_IN_TYPES: &[&str] = &[
    "void", "var", "bool", "byte", "sbyte", "char", "decimal", "double", "float", "int", "uint",
    "nint", "nuint", "long", "ulong", "short", "ushort", "object", "string", "dynamic", "this",
    "params", "out", "in", "scoped",
];

/// `line` with every `<…>` cut out, so the identifiers left are the declaration's own.
fn without_generics(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut depth = 0usize;
    for character in line.chars() {
        match character {
            '<' => depth += 1,
            '>' => depth = depth.saturating_sub(1),
            _ if depth == 0 => out.push(character),
            _ => {}
        }
    }
    out
}

// ---------------------------------------------------------------------------------------------
// The lexer
// ---------------------------------------------------------------------------------------------

/// What one byte of a C# source is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Mask {
    /// Code: a declaration, an operator, whitespace between them.
    Code,
    /// Inside a string or character literal, or inside a comment — not code, whatever it spells.
    Text,
    /// Inside an interpolation hole — `{…}` in a `$"…"`. It **is** code, and is kept apart from
    /// [`Code`](Self::Code) only because its braces are the hole's rather than a class body's.
    Hole,
}

/// What one pass of this arm's lexer found: what every byte is.
///
/// Always the scan's best reading, even where the source did not lex cleanly: its readers —
/// [`wrap_module`] and its helpers — have their errors safe in the accepting direction, since an
/// unlisted export is a call the model was not told about and the compiler still resolves.
pub(super) struct Scan {
    /// What every byte is.
    pub(super) mask: Vec<Mask>,
}

/// Classify every byte of a C# source.
pub(super) fn mask(source: &str) -> Vec<Mask> {
    scan(source).mask
}

/// Classify every byte of a C# source.
///
/// Handles what a model or a skill author actually writes: `//` and `/* */`, `'c'`, `"…"` with
/// backslash escapes, `@"…"` with doubled quotes, `"""…"""` raw strings of any quote count, and `$`
/// interpolation — including a hole containing another string, which C# 11 allows and which a scanner
/// that stopped at the first quote would get wrong.
///
/// It is a lexer rather than a parser because every question asked of it is lexical. It is *this
/// arm's* rather than a shared one for the reason every arm's is: what counts as a comment and what
/// counts as a string are the two things no two languages here agree on.
///
/// # Why it compares bytes rather than slicing the source
///
/// Because the scan walks one **byte** at a time and a model's reply is not ASCII. `&source[at..]`
/// panics unless `at` falls on a character boundary, so an `é` inside a string would take the turn
/// down with a slice index error. Every delimiter here is ASCII, and an ASCII byte never appears
/// inside a multi-byte UTF-8 sequence, so a byte comparison finds exactly what a string comparison
/// would and cannot panic on the way.
pub(super) fn scan(source: &str) -> Scan {
    /// An open string literal, and how it ends.
    struct Literal {
        /// How many `"` close it — 1 for an ordinary or verbatim string, 3 or more for a raw one.
        quotes: usize,
        /// `@"…"`, where the only escape is a doubled quote.
        verbatim: bool,
        /// `$"…"`, where `{` opens a hole of code.
        interpolated: bool,
    }

    impl Literal {
        /// A `"""…"""` raw string, which escapes nothing and ends on a long enough run of quotes.
        fn raw(&self) -> bool {
            self.quotes >= 3
        }
    }

    let bytes = source.as_bytes();
    let mut out = vec![Mask::Code; bytes.len()];
    // The stack of literals we are inside, outermost first. A hole in the top literal is code again,
    // which is what makes `$"{items.First(x => $"{x}")}"` come out right.
    let mut open: Vec<Literal> = Vec::new();
    // How deep the braces are inside the innermost literal's hole. Zero means we are in that
    // literal's text.
    let mut holes: Vec<usize> = Vec::new();
    let mut index = 0usize;

    while index < bytes.len() {
        let in_text = open.last().is_some() && holes.last() == Some(&0);
        if in_text {
            let literal = open.last().expect("a literal is open");
            // A `"…"` or a `'…'` may not span a line in C#, so a newline reached inside one is a
            // literal the author left open. It ends here rather than swallowing the rest of the
            // file: the compiler will report it, and masking everything below would make the
            // module reader answer about the whole source.
            if bytes[index] == b'\n' && !literal.verbatim && !literal.raw() {
                open.pop();
                holes.pop();
                continue;
            }
            let run = quote_run(bytes, index);
            if run >= literal.quotes {
                // A verbatim string escapes a quote by doubling it, so a run of them is that many
                // pairs and — if the run is odd — the one that ends the literal. A raw string
                // escapes nothing and ends on the first run long enough to close it.
                let escapes = match literal.verbatim && !literal.raw() {
                    true => run - run % 2,
                    false => 0,
                };
                for offset in 0..run.min(escapes + literal.quotes) {
                    out[index + offset] = Mask::Text;
                }
                index += escapes;
                if escapes == run {
                    continue;
                }
                index += literal.quotes;
                open.pop();
                holes.pop();
                continue;
            }
            if !literal.verbatim && !literal.raw() && bytes[index] == b'\\' {
                out[index] = Mask::Text;
                if index + 1 < bytes.len() {
                    out[index + 1] = Mask::Text;
                }
                index += 2;
                continue;
            }
            if literal.interpolated && bytes[index] == b'{' {
                // `{{` is a literal brace in every interpolated string but a raw one, where a hole is
                // opened by as many braces as the `$`s that opened the literal — a shape a code
                // skill is vanishingly unlikely to write, and one this reads as text rather than
                // guessing at.
                if !literal.raw() && bytes.get(index + 1) == Some(&b'{') {
                    out[index] = Mask::Text;
                    out[index + 1] = Mask::Text;
                    index += 2;
                    continue;
                }
                if !literal.raw() {
                    out[index] = Mask::Text;
                    index += 1;
                    *holes.last_mut().expect("a literal is open") = 1;
                    continue;
                }
            }
            out[index] = Mask::Text;
            index += 1;
            continue;
        }

        // Code, or the inside of a hole — which is code with a brace count of its own.
        let inside_hole = !open.is_empty();
        let here = match inside_hole {
            true => Mask::Hole,
            false => Mask::Code,
        };
        match bytes[index] {
            b'/' if bytes.get(index + 1) == Some(&b'/') => {
                while index < bytes.len() && bytes[index] != b'\n' {
                    out[index] = Mask::Text;
                    index += 1;
                }
            }
            b'/' if bytes.get(index + 1) == Some(&b'*') => {
                out[index] = Mask::Text;
                out[index + 1] = Mask::Text;
                index += 2;
                let mut closed = false;
                while index < bytes.len() {
                    let end = bytes[index] == b'*' && bytes.get(index + 1) == Some(&b'/');
                    out[index] = Mask::Text;
                    if end {
                        out[index + 1] = Mask::Text;
                        index += 2;
                        closed = true;
                        break;
                    }
                    index += 1;
                }
                // A block comment does **not** nest in C#, so it ends at the first `*/` — and one
                // the author never closed swallowed the rest of the source.
                let _ = closed;
            }
            b'\'' => {
                out[index] = Mask::Text;
                index += 1;
                let mut closed = false;
                while index < bytes.len() && bytes[index] != b'\'' && bytes[index] != b'\n' {
                    let escape = bytes[index] == b'\\';
                    out[index] = Mask::Text;
                    index += 1;
                    if escape && index < bytes.len() {
                        out[index] = Mask::Text;
                        index += 1;
                    }
                }
                if index < bytes.len() && bytes[index] == b'\'' {
                    out[index] = Mask::Text;
                    index += 1;
                    closed = true;
                }
                let _ = closed;
            }
            b'"' | b'@' | b'$' => {
                let (prefix, verbatim, interpolated) = literal_prefix(bytes, index);
                let quotes = quote_run(bytes, index + prefix);
                if quotes == 0 {
                    // A stray `@` or `$` that opens nothing — a verbatim identifier, say.
                    out[index] = here;
                    index += 1;
                    continue;
                }
                for offset in 0..prefix + quotes {
                    out[index + offset] = Mask::Text;
                }
                index += prefix + quotes;
                open.push(Literal {
                    quotes,
                    verbatim,
                    interpolated,
                });
                holes.push(0);
            }
            b'{' if inside_hole => {
                out[index] = Mask::Hole;
                *holes.last_mut().expect("a hole is open") += 1;
                index += 1;
            }
            b'}' if inside_hole => {
                let depth = holes.last_mut().expect("a hole is open");
                *depth -= 1;
                // The brace that closes the hole is the literal's own delimiter.
                out[index] = match *depth {
                    0 => Mask::Text,
                    _ => Mask::Hole,
                };
                index += 1;
            }
            _ => {
                out[index] = here;
                index += 1;
            }
        }
    }
    Scan { mask: out }
}

/// How many `"` there are in a row at `index`.
fn quote_run(bytes: &[u8], index: usize) -> usize {
    bytes[index..]
        .iter()
        .take_while(|byte| **byte == b'"')
        .count()
}

/// The `@`/`$` prefix a literal opens with: how many bytes it is, and what it means.
fn literal_prefix(bytes: &[u8], index: usize) -> (usize, bool, bool) {
    let mut length = 0usize;
    let mut verbatim = false;
    let mut interpolated = false;
    while let Some(byte) = bytes.get(index + length) {
        match byte {
            b'@' => verbatim = true,
            b'$' => interpolated = true,
            _ => break,
        }
        length += 1;
    }
    (length, verbatim, interpolated)
}

#[cfg(test)]
#[path = "csharp.source.test.rs"]
mod tests;
